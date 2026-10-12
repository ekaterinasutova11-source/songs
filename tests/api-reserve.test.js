import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const google = 'https://script.google.com/macros/s/test-deployment/exec';
const primary = 'https://primary.invalid/api';
const source = (await fs.readFile(new URL('../api.js', import.meta.url), 'utf8'))
  .replace("import { FUNCTION_URL, GOOGLE_RESERVE_URL } from './config.js?v=reserve1';",
    `const FUNCTION_URL = ${JSON.stringify(primary)}, GOOGLE_RESERVE_URL = ${JSON.stringify(google)};`)
  .replace("from './reserve.js?v=reserve1'", `from '${new URL('../reserve.js', import.meta.url).href}'`);
let sequence = 0;
async function api() {
  return import('data:text/javascript;base64,' + Buffer.from(source + `\n// instance ${sequence++}`).toString('base64'));
}
const response = (status, body) => ({ok: status < 400, status, json: async () => body});
test('server outage falls back to Google; writes stay blocked until a fresh primary library loads', async () => {
  const oldFetch = globalThis.fetch, oldLocation = globalThis.location;
  let restored = false, googleCalls = 0, writes = 0;
  globalThis.location = {hostname: 'production.invalid', search: ''};
  globalThis.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body);
    assert.equal(req.key, 'existing-link-key');
    if (url === google) {
      googleCalls++;
      return response(200, {ok: true, data: {role: 'student', students: [{id: 'old-id'}], reserve: {readOnly: true}}});
    }
    assert.equal(url, primary);
    if (req.action !== 'library') writes++;
    return restored ? response(200, {role: 'student', students: [{id: 'old-id'}]}) : response(502, {error: 'Unavailable'});
  };
  try {
    const client = await api(); client.setKey('existing-link-key');
    assert.equal((await client.call('library')).reserve.readOnly, true);
    await assert.rejects(client.call('saveMeta', {folder: 'old-id', patch: {translation: 'new'}}), /Изменения пока недоступны/);
    assert.equal(writes, 0); assert.equal(googleCalls, 1);
    restored = true; await client.call('library');
    assert.equal(client.storageState().reserve, false);
    await client.call('saveMeta'); assert.equal(writes, 1);
  } finally {globalThis.fetch = oldFetch; globalThis.location = oldLocation;}
});
test('primary access denial cannot be bypassed using an older Google snapshot', async () => {
  const oldFetch = globalThis.fetch, oldLocation = globalThis.location;
  globalThis.location = {hostname: 'production.invalid', search: ''};
  let requests = 0;
  globalThis.fetch = async url => {
    requests++; assert.equal(url, primary);
    return response(403, {error: 'Link revoked'});
  };
  try {
    const client = await api(); client.setKey('revoked-key');
    await assert.rejects(client.call('library'), {status: 403});
    assert.equal(requests, 1); assert.equal(client.storageState().reserve, false);
  } finally {globalThis.fetch = oldFetch; globalThis.location = oldLocation;}
});
