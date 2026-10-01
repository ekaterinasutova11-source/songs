import test from 'node:test';
import assert from 'node:assert/strict';
import { StandaloneMetronome, DRUM_PATTERNS } from '../metronome.js';

function setup() {
  const clicks = [];
  const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const ctx = { currentTime: 10, state: 'running', destination: {}, resume() { return Promise.resolve(); },
    createMediaElementSource() { throw new Error('Standalone must never need a song'); },
    createGain() { return { gain: { ...param }, connect() {}, disconnect() {} }; },
    createOscillator() { const node = { frequency: {}, connect() { return this; }, disconnect() {}, start(t) { clicks.push(t); }, stop() {} }; return node; } };
  globalThis.window = { AudioContext: function() { return ctx; } };
  const metro = new StandaloneMetronome();
  return { metro, ctx, clicks };
}
test('runs without an audio element, schedules exact intervals and avoids duplicates', () => {
  const { metro, ctx, clicks } = setup();
  try {
    metro.start();
    assert.equal(metro.audio, null); assert.equal(metro.source, null);
    assert.equal(clicks.length, 1); assert.ok(Math.abs(clicks[0] - 10.04) < 1e-9);
    metro.schedule(); assert.equal(clicks.length, 1);
    ctx.currentTime = 10.5; metro.schedule();
    assert.ok(Math.abs(clicks[1] - clicks[0] - 0.5) < 1e-9);
    ctx.currentTime = 11; metro.schedule();
    assert.ok(Math.abs(clicks[2] - clicks[1] - 0.5) < 1e-9);
  } finally { metro.stop(); }
});
test('tempo changes cancel old clicks; fractional tempo and volume work', () => {
  const { metro, ctx, clicks } = setup();
  try {
    metro.start(); metro.setTempo(93.6);
    assert.equal(metro.pending.size, 0);
    metro.setVolume(0.25); assert.equal(metro.gain.gain.value, 0.25);
    metro.schedule(); ctx.currentTime += 60 / 93.6; metro.schedule();
    assert.ok(Math.abs(clicks.at(-1) - clicks.at(-2) - 60 / 93.6) < 1e-9);
    metro.stop(); assert.equal(metro.pending.size, 0);
    const count = clicks.length; metro.schedule(); assert.equal(clicks.length, count);
  } finally { metro.stop(); }
});
test('long timer delays skip past beats instead of playing a burst', () => {
  const { metro, ctx, clicks } = setup();
  try { metro.start(); ctx.currentTime = 30; metro.schedule(); assert.equal(clicks.length, 2); assert.ok(clicks[1] >= 30); }
  finally { metro.stop(); }
});
test('accepts 1 through 999 BPM and rejects invalid input', () => {
  const metro = new StandaloneMetronome();
  for (const bpm of [1, 20, 120.5, 400, 999]) { metro.setTempo(bpm); assert.equal(metro.bpm, bpm); }
  for (const bpm of [0, -1, 1000, NaN, Infinity]) assert.throws(() => metro.setTempo(bpm), RangeError);
});
for (const pattern of Object.keys(DRUM_PATTERNS).filter(id => id !== 'click')) {
  test(`${pattern}: exact repeating bars without missing or duplicated hits`, () => {
    const { metro, ctx } = setup();
    const hits = [];
    metro.drum = (voice, time) => hits.push({voice, time});
    metro.setPattern(pattern);
    const bar = DRUM_PATTERNS[pattern].steps * 0.5 / (DRUM_PATTERNS[pattern].subdivisions || 4);
    try {
      metro.start();
      for (let t = 10; t < 10 + bar * 3 - 0.12; t += 0.025) { ctx.currentTime = t; metro.schedule(); }
      const first = hits.filter(h => h.time < 10.04 + bar - 1e-8);
      const second = hits.filter(h => h.time >= 10.04 + bar - 1e-8 && h.time < 10.04 + bar * 2 - 1e-8);
      assert.equal(first.length, second.length);
      first.forEach((h,i) => { assert.equal(h.voice, second[i].voice); assert.ok(Math.abs(second[i].time - h.time - bar) < 1e-8); });
      assert.equal(new Set(hits.map(h => `${h.voice}:${h.time}`)).size, hits.length);
      metro.setPattern('click'); assert.equal(metro.pending.size, 0);
    } finally { metro.stop(); }
  });
}

test('synthesizes every pattern instrument with valid envelopes and cancels it on stop', () => {
  const { metro, ctx } = setup();
  const sources = [];
  const param = () => ({ value: 0,
    setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); },
    linearRampToValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); },
    exponentialRampToValueAtTime(value, time) { assert.ok(value > 0 && Number.isFinite(value) && Number.isFinite(time)); } });
  const source = () => { const node = { frequency: param(), connect() { return this; }, disconnect() {},
    start(time) { assert.ok(time >= ctx.currentTime); }, stop(time) { if (time !== undefined) assert.ok(time > ctx.currentTime); else this.onended?.(); } };
    sources.push(node); return node; };
  ctx.sampleRate = 48000;
  ctx.createOscillator = source;
  ctx.createBufferSource = source;
  ctx.createGain = () => ({ gain: param(), connect() { return this; }, disconnect() {} });
  ctx.createBiquadFilter = () => ({ frequency: param(), Q: param(), connect() { return this; }, disconnect() {} });
  ctx.createBuffer = (_, length) => ({ duration: length / ctx.sampleRate, getChannelData() { return new Float32Array(length); } });
  metro.ctx = ctx; metro.gain = ctx.createGain();
  const instruments = new Set(Object.values(DRUM_PATTERNS).flatMap(pattern => Object.keys(pattern).filter(key => Array.isArray(pattern[key]))));
  for (const voice of instruments) metro.drum(voice, 10.04);
  assert.equal(sources.length, instruments.size);
  assert.equal(metro.pending.size, instruments.size);
  assert.ok(metro.noise.duration >= 0.32);
  metro.stop(); assert.equal(metro.pending.size, 0);
});
