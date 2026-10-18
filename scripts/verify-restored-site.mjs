import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {FUNCTION_URL} from '../config.js';
const directory='secrets/recovery-2026-10-19';
const version=JSON.parse(fs.readFileSync(`${directory}/cloud-version-before.json`,'utf8'));
const recovery=JSON.parse(fs.readFileSync(`${directory}/verified-recovery-plan.json`,'utf8'));
const oldIndex=JSON.parse(fs.readFileSync('C:/Users/Ekaterina/Documents/Codex/2026-10-02/https-ekaterinasutova11-source-github-io-songs/outputs/sad-zvuka-reserve-index-updated.json','utf8'));
const report={checkedAt:new Date().toISOString(),students:[],media:[],transientErrors:[]};
async function call(action,key,params={}){
  for(let attempt=1;attempt<=3;attempt++){
    const start=performance.now();
    const response=await fetch(FUNCTION_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action,key,...params}),signal:AbortSignal.timeout(25000)});
    const result={status:response.status,body:await response.json(),milliseconds:Math.round(performance.now()-start)};
    if(response.status<500 || attempt===3)return result;
    report.transientErrors.push({action,status:response.status,milliseconds:result.milliseconds,attempt});
  }
}
const teacher=await call('library',version.environment.TEACHER_KEY);
assert.equal(teacher.status,200);assert.equal(teacher.body.role,'teacher');
assert.equal(teacher.body.students.length,11);assert(!teacher.body.reserve);
fs.writeFileSync(`${directory}/restored-primary-library.json`,JSON.stringify(teacher.body,null,2));
for(const old of oldIndex.students)assert.equal(teacher.body.students.find(s=>s.id===old.id)?.key,old.key);
report.teacher={status:teacher.status,spaces:11,primary:true,milliseconds:teacher.milliseconds,
  unavailableMetadata:teacher.body.students.filter(s=>s.metadataUnavailable).length};
console.log(JSON.stringify({stage:'teacher',...report.teacher}));
for(const student of teacher.body.students){
  const result=await call('library',student.key);
  assert.equal(result.status,200);assert.equal(result.body.role,'student');
  assert.equal(result.body.students.length,1);assert.equal(result.body.students[0].id,student.id);
  assert(!Object.hasOwn(result.body.students[0],'key'));
  report.students.push({id:student.id,status:200,isolated:true,milliseconds:result.milliseconds});
  fs.writeFileSync(`${directory}/restored-site-verification.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({stage:'student',verified:report.students.length,milliseconds:result.milliseconds}));
}
const first=teacher.body.students[0],other=teacher.body.students[1];
const denied=await call('url',first.key,{folder:other.id,name:other.files[0].name});
assert.equal(denied.status,403);report.foreignFolderStatus=denied.status;
const unknown=await call('library','invalid-recovery-audit-key');
assert.equal(unknown.status,403);report.unknownKeyStatus=unknown.status;
const backup='D:/ffmpeg-gui/songs-project-backups/2026-10-19-materials/files';
for(const extension of ['.txt','.mp3']){
  const student=teacher.body.students.find(s=>s.files.some(f=>f.name.toLowerCase().endsWith(extension)));
  const file=student.files.find(f=>f.name.toLowerCase().endsWith(extension));
  const link=await call('url',student.key,{folder:student.id,name:file.name});
  assert.equal(link.status,200);
  const opts=extension==='.mp3'?{headers:{Range:'bytes=0-65535'}}:{};
  const started=performance.now();
  const response=await fetch(link.body.href,{...opts,signal:AbortSignal.timeout(25000)});
  assert(response.ok);
  const data=Buffer.from(await response.arrayBuffer());
  const local=fs.readFileSync(path.join(backup,student.name,file.name));
  assert(data.equals(extension==='.mp3'?local.subarray(0,data.length):local));
  if(extension==='.mp3')assert.equal(response.status,206,'Audio must support ranged playback');
  report.media.push({extension,status:response.status,verifiedBytes:data.length,
    milliseconds:Math.round(performance.now()-started),matchesBackup:true});
}
const newStudents=teacher.body.students.filter(s=>!oldIndex.students.some(old=>old.id===s.id));
fs.writeFileSync('secrets/Ссылки новых дуэтов.txt',newStudents.map(s=>`${s.name}\nhttps://ekaterinasutova11-source.github.io/songs/#/s/${s.key}\n`).join('\n'));
report.preservedIssuedLinks=oldIndex.students.length;
report.verifiedStudents=report.students.length;
report.complete=true;
fs.writeFileSync(`${directory}/restored-site-verification.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({complete:true,students:report.verifiedStudents,preservedLinks:report.preservedIssuedLinks,
  unknownKeyStatus:report.unknownKeyStatus,foreignFolderStatus:report.foreignFolderStatus,media:report.media}));
