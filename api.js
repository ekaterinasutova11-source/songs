// Запросы к посреднику в Yandex Cloud.
import { FUNCTION_URL } from './config.js';

// На своём компьютере (node server.js) посредник работает по адресу /api.
const ENDPOINT = ['localhost', '127.0.0.1'].includes(location.hostname) ? '/api' : FUNCTION_URL;

let accessKey = '';
export const setKey = k => { accessKey = k; };

export async function call(action, params = {}) {
  let r;
  try {
    // text/plain — «простой» запрос, браузеру не нужна предварительная проверка.
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: accessKey, ...params }),
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `Ошибка сервера (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function fileUrl(folder, name) {
  return (await call('url', { folder, name })).href;
}

export async function fileText(folder, name) {
  const r = await fetch(await fileUrl(folder, name));
  if (!r.ok) throw new Error(`Не удалось загрузить текст (${r.status})`);
  return r.text();
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
