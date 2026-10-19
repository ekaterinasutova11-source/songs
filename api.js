// Requests to the private Selectel API.
import { FUNCTION_URL, GOOGLE_RESERVE_URL } from './config.js?v=selectel1';
import { createReserveClient } from './reserve.js?v=reserve1';

// На своём компьютере (node server.js) посредник работает по адресу /api.
const ENDPOINT = ['localhost', '127.0.0.1'].includes(location.hostname) && !location.search.includes('api=cloud') ? '/api' : FUNCTION_URL;

let accessKey = '';
let reserveMode = false;
const reserve = GOOGLE_RESERVE_URL ? createReserveClient({endpoint: GOOGLE_RESERVE_URL}) : null;
const reserveUrls = new Map();
export const storageState = () => ({reserve: reserveMode, available: !!reserve});
export const setKey = k => {
  if (accessKey !== k) {
    for (const url of reserveUrls.values()) URL.revokeObjectURL(url);
    reserveUrls.clear(); reserveMode = false;
  }
  accessKey = k;
};

// Чтение можно спокойно повторить, если сервер на секунду не ответил.
const SAFE_TO_RETRY = new Set(['library', 'url']);

export async function call(action, params = {}) {
  if (reserveMode && !SAFE_TO_RETRY.has(action)) {
    throw new Error('Открыта резервная копия. Изменения пока недоступны; обновите страницу, когда Яндекс заработает.');
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await callOnce(action, params);
      if (action === 'library') reserveMode = false;
      return result;
    } catch (e) {
      const transient = !e.status || e.status >= 500;
      if (reserve && action === 'library' && transient) {
        const result = await reserve.call('library', {}, accessKey);
        reserveMode = true;
        return result;
      }
      if (!SAFE_TO_RETRY.has(action) || !transient || attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
}

async function callOnce(action, params) {
  let r;
  try {
    // text/plain — «простой» запрос, браузеру не нужна предварительная проверка.
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: accessKey, ...params }),
      // A teacher's library reads metadata for every pupil; a cold cloud
      // function can take longer than a single file-link request.
      signal: AbortSignal.timeout(action === 'library' ? 25000 : 10000),
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const data = await r.json().catch(() => {
    const error = new Error('Сервер вернул неверный ответ'); error.status = 502; throw error;
  });
  if (!r.ok) {
    const err = new Error(data.error || `Ошибка сервера (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function reserveFileUrl(folder, name, options = {}) {
  if (!reserve) throw new Error('Резервный сервис ещё не подключён');
  const key = accessKey, id = JSON.stringify([key, folder, name]);
  if (reserveUrls.has(id)) return reserveUrls.get(id);
  const blob = await reserve.file(folder, name, key, options);
  if (accessKey !== key) throw new DOMException('Aborted', 'AbortError');
  const url = URL.createObjectURL(blob);
  reserveUrls.set(id, url);
  while (reserveUrls.size > 2) {
    const first = reserveUrls.keys().next().value;
    URL.revokeObjectURL(reserveUrls.get(first)); reserveUrls.delete(first);
  }
  return url;
}

export async function fileUrl(folder, name, options = {}) {
  if (reserveMode) return reserveFileUrl(folder, name, options);
  try { return (await call('url', { folder, name })).href; }
  catch (error) {
    if (reserve && (!error.status || error.status >= 500)) return reserveFileUrl(folder, name, options);
    throw error;
  }
}

export async function fileText(folder, name) {
  try {
    const r = await fetch(await fileUrl(folder, name), {signal: AbortSignal.timeout(15000)});
    if (!r.ok) {
      const error = new Error(`Не удалось загрузить текст (${r.status})`); error.status = r.status; throw error;
    }
    return await r.text();
  } catch (error) {
    if (reserve && (!error.status || error.status >= 500)) return (await reserve.file(folder, name, accessKey)).text();
    throw error;
  }
}

// Загрузка файла прямо на Диск, с прогрессом (0…1).
export async function uploadFile(folder, name, file, onProgress) {
  const { href } = await call('uploadUrl', { folder, name });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', href);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Диск не принял файл (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Загрузка прервалась. Проверьте интернет.'));
    xhr.send(file);
  });
}
