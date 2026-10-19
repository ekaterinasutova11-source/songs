import fs from 'node:fs';
import assert from 'node:assert/strict';
const env=JSON.parse(fs.readFileSync('secrets/selectel-cutover/cloud-before.json')).environment;
const old=JSON.parse(fs.readFileSync('secrets/selectel-cutover/source/inventory.json'));
const headers={Authorization:'OAuth '+env.DISK_TOKEN};
const files=[],folders=[];
async function get(resource,params){
  const r=await fetch('https://cloud-api.yandex.net/v1/disk/resources'+resource+'?'+new URLSearchParams(params),{headers,signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200,'Source check failed');return r.json();
}
async function walk(dir){
  let offset=0;for(;;){const p=await get('',{path:dir,limit:'1000',offset:String(offset)});for(const x of p._embedded.items){if(x.type==='dir'){folders.push(x);await walk(x.path);}else files.push(x);}offset+=p._embedded.items.length;if(offset>=p._embedded.total)break;if(!p._embedded.items.length)throw new Error('Incomplete source catalog');}
}
await walk(env.ROOT);
const stamp=items=>JSON.stringify(items.map(x=>[x.path,x.resource_id,x.size,x.modified,x.sha256,x.md5]).sort());
assert.equal(stamp(files),stamp(old.files),'Source files changed after the final snapshot');
assert.equal(stamp(folders),stamp(old.folders),'Source spaces changed after the final snapshot');
const {href}=await get('/download',{path:env.SETTINGS});const r=await fetch(href,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);
assert.deepEqual(await r.json(),JSON.parse(fs.readFileSync('secrets/selectel-cutover/source/settings.json')));
console.log(JSON.stringify({lateSourceChanges:0,files:files.length,spaces:folders.length,settingsUnchanged:true}));
