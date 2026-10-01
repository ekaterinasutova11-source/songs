import test from 'node:test';
import assert from 'node:assert/strict';
import { StandaloneMetronome } from '../metronome.js';

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
