// Read-only audit. Private inventories and credentials never enter the repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FUNCTION_URL, GOOGLE_RESERVE_URL } from '../config.js';

const base = process.argv[2];
if (!base) throw new Error('Pass the previous project directory as the first argument');
const output = path.resolve('secrets', 'audit-2026-10-19');
fs.mkdirSync(output, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2));
const env = name => Object.fromEntries(fs.readFileSync(path.join('secrets', name), 'utf8')
  .split(/\r?\n/).map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(m => [m[1], m[2].trim()]));
const hashFile = async (file, algorithm, start, end) => {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file, start === undefined ? {} : { start, end })) hash.update(chunk);
  return hash.digest('hex');
};
const index = JSON.parse(fs.readFileSync(path.join(base, 'outputs', 'sad-zvuka-reserve-index-updated.json'), 'utf8'));
const archives = [index.archive, ...(index.extraArchives || [])];
const archiveResults = [];
for (const archive of archives) {
  const file = path.join(base, 'outputs', archive.name);
  archiveResults.push({ name: archive.name, expectedSize: archive.size, size: fs.statSync(file).size,
    md5Matches: await hashFile(file, 'md5') === archive.md5 });
}
const checks = [];
for (const student of index.students) {
  for (const file of student.files) {
    const archive = archives.find(a => a.name === (file.archive || index.archive.name));
    const validBounds = archive && Number.isSafeInteger(file.offset) && file.offset >= 0 &&
      Number.isSafeInteger(file.size) && file.size >= 0 && file.offset + file.size <= archive.size;
    const hash = validBounds && (file.size === 0 ? crypto.createHash('sha256').digest('hex') :
      await hashFile(path.join(base, 'outputs', archive.name), 'sha256', file.offset, file.offset + file.size - 1));
    checks.push({ studentId: student.id, name: file.name, size: file.size,
      archive: file.archive || index.archive.name, matches: hash === file.sha256 });
  }
}
save('local-file-verification.json', checks);
const summary = { checkedAt: new Date().toISOString(), localReserve: {
  capturedAt: index.capturedAt, restoredTextsAt: index.restoredTextsAt,
  spaces: index.students.length, files: checks.length, verified: checks.filter(f => f.matches).length,
  bytes: checks.reduce((n, f) => n + f.size, 0), archives: archiveResults,
  missingEntries: index.missing.length,
  metadataUnavailable: index.students.filter(s => s.metadataUnavailable).length,
} };
save('summary.json', summary);
console.log(JSON.stringify({ stage: 'local', ...summary.localReserve }));

const token = env('yandex.env').YANDEX_DISK_TOKEN;
const root = 'disk:/Песни для Notion';
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
async function list(folder) {
  const items = [];
  let total;
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ path: folder, limit: '1000', offset: String(offset),
      fields: '_embedded.total,_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.modified,_embedded.items.md5,_embedded.items.sha256' });
    const result = await (await request(`https://cloud-api.yandex.net/v1/disk/resources?${query}`,
      { headers: { Authorization: `OAuth ${token}` } })).json();
    const page = result._embedded;
    if (!page || !Array.isArray(page.items)) throw new Error('Invalid listing');
    total = page.total;
    items.push(...page.items);
    if (items.length >= total) return items;
    if (!page.items.length) throw new Error('Incomplete listing');
  }
}
const files = [], folders = [], errors = [];
async function walk(folder) {
  let items;
  try { items = await list(folder); }
  catch (error) { errors.push({ path: folder, error: error.message }); return; }
  for (const item of items) {
    if (item.type === 'dir') { folders.push(item); await walk(item.path); }
    else files.push(item);
  }
}
await walk(root);
save('yandex-inventory.json', { root, folders, files, errors });
const extensions = {};
for (const file of files) {
  const ext = path.extname(file.name).toLowerCase() || '(none)';
  extensions[ext] ??= { files: 0, bytes: 0 };
  extensions[ext].files++; extensions[ext].bytes += file.size || 0;
}
summary.yandex = { accessible: folders.length > 0 || files.length > 0,
  complete: errors.length === 0, spaces: folders.filter(f => f.path.slice(root.length + 1).split('/').length === 1).length,
  folders: folders.length, files: files.length, bytes: files.reduce((n, f) => n + (f.size || 0), 0),
  errors: errors.length, extensions };
save('summary.json', summary);
console.log(JSON.stringify({ stage: 'yandex', ...summary.yandex }));

const teacher = env('teacher.env').TEACHER_KEY;
// The legacy primary library handler may automatically create missing access keys.
// Keep that request opt-in; direct Disk inventory and Google reads do not mutate.
const endpoints = [['googleReserve', GOOGLE_RESERVE_URL]];
if (process.argv.includes('--probe-primary-library')) endpoints.unshift(['primary', FUNCTION_URL]);
for (const [name, url] of endpoints) {
  try {
    const result = await (await request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'library', key: teacher }) })).json();
    save(`${name}-library.json`, result);
    console.log(JSON.stringify({ stage: name, keys: Object.keys(result) }));
    const data = result.data || result;
    summary[name] = { responded: true, applicationOk: result.ok !== false,
      role: data.role, spaces: data.students?.length,
      files: data.students?.reduce((n, s) => n + (s.files?.length || 0), 0), reserve: data.reserve };
  } catch (error) {
    summary[name] = { responded: false, error: error.message };
    console.log(JSON.stringify({ stage: name, ...summary[name] }));
  }
  save('summary.json', summary);
}

const comparison = { unchanged: [], changed: [], sourceOnly: [], reserveOnly: [] };
const indexed = new Map();
for (const student of index.students) for (const file of student.files) {
  indexed.set(`${student.name.normalize('NFC')}/${file.name.normalize('NFC')}`, file);
}
for (const file of files) {
  const relative = file.path.slice(root.length + 1).normalize('NFC');
  const old = indexed.get(relative);
  if (!old) comparison.sourceOnly.push(file);
  else {
    const identical = file.sha256 && old.sha256 ? file.sha256 === old.sha256 : null;
    comparison[identical === true ? 'unchanged' : 'changed'].push({ path: file.path,
      sizeMatches: file.size === old.size, sha256Matches: identical });
    indexed.delete(relative);
  }
}
comparison.reserveOnly = [...indexed.keys()];
save('comparison.json', comparison);
summary.comparison = Object.fromEntries(Object.entries(comparison).map(([k, v]) => [k, v.length]));
const remote = JSON.parse(fs.readFileSync(path.join(output, 'googleReserve-library.json'), 'utf8'));
if (remote.ok === true && remote.data?.students) {
  summary.googleReserve.sampleReads = [];
  for (const extension of ['.txt', '.mp3']) {
    const student = remote.data.students.find(s => s.files.some(f => f.name.toLowerCase().endsWith(extension)));
    const file = student?.files.find(f => f.name.toLowerCase().endsWith(extension));
    if (!file) continue;
    try {
      const length = Math.min(file.size, 65536);
      const response = await (await request(GOOGLE_RESERVE_URL, { method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ action: 'fileChunk', key: teacher, folder: student.id,
          name: file.name, start: 0, length }) })).json();
      save(`google-sample${extension}.json`, response);
      const originalStudent = index.students.find(s => s.id === student.id);
      const originalFile = originalStudent?.files.find(f => f.name === file.name);
      const data = response.data;
      const base64 = data?.data;
      let matchesLocal = false;
      if (base64 && originalFile) {
        const handle = fs.openSync(path.join(base, 'outputs', originalFile.archive || index.archive.name), 'r');
        try {
          const expected = Buffer.alloc(length);
          const read = fs.readSync(handle, expected, 0, length, originalFile.offset);
          matchesLocal = read === length && expected.equals(Buffer.from(base64, 'base64'));
        } finally { fs.closeSync(handle); }
      }
      summary.googleReserve.sampleReads.push({ extension, requestedBytes: length,
        applicationOk: response.ok === true, responseKeys: Object.keys(data || {}), matchesLocal });
    } catch (error) { summary.googleReserve.sampleReads.push({ extension, error: error.message }); }
  }
}
save('summary.json', summary);
console.log(JSON.stringify({ stage: 'comparison', ...summary.comparison, reserve: summary.googleReserve }));
