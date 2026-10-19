// Writes only to two uniquely named temporary test spaces, then soft-deletes them.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base='https://135.106.183.211';
const key=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const names=[1,2].map(n=>'Проверка переноса '+crypto.randomUUID()+' '+n),created=[];
const call=async(action,params={},access=key)=>{
  await new Promise(r=>setTimeout(r,150));
  const r=await fetch(base+'/api',{method:'POST',body:JSON.stringify({action,key:access,...params}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok)throw new Error(`Smoke ${action} HTTP ${r.status}`);return data;
};
const before=await call('library');
try{
  for(const name of names){await call('createStudent',{name});const s=(await call('library')).students.find(s=>s.name===name);assert(s);created.push(s);}
  const [a,b]=created;
  const ticket=await call('uploadUrl',{folder:a.id,name:'Проверка.txt'});
  assert.equal((await fetch(ticket.href,{method:'PUT',body:'Проверка загрузки'})).status,200);
  await call('saveText',{folder:a.id,name:'Проверка.txt',text:'Проверка сохранения'},a.key);
  await call('rename',{folder:a.id,name:'Проверка.txt',newName:'Текст.txt'});
  await call('saveMeta',{folder:a.id,song:'тест',patch:{notes:'Примечание',translation:'Перевод',impulse:'спокойно уверенно'}});
  await call('copyTo',{folder:a.id,to:b.id,names:['Текст.txt'],song:'тест'});
  const result=await call('library',{},b.key);assert.equal(result.students[0].meta['тест'].notes,'Примечание');assert.equal(result.students[0].meta['тест'].impulse,undefined);
  const {href}=await call('url',{folder:b.id,name:'Текст.txt'},b.key);assert.equal(await(await fetch(href)).text(),'Проверка сохранения');
  await call('renameStudent',{folder:b.id,newName:names[1]+' переименовано'});
  await call('delete',{folder:b.id,name:'Текст.txt'});
  const rotated=await call('resetLink',{folder:b.id});assert.notEqual(rotated.key,b.key);
  const invalid=await fetch(base+'/api',{method:'POST',body:JSON.stringify({action:'library',key:b.key})});assert.equal(invalid.status,403);
  console.log(JSON.stringify({liveWrites:'passed',uploads:true,text:true,metadata:true,copy:true,rename:true,deletion:true,keyRevocation:true}));
}finally{
  for(const s of created)await call('deleteStudent',{folder:s.id});
  const after=await call('library');assert.deepEqual(after,before,'Real library changed during smoke tests');
  console.log(JSON.stringify({testSpacesRemoved:true,realLibraryUnchanged:true,spaces:after.students.length}));
}
