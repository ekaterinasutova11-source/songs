// Посредник между сайтом и Яндекс Диском (Yandex Cloud Function, Node.js 22).
// Хранит ключ к Диску и пускает каждого только туда, куда можно:
// ученика — в его папку, преподавателя — во все.
//
// Переменные окружения:
//   DISK_TOKEN  — OAuth-токен Яндекс Диска
//   TEACHER_KEY — секрет из ссылки преподавателя
//   ROOT        — папка с учениками, например «disk:/Песни для Notion»
//   SETTINGS    — файл с ключами учеников, например «disk:/Песни учеников — настройки (не удалять).json»

import crypto from 'node:crypto';

const API = 'https://cloud-api.yandex.net/v1/disk';
const { DISK_TOKEN, TEACHER_KEY, ROOT, SETTINGS } = process.env;
const ALLOWED_ORIGINS = [
  'https://ekaterinasutova11-source.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Яндекс Диск ----------
// Диск иногда на мгновение не отвечает — повторяем запрос ещё до двух раз.
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status < 500 || i >= tries) return r;
    } catch (e) {
      if (i >= tries) throw e;
    }
    await new Promise(res => setTimeout(res, 300 * i));
  }
}

async function disk(method, path, params = {}, { okStatuses = [] } = {}) {
  const qs = new URLSearchParams(params).toString();
  // Повторять можно только то, что безопасно выполнить дважды.
  const tries = method === 'GET' ? 3 : 1;
  const r = await fetchRetry(`${API}${path}${qs ? '?' + qs : ''}`, {
    method, headers: { Authorization: 'OAuth ' + DISK_TOKEN },
  }, tries);
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok && !okStatuses.includes(r.status)) {
    const msg = r.status === 409 ? 'Файл или папка с таким именем уже есть'
      : r.status === 404 ? 'Не найдено — возможно, уже удалено'
      : body.message || `Ошибка Диска (${r.status})`;
    throw new HttpError(r.status === 409 || r.status === 404 ? r.status : 502, msg);
  }
  return { status: r.status, ...body };
}

async function list(path) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const page = (await disk('GET', '/resources', {
      path, limit: 1000, offset,
      fields: '_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.modified,_embedded.items.size,_embedded.items.resource_id,_embedded.total',
    }))._embedded;
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
  }
}

// Ссылка Диска ведёт на downloader.disk.yandex.ru, а тот перенаправляет на *.storage.yandex.net.
// Браузер DuckDuckGo блокирует адреса yandex.ru на чужих сайтах, поэтому отдаём сразу конечный адрес.
async function directUrl(href) {
  try {
    const r = await fetch(href, { redirect: 'manual', headers: { Range: 'bytes=0-0' } });
    r.body?.cancel();
    const loc = r.headers.get('location');
    return r.status >= 300 && r.status < 400 && loc ? new URL(loc, href).href : href;
  } catch {
    return href;
  }
}

async function readJson(path) {
  try {
    const { href } = await disk('GET', '/resources/download', { path });
    const r = await fetchRetry(href);
    if (!r.ok) throw new HttpError(502, `Не удалось прочитать настройки (${r.status})`);
    return await r.json();
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function writeText(path, text, type = 'text/plain; charset=utf-8') {
  const { href } = await disk('GET', '/resources/upload', { path, overwrite: 'true' });
  const r = await fetchRetry(href, { method: 'PUT', body: text, headers: { 'Content-Type': type } });
  if (!r.ok) throw new HttpError(502, `Не удалось сохранить (${r.status})`);
}

// Операции с папками Диск может выполнять асинхронно — дожидаемся конца.
async function waitOperation(res) {
  if (res?.status !== 202 || !res.href) return;
  const opPath = new URL(res.href).pathname.replace(/^\/v1\/disk/, '');
  for (let i = 0; i < 40; i++) {
    const op = await disk('GET', opPath);
    if (op.status === 'success') return;
    if (op.status === 'failed') throw new HttpError(502, 'Диск не смог выполнить операцию');
    await new Promise(r => setTimeout(r, 500));
  }
}

// ---------- Настройки (ключи учеников) ----------
const newKey = () => crypto.randomBytes(9).toString('base64url');

async function loadState() {
  const [settings, rootItems] = await Promise.all([readJson(SETTINGS), list(ROOT)]);
  const s = settings || { students: {} };
  const folders = rootItems.filter(i => i.type === 'dir');
  let changed = !settings;
  for (const f of folders) {
    if (!s.students[f.resource_id]) { s.students[f.resource_id] = { key: newKey() }; changed = true; }
  }
  if (changed) await writeText(SETTINGS, JSON.stringify(s, null, 2), 'application/json');
  return { settings: s, folders };
}

const saveSettings = s => writeText(SETTINGS, JSON.stringify(s, null, 2), 'application/json');

// Имя файла или папки: без слэшей и служебных символов.
function cleanName(name, what = 'Название') {
  const n = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || n === '.' || n === '..') throw new HttpError(400, `${what} не может быть пустым`);
  if (n.length > 150) throw new HttpError(400, `${what} слишком длинное`);
  return n;
}

function fileOut(i) {
  return { name: i.name, modified: i.modified, size: i.size };
}

// ---------- Данные песен (импульс, заметки, перевод, темп) ----------
// Хранятся в одном файле в папке ученика: { songs: { <ключ песни>: {...} } }.
const META_NAME = 'Данные сайта (не удалять).json';
const LIMITS = { impulse: 40, notes: 5000, translation: 50000 };

async function readMeta(folder) {
  return (await readJson(`${folder.path}/${META_NAME}`)) || { songs: {} };
}
const writeMeta = (folder, meta) => writeText(`${folder.path}/${META_NAME}`, JSON.stringify(meta, null, 1), 'application/json');

function cleanPatch(patch = {}) {
  const out = {};
  for (const k of ['impulse', 'notes', 'translation']) {
    if (patch[k] === undefined) continue;
    let v = String(patch[k] ?? '');
    if (k === 'impulse') {
      v = v.replace(/s+/g, ' ').trim();
      if (v.split(' ').filter(Boolean).length > 2) throw new HttpError(400, 'Импульс — не больше двух слов');
    }
    if (v.length > LIMITS[k]) throw new HttpError(400, 'Слишком длинный текст');
    out[k] = v;
  }
  if (patch.tempo && typeof patch.tempo === 'object') {
    out.tempo = {};
    for (const [file, t] of Object.entries(patch.tempo)) {
      if (!(t && Number.isFinite(+t.bpm) && +t.bpm > 20 && +t.bpm < 400)) { out.tempo[cleanName(file, 'Имя файла')] = null; continue; }
      const v = { bpm: Math.round(+t.bpm * 1000) / 1000, offset: Math.round((+t.offset || 0) * 1000) / 1000 };
      if (typeof t.beats === 'string' && /^-?d+(,-?d+)*$/.test(t.beats) && t.beats.length < 20000) v.beats = t.beats;
      if (t.manual) v.manual = true;
      out.tempo[cleanName(file, 'Имя файла')] = v;
    }
  }
  return out;
}

// ---------- Действия ----------
async function folderFiles(folder) {
  return (await list(folder.path)).filter(i => i.type === 'file').map(fileOut);
}

async function folderData(folder) {
  const files = await folderFiles(folder);
  const meta = files.some(f => f.name === META_NAME) ? await readMeta(folder) : { songs: {} };
  return { files: files.filter(f => f.name !== META_NAME), meta: meta.songs || {} };
}

async function handle(req) {
  const { action, key } = req;
  if (!key) throw new HttpError(401, 'Нет ключа доступа');
  const isTeacher = key === TEACHER_KEY;
  const state = await loadState();
  const { settings, folders } = state;

  // Папка, с которой разрешено работать по этому ключу.
  const own = isTeacher ? null : folders.find(f => settings.students[f.resource_id]?.key === key);
  if (!isTeacher && !own) throw new HttpError(403, 'Ссылка устарела или неверна — попросите новую у преподавателя');

  const folderById = id => {
    const f = isTeacher ? folders.find(x => x.resource_id === id) : (id === own.resource_id ? own : null);
    if (!f) throw new HttpError(403, 'Нет доступа к этой папке');
    return f;
  };
  const filePath = (folder, name) => `${folder.path}/${cleanName(name, 'Имя файла')}`;
  const teacherOnly = () => { if (!isTeacher) throw new HttpError(403, 'Это может только преподаватель'); };

  switch (action) {
    case 'library': {
      if (isTeacher) {
        const students = await Promise.all(folders.map(async f => ({
          id: f.resource_id, name: f.name, key: settings.students[f.resource_id].key, ...(await folderData(f)),
        })));
        return { role: 'teacher', students };
      }
      return { role: 'student', students: [{ id: own.resource_id, name: own.name, ...(await folderData(own)) }] };
    }

    case 'url': {
      const { href } = await disk('GET', '/resources/download', { path: filePath(folderById(req.folder), req.name) });
      return { href: await directUrl(href) };
    }

    case 'uploadUrl': {
      const path = filePath(folderById(req.folder), req.name);
      const { href } = await disk('GET', '/resources/upload', { path, overwrite: req.overwrite ? 'true' : 'false' });
      return { href };
    }

    case 'saveText': {
      const name = cleanName(req.name, 'Имя файла');
      if (!/\.txt$/i.test(name)) throw new HttpError(400, 'Можно сохранять только .txt');
      await writeText(filePath(folderById(req.folder), name), String(req.text ?? ''));
      return { ok: true };
    }

    case 'rename': {
      const folder = folderById(req.folder);
      await disk('POST', '/resources/move', {
        from: filePath(folder, req.name), path: filePath(folder, req.newName), overwrite: 'false',
      });
      return { ok: true };
    }

    case 'delete': {
      // В корзину Диска, а не навсегда — всегда можно восстановить.
      await waitOperation(await disk('DELETE', '/resources', { path: filePath(folderById(req.folder), req.name), permanently: 'false' }));
      return { ok: true };
    }

    case 'copyTo': {
      teacherOnly();
      const from = folderById(req.folder), to = folderById(req.to);
      for (const name of req.names || []) {
        await disk('POST', '/resources/copy', { from: filePath(from, name), path: filePath(to, name), overwrite: 'false' }, { okStatuses: [409] });
      }
      // Перевод, заметки и темп переносим; импульс у каждого ученика свой.
      const src = (await readMeta(from)).songs?.[req.song];
      if (src) {
        const dst = await readMeta(to);
        dst.songs ||= {};
        const { impulse, ...rest } = src;
        dst.songs[req.song] = { ...rest, ...dst.songs[req.song] };
        await writeMeta(to, dst);
      }
      return { ok: true };
    }

    case 'saveMeta': {
      const folder = folderById(req.folder);
      const key = String(req.song || '');
      if (!key) throw new HttpError(400, 'Не указана песня');
      const meta = await readMeta(folder);
      meta.songs ||= {};
      const entry = meta.songs[key] || {};
      if (req.remove) {
        delete meta.songs[key];
      } else {
        const patch = cleanPatch(req.patch);
        const tempo = { ...entry.tempo };
        for (const [file, t] of Object.entries(patch.tempo || {})) { if (t) tempo[file] = t; else delete tempo[file]; }
        // Файлы переименованы — переносим их темп.
        for (const [oldName, newName] of Object.entries(req.renameFiles || {})) {
          if (tempo[oldName]) { tempo[cleanName(newName, 'Имя файла')] = tempo[oldName]; delete tempo[oldName]; }
        }
        const next = { ...entry, ...patch, tempo };
        for (const k of Object.keys(next)) if (next[k] === '' || (k === 'tempo' && !Object.keys(next[k]).length)) delete next[k];
        const newKey = req.renameTo ? String(req.renameTo) : key;
        if (newKey !== key) delete meta.songs[key];
        if (Object.keys(next).length) meta.songs[newKey] = next; else delete meta.songs[newKey];
      }
      await writeMeta(folder, meta);
      return { ok: true };
    }

    case 'createStudent': {
      teacherOnly();
      await disk('PUT', '/resources', { path: `${ROOT}/${cleanName(req.name, 'Имя ученика')}` });
      return { ok: true };
    }

    case 'renameStudent': {
      teacherOnly();
      const f = folderById(req.folder);
      await waitOperation(await disk('POST', '/resources/move', { from: f.path, path: `${ROOT}/${cleanName(req.newName, 'Имя ученика')}`, overwrite: 'false' }));
      return { ok: true };
    }

    case 'deleteStudent': {
      teacherOnly();
      const f = folderById(req.folder);
      await waitOperation(await disk('DELETE', '/resources', { path: f.path, permanently: 'false' }));
      delete settings.students[f.resource_id];
      await saveSettings(settings);
      return { ok: true };
    }

    case 'resetLink': {
      teacherOnly();
      const f = folderById(req.folder);
      settings.students[f.resource_id] = { key: newKey() };
      await saveSettings(settings);
      return { key: settings.students[f.resource_id].key };
    }

    default:
      throw new HttpError(400, 'Неизвестное действие');
  }
}

// ---------- Точка входа ----------
export async function handler(event) {
  const origin = event.headers?.Origin || event.headers?.origin || '';
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    const result = await handle(JSON.parse(raw || '{}'));
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return { statusCode: status, headers, body: JSON.stringify({ error: e instanceof HttpError ? e.message : 'Внутренняя ошибка' }) };
  }
}
