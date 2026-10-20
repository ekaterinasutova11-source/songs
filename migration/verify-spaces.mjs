// Read-only live checks. Reports contain aggregate counts, never links or keys.
import fs from 'node:fs';
const base='https://135.106.183.211';
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
async function call(key,action='library',params={}) {
  const r=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,key,...params}),signal:AbortSignal.timeout(30000)});
  return {status:r.status,data:await r.json()};
}
const library=(await call(teacher)).data;
const plan=JSON.parse(fs.readFileSync('secrets/space-memberships/plan.json'));
const individuals=[...new Set(plan.flatMap(s=>s.members))];
let forbiddenReads=0,groupMediaReads=0;
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
for(const id of individuals) {
  const own=library.students.find(s=>s.id===id);
  const result=await call(own.key,'library',{includeSpaces:true});
  const expected=[id,...plan.filter(p=>p.members.includes(id)).map(p=>p.folder)];
  if(result.status!==200 || result.data.ownId!==id || !same(result.data.students.map(s=>s.id),expected) || result.data.students.some(s=>'key' in s || 'members' in s)) throw new Error('Shared library isolation failed');
  if((await call(own.key)).data.students.length!==1)throw new Error('Legacy library contract changed');
  for(const peer of individuals.filter(p=>p!==id)) {
    const denied=await call(own.key,'url',{folder:peer,name:'permission-probe.txt'});
    if(denied.status!==403)throw new Error('Peer folder was accessible');forbiddenReads++;
  }
  const group=plan.find(p=>p.members.includes(id));
  const folder=library.students.find(s=>s.id===group.folder);
  const file=folder.files.find(f=>/\.(mp3|wav|m4a|ogg)$/i.test(f.name));
  if(file){
    const ticket=await call(own.key,'url',{folder:folder.id,name:file.name});
    if(ticket.status!==200)throw new Error('Shared media ticket failed');
    const bytes=await fetch(ticket.data.href,{headers:{Range:'bytes=0-31'},signal:AbortSignal.timeout(15000)});
    if(bytes.status!==206 || (await bytes.arrayBuffer()).byteLength!==32)throw new Error('Shared media range failed');groupMediaReads++;
  }
}
for(const item of plan){
  const group=library.students.find(s=>s.id===item.folder);
  const legacy=await call(group.key,'library',{includeSpaces:true});
  if(legacy.status!==200 || !same(legacy.data.students.map(s=>s.id),[group.id]))throw new Error('Legacy group key gained extra access');
}
const report={checkedAt:new Date().toISOString(),groups:plan.length,memberships:plan.reduce((n,s)=>n+s.members.length,0),personalAccountsChecked:individuals.length,forbiddenPeerReads:forbiddenReads,sharedRangeReads:groupMediaReads,legacyGroupLinksScoped:true,writesPerformed:false};
fs.writeFileSync('outputs/shared-spaces-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
