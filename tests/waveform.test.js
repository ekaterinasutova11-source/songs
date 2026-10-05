import test from 'node:test';
import assert from 'node:assert/strict';
import { audioPeaks, loadWaveform } from '../waveform.js';

test('waveform follows actual silence, transients and quieter sections', () => {
  const samples = new Float32Array(400);
  samples[125] = -0.8; samples.fill(0.2, 200, 300);
  const peaks = audioPeaks([samples], 4);
  assert.deepEqual([...peaks].map(x => Math.round(x * 10)), [0, 8, 2, 0]);
});
test('opposite stereo phases do not erase sound; peaks include last sample', () => {
  const left = Float32Array.from([0, 0.4, 0, 0, 0.9]);
  const right = Float32Array.from(left, x => -x);
  assert.deepEqual([...audioPeaks([left, right], 2)].map(x => Math.round(x * 10)), [4, 9]);
  assert.equal(audioPeaks([left]).length, left.length);
  assert.equal(audioPeaks([]).length, 0);
});
test('cancelling a switched recording discards even an already decoded result', async () => {
  const controller = new AbortController();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  globalThis.window = { OfflineAudioContext: class {
    async decodeAudioData() { controller.abort(); return { numberOfChannels: 1, getChannelData: () => new Float32Array(4) }; }
  } };
  try { await assert.rejects(loadWaveform('audio', controller.signal), { name: 'AbortError' }); }
  finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});
