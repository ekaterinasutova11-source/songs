// Transport for the private, immutable Google reserve. Keys travel in POST
// bodies, never query strings. A complete file must pass SHA-256 before playback.
export function createReserveClient({endpoint, fetchImpl = (...args) => fetch(...args),
  subtle = globalThis.crypto?.subtle, timeoutMs = 25000} = {}) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint || ''))
    throw new Error('Неверный адрес резервного сервиса');
  async function call(action, params, key, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(new Error('Резервный сервер не ответил вовремя')), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({...params, action, key}), signal: controller.signal,
        credentials: 'omit', redirect: 'follow'});
      if (!response.ok) {
        const error = new Error(`Резервный сервер недоступен (${response.status})`);
        error.status = response.status; throw error;
      }
      const result = await response.json();
      if (result?.ok !== true || !result.data) {
        const error = new Error(result?.error || 'Неверный ответ резервного сервера');
        error.status = result?.status || 502; throw error;
      }
      return result.data;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  async function file(folder, name, key, {signal, onProgress} = {}) {
    const info = await call('fileInfo', {folder, name}, key, signal);
    if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > 128 * 1024 * 1024
        || !Number.isSafeInteger(info.chunkSize) || info.chunkSize < 1 || info.chunkSize > 2 * 1024 * 1024
        || !/^[a-f0-9]{64}$/.test(info.sha256 || '') || !subtle)
      throw new Error('Не удалось проверить параметры резервного файла');
    const bytes = new Uint8Array(info.size);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) controller.abort(signal.reason);
    let next = 0, completed = 0;
    try {
      await Promise.all(Array.from({length: Math.min(2, Math.ceil(info.size / info.chunkSize))}, async () => {
        while (next < info.size) {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const start = next, length = Math.min(info.chunkSize, info.size - start);
          next += length;
          const chunk = await call('fileChunk', {folder, name, start, length}, key, controller.signal);
          if (chunk.start !== start || chunk.length !== length || typeof chunk.data !== 'string')
            throw new Error('Неверный фрагмент резервного файла');
          const decoded = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
          if (decoded.length !== length) throw new Error('Резервный файл получен не полностью');
          bytes.set(decoded, start); completed += length; onProgress?.(completed / info.size);
        }
      }));
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const digest = [...new Uint8Array(await subtle.digest('SHA-256', bytes))]
        .map(b => b.toString(16).padStart(2, '0')).join('');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (digest !== info.sha256) throw new Error('Резервный файл не прошёл проверку целостности');
      return new Blob([bytes]);
    } catch (error) {controller.abort(); throw error;}
    finally {signal?.removeEventListener('abort', abort);}
  }
  return {call, file};
}
