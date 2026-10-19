import fs from 'node:fs';
import assert from 'node:assert/strict';
const oldRoot='secrets/selectel-2026-10-20/source',newRoot='secrets/selectel-cutover/source';
const old=JSON.parse(fs.readFileSync(oldRoot+'/manifest.json')),current=JSON.parse(fs.readFileSync(newRoot+'/manifest.json'));
const settings=JSON.parse(fs.readFileSync(newRoot+'/settings.json'));
const previous=JSON.parse(fs.readFileSync(oldRoot+'/settings.json'));
const inventory=JSON.parse(fs.readFileSync(newRoot+'/inventory.json'));
for(const f of inventory.folders){assert.equal(settings.students[f.resource_id]?.key,previous.students[f.resource_id]?.key,'Existing access key changed during migration');}
const before=new Map(old.records.map(r=>[r.path,r]));
const added=[],changed=[];
for(const r of current.records){const b=before.get(r.path);if(!b)added.push(r.path);else if(b.sha256!==r.sha256||b.modified!==r.modified)changed.push(r.path);before.delete(r.path);}
const env=JSON.parse(fs.readFileSync('secrets/selectel-cutover/cloud-freeze.json')).environment;
assert.equal(env.MIGRATION_READ_ONLY,'true');
const r=await fetch('https://functions.yandexcloud.net/d4eotnn5qmurkd5kle8k',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'saveText',name:'invalid-without-extension',key:'freeze-check'}),signal:AbortSignal.timeout(30000)});
assert.equal(r.status,503,'Source mutation gate not active');
const report={checkedAt:new Date().toISOString(),files:current.files,spaces:inventory.folders.length,bytes:current.bytes,added:added.length,changed:changed.length,removed:before.size,issuedKeysPreserved:true,sourceFrozen:true};
fs.writeFileSync('outputs/selectel-cutover-reconciliation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
