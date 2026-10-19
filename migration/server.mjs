import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Store, HttpError, META_NAME, cleanName, existingName, cleanPatch, digest, newKey } from './local-store.mjs';
import { pathToFileURL } from 'node:url';

const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const dictionary = value => Object.assign(Object.create(null), value || {});
const songKey = value => {
  const key = String(value || '');
  if (!key || key.length > 500 || ['__proto__','constructor','prototype'].includes(key)) throw new HttpError(400, 'Некорректный ключ песни');
  return key;
};
export function createApp({ directory, teacherKey, signingKey, baseUrl, readOnly = true, origins = [], maxUpload = 268435456 }) {
  if (!teacherKey || !signingKey || !/^https?:\/\//.test(baseUrl)) throw new Error('Missing application configuration');
  const store = new Store(directory);
  const allowed = new Set([new URL(baseUrl).origin, ...origins]);
  const assertWritable = () => { if (readOnly) throw new HttpError(503, 'Идёт проверка переноса. Изменения пока доступны только на рабочем сайте.'); };
  function authenticate(key) {
    if (typeof key !== 'string' || !key) throw new HttpError(401, 'Нет ключа доступа');
    if (safeEqual(key, teacherKey)) return { teacher: true, principal: digest(teacherKey) };
    const own = store.folders().find(f => safeEqual(f.key, key));
    if (!own) throw new HttpError(403, 'Ссылка устарела или неверна — попросите новую у преподавателя');
    return { teacher: false, own, principal: digest(key) };
  }
  function folderFor(auth, id) {
    if (!auth.teacher && auth.own.id !== id) throw new HttpError(403, 'Нет доступа к этой папке');
    return store.folder(id);
  }
  const teacherOnly = auth => { if (!auth.teacher) throw new HttpError(403, 'Это может только преподаватель'); };
  function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${crypto.createHmac('sha256', signingKey).update(data).digest('base64url')}`;
  }
  function verify(token, purpose) {
    if (typeof token !== 'string' || token.length > 4096) throw new HttpError(403, 'Неверная ссылка');
    const [data, mac, extra] = token.split('.');
    const expected = crypto.createHmac('sha256', signingKey).update(data || '').digest('base64url');
    if (extra || !safeEqual(mac, expected)) throw new HttpError(403, 'Неверная ссылка');
    let payload;
    try { payload = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { throw new HttpError(403, 'Неверная ссылка'); }
    if (payload.purpose !== purpose || payload.expires < Date.now()) throw new HttpError(403, 'Ссылка истекла — откройте файл заново');
    const folder = store.folder(payload.folder);
    if (!safeEqual(payload.principal, digest(teacherKey)) && !safeEqual(payload.principal, digest(folder.key))) throw new HttpError(403, 'Доступ отозван');
    return payload;
  }
  function handle(body) {
    const auth = authenticate(body.key), action = body.action;
    if (action === 'library') {
      const folders = auth.teacher ? store.folders() : [auth.own];
      return { role: auth.teacher ? 'teacher' : 'student', students: folders.map(f => ({ id: f.id, name: f.name, ...(auth.teacher ? { key: f.key } : {}), ...store.folderData(f.id) })) };
    }
    if (action === 'url' || action === 'uploadUrl') {
      const folder = folderFor(auth, body.folder), name = action === 'url' ? existingName(body.name) : cleanName(body.name);
      if (name === META_NAME) throw new HttpError(403, 'Служебный файл');
      if (action === 'uploadUrl') assertWritable(); else store.file(folder.id, name);
      const purpose = action === 'url' ? 'media' : 'upload';
      const payload = { purpose, folder: folder.id, name, principal: auth.principal, expires: Date.now() + (purpose === 'media' ? 3600000 : 900000), nonce: crypto.randomUUID(), overwrite: !!body.overwrite };
      return { href: `${baseUrl}/${purpose}?token=${sign(payload)}` };
    }
    assertWritable();
    return store.transaction(() => {
      switch (action) {
        case 'saveText': {
          const folder = folderFor(auth, body.folder), name = cleanName(body.name), text = String(body.text ?? '');
          if (!/\.txt$/i.test(name) || Buffer.byteLength(text) > 1048576) throw new HttpError(400, 'Некорректный текстовый файл');
          store.saveFile(folder.id, name, store.putBytes(Buffer.from(text))); break;
        }
        case 'rename': {
          const f = folderFor(auth, body.folder), oldName = existingName(body.name), name = cleanName(body.newName);
          if ([oldName, name].includes(META_NAME)) throw new HttpError(403, 'Служебный файл');
          const old = store.file(f.id, oldName);
          if (oldName === name) break;
          store.saveFile(f.id, name, old, false);
          store.db.prepare('UPDATE files SET deleted=1 WHERE folder=? AND name=?').run(f.id, oldName);
          store.audit('file-rename', { folder: f.id, oldName, name }); break;
        }
        case 'delete': {
          const f = folderFor(auth, body.folder), file = store.file(f.id, body.name);
          if (file.name === META_NAME) throw new HttpError(403, 'Служебный файл');
          store.audit('file-delete', file);
          store.db.prepare('UPDATE files SET deleted=1 WHERE folder=? AND name=?').run(f.id, file.name); break;
        }
        case 'copyTo': {
          teacherOnly(auth);
          const from = folderFor(auth, body.folder), to = folderFor(auth, body.to);
          if (!Array.isArray(body.names) || body.names.length > 300) throw new HttpError(400, 'Некорректный список файлов');
          for (const name of body.names) {
            if (cleanName(name) === META_NAME) throw new HttpError(403, 'Служебный файл');
            const source = store.file(from.id, name);
            try { store.file(to.id, name); } catch (error) { if (error.status !== 404) throw error; store.saveFile(to.id, name, source, false); }
          }
          const key = songKey(body.song), src = store.meta(from.id).songs[key];
          if (src) {
            const dst = store.meta(to.id); dst.songs = dictionary(dst.songs);
            const { impulse, ...rest } = src;
            dst.songs[key] = { ...rest, ...dst.songs[key] }; store.saveMeta(to.id, dst);
          }
          break;
        }
        case 'saveMeta': {
          const f = folderFor(auth, body.folder), key = songKey(body.song), meta = store.meta(f.id);
          meta.songs = dictionary(meta.songs);
          if (body.remove) delete meta.songs[key];
          else {
            const entry = meta.songs[key] || {}, patch = cleanPatch(body.patch), tempo = dictionary(entry.tempo);
            for (const [file, value] of Object.entries(patch.tempo || {})) { if (value) tempo[file] = value; else delete tempo[file]; }
            for (const [oldName, name] of Object.entries(body.renameFiles || {})) {
              if (tempo[oldName]) { tempo[cleanName(name)] = tempo[oldName]; delete tempo[oldName]; }
            }
            const next = { ...entry, ...patch, tempo }, target = body.renameTo ? songKey(body.renameTo) : key;
            for (const k of Object.keys(next)) if (next[k] === '' || (k === 'tempo' && !Object.keys(tempo).length)) delete next[k];
            if (target !== key) delete meta.songs[key];
            if (Object.keys(next).length) meta.songs[target] = next; else delete meta.songs[target];
          }
          store.saveMeta(f.id, meta); break;
        }
        case 'createStudent': {
          teacherOnly(auth);
          store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run(crypto.randomUUID(), cleanName(body.name), newKey());
          store.audit('folder-create', {}); break;
        }
        case 'renameStudent': {
          teacherOnly(auth); const f = folderFor(auth, body.folder);
          store.audit('folder-rename', { id: f.id, previous: f.name });
          store.db.prepare('UPDATE folders SET name=? WHERE id=?').run(cleanName(body.newName), f.id); break;
        }
        case 'deleteStudent': {
          teacherOnly(auth); const f = folderFor(auth, body.folder);
          store.audit('folder-delete', f);
          store.db.prepare('UPDATE folders SET deleted=1 WHERE id=?').run(f.id); break;
        }
        case 'resetLink': {
          teacherOnly(auth); const f = folderFor(auth, body.folder), key = newKey();
          store.audit('link-reset', f);
          store.db.prepare('UPDATE folders SET key=? WHERE id=?').run(key, f.id);
          return { key };
        }
        default: throw new HttpError(400, 'Неизвестное действие');
      }
      return { ok: true };
    });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    }
    let temporary;
    try {
      if (origin && !allowed.has(origin)) throw new HttpError(403, 'Источник запроса не разрешён');
      const url = new URL(req.url, baseUrl);
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      if (url.pathname === '/healthz' && req.method === 'GET') {
        store.db.prepare('SELECT 1').get(); res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, readOnly })); return;
      }
      if (url.pathname === '/api' && req.method === 'POST') {
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 2097152) throw new HttpError(413, 'Запрос слишком большой'); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new HttpError(400, 'Некорректный JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Некорректный запрос');
        const result = handle(body);
        res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(result)); return;
      }
      if (url.pathname === '/media' && ['GET','HEAD'].includes(req.method)) {
        const payload = verify(url.searchParams.get('token'), 'media'), file = store.file(payload.folder, payload.name);
        const handle = await fsp.open(store.blobPath(file.blob), 'r');
        try {
          let start = 0, end = file.size - 1, partial = false;
          if (req.headers.range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (!m || (!m[1] && !m[2]) || file.size === 0) { res.setHeader('Content-Range', `bytes */${file.size}`); throw new HttpError(416, 'Неверный диапазон'); }
            if (!m[1]) { const suffix = Number(m[2]); start = Math.max(0, file.size - suffix); }
            else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.size) { res.setHeader('Content-Range', `bytes */${file.size}`); throw new HttpError(416, 'Неверный диапазон'); }
            partial = true;
          }
          const type = ({ '.mp3':'audio/mpeg', '.wav':'audio/wav', '.m4a':'audio/mp4', '.ogg':'audio/ogg', '.txt':'text/plain; charset=utf-8', '.json':'application/json' })[path.extname(file.name).toLowerCase()] || 'application/octet-stream';
          res.setHeader('Content-Type', type); res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
          res.setHeader('Content-Length', file.size === 0 ? 0 : end - start + 1);
          if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
          res.statusCode = partial ? 206 : 200;
          if (req.method === 'HEAD' || file.size === 0) res.end();
          else await pipeline(handle.createReadStream({ start, end, autoClose: false }), res);
        } finally { await handle.close(); }
        return;
      }
      if (url.pathname === '/upload' && req.method === 'PUT') {
        assertWritable(); const payload = verify(url.searchParams.get('token'), 'upload');
        if (Number(req.headers['content-length']) > maxUpload) throw new HttpError(413, 'Файл слишком большой');
        if (fs.statfsSync(directory).bavail * fs.statfsSync(directory).bsize < maxUpload + 1073741824) throw new HttpError(507, 'Недостаточно свободного места');
        temporary = path.join(directory, 'tmp', crypto.randomUUID());
        const sha = crypto.createHash('sha256'); let size = 0;
        const meter = new Transform({ transform(chunk, _, done) { size += chunk.length; if (size > maxUpload) return done(new HttpError(413, 'Файл слишком большой')); sha.update(chunk); done(null,chunk); } });
        await pipeline(req, meter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        const hash = sha.digest('hex'); await fsp.rename(temporary, store.blobPath(hash)); temporary = null;
        store.transaction(() => {
          verify(url.searchParams.get('token'), 'upload');
          store.db.prepare('DELETE FROM used_uploads WHERE expires<?').run(Date.now());
          if (store.db.prepare('SELECT 1 FROM used_uploads WHERE nonce=?').get(payload.nonce)) throw new HttpError(409, 'Загрузка уже выполнена');
          store.saveFile(payload.folder, payload.name, { blob: hash, size }, payload.overwrite);
          store.db.prepare('INSERT INTO used_uploads(nonce,expires) VALUES(?,?)').run(payload.nonce, payload.expires);
        });
        res.setHeader('Content-Type','application/json'); res.end('{"ok":true}'); return;
      }
      throw new HttpError(404, 'Не найдено');
    } catch (error) {
      if (temporary) await fsp.rm(temporary, { force: true }).catch(() => {});
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const conflict = /UNIQUE constraint failed/.test(error.message);
      const status = error instanceof HttpError ? error.status : conflict ? 409 : 500;
      if (status === 500) console.error('Request failed:', error.code || error.name);
      res.removeHeader('Content-Length'); res.setHeader('Content-Type','application/json; charset=utf-8');
      res.writeHead(status).end(JSON.stringify({error: error instanceof HttpError ? error.message : conflict ? 'Такое имя уже существует' : 'Внутренняя ошибка'}));
    }
  });
  server.requestTimeout = 300000; server.headersTimeout = 30000;
  return { server, store };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, store } = createApp({ directory: process.env.DATA_DIR || '/var/lib/songs', teacherKey: process.env.TEACHER_KEY,
    signingKey: process.env.SIGNING_KEY, baseUrl: process.env.BASE_URL, readOnly: process.env.READ_ONLY !== 'false',
    origins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) });
  if (!store.db.prepare('SELECT 1 FROM settings WHERE name=?').get('source-captured-at')) {
    store.close(); throw new Error('Verified library import is required before starting the production service');
  }
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Songs API listening on loopback'));
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
