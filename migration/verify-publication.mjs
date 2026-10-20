import fs from 'node:fs';
import {github} from './github-pages.mjs';
const build=await github('/pages/builds/latest');
const base='https://ekaterinasutova11-source.github.io/songs/';
const checks={};
const module=fs.readFileSync('index.html','utf8').match(/src="(app\.js\?v=[^"]+)"/)[1];
const modulePattern=new RegExp(module.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
for(const [file,pattern]of [['index.html',modulePattern],[module,/api\.js\?v=selectel1/],['api.js?v=selectel1',/config\.js\?v=selectel1/],['config.js?v=selectel1',/FUNCTION_URL\s*=\s*'https:\/\/135\.106\.183\.211\/api'/]]){
  const r=await fetch(base+file,{cache:'no-store',signal:AbortSignal.timeout(30000)});const body=await r.text();checks[file]=r.status===200&&pattern.test(body);
  if(file.startsWith('config'))checks.staleFallbackDisabled=/GOOGLE_RESERVE_URL\s*=\s*''/.test(body);
}
const report={checkedAt:new Date().toISOString(),build:{status:build.status,commit:build.commit,error:build.error?.message||null},checks,ready:build.status==='built'&&Object.values(checks).every(Boolean)};
fs.writeFileSync('outputs/selectel-publication.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(!report.ready)process.exitCode=2;
