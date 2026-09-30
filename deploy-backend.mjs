import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const yc = path.join(process.env.USERPROFILE, 'yandex-cloud', 'bin', 'yc.exe');
const run = (...a) => execFileSync(yc, [...a, '--format', 'json'], { encoding: 'utf8' });
const env = f => Object.fromEntries(fs.readFileSync('secrets/' + f, 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
let fn;
try { fn = JSON.parse(run('serverless', 'function', 'get', '--name', 'songs-api')); }
catch { fn = JSON.parse(run('serverless', 'function', 'create', '--name', 'songs-api', '--description', 'Песни учеников: посредник к Яндекс Диску')); }
const vars = {
  DISK_TOKEN: env('yandex.env').YANDEX_DISK_TOKEN, TEACHER_KEY: env('teacher.env').TEACHER_KEY,
  ROOT: 'disk:/Песни для Notion', SETTINGS: 'disk:/Песни учеников — настройки (не удалять).json',
};
const ver = JSON.parse(run('serverless', 'function', 'version', 'create', '--function-id', fn.id,
  '--runtime', 'nodejs22', '--entrypoint', 'index.handler', '--memory', '128m', '--execution-timeout', '30s',
  '--source-path', 'backend', '--environment', Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')));
run('serverless', 'function', 'allow-unauthenticated-invoke', '--id', fn.id);
fs.writeFileSync('secrets/function.env', `FUNCTION_ID=${fn.id}\nFUNCTION_URL=https://functions.yandexcloud.net/${fn.id}\n`);
console.log('function', fn.id, 'version', ver.id, ver.status);
