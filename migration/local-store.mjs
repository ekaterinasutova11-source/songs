// Selectel storage: SQLite transactions reference immutable, SHA-256 addressed blobs.
// No source credentials or pupil keys belong in the repository.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const META_NAME = 'Данные сайта (не удалять).json';
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function cleanName(value) {
  const name = String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name === '.' || name === '..' || name.length > 150) throw new HttpError(400, 'Некорректное имя');
  return name;
}
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export function existingName(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value) || value.length > 255) throw new HttpError(400, 'Некорректное имя файла');
  return value;
}
export const newKey = () => crypto.randomBytes(24).toString('base64url');
export class Store {
  constructor(directory) {
    this.directory = path.resolve(directory);
    for (const dir of ['', 'blobs', 'tmp']) fs.mkdirSync(path.join(this.directory, dir), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.directory, 'songs.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,key TEXT NOT NULL UNIQUE,deleted INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS active_folder_names ON folders(name) WHERE deleted=0;
      CREATE TABLE IF NOT EXISTS files(folder TEXT NOT NULL REFERENCES folders(id),name TEXT NOT NULL,blob TEXT NOT NULL,size INTEGER NOT NULL,modified TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(folder,name));
      CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS used_uploads(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // Additive migration preserves existing pupil IDs, keys, files and backups.
    this.transaction(() => {
      const columns = new Set(this.db.prepare('PRAGMA table_info(folders)').all().map(c => c.name));
      if (!columns.has('archived_at')) this.db.exec('ALTER TABLE folders ADD COLUMN archived_at TEXT');
      if (!columns.has('access_version')) this.db.exec('ALTER TABLE folders ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0');
      if (!columns.has('kind')) this.db.exec("ALTER TABLE folders ADD COLUMN kind TEXT NOT NULL DEFAULT 'individual'");
      this.db.exec(`CREATE TABLE IF NOT EXISTS space_memberships(
        space TEXT NOT NULL REFERENCES folders(id),member TEXT NOT NULL REFERENCES folders(id),
        PRIMARY KEY(space,member),CHECK(space<>member));`);
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(action, detail) {
    this.db.prepare('INSERT INTO revisions(at,action,detail) VALUES(?,?,?)').run(new Date().toISOString(), action, JSON.stringify(detail));
  }
  blobPath(hash) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid blob hash');
    return path.join(this.directory, 'blobs', hash);
  }
  putBytes(bytes) {
    const hash = digest(bytes), target = this.blobPath(hash);
    if (!fs.existsSync(target)) {
      const temp = path.join(this.directory, 'tmp', crypto.randomUUID());
      fs.writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, target);
    }
    return { blob: hash, size: bytes.length };
  }
  folders({ includeArchived = false } = {}) {
    return this.db.prepare(`SELECT * FROM folders WHERE deleted=0${includeArchived ? '' : ' AND archived_at IS NULL'} ORDER BY name`).all();
  }
  folder(id) {
    const item = this.db.prepare('SELECT * FROM folders WHERE id=? AND deleted=0').get(id);
    if (!item) throw new HttpError(403, 'Нет доступа к этой папке');
    return item;
  }
  members(space) {
    return this.db.prepare('SELECT member FROM space_memberships WHERE space=? ORDER BY member').all(space).map(row => row.member);
  }
  canReadSpace(member, space) {
    if (member === space) return true;
    return !!this.db.prepare(`SELECT 1 FROM space_memberships m JOIN folders f ON f.id=m.space
      WHERE m.member=? AND m.space=? AND f.deleted=0 AND f.archived_at IS NULL AND f.kind IN ('duet','ensemble')`).get(member, space);
  }
  accessibleSpaces(member) {
    return this.folders().filter(folder => this.canReadSpace(member, folder.id));
  }
  setMembers(space, kind, members) {
    if (!['duet','ensemble'].includes(kind) || !Array.isArray(members) || members.length > 100 ||
      members.some(id => typeof id !== 'string') || new Set(members).size !== members.length) throw new HttpError(400, 'Некорректные участники');
    const target = this.folder(space);
    for (const id of members) {
      const member = this.folder(id);
      if (id === space || member.kind !== 'individual') throw new HttpError(400, 'Участником должен быть отдельный ученик');
    }
    const before = this.members(space), next = new Set(members), previous = new Set(before);
    // Converting a principal which already joins another space into a group
    // would make indirect access ambiguous; keep membership strictly direct.
    if (this.db.prepare('SELECT 1 FROM space_memberships WHERE member=?').get(space)) throw new HttpError(400, 'Это пространство уже является участником группы');
    this.audit('space-members', {space, kind, previousKind: target.kind, before, members});
    this.db.prepare('UPDATE folders SET kind=? WHERE id=?').run(kind, space);
    this.db.prepare('DELETE FROM space_memberships WHERE space=?').run(space);
    for (const member of members) this.db.prepare('INSERT INTO space_memberships(space,member) VALUES(?,?)').run(space, member);
    for (const id of new Set([...before, ...members])) {
      if (previous.has(id) !== next.has(id)) this.db.prepare('UPDATE folders SET access_version=access_version+1 WHERE id=?').run(id);
    }
  }
  file(folder, name) {
    const file = this.db.prepare('SELECT * FROM files WHERE folder=? AND name=? AND deleted=0').get(folder, existingName(name));
    if (!file) throw new HttpError(404, 'Файл не найден');
    return file;
  }
  saveFile(folder, name, value, overwrite = true, modified = new Date().toISOString()) {
    this.folder(folder); name = existingName(name);
    const old = this.db.prepare('SELECT * FROM files WHERE folder=? AND name=?').get(folder, name);
    if (old && !old.deleted && !overwrite) throw new HttpError(409, 'Файл с таким именем уже есть');
    this.audit('file-write', { folder, name, previous: old || null });
    this.db.prepare(`INSERT INTO files(folder,name,blob,size,modified,deleted) VALUES(?,?,?,?,?,0)
      ON CONFLICT(folder,name) DO UPDATE SET blob=excluded.blob,size=excluded.size,modified=excluded.modified,deleted=0`).run(folder,name,value.blob,value.size,modified);
  }
  meta(folder) {
    const row = this.db.prepare('SELECT blob FROM files WHERE folder=? AND name=? AND deleted=0').get(folder, META_NAME);
    if (!row) return { songs: {} };
    const meta = JSON.parse(fs.readFileSync(this.blobPath(row.blob), 'utf8'));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) || !meta.songs || typeof meta.songs !== 'object' || Array.isArray(meta.songs)) throw new HttpError(503, 'Метаданные повреждены');
    return meta;
  }
  saveMeta(folder, meta) { this.saveFile(folder, META_NAME, this.putBytes(Buffer.from(JSON.stringify(meta, null, 1)))); }
  folderData(folder) {
    const files = this.db.prepare('SELECT name,size,modified FROM files WHERE folder=? AND deleted=0 AND name<>? ORDER BY name').all(folder, META_NAME);
    return { files, meta: this.meta(folder).songs };
  }
  close() { this.db.close(); }
}

export function cleanPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Некорректные метаданные');
  const out = {};
  for (const [key, limit] of Object.entries({ impulse: 40, notes: 5000, translation: 50000 })) {
    if (patch[key] === undefined) continue;
    let value = String(patch[key] ?? '');
    if (key === 'impulse') {
      value = value.replace(/\s+/g, ' ').trim();
      if (value.split(' ').filter(Boolean).length > 2) throw new HttpError(400, 'Импульс — не больше двух слов');
    }
    if (value.length > limit) throw new HttpError(400, 'Слишком длинный текст');
    out[key] = value;
  }
  if (patch.tempo && typeof patch.tempo === 'object') {
    out.tempo = Object.create(null);
    for (const [file, t] of Object.entries(patch.tempo)) {
      const name = cleanName(file);
      if (!t || !Number.isFinite(+t.bpm) || +t.bpm <= 20 || +t.bpm >= 400) { out.tempo[name] = null; continue; }
      const value = { bpm: Math.round(+t.bpm * 1000) / 1000, offset: Number.isFinite(+t.offset) ? Math.round(+t.offset * 1000) / 1000 : 0 };
      if (typeof t.beats === 'string' && /^-?\d+(,-?\d+)*$/.test(t.beats) && t.beats.length < 20000) value.beats = t.beats;
      if (t.manual) value.manual = true;
      out.tempo[name] = value;
    }
  }
  return out;
}
