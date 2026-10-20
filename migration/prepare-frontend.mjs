import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('outputs/frontend-release');
if(fs.existsSync(root))throw new Error('Existing frontend staging: keep it or choose a fresh release directory');
fs.mkdirSync(root,{recursive:true});
const files=fs.readdirSync('.').filter(name=>/\.(html|css|js|svg)$/.test(name)&&name!=='server.js');
for(const name of files)fs.copyFileSync(name,path.join(root,name));
fs.cpSync('assets',path.join(root,'assets'),{recursive:true});
const manifest=[];
function walk(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){
  const p=path.join(directory,e.name);if(e.isDirectory())walk(p);else manifest.push({path:path.relative(root,p).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});
}}
walk(root);fs.writeFileSync('outputs/frontend-manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({files:manifest.length,privateFilesIncluded:false}));
