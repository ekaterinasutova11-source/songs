// Live acceptance checks only touch a newly-created temporary test pupil.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='secrets/archive-test';fs.mkdirSync(root,{recursive:true});
const base='https://135.106.183.211';
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const call=async(action,params={},key=teacher)=>{
  await new Promise(r=>setTimeout(r,130));
  const r=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,key,...params}),signal:AbortSignal.timeout(30000)});
  return {status:r.status,data:await r.json()};
};
const ok=async(...args)=>{const r=await call(...args);assert.equal(r.status,200);return r.data;};
const mode=process.argv[2];
if(mode==='setup'){
  if(fs.existsSync(root+'/pupil.json'))throw new Error('Existing test pupil requires cleanup first');
  const before=await ok('library');fs.writeFileSync(root+'/before.json',JSON.stringify(before));
  const name='Проверка архива '+crypto.randomUUID().slice(0,8);
  await ok('createStudent',{name});const pupil=(await ok('library')).students.find(s=>s.name===name);assert(pupil);
  fs.writeFileSync(root+'/pupil.json',JSON.stringify(pupil));
  const sampleRate=22050,samples=sampleRate,bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(Math.sin(i/sampleRate*2*Math.PI*440)*1000),44+i*2);
  const ticket=await ok('uploadUrl',{folder:pupil.id,name:'Проверка -.wav'});
  assert.equal((await fetch(ticket.href,{method:'PUT',body:bytes})).status,200);
  await ok('saveText',{folder:pupil.id,name:'Проверка.txt',text:'Все материалы остаются в архиве.'});
  await ok('saveMeta',{folder:pupil.id,song:'проверка',patch:{notes:'Заметки сохранены',translation:'Перевод сохранён',impulse:'спокойно уверенно'}});
  const record=(await ok('library')).students.find(s=>s.id===pupil.id);
  const media=await ok('url',{folder:pupil.id,name:'Проверка -.wav'},pupil.key);
  const pending=await ok('uploadUrl',{folder:pupil.id,name:'pending.txt'},pupil.key);
  fs.writeFileSync(root+'/state.json',JSON.stringify({record,media:media.href,pending:pending.href,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
  console.log(JSON.stringify({testPupilCreated:true,name,audio:true,text:true,metadata:true}));
}else{
  const pupil=JSON.parse(fs.readFileSync(root+'/pupil.json')),saved=JSON.parse(fs.readFileSync(root+'/state.json'));
  if(mode==='archive-via-api'){
    await ok('archiveStudent',{folder:pupil.id});console.log('Temporary pupil archived');
  }else if(mode==='restore-via-api'){
    await ok('restoreStudent',{folder:pupil.id});console.log('Temporary pupil restored');
  }else if(mode==='archived'){
    assert.equal((await call('library',{},pupil.key)).status,403);
    assert.equal((await fetch(saved.media)).status,403);
    assert.equal((await fetch(saved.pending,{method:'PUT',body:'blocked'})).status,403);
    const current=(await ok('library')).students.find(s=>s.id===pupil.id);assert(current.archivedAt);
    const {archivedAt,...rest}=current;assert.deepEqual(rest,saved.record);
    const {href}=await ok('url',{folder:pupil.id,name:'Проверка -.wav'});
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await(await fetch(href)).arrayBuffer())).digest('hex'),saved.sha256);
    console.log(JSON.stringify({archived:true,pupilDenied:true,oldMediaDenied:true,pendingUploadDenied:true,teacherReads:true,allMaterialsPreserved:true}));
  }else if(mode==='restored'){
    const current=(await ok('library')).students.find(s=>s.id===pupil.id);assert.deepEqual(current,saved.record);
    assert.equal((await call('library',{},pupil.key)).status,200);
    const {href}=await ok('url',{folder:pupil.id,name:'Проверка -.wav'},pupil.key);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await(await fetch(href)).arrayBuffer())).digest('hex'),saved.sha256);
    assert.equal((await fetch(saved.media)).status,403);
    console.log(JSON.stringify({restored:true,originalLinkWorks:true,filesAndMetadataUnchanged:true,oldTicketsStayRevoked:true}));
  }else if(mode==='cleanup'){
    await ok('deleteStudent',{folder:pupil.id});
    assert.deepEqual(await ok('library'),JSON.parse(fs.readFileSync(root+'/before.json')));
    fs.renameSync(root+'/pupil.json',root+'/completed-pupil.json');
    console.log(JSON.stringify({testPupilRemoved:true,realPupilsUnchanged:true}));
  }else throw new Error('Pass setup, archived, restored or cleanup');
}
