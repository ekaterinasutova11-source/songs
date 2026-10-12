import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createReserveClient} from '../reserve.js';
const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function client({corrupt = false, denied = false, wrongOffset = false} = {}) {
  const data = Buffer.from('actual original audio bytes');
  let chunks = 0;
  const transport = createReserveClient({endpoint, subtle: crypto.webcrypto.subtle, fetchImpl: async (url, opts) => {
    assert.equal(url, endpoint);
    assert.equal(opts.credentials, 'omit');
    const req = JSON.parse(opts.body);
    assert.equal(req.key, 'private-key');
    if (denied) return {ok: true, json: async () => ({ok: false, status: 403, error: 'Denied'})};
    const result = req.action === 'fileInfo' ? {size: data.length, sha256: digest(data), chunkSize: 5}
      : {start: wrongOffset ? req.start + 1 : req.start, length: req.length,
        data: (corrupt ? Buffer.alloc(req.length) : data.subarray(req.start, req.start + req.length)).toString('base64')};
    if (req.action === 'fileChunk') chunks++;
    return {ok: true, json: async () => ({ok: true, data: result})};
  }});
  return {transport, data, chunks: () => chunks};
}
test('reserve reconstructs real bytes from multiple chunks and verifies full SHA-256', async () => {
  const {transport, data, chunks} = client();
  const blob = await transport.file('original-folder-id', 'song.mp3', 'private-key');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), data);
  assert.equal(chunks(), Math.ceil(data.length / 5));
});
test('corrupt bytes, shifted ranges and denied access cannot become playable files', async () => {
  await assert.rejects(client({corrupt: true}).transport.file('id', 'song.mp3', 'private-key'), /целостности/);
  await assert.rejects(client({wrongOffset: true}).transport.file('id', 'song.mp3', 'private-key'), /фрагмент/);
  const denied = client({denied: true});
  await assert.rejects(denied.transport.file('id', 'song.mp3', 'private-key'), {status: 403});
  assert.equal(denied.chunks(), 0);
});
test('cancellation and arbitrary destinations are rejected before transmitting a key', async () => {
  const {transport, chunks} = client();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport.file('id', 'song.mp3', 'private-key', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(chunks(), 0);
  assert.throws(() => createReserveClient({endpoint: 'https://example.com/steal-key'}));
});
