// Private deployment inputs only; the cloud stores restic ciphertext, never these files.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root='secrets/selectel-cloud-backup';fs.mkdirSync(root,{recursive:true});
const token=fs.readFileSync('secrets/yandex.env','utf8').match(/^YANDEX_DISK_TOKEN=(.*)$/m)?.[1].trim();
if(!token)throw new Error('Existing disk credential missing');
// Existing manually issued token has no known expiry/refresh grant. rclone's Yandex
// backend requires a nonempty refresh field even when expiry is zero. Never try
// to fabricate an automatic refresh: a revoked/expired grant needs manual renewal.
const config='[songscloud]\ntype = yandex\ntoken = '+JSON.stringify({access_token:token,token_type:'OAuth',refresh_token:'manual-rotation-required',expiry:'0001-01-01T00:00:00Z'})+'\nupload_wait = 2s\n';
fs.writeFileSync(root+'/cloud-rclone.conf',config,{flag:'wx'});
fs.writeFileSync(root+'/cloud-backup-password',crypto.randomBytes(48).toString('base64url')+'\n',{flag:'wx'});
fs.writeFileSync(root+'/RECOVERY.txt','Приватный резерв Songs на Яндекс Диске: Songs-private-backups/restic.\nПароль restic: файл cloud-backup-password рядом с этой памяткой.\nНе загружать этот пароль в открытую папку облачного резерва.\nВосстановление: migration/README.md в репозитории проекта.\n');
console.log('Prepared private cloud-backup inputs; no secrets printed');
