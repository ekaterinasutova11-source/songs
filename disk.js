// Чтение публичной папки Яндекс Диска через открытый API (без ключей).
import { PUBLIC_FOLDER } from './config.js';

const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Яндекс Диск ответил ${r.status}`);
  return r.json();
}

async function listFolder(path) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${API}?public_key=${encodeURIComponent(PUBLIC_FOLDER)}` +
      `&path=${encodeURIComponent(path)}&limit=1000&offset=${offset}`;
    const page = (await getJson(url))._embedded;
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

// Короткий постоянный идентификатор ученика для личной ссылки.
// resource_id папки не меняется при переименовании.
async function shortId(resourceId) {
  const bytes = new TextEncoder().encode('songs:' + resourceId);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash.slice(0, 5)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// → [{id, name, path, files: [{name, path, modified, size}]}]
export async function loadLibrary() {
  const root = await listFolder('/');
  const dirs = root.filter(i => i.type === 'dir');
  return Promise.all(dirs.map(async d => ({
    id: await shortId(d.resource_id),
    name: d.name,
    path: d.path,
    files: (await listFolder(d.path))
      .filter(i => i.type === 'file')
      .map(i => ({ name: i.name, path: i.path, modified: i.modified, size: i.size })),
  })));
}

// Прямые ссылки на файлы временные, поэтому получаем свежую перед каждым запуском.
export async function fileUrl(path) {
  const url = `${API}/download?public_key=${encodeURIComponent(PUBLIC_FOLDER)}` +
    `&path=${encodeURIComponent(path)}`;
  return (await getJson(url)).href;
}

export async function fileText(path) {
  const r = await fetch(await fileUrl(path));
  if (!r.ok) throw new Error(`Не удалось загрузить текст (${r.status})`);
  return r.text();
}
