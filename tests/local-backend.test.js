import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../migration/server.mjs';
import { META_NAME } from '../migration/local-store.mjs';

async function fixture(readOnly=false) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songs-api-'));
  const app=createApp({directory,teacherKey:'teacher',signingKey:'test-signing-secret',baseUrl:'http://localhost',readOnly,maxUpload:32});
  for(const [id,key] of [['a','pupil-a'],['b','pupil-b']])app.store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run(id,id,key);
  app.store.transaction(()=>app.store.saveFile('a','song.mp3',app.store.putBytes(Buffer.from('0123456789'))));
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(action,params={},key='teacher')=>{
    const response=await fetch(base+'/api',{method:'POST',body:JSON.stringify({action,key,...params})});
    return {status:response.status,data:await response.json()};
  };
  const signed=href=>base+new URL(href).pathname+new URL(href).search;
  const close=async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));app.store.close();fs.rmSync(directory,{recursive:true,force:true});};
  return {...app,directory,base,request,signed,close};
}
test('access isolation, CORS and service-file protection',async()=>{
  const app=await fixture();
  try {
    assert.equal((await app.request('library',{},'unknown')).status,403);
    const own=await app.request('library',{},'pupil-a');
    assert.equal(own.data.students.length,1);assert.equal(own.data.students[0].key,undefined);
    assert.equal((await app.request('url',{folder:'b',name:'x'},'pupil-a')).status,403);
    assert.equal((await app.request('createStudent',{name:'x'},'pupil-a')).status,403);
    assert.equal((await app.request('uploadUrl',{folder:'a',name:META_NAME})).status,403);
    assert.equal((await app.request('url',{folder:'a',name:'../../songs.sqlite'})).status,400);
    assert.equal((await fetch(app.base+'/api',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'})).status,403);
    assert.equal((await fetch(app.base+'/songs.sqlite')).status,404);
  } finally {await app.close();}
});
test('signed media supports full, HEAD, suffix, invalid and expired ranges; revocation applies immediately',async()=>{
  const app=await fixture();
  try {
    const {data}=await app.request('url',{folder:'a',name:'song.mp3'},'pupil-a'),url=app.signed(data.href);
    const full=await fetch(url);assert.equal(await full.text(),'0123456789');
    const range=await fetch(url,{headers:{range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');
    assert.equal(await (await fetch(url,{headers:{range:'bytes=-3'}})).text(),'789');
    assert.equal((await fetch(url,{method:'HEAD'})).headers.get('content-length'),'10');
    for(const range of ['bytes=20-30','bytes=5-2','bytes=0-1,3-4','bytes=-0'])assert.equal((await fetch(url,{headers:{range}})).status,416);
    assert.equal((await fetch(url+'bad')).status,403);
    const expired=new URL(url),payload=JSON.parse(Buffer.from(expired.searchParams.get('token').split('.')[0],'base64url'));
    payload.expires=Date.now()-1000;
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    expired.searchParams.set('token',encoded+'.'+crypto.createHmac('sha256','test-signing-secret').update(encoded).digest('base64url'));
    assert.equal((await fetch(expired)).status,403);
    await app.request('resetLink',{folder:'a'});
    assert.equal((await fetch(url)).status,403);
    assert.equal((await app.request('library',{},'pupil-a')).status,403);
  } finally {await app.close();}
});
test('uploads are single-use, bounded, conflict-safe and invisible until complete',async()=>{
  const app=await fixture();
  try {
    const token=await app.request('uploadUrl',{folder:'a',name:'new.txt'},'pupil-a');
    const url=app.signed(token.data.href);
    assert.equal((await fetch(url,{method:'PUT',body:'new content'})).status,200);
    assert.equal((await fetch(url,{method:'PUT',body:'replayed'})).status,409);
    const conflict=await app.request('uploadUrl',{folder:'a',name:'new.txt'},'pupil-a');
    assert.equal((await fetch(app.signed(conflict.data.href),{method:'PUT',body:'conflict'})).status,409);
    assert.equal(fs.readFileSync(app.store.blobPath(app.store.file('a','new.txt').blob),'utf8'),'new content');
    const large=await app.request('uploadUrl',{folder:'a',name:'large.txt'},'pupil-a');
    assert.equal((await fetch(app.signed(large.data.href),{method:'PUT',body:'x'.repeat(33)})).status,413);
    assert.throws(()=>app.store.file('a','large.txt'));
  } finally {await app.close();}
});
test('metadata patches preserve concurrent fields, copy omits impulse, renames preserve keys, deletes retain blobs',async()=>{
  const app=await fixture();
  try {
    const patches=[{notes:'notes'},{translation:'translation'},{impulse:'тихо плавно'}];
    assert((await Promise.all(patches.map(patch=>app.request('saveMeta',{folder:'a',song:'song',patch})))).every(r=>r.status===200));
    assert.deepEqual(app.store.meta('a').songs.song,{notes:'notes',translation:'translation',impulse:'тихо плавно'});
    await app.request('copyTo',{folder:'a',to:'b',names:['song.mp3'],song:'song'});
    assert.equal(app.store.meta('b').songs.song.impulse,undefined);assert.equal(app.store.meta('b').songs.song.notes,'notes');
    const hash=app.store.file('a','song.mp3').blob;
    await app.request('rename',{folder:'a',name:'song.mp3',newName:'renamed.mp3'});
    assert.equal(app.store.file('a','renamed.mp3').blob,hash);
    await app.request('delete',{folder:'a',name:'renamed.mp3'});
    assert(fs.existsSync(app.store.blobPath(hash)));
    await app.request('renameStudent',{folder:'a',newName:'new name'});
    assert.equal(app.store.folder('a').key,'pupil-a');
    assert.equal((await app.request('saveMeta',{folder:'a',song:'__proto__',patch:{notes:'bad'}})).status,400);
    await app.request('deleteStudent',{folder:'a'});assert.equal((await app.request('library',{},'pupil-a')).status,403);
  } finally {await app.close();}
});
test('staging prevents ALL mutations and upload tickets but permits reads',async()=>{
  const app=await fixture(true);
  try {
    assert.equal((await app.request('library')).status,200);
    assert.equal((await app.request('url',{folder:'a',name:'song.mp3'})).status,200);
    for(const action of ['uploadUrl','saveText','rename','delete','copyTo','saveMeta','createStudent','renameStudent','deleteStudent','resetLink']) {
      assert.equal((await app.request(action,{folder:'a',name:'song.mp3'})).status,503,action);
    }
  } finally {await app.close();}
});
