import fs from 'node:fs';
import assert from 'node:assert/strict';
const token=fs.readFileSync('secrets/yandex.env','utf8').match(/^YANDEX_DISK_TOKEN=(.*)$/m)[1].trim();
for(const path of ['disk:/Songs-private-backups','disk:/Songs-private-backups/restic']){
  const q=new URLSearchParams({path,fields:'type,public_key,public_url'});
  const r=await fetch('https://cloud-api.yandex.net/v1/disk/resources?'+q,{headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200);const d=await r.json();assert.equal(d.type,'dir');assert(!d.public_key&&!d.public_url);
}
console.log(JSON.stringify({cloudRootPrivate:true,repositoryPrivate:true,provider:'existing Yandex Disk',additionalSubscription:false}));
