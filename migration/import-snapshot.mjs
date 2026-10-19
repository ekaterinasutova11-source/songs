import fs from 'node:fs';
import path from 'node:path';
import { Store, META_NAME, digest, cleanName, existingName } from './local-store.mjs';

const [snapshot, destination] = process.argv.slice(2);
if (!snapshot || !destination || fs.existsSync(path.join(destination, 'songs.sqlite'))) throw new Error('Pass snapshot and EMPTY data directory');
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json')));
if (manifest.status !== 'verified-staging-snapshot') throw new Error('Unverified snapshot');
const inventory = JSON.parse(fs.readFileSync(path.join(snapshot,'inventory.json')));
const settings = JSON.parse(fs.readFileSync(path.join(snapshot,'settings.json')));
const folders = inventory.folders.filter(f => !f.path.slice(inventory.root.length+1).includes('/'));
if (folders.length !== inventory.folders.length) throw new Error('Nested source folders require explicit migration support');
const store = new Store(destination);
try {
  store.transaction(() => {
    for (const f of folders) {
      const key = settings.students[f.resource_id]?.key;
      if (!key || cleanName(f.name) !== f.name) throw new Error('Missing key or unsupported folder name');
      store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run(f.resource_id,f.name,key);
    }
    for (const record of manifest.records) {
      const [folderName,...parts] = record.path.split('/');
      if (parts.length !== 1 || existingName(parts[0]) !== parts[0]) throw new Error('Unsupported file name');
      const folder = folders.find(f=>f.name.normalize('NFC')===folderName), name=parts[0];
      if (!folder) throw new Error('Unknown source folder');
      const data = fs.readFileSync(path.join(snapshot,'files',record.path));
      if (data.length !== record.bytes || digest(data) !== record.sha256) throw new Error('Snapshot integrity mismatch');
      if (name === META_NAME) {
        const meta = JSON.parse(data); if (!meta?.songs || Array.isArray(meta.songs)) throw new Error('Invalid source metadata');
      }
      store.saveFile(folder.resource_id,name,store.putBytes(data),false,record.modified);
    }
    store.db.prepare('INSERT INTO settings(name,value) VALUES(?,?)').run('source-captured-at',manifest.capturedAt);
  });
  const check=store.db.prepare('PRAGMA integrity_check').get();
  if (check.integrity_check !== 'ok') throw new Error('SQLite integrity failure');
  console.log(JSON.stringify({folders:store.folders().length,files:store.db.prepare('SELECT count(*) AS n FROM files').get().n,integrity:'ok'}));
} finally {store.close();}
