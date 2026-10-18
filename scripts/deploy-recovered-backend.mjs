// Uses the existing cloud identity, function, permissions and teacher credential.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const directory='secrets/recovery-2026-10-19';
const old=JSON.parse(fs.readFileSync(`${directory}/cloud-version-before.json`,'utf8'));
const recovery=JSON.parse(fs.readFileSync(`${directory}/verified-recovery-plan.json`,'utf8'));
assert(recovery.private && recovery.currentSpaces===11 && recovery.preservedIssuedLinks===9 && recovery.newLinks===2);
const yc=path.join(process.env.USERPROFILE,'yandex-cloud/bin/yc.exe');
const run=(...args)=>JSON.parse(execFileSync(yc,[...args,'--format','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const active=run('serverless','function','version','list','--function-id',old.function_id).find(v=>v.status==='ACTIVE');
assert.equal(active.id,old.id,'Deployment changed since backup: review before proceeding');
const environment={...old.environment,SETTINGS:recovery.settingsPath};
const args=['serverless','function','version','create','--function-id',old.function_id,
  '--runtime',old.runtime,'--entrypoint',old.entrypoint,'--memory',`${Number(old.resources.memory)/1048576}m`,
  '--execution-timeout',old.execution_timeout,'--source-path','backend',
  '--environment',Object.entries(environment).map(([k,v])=>`${k}=${v}`).join(',')];
if(old.service_account_id)args.push('--service-account-id',old.service_account_id);
const next=run(...args);
fs.writeFileSync(`${directory}/cloud-version-after.json`,JSON.stringify(next,null,2));
console.log(JSON.stringify({id:next.id,status:next.status,runtime:next.runtime,
  teacherUnchanged:next.environment?.TEACHER_KEY===old.environment.TEACHER_KEY,
  tokenUnchanged:next.environment?.DISK_TOKEN===old.environment.DISK_TOKEN,
  rootUnchanged:next.environment?.ROOT===old.environment.ROOT}));
