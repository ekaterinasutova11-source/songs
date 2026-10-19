import fs from 'node:fs';
import assert from 'node:assert/strict';
const settings=JSON.parse(fs.readFileSync('secrets/selectel-cutover/source/settings.json'));
const inventory=JSON.parse(fs.readFileSync('secrets/selectel-cutover/source/inventory.json'));
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const old='https://functions.yandexcloud.net/d4eotnn5qmurkd5kle8k';
const call=async(endpoint,key,params={})=>{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain',Origin:'https://ekaterinasutova11-source.github.io'},body:JSON.stringify({action:'library',key,...params}),signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://ekaterinasutova11-source.github.io');return r.json();
};
const [direct,legacy]=await Promise.all([call('https://135.106.183.211/api',teacher),call(old,teacher)]);assert.deepEqual(legacy,direct);
let checked=0;
for(const folder of inventory.folders){
  const key=settings.students[folder.resource_id].key;
  const pupil=await call(old,key);assert.equal(pupil.role,'student');assert.equal(pupil.students.length,1);assert.equal(pupil.students[0].id,folder.resource_id);checked++;
}
console.log(JSON.stringify({legacyGateway:'Selectel',teacherLibraryMatches:true,originalPupilKeysWorking:checked}));
