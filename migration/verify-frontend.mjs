// Read-only checks; private baseline includes access keys and stays in secrets/.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base='https://135.106.183.211';
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const api=async(key,action='library',params={})=>{
  const r=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,key,...params}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();assert.equal(r.status,200);return data;
};
const directory='secrets/frontend-move';fs.mkdirSync(directory,{recursive:true});
const library=await api(teacher);
if(process.argv.includes('--baseline')){
  fs.writeFileSync(directory+'/library-before.json',JSON.stringify(library),{flag:'wx'});
  console.log(JSON.stringify({baselineSaved:true,spaces:library.students.length}));
}else{
  assert.deepEqual(library,JSON.parse(fs.readFileSync(directory+'/library-before.json')));
  const manifest=JSON.parse(fs.readFileSync('outputs/frontend-manifest.json'));
  for(const file of manifest){
    const r=await fetch(base+'/'+file.path,{cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),file.sha256);
  }
  let pupilLinks=0;
  for(const pupil of library.students.filter(s=>!s.archivedAt)){
    await new Promise(r=>setTimeout(r,160));
    const own=await api(pupil.key);assert.equal(own.role,'student');assert.equal(own.students.length,1);assert.equal(own.students[0].id,pupil.id);pupilLinks++;
  }
  const html=await(await fetch(base+'/')).text();assert(!html.includes('fonts.googleapis.com'));assert(html.includes('assets/fonts/fonts.css'));
  for(const url of ['/secrets/teacher.env','/migration/server.mjs','/songs.sqlite'])assert([403,404].includes((await fetch(base+url)).status));
  const report={checkedAt:new Date().toISOString(),staticFilesHashVerified:manifest.length,libraryUnchanged:true,pupilLinksWorking:pupilLinks,fontsSelfHosted:true,privatePathsBlocked:true};
  fs.writeFileSync('outputs/frontend-move-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
