// Owner-authorized memberships. Never print credentials, pupil links or payloads.
// --plan only reads; --apply requires a fresh verified server backup first.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = 'https://135.106.183.211';
const teacher = fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
async function call(action, params={}) {
  const response = await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,key:teacher,...params}),signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error('Space setup API failed: '+response.status);
  return response.json();
}
const library=await call('library');
const normalize = value => value.toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();
function unique(fragment) {
  const matches=library.students.filter(s=>normalize(s.name).includes(normalize(fragment)));
  if(matches.length!==1) throw new Error('Space setup requires exactly one matching existing folder; inspect private plan');
  return matches[0];
}
const people={n:unique('Комарова Наталья'),m:unique('Ищенко Михаил'),e:unique('Русских Екатерина'),k:unique('Краюшкина Ксения')};
const plan=[
  {folder:unique('Дуэт Миша и Наташа').id,kind:'duet',members:[people.n.id,people.m.id]},
  {folder:unique('Дуэт Яша и Катя').id,kind:'duet',members:[people.e.id]},
  {folder:unique('Ансамбль').id,kind:'ensemble',members:[people.n.id,people.m.id,people.e.id,people.k.id]},
];
fs.mkdirSync('secrets/space-memberships',{recursive:true});
fs.writeFileSync('secrets/space-memberships/plan.json',JSON.stringify(plan,null,2));
const snapshot='secrets/space-memberships/library-before.json';
if(!fs.existsSync(snapshot))fs.writeFileSync(snapshot,JSON.stringify(library),{flag:'wx'});
if(process.argv.includes('--apply')) {
  for(const item of plan) await call('setSpaceMembers',item);
  const after=await call('library');
  for(const item of plan){const folder=after.students.find(s=>s.id===item.folder);
    assert.equal(folder.kind,item.kind);assert.deepEqual([...folder.members].sort(),[...item.members].sort());}
  const before=library;
  for(const old of before.students){
    const now=after.students.find(s=>s.id===old.id);
    if(!now || now.key!==old.key || JSON.stringify(now.files)!==JSON.stringify(old.files) || JSON.stringify(now.meta)!==JSON.stringify(old.meta)) throw new Error('Unexpected existing material or identity change; inspect private snapshots');
  }
  fs.writeFileSync('secrets/space-memberships/library-after.json',JSON.stringify(after));
}
console.log(JSON.stringify({groups:plan.length,memberships:plan.reduce((n,s)=>n+s.members.length,0),applied:process.argv.includes('--apply'),identitiesPreserved:true}));
