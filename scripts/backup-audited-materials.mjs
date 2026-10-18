// Local snapshot only. Yandex calls are GETs; no remote writes or key exports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const previous = process.argv[2], destination = process.argv[3];
if (!previous || !destination) throw new Error('Pass previous project and a NEW snapshot directory');
const audit = path.resolve('secrets/audit-2026-10-19');
const inventory = JSON.parse(fs.readFileSync(path.join(audit, 'yandex-inventory.json'), 'utf8'));
if (inventory.errors.length) throw new Error('Inventory is incomplete');
const index = JSON.parse(fs.readFileSync(path.join(previous, 'outputs/sad-zvuka-reserve-index-updated.json'), 'utf8'));
const verified = JSON.parse(fs.readFileSync(path.join(audit, 'local-file-verification.json'), 'utf8'));
if (verified.some(f => !f.matches)) throw new Error('Local reserve verification failed');
const token = fs.readFileSync('secrets/yandex.env', 'utf8').match(/^YANDEX_DISK_TOKEN=(.*)$/m)?.[1].trim();
if (!token) throw new Error('No existing token');
const target = path.resolve(destination), filesRoot = path.join(target, 'files');
if (fs.existsSync(target)) throw new Error('Refusing to overwrite an existing snapshot');
fs.mkdirSync(filesRoot, { recursive: true });
const records = [], failures = [];
const manifest = { startedAt: new Date().toISOString(), status: 'incomplete',
  sourceRoot: inventory.root, expectedFiles: inventory.files.length, records, failures };
const save = () => fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
save();
const cached = new Map();
for (const student of index.students) for (const file of student.files)
  cached.set(`${student.name.normalize('NFC')}/${file.name.normalize('NFC')}`, file);
for (const item of inventory.files) {
  const relative = item.path.slice(inventory.root.length + 1).normalize('NFC');
  const output = path.resolve(filesRoot, relative);
  if (!output.startsWith(filesRoot + path.sep)) throw new Error('Unsafe destination path');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const old = cached.get(relative);
  let stream, source;
  try {
    if (old && item.sha256 && old.sha256 === item.sha256) {
      stream = fs.createReadStream(path.join(previous, 'outputs', old.archive || index.archive.name),
        { start: old.offset, end: old.offset + old.size - 1 });
      source = 'verified-local-archive';
    } else {
      const query = new URLSearchParams({ path: item.path });
      const info = await fetch(`https://cloud-api.yandex.net/v1/disk/resources/download?${query}`,
        { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(30000) });
      if (!info.ok) throw new Error(`Download link HTTP ${info.status}`);
      const { href } = await info.json();
      const response = await fetch(href, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
      stream = Readable.fromWeb(response.body);
      source = 'yandex';
    }
    const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
    let bytes = 0;
    stream.on('data', chunk => { sha.update(chunk); md5.update(chunk); bytes += chunk.length; });
    await pipeline(stream, fs.createWriteStream(output, { flags: 'wx' }));
    const sha256 = sha.digest('hex'), md5sum = md5.digest('hex');
    if (bytes !== item.size || (item.sha256 && item.sha256 !== sha256) || (item.md5 && item.md5 !== md5sum))
      throw new Error('Size or source checksum mismatch');
    records.push({ path: relative, bytes, sha256, md5: md5sum, source, modified: item.modified });
  } catch (error) { failures.push({ path: relative, error: error.message }); }
  save();
  if (records.length % 50 === 0) console.log(JSON.stringify({ verified: records.length, failed: failures.length }));
}
manifest.completedAt = new Date().toISOString();
manifest.status = !failures.length && records.length === inventory.files.length ? 'complete-for-inventoried-root' : 'incomplete';
manifest.bytes = records.reduce((n, f) => n + f.bytes, 0);
save();
console.log(JSON.stringify({ status: manifest.status, verified: records.length,
  failed: failures.length, bytes: manifest.bytes, destination: target }));
