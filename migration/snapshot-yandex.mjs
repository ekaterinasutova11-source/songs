// Read-only source capture. All private inventories stay under secrets/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(target)) throw new Error('Pass a NEW private snapshot directory');
const env = JSON.parse(fs.readFileSync('secrets/recovery-2026-10-19/cloud-version-after.json')).environment;
const headers = { Authorization: `OAuth ${env.DISK_TOKEN}` };
async function request(url, options = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
      if (!r.ok) { await r.body?.cancel(); throw new Error(`Source HTTP ${r.status}`); }
      return r;
    } catch (e) { if (i >= 2) throw e; await new Promise(resolve => setTimeout(resolve, 800 * (i + 1))); }
  }
}
async function api(resource, file) {
  return (await request(`https://cloud-api.yandex.net/v1/disk/resources${resource}?${new URLSearchParams({ path: file, limit: '1000', fields: resource ? 'href' : '_embedded.items,_embedded.total' })}`, { headers })).json();
}
async function readSettings() {
  const { href } = await api('/download', env.SETTINGS);
  const value = await (await request(href)).json();
  if (!value?.students || !Object.keys(value.students).length) throw new Error('Missing access settings');
  return value;
}
async function inventory() {
  const folders = [], files = [];
  async function walk(dir) {
    let offset = 0;
    for (;;) {
      const page = await (await request(`https://cloud-api.yandex.net/v1/disk/resources?${new URLSearchParams({path:dir,limit:'1000',offset:String(offset)})}`, {headers})).json();
      const items = page._embedded.items;
      for (const item of items) {
        if (item.type === 'dir') { folders.push(item); await walk(item.path); } else files.push(item);
      }
      offset += items.length;
      if (offset >= page._embedded.total) break;
      if (!items.length) throw new Error('Incomplete pagination');
    }
  }
  await walk(env.ROOT); return { folders, files };
}
const settings = await readSettings(), source = await inventory();
const previous = 'D:/ffmpeg-gui/songs-project-backups/2026-10-19-materials';
const old = new Map(JSON.parse(fs.readFileSync(path.join(previous, 'manifest.json'))).records.map(r => [r.path, r]));
fs.mkdirSync(path.join(target, 'files'), { recursive: true });
const records = [];
for (const item of source.files) {
  const relative = item.path.slice(env.ROOT.length + 1).normalize('NFC');
  const dest = path.resolve(target, 'files', relative), filesRoot = path.join(target, 'files');
  if (!dest.startsWith(filesRoot + path.sep)) throw new Error('Unsafe source path');
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  const cached = old.get(relative);
  const useCache = cached && cached.bytes === item.size && ((item.sha256 && item.sha256 === cached.sha256) || (item.md5 && item.md5 === cached.md5));
  if (useCache) fs.copyFileSync(path.join(previous, 'files', relative), dest);
  else {
    const { href } = await api('/download', item.path);
    const r = await request(href);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest, {flags:'wx'}));
  }
  const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5'); let size = 0;
  for await (const chunk of fs.createReadStream(dest)) { size += chunk.length; sha.update(chunk); md5.update(chunk); }
  const hash = sha.digest('hex'), md5sum = md5.digest('hex');
  if (size !== item.size || (item.sha256 && hash !== item.sha256) || (item.md5 && md5sum !== item.md5)) throw new Error('Source integrity mismatch');
  records.push({ path: relative, bytes: size, sha256: hash, md5: md5sum, modified: item.modified });
  if (records.length % 50 === 0) console.log(JSON.stringify({ verified: records.length, total: source.files.length }));
}
const after = await inventory(), settingsAfter = await readSettings();
const stamp = inventory => JSON.stringify(inventory.files.map(f => [f.path,f.size,f.modified,f.sha256,f.md5]).sort());
if (stamp(source) !== stamp(after) || JSON.stringify(settings) !== JSON.stringify(settingsAfter) ||
    JSON.stringify(source.folders.map(f=>[f.path,f.resource_id]).sort()) !== JSON.stringify(after.folders.map(f=>[f.path,f.resource_id]).sort())) throw new Error('Source changed during capture; repeat before import');
fs.writeFileSync(path.join(target, 'settings.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(target, 'inventory.json'), JSON.stringify({ root: env.ROOT, ...source }));
const manifest = { status:'verified-staging-snapshot', capturedAt:new Date().toISOString(), records,
  bytes:records.reduce((n,r)=>n+r.bytes,0), files:records.length, folders:source.folders.length };
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
console.log(JSON.stringify({status:manifest.status,files:manifest.files,folders:manifest.folders,bytes:manifest.bytes}));
