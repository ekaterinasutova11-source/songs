// Restore known links into a NEW private Disk file. Never overwrite the failed file.
// New links are permitted only for the two duets the owner confirmed had none.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const output='secrets/recovery-2026-10-19';
const previous='C:/Users/Ekaterina/Documents/Codex/2026-10-02/https-ekaterinasutova11-source-github-io-songs';
const original=JSON.parse(fs.readFileSync(`${previous}/work/backups/source-settings-2026-10-13/settings.json`,'utf8'));
const reserve=JSON.parse(fs.readFileSync(`${previous}/outputs/sad-zvuka-reserve-index-updated.json`,'utf8'));
const version=JSON.parse(fs.readFileSync(`${output}/cloud-version-before.json`,'utf8'));
const token=version.environment.DISK_TOKEN;
const api='https://cloud-api.yandex.net/v1/disk';
const target='disk:/Сад звука — настройки доступа восстановлены 2026-10-19 (не удалять).json';
const headers={Authorization:`OAuth ${token}`};
async function disk(route,params,method='GET'){
  const r=await fetch(`${api}${route}?${new URLSearchParams(params)}`,{method,headers,signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new Error(`Disk ${route}: HTTP ${r.status}`);
  return r.json();
}
const listing=await disk('/resources',{path:version.environment.ROOT,limit:'1000'});
assert.equal(listing._embedded.items.length,listing._embedded.total,'Root listing must be complete');
const folders=listing._embedded.items.filter(f=>f.type==='dir');
assert.equal(folders.length,11,'Stop if source spaces have changed');
for(const student of reserve.students) assert.equal(original.students[student.id]?.key,student.key,'Known link conflict');
const confirmation=JSON.parse(fs.readFileSync(`${output}/owner-confirmed-unissued-spaces.json`,'utf8'));
assert.equal(confirmation.confirmedByOwner,true);
const allowedNew=new Set(confirmation.folderIds);
const created=[];
for(const folder of folders){
  if(original.students[folder.resource_id]?.key)continue;
  assert(allowedNew.has(folder.resource_id),'Cannot invent a replacement for an issued link');
  let key;
  do {key=crypto.randomBytes(9).toString('base64url');}
  while(Object.values(original.students).some(s=>s.key===key));
  original.students[folder.resource_id]={key};
  created.push(folder.resource_id);
}
assert.equal(created.length,2);
const bytes=Buffer.from(JSON.stringify(original,null,2)+'\n');
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${output}/recovered-access-settings.json`,bytes,{flag:'wx'});
const upload=await disk('/resources/upload',{path:target,overwrite:'false'});
const put=await fetch(upload.href,{method:'PUT',body:bytes,headers:{'Content-Type':'application/json; charset=utf-8'},signal:AbortSignal.timeout(25000)});
assert(put.ok,`Upload HTTP ${put.status}`);
const download=await disk('/resources/download',{path:target});
const read=await fetch(download.href,{signal:AbortSignal.timeout(25000)});
assert(read.ok,`Verification HTTP ${read.status}`);
const downloaded=Buffer.from(await read.arrayBuffer());
assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'),sha256,'Uploaded settings differ');
const metadata=await disk('/resources',{path:target});
assert.equal(metadata.sha256,sha256);
assert(!metadata.public_url && !metadata.public_key,'Access settings must stay private');
const backup='D:/ffmpeg-gui/songs-project-backups/2026-10-19-materials/control';
fs.mkdirSync(backup,{recursive:true});
fs.writeFileSync(`${backup}/recovered-access-settings.json`,bytes,{flag:'wx'});
const plan={verifiedAt:new Date().toISOString(),settingsPath:target,sha256,
  preservedIssuedLinks:reserve.students.length,newLinks:created.length,currentSpaces:folders.length,
  sourceOriginalPreserved:true,private:true,settings:original};
fs.writeFileSync(`${output}/verified-recovery-plan.json`,JSON.stringify(plan,null,2));
console.log(JSON.stringify({uploaded:true,verified:true,private:true,preservedIssuedLinks:9,newLinks:2,currentSpaces:11}));
