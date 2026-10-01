import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOnsets, analyzeSamples } from '../tempo.js';
import { Metronome, fitTaps } from '../metronome.js';

const FPS = 11025 / 128;
function onsets(bpm, duration = 40) {
  const env = new Float32Array(Math.ceil(duration * FPS));
  const expected = [];
  for (let t = 0.3; t < duration - 0.3; t += 60 / bpm) {
    expected.push(t);
    const frame = t * FPS - 2;
    for (let i = Math.max(0, Math.floor(frame) - 2); i <= Math.min(env.length - 1, Math.ceil(frame) + 2); i++) {
      env[i] += Math.max(0, 1 - Math.abs(i - frame) / 2);
    }
  }
  return { env, expected };
}
for (const bpm of [60, 90, 120, 180, 220]) {
  test(`steady ${bpm} BPM: tempo, phase and no drift`, async () => {
    const { env, expected } = onsets(bpm);
    const result = await analyzeOnsets(env);
    assert.ok(Math.abs(result.bpm - bpm) < 0.2, `got ${result.bpm}`);
    const errors = result.beats.map(t => Math.min(...expected.map(b => Math.abs(t - b))));
    assert.ok(Math.max(...errors) < 0.025, `phase error ${Math.max(...errors)}`);
    assert.ok(result.beats.length >= expected.length - 2);
  });
}
test('silence does not generate a tempo', async () => {
  await assert.rejects(analyzeOnsets(new Float32Array(3000)));
});
test('changing tempo follows the recording instead of drifting on one grid', async () => {
  const env = new Float32Array(60 * FPS);
  const expected = [];
  for (let t = 0.4; t < 59; t += 60 / (100 + 20 * t / 60)) {
    expected.push(t);
    const frame = t * FPS - 2;
    for (let i = Math.floor(frame) - 2; i <= Math.ceil(frame) + 2; i++) env[i] = Math.max(0, 1 - Math.abs(i - frame) / 2);
  }
  const result = await analyzeOnsets(env);
  const near = result.beats.filter(t => Math.min(...expected.map(b => Math.abs(t - b))) < 0.035);
  assert.ok(near.length / result.beats.length > 0.95, `aligned ${near.length}/${result.beats.length}`);
  assert.ok(result.beats.length >= expected.length * 0.9);
});
test('leading and trailing silence are not filled with invented clicks', async () => {
  const { env } = onsets(120, 20);
  const padded = new Float32Array(40 * FPS);
  padded.set(env, Math.round(10 * FPS));
  const result = await analyzeOnsets(padded);
  assert.ok(result.beats[0] > 10);
  assert.ok(result.beats.at(-1) < 30);
});
test('FFT pipeline places synthetic audio clicks near their true times', async () => {
  const sr = 11025;
  const mono = new Float32Array(20 * sr);
  const expected = [];
  for (let t = 0.3; t < 19.7; t += 0.5) {
    expected.push(t);
    const start = Math.round(t * sr);
    for (let i = 0; i < 500; i++) mono[start + i] = Math.sin(i * 1.7) * Math.exp(-i / 60);
  }
  const result = await analyzeSamples(mono);
  assert.ok(Math.abs(result.bpm - 120) < 0.3, `got ${result.bpm}`);
  const errors = result.beats.map(t => Math.min(...expected.map(b => Math.abs(t - b))));
  assert.ok(Math.max(...errors) < 0.035, `phase error ${Math.max(...errors)}`);
});

function setup() {
  const listeners = new Map();
  const audio = { currentTime: 1, duration: 20, playbackRate: 1, paused: false, seeking: false, readyState: 4,
    addEventListener(ev, fn) { const list = listeners.get(ev) || []; list.push(fn); listeners.set(ev, list); },
    emit(ev) { for (const fn of listeners.get(ev) || []) fn(); } };
  const nodes = [];
  const ctx = { currentTime: 10, state: 'running',
    createOscillator() { const node = { frequency: {}, stops: [], connect() { return this; }, disconnect() {}, start(when) { this.when = when; }, stop(when) { this.stops.push(when); } }; nodes.push(node); return node; },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; } };
  const m = new Metronome(audio); m.ctx = ctx; m.gain = {}; m.on = true; m.setGrid(120, 1.1);
  return { m, audio, ctx, nodes };
}
test('pause, seek, speed change and stop cancel scheduled clicks', () => {
  for (const event of ['pause', 'seeking', 'ratechange', 'waiting', 'emptied', 'ended']) {
    const { m, audio, nodes } = setup(); m.schedule();
    assert.equal(nodes.length, 1);
    audio.emit(event);
    assert.equal(nodes[0].stops.length, 2); assert.equal(nodes[0].stops.at(-1), undefined); assert.equal(m.pending.size, 0);
  }
  const { m, nodes } = setup(); m.schedule(); m.stop(); assert.equal(nodes[0].stops.at(-1), undefined);
});
test('speed scales scheduled timing; no duplicate beats', () => {
  const { m, audio, nodes } = setup(); audio.playbackRate = 0.75;
  m.setGrid(120, 1.05); m.schedule(); m.schedule();
  assert.equal(nodes.length, 1); assert.ok(Math.abs(nodes[0].when - (10 + 0.05 / 0.75)) < 1e-9);
});
test('no click while audio is buffering', () => {
  const { m, audio, nodes } = setup(); audio.readyState = 2; m.schedule(); assert.equal(nodes.length, 0);
});
test('loop wrap resumes clicking at the beginning of the song', () => {
  const { m, audio, nodes } = setup();
  audio.currentTime = 19; m.schedule();
  audio.currentTime = 0.5; m.schedule();
  assert.equal(nodes.length, 2);
  assert.ok(Math.abs(nodes[1].when - 10.1) < 1e-9);
});
test('beat list does not invent beats after its end; shift moves every beat', () => {
  const { m } = setup(); m.setBeats([0.2, 0.7, 1.2], 120);
  assert.deepEqual(m.beatsBetween(1.3, 5), []);
  m.shift(0.01); assert.ok(Math.abs(m.beats[0] - 0.21) < 1e-9);
});
test('tap tempo tolerates a missing tap and preserves phase', () => {
  const fit = fitTaps([0.3, 0.8, 1.3, 2.3, 2.8, 3.3, 3.8]);
  assert.ok(Math.abs(fit.bpm - 120) < 1e-8);
  assert.ok(Math.abs(fit.offset - 0.3) < 1e-8);
});
