import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const repo='ekaterinasutova11-source/songs';
const result=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['pipe','pipe','pipe']});
const credentials=Object.fromEntries(result.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
if(!credentials.password)throw new Error('No existing GitHub credential');
export async function github(endpoint,options={}){
  const r=await fetch('https://api.github.com/repos/'+repo+endpoint,{...options,headers:{Authorization:'Bearer '+credentials.password,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...options.headers}});
  const data=r.status===204?null:await r.json();if(!r.ok)throw new Error(`GitHub HTTP ${r.status}: ${data?.message}`);return data;
}
if(process.argv[2]==='status'){
  const project=await github('');
  const pages=await github('/pages');
  const report={push:project.permissions?.push,defaultBranch:project.default_branch,pages:{status:pages.status,buildType:pages.build_type,source:pages.source,url:pages.html_url}};
  fs.mkdirSync('secrets/selectel-cutover',{recursive:true});fs.writeFileSync('secrets/selectel-cutover/github-status.json',JSON.stringify(report));
  console.log(JSON.stringify(report));
}
