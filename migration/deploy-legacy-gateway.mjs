import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const directory='secrets/selectel-cutover';fs.mkdirSync(directory,{recursive:true});
const mode=process.argv[2];
if(!['freeze','redirect','rollback'].includes(mode))throw new Error('Pass freeze, redirect or rollback');
const original=JSON.parse(fs.readFileSync('secrets/recovery-2026-10-19/cloud-version-after.json'));
const yc=path.join(process.env.USERPROFILE,'yandex-cloud/bin/yc.exe');
const run=(...args)=>{
  try{return JSON.parse(execFileSync(yc,[...args,'--format','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch{throw new Error('Yandex deployment failed; command arguments and credentials suppressed');}
};
const current=run('serverless','function','version','list','--function-id',original.function_id).find(v=>v.status==='ACTIVE');
if(!current)throw new Error('No active legacy function');
const full=run('serverless','function','version','get','--id',current.id);
const before=path.join(directory,'cloud-before.json');
if(mode==='freeze'){
  if(fs.existsSync(before))throw new Error('Cutover already started; inspect saved state');
  fs.writeFileSync(before,JSON.stringify(full));
}
const baseline=JSON.parse(fs.readFileSync(before));
const source=path.join(directory,'legacy-backend');fs.mkdirSync(source,{recursive:true});
for(const file of ['index.js','package.json'])fs.copyFileSync(path.join('backend',file),path.join(source,file));
const environment={...baseline.environment};
delete environment.SELECTEL_API_URL;delete environment.MIGRATION_READ_ONLY;
if(mode==='freeze')environment.MIGRATION_READ_ONLY='true';
if(mode==='redirect')environment.SELECTEL_API_URL='https://135.106.183.211/api';
const args=['serverless','function','version','create','--function-id',baseline.function_id,
  '--runtime',baseline.runtime,'--entrypoint',baseline.entrypoint,'--memory',`${Number(baseline.resources.memory)/1048576}m`,
  '--execution-timeout',baseline.execution_timeout,'--source-path',source,
  '--environment',Object.entries(environment).map(([key,value])=>`${key}=${value}`).join(',')];
if(baseline.service_account_id)args.push('--service-account-id',baseline.service_account_id);
const deployed=run(...args);fs.writeFileSync(path.join(directory,`cloud-${mode}.json`),JSON.stringify(deployed));
console.log(JSON.stringify({mode,id:deployed.id,status:deployed.status}));
