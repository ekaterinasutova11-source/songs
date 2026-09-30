// Простой локальный сервер для просмотра сайта на своём компьютере.
// По адресу /api он работает так же, как посредник в Yandex Cloud
// (ключи берутся из папки secrets).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function loadEnv(file) {
  try {
    for (const line of (await fs.readFile(path.join(root, 'secrets', file), 'utf8')).split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] ??= m[2].trim();
    }
  } catch { /* нет файла — /api не заработает */ }
}
await loadEnv('yandex.env');
await loadEnv('teacher.env');
process.env.DISK_TOKEN ??= process.env.YANDEX_DISK_TOKEN;
process.env.ROOT ??= 'disk:/Песни для Notion';
process.env.SETTINGS ??= 'disk:/Песни учеников — настройки (не удалять).json';
const { handler } = await import('./backend/index.js');

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/api') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = await handler({ httpMethod: req.method, headers: req.headers, body });
    res.writeHead(out.statusCode, out.headers).end(out.body);
    return;
  }
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root) || file.startsWith(path.join(root, 'secrets'))) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Сайт открыт: http://localhost:${port}`));
