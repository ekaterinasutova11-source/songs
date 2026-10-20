import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute, studentPath, songPath, selectStudentSpace, canEditSpace} from '../navigation.js';

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

test('personal links stay unchanged while shared space songs round trip', () => {
  const own = 'individual:id', group = 'дуэт / лето', key = 'abcdefgh1234';
  assert.equal(studentPath('student', key, own, own), `#/s/${key}`);
  assert.equal(songPath('student', key, own, 'Песня', own), `#/s/${key}/song/${encodeURIComponent('Песня')}`);
  assert.deepEqual(parseRoute(songPath('student', key, group, 'Песня / 1', own)),
    {mode: 's', key, folder: group, song: 'Песня / 1'});
  assert.equal(parseRoute('#/s/abcdefgh1234/space/%ZZ'), null);
  assert.equal(parseRoute('#/t/abcdefgh1234/space/duet'), null);
});

test('a route selects only an authorized returned space, never another pupil or first group', () => {
  const own = {id: 'own', kind: 'individual'}, group = {id: 'group', kind: 'duet'};
  const spaces = [group, own];
  assert.equal(selectStudentSpace(spaces, 'own'), own);
  assert.equal(selectStudentSpace(spaces, 'own', 'group'), group);
  assert.equal(selectStudentSpace(spaces, 'own', 'other-personal'), null);
  assert.equal(selectStudentSpace([group], 'own'), null);
});

test('group members get no editing controls, own personal editing remains', () => {
  const own = {id: 'own', kind: 'individual'}, group = {id: 'group', kind: 'ensemble'};
  assert.equal(canEditSpace('student', 'own', own), true);
  assert.equal(canEditSpace('student', 'own', group), false);
  assert.equal(canEditSpace('student', 'group', group), false);
  assert.equal(canEditSpace('student', 'other', own), false);
  assert.equal(canEditSpace('teacher', null, group), true);
});
