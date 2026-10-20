import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute, studentPath, songPath} from '../navigation.js';

test('existing pupil and teacher links still open the repertoire', () => {
  assert.deepEqual(parseRoute('#/s/abcdefgh1234'),{mode:'s',key:'abcdefgh1234',folder:null,song:null});
  assert.equal(parseRoute('#/t/abcdefgh1234/s/594%3Afolder').folder,'594:folder');
});
test('song pages round trip Unicode, slashes and punctuation for both roles', () => {
  const song='Песня / summer #1 ? + любовь';
  for(const role of ['teacher','student']) {
    const route=parseRoute(songPath(role,'abcdefgh1234','594:folder',song));
    assert.equal(route.song,song);
    assert.equal(route.folder,role==='teacher'?'594:folder':null);
    assert.equal(parseRoute(studentPath(role,'abcdefgh1234','594:folder')).song,null);
  }
});
test('malformed and foreign-folder pupil routes are rejected without throwing', () => {
  for(const hash of ['#/s/abcdefgh1234/song/%E0%A4','#/s/abcdefgh1234/s/other','#/s/short','#/t/abcdefgh1234/s/%ZZ'])
    assert.equal(parseRoute(hash),null);
});
test('teacher archive has a reloadable route without changing existing pupil links',()=>{
  assert.deepEqual(parseRoute('#/t/abcdefgh1234/archive'),{mode:'t',key:'abcdefgh1234',folder:null,song:null,archive:true});
  assert.equal(parseRoute('#/s/abcdefgh1234/archive'),null);
  assert.equal(parseRoute('#/t/short/archive'),null);
});
