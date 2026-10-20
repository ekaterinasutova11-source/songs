import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../migration/server.mjs';
import { Store, META_NAME } from '../migration/local-store.mjs';
import { DatabaseSync } from 'node:sqlite';

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

test('direct shared memberships expose only own and assigned groups; legacy links stay scoped',async()=>{
  const app=await fixture();
  try {
    for(const id of ['g','h'])app.store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run(id,id,'key-'+id);
    app.store.transaction(()=>app.store.saveFile('g','shared.mp3',app.store.putBytes(Buffer.from('group bytes'))));
    assert.equal((await app.request('setSpaceMembers',{folder:'g',kind:'duet',members:['a','b']})).status,200);
    assert.equal((await app.request('setSpaceMembers',{folder:'h',kind:'ensemble',members:['a']})).status,200);
    const a=(await app.request('library',{includeSpaces:true},'pupil-a')).data;
    assert.equal(a.ownId,'a');assert.deepEqual(a.students.map(s=>s.id),['a','g','h']);
    for(const row of a.students){assert.equal(row.key,undefined);assert.equal(row.members,undefined);}
    assert.deepEqual((await app.request('library',{},'pupil-a')).data.students.map(s=>s.id),['a']);
    assert.deepEqual((await app.request('library',{includeSpaces:true},'key-g')).data.students.map(s=>s.id),['g']);
    assert.equal((await app.request('saveMeta',{folder:'g',song:'x',patch:{notes:'bad'}},'key-g')).status,403);
    assert.deepEqual((await app.request('library',{includeSpaces:true},'pupil-b')).data.students.map(s=>s.id),['b','g']);
    const media=await app.request('url',{folder:'g',name:'shared.mp3'},'pupil-a');
    assert.equal(media.status,200);assert.equal(await(await fetch(app.signed(media.data.href))).text(),'group bytes');
    for(const action of ['uploadUrl','saveText','saveMeta','rename','delete']) {
      assert.equal((await app.request(action,{folder:'g',name:'shared.mp3',song:'x',patch:{notes:'bad'}},'pupil-a')).status,403);
    }
    assert.equal((await app.request('url',{folder:'b',name:'secret.txt'},'pupil-a')).status,403);
    assert.equal((await app.request('url',{folder:'h',name:'secret.txt'},'pupil-b')).status,403);
    assert.equal((await app.request('setSpaceMembers',{folder:'g',kind:'duet',members:[]},'pupil-a')).status,403);
    assert.deepEqual(app.store.members('g'),['a','b']);
  } finally {await app.close();}
});

test('removal, member archive and group archive revoke issued tickets without reviving them',async()=>{
  const app=await fixture();
  try {
    app.store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run('g','group','key-group');
    app.store.transaction(()=>app.store.saveFile('g','s.mp3',app.store.putBytes(Buffer.from('shared'))));
    const set=members=>app.request('setSpaceMembers',{folder:'g',kind:'ensemble',members});
    const ticket=async()=>app.signed((await app.request('url',{folder:'g',name:'s.mp3'},'pupil-a')).data.href);
    await set(['a']);const original=await ticket();assert.equal((await fetch(original)).status,200);
    await set([]);assert.equal((await fetch(original)).status,403);
    await set(['a']);assert.equal((await fetch(original)).status,403);
    const beforeMemberArchive=await ticket();await app.request('archiveStudent',{folder:'a'});
    assert.equal((await fetch(beforeMemberArchive)).status,403);
    assert.equal((await app.request('library',{includeSpaces:true},'pupil-a')).status,403);
    await app.request('restoreStudent',{folder:'a'});assert.equal(app.store.folder('a').key,'pupil-a');
    assert.equal((await fetch(beforeMemberArchive)).status,403);
    const beforeGroupArchive=await ticket();await app.request('archiveStudent',{folder:'g'});
    assert.equal((await fetch(beforeGroupArchive)).status,403);
    assert.deepEqual((await app.request('library',{includeSpaces:true},'pupil-a')).data.students.map(s=>s.id),['a']);
    await app.request('restoreStudent',{folder:'g'});assert.equal((await fetch(beforeGroupArchive)).status,403);
    assert.equal((await fetch(await ticket())).status,200);
    assert.equal(app.store.folder('g').key,'key-group');
    assert.equal(fs.readFileSync(app.store.blobPath(app.store.file('g','s.mp3').blob),'utf8'),'shared');
  } finally {await app.close();}
});

test('membership migration is additive, validates direct members, and survives backup/reopen',async()=>{
  const app=await fixture();
  try {
    app.store.db.prepare('INSERT INTO folders(id,name,key) VALUES(?,?,?)').run('g','group','key-group');
    assert.equal((await app.request('setSpaceMembers',{folder:'g',kind:'duet',members:['a']})).status,200);
    for(const params of [{kind:'bad',members:['b']},{kind:'duet',members:['g']},{kind:'duet',members:['a','a']},{kind:'duet',members:['missing']}]) {
      assert.notEqual((await app.request('setSpaceMembers',{folder:'g',...params})).status,200);
      assert.deepEqual(app.store.members('g'),['a']);
    }
    assert.equal((await app.request('setSpaceMembers',{folder:'b',kind:'ensemble',members:['g']})).status,400);
    const snapshot=path.join(app.directory,'membership-backup.sqlite');
    app.store.db.exec("VACUUM INTO '"+snapshot.replaceAll("'","''")+"'");
    const backup=new DatabaseSync(snapshot);
    assert.equal(backup.prepare('SELECT member FROM space_memberships WHERE space=?').get('g').member,'a');backup.close();
    const reopened=new Store(app.directory);assert.deepEqual(reopened.members('g'),['a']);
    assert.equal(reopened.folder('a').key,'pupil-a');assert.equal(reopened.folder('g').kind,'duet');reopened.close();
  } finally {await app.close();}
});
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
    for(const action of ['uploadUrl','saveText','rename','delete','copyTo','saveMeta','createStudent','renameStudent','deleteStudent','resetLink','archiveStudent','restoreStudent']) {
      assert.equal((await app.request(action,{folder:'a',name:'song.mp3'})).status,503,action);
    }
  } finally {await app.close();}
});

test('archive closes pupil access and old media/upload tickets, preserves all materials, restores the original link',async()=>{
  const app=await fixture();
  try{
    await app.request('saveMeta',{folder:'a',song:'song',patch:{notes:'Keep notes',translation:'Keep translation',impulse:'тихо плавно'}});
    const before=app.store.folderData('a'),key=app.store.folder('a').key;
    const download=await app.request('url',{folder:'a',name:'song.mp3'},key);
    const upload=await app.request('uploadUrl',{folder:'a',name:'pending.txt'},key);
    const teacherDownload=await app.request('url',{folder:'a',name:'song.mp3'});
    const files=app.store.db.prepare('SELECT * FROM files WHERE folder=? ORDER BY name').all('a');
    assert.equal((await app.request('archiveStudent',{folder:'a'},'pupil-a')).status,403);
    assert.equal((await app.request('archiveStudent',{folder:'a'},'pupil-b')).status,403);
    assert.equal((await app.request('restoreStudent',{folder:'a'},'pupil-b')).status,403);
    assert.equal((await app.request('archiveStudent',{folder:'a'})).status,200);
    const archived=app.store.folder('a');assert(archived.archived_at);assert.equal(archived.key,key);
    assert.equal(archived.deleted,0);assert.deepEqual(app.store.folderData('a'),before);
    assert.deepEqual(app.store.db.prepare('SELECT * FROM files WHERE folder=? ORDER BY name').all('a'),files);
    assert.equal(app.store.folders().length,1);
    const teacher=(await app.request('library')).data.students.find(s=>s.id==='a');
    assert.equal(teacher.archivedAt,archived.archived_at);assert.equal(teacher.meta.song.notes,'Keep notes');
    for(const action of ['library','url','saveMeta','saveText','uploadUrl','restoreStudent'])assert.equal((await app.request(action,{folder:'a',name:'song.mp3'},key)).status,403,action);
    assert.equal((await fetch(app.signed(download.data.href))).status,403);
    assert.equal((await fetch(app.signed(upload.data.href),{method:'PUT',body:'must not save'})).status,403);
    assert.equal((await fetch(app.signed(teacherDownload.data.href))).status,200);
    await app.request('archiveStudent',{folder:'a'});assert.equal(app.store.folder('a').access_version,archived.access_version,'archive is idempotent');
    assert.equal((await app.request('restoreStudent',{folder:'a'})).status,200);
    assert.equal(app.store.folder('a').archived_at,null);assert.equal(app.store.folder('a').key,key);
    assert.equal((await app.request('library',{},key)).status,200);
    assert.deepEqual(app.store.folderData('a'),before);
    // Old tickets must not spring back to life after restoration.
    assert.equal((await fetch(app.signed(download.data.href))).status,403);
    assert.equal((await fetch(app.signed(upload.data.href),{method:'PUT',body:'still must not save'})).status,403);
    const fresh=await app.request('url',{folder:'a',name:'song.mp3'},key);
    assert.equal(await(await fetch(app.signed(fresh.data.href))).text(),'0123456789');
    assert.throws(()=>app.store.file('a','pending.txt'));
    const restored=app.store.folder('a').access_version;await app.request('restoreStudent',{folder:'a'});assert.equal(app.store.folder('a').access_version,restored);
  }finally{await app.close();}
});

test('additive archive migration opens an existing database without changing issued keys or file rows',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songs-before-archive-'));
  const db=new DatabaseSync(path.join(directory,'songs.sqlite'));
  db.exec("CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,key TEXT NOT NULL UNIQUE,deleted INTEGER NOT NULL DEFAULT 0); INSERT INTO folders(id,name,key) VALUES('old-id','Existing pupil','existing-key');");db.close();
  let app;
  try{
    app=createApp({directory,teacherKey:'teacher',signingKey:'secret',baseUrl:'http://localhost'});
    assert.equal(app.store.folder('old-id').key,'existing-key');assert.equal(app.store.folder('old-id').archived_at,null);assert.equal(app.store.folder('old-id').access_version,0);
    app.store.close();
    app=createApp({directory,teacherKey:'teacher',signingKey:'secret',baseUrl:'http://localhost'});
    assert.equal(app.store.folder('old-id').key,'existing-key');
  }finally{app?.store.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('archive state, access revocation and material references survive a SQLite backup and reopen',async()=>{
  const app=await fixture();
  const restoredDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'songs-restored-archive-'));
  let restored;
  try{
    await app.request('archiveStudent',{folder:'a'});
    app.store.db.exec('VACUUM INTO '+"'"+path.join(restoredDirectory,'songs.sqlite').replace(/\\/g,'/').replace(/'/g,"''")+"'");
    fs.cpSync(path.join(app.directory,'blobs'),path.join(restoredDirectory,'blobs'),{recursive:true});
    restored=new Store(restoredDirectory);
    assert(restored.folder('a').archived_at);assert.equal(restored.folder('a').key,'pupil-a');
    assert.equal(restored.folders().length,1);assert.equal(restored.folder('a').access_version,1);
    assert.equal(fs.readFileSync(restored.blobPath(restored.file('a','song.mp3').blob),'utf8'),'0123456789');
  }finally{restored?.close();fs.rmSync(restoredDirectory,{recursive:true,force:true});await app.close();}
});
