import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.argv[2] || 'https://135.106.183.211';
const writable=process.argv.includes('--writable');
const snapshot=writable?'secrets/selectel-cutover/source':'secrets/selectel-2026-10-20/source';
const settings=JSON.parse(fs.readFileSync(path.join(snapshot,'settings.json')));
const inventory=JSON.parse(fs.readFileSync(path.join(snapshot,'inventory.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json')));
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const report={checkedAt:new Date().toISOString(),base,spaces:0,isolated:0,metadata:0,textFiles:0,audioRanges:0};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function call(action,params={},key=teacher){
  await new Promise(resolve=>setTimeout(resolve,150));
  const r=await fetch(base+'/api',{method:'POST',body:JSON.stringify({action,key,...params}),signal:AbortSignal.timeout(30000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error(`API HTTP ${r.status} for ${action}`);
  return {status:r.status,data:await r.json()};
}
const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.equal((await health.json()).readOnly,!writable);
const library=await call('library');assert.equal(library.status,200);assert.equal(library.data.students.length,inventory.folders.length);
for(const pupil of library.data.students){
  const folder=inventory.folders.find(f=>f.resource_id===pupil.id);assert(folder);assert.equal(pupil.name,folder.name);
  assert.equal(pupil.key,settings.students[pupil.id].key);
  const own=await call('library',{},pupil.key);assert.equal(own.status,200);assert.equal(own.data.students.length,1);
  assert.equal(own.data.students[0].id,pupil.id);assert.equal(own.data.students[0].key,undefined);
  report.spaces++;
  const other=library.data.students.find(p=>p.id!==pupil.id);
  assert.equal((await call('url',{folder:other.id,name:other.files[0].name},pupil.key)).status,403);report.isolated++;
  const records=manifest.records.filter(r=>r.path.split('/')[0]===pupil.name.normalize('NFC'));
  const meta=records.find(r=>r.path.endsWith('/Данные сайта (не удалять).json'));
  if(meta){assert.deepEqual(pupil.meta,JSON.parse(fs.readFileSync(path.join(snapshot,'files',meta.path))).songs);report.metadata++;}
  assert.equal(pupil.files.length,records.length-(meta?1:0));
  for(const file of pupil.files){
    const record=records.find(r=>r.path.split('/')[1]===file.name);assert(record);assert.equal(file.size,record.bytes);
    if(!/\.(txt|mp3|wav)$/i.test(file.name))continue;
    const signed=await call('url',{folder:pupil.id,name:file.name},pupil.key);assert.equal(signed.status,200);
    const text=/\.txt$/i.test(file.name),size=Math.min(file.size,65536);
    const response=await fetch(signed.data.href,{headers:text?{}:{Range:`bytes=0-${size-1}`},signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,text?200:206);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(text){assert.equal(hash(bytes),record.sha256);report.textFiles++;}
    else{
      assert.equal(response.headers.get('content-range'),`bytes 0-${size-1}/${file.size}`);
      const fd=fs.openSync(path.join(snapshot,'files',record.path),'r');
      const expected=Buffer.alloc(size);try{assert.equal(fs.readSync(fd,expected,0,size,0),size);}finally{fs.closeSync(fd);}
      assert(bytes.equals(expected));report.audioRanges++;
    }
  }
}
assert.equal((await call('library',{},'invalid-key')).status,403);
// An invalid extension fails safely in both modes and never writes a file.
assert.equal((await call('saveText',{folder:library.data.students[0].id,name:'invalid-without-extension'})).status,writable?400:503);
for(const url of ['/secrets/teacher.env','/songs.sqlite','/migration/server.mjs','/.env'])assert([403,404].includes((await fetch(base+url)).status));
report.status='passed';
report.readOnly=!writable;
fs.writeFileSync('outputs/selectel-live-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
