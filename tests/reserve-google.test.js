import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const code = fs.readFileSync(new URL('../reserve-google/Code.gs', import.meta.url), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function service({changedArchive = false, wrongRange = false, extraArchive = false, changedExtra = false} = {}) {
  const index = {version: 1, readOnly: true, teacherKeySha256: hash('teacher-test'),
    archive: {name: 'test.zip', size: 1000, md5: 'test-md5'}, missing: [{}], capturedAt: '2026-10-13',
    students: [
      {id: 'old-a', name: 'A', key: 'student-a', meta: {}, metadataUnavailable: true,
        files: [{name: 'song.mp3', size: 4, offset: 100, sha256: hash('test')}]},
      {id: 'old-b', name: 'B', key: 'student-b', meta: {}, files: []}
    ]};
  if (extraArchive) {
    index.extraArchives = [{name:'additions.zip', size:3000, md5:'extra-md5'}];
    index.students[0].files[0].archive = 'additions.zip';
    index.students[0].files[0].offset = 2000;
  }
  let reads = 0;
  const folder = {getFilesByName(name) {
    let consumed = false;
    return {hasNext: () => !consumed, next() {
      consumed = true;
      return {getId: () => name==='additions.zip'?'private-extra':'private-archive', getBlob: () => ({getDataAsString: () => JSON.stringify(index)})};
    }};
  }};
  const context = vm.createContext({console,
    DriveApp: {getFolderById: () => folder},
    Drive: {Files: {get: id => id==='private-extra' ? {size:3000,md5Checksum:changedExtra?'changed':'extra-md5'}
      : ({size: 1000, md5Checksum: changedArchive ? 'changed' : 'test-md5'})}},
    Utilities: {DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (_a, value) => [...crypto.createHash('sha256').update(value).digest()],
      base64Encode: bytes => Buffer.from(bytes).toString('base64')},
    ScriptApp: {getOAuthToken: () => 'never-return-this-token'},
    UrlFetchApp: {fetch(url, options) {
      reads++;
      assert.equal(options.headers.Range, extraArchive?'bytes=2000-2003':'bytes=100-103');
      if (extraArchive) assert.match(url, /private-extra/);
      return {getResponseCode: () => 206, getAllHeaders: () => ({'Content-Range': wrongRange ? 'bytes 0-3/1000' : extraArchive?'bytes 2000-2003/3000':'bytes 100-103/1000'}),
        getBlob: () => ({getBytes: () => [...Buffer.from('test')]})};
    }},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({setMimeType: () => text})}
  });
  vm.runInContext(code, context);
  return {call: req => JSON.parse(context.doPost({postData: {contents: JSON.stringify(req)}})), reads: () => reads};
}
test('reserve keeps original pupil ids and confines pupil library to their folder', () => {
  const s = service();
  const result = s.call({action: 'library', key: 'student-a'});
  assert.equal(result.ok, true);
  assert.equal(result.data.students.length, 1);
  assert.equal(result.data.students[0].id, 'old-a');
  assert.equal(result.data.students[0].metadataUnavailable, true);
  assert.equal(result.data.students[0].key, undefined);
  assert.equal(result.data.reserve.readOnly, true);
  assert.doesNotMatch(JSON.stringify(result), /student-b|teacherKeySha256|never-return-this-token/);
  assert.equal(s.call({action: 'fileInfo', key: 'student-a', folder: 'old-b', name: 'song.mp3'}).status, 403);
  assert.equal(s.call({action: 'library', key: 'invalid'}).status, 403);
});
test('teacher can recover existing pupil links but mutations never succeed', () => {
  const s = service();
  assert.equal(s.call({action: 'library', key: 'teacher-test'}).data.students[1].key, 'student-b');
  assert.equal(s.call({action: 'saveMeta', key: 'teacher-test', folder: 'old-a'}).ok, false);
  assert.equal(s.reads(), 0);
});
test('range reads cannot escape song bytes; OAuth token is never returned', () => {
  const s = service();
  for (const req of [{start: -1, length: 4}, {start: 0, length: 5}, {start: '0', length: 4}]) {
    assert.equal(s.call({action: 'fileChunk', key: 'student-a', folder: 'old-a', name: 'song.mp3', ...req}).status, 400);
  }
  assert.equal(s.reads(), 0);
  const result = s.call({action: 'fileChunk', key: 'student-a', folder: 'old-a', name: 'song.mp3', start: 0, length: 4});
  assert.equal(Buffer.from(result.data.data, 'base64').toString(), 'test');
  assert.doesNotMatch(JSON.stringify(result), /never-return-this-token/);
});
test('changed archives and incorrect HTTP ranges fail closed', () => {
  assert.equal(service({changedArchive: true}).call({action: 'library', key: 'teacher-test'}).status, 503);
  assert.equal(service({wrongRange: true}).call({action: 'fileChunk', key: 'student-a', folder: 'old-a', name: 'song.mp3', start: 0, length: 4}).status, 502);
});
test('restored texts are read from their checked supplement archive without touching the base ZIP', () => {
  const s=service({extraArchive:true});
  const result=s.call({action:'fileChunk',key:'student-a',folder:'old-a',name:'song.mp3',start:0,length:4});
  assert.equal(result.ok,true); assert.equal(Buffer.from(result.data.data,'base64').toString(),'test');
  assert.equal(service({extraArchive:true,changedExtra:true}).call({action:'library',key:'teacher-test'}).status,503);
});
