// Loopback-only test entry points keep access keys out of tool arguments.
import http from 'node:http';
import fs from 'node:fs';
const teacher=fs.readFileSync('secrets/teacher.env','utf8').match(/^TEACHER_KEY=(.*)$/m)[1].trim();
const settings=JSON.parse(fs.readFileSync('secrets/selectel-2026-10-20/source/settings.json'));
const keys=Object.values(settings.students).map(s=>s.key);
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const legacy=url.pathname.startsWith('/legacy/');
  const route=url.pathname.replace(/^\/legacy/,'');
  const base=legacy?'https://ekaterinasutova11-source.github.io/songs/':'https://135.106.183.211/';
  let fragment;
  if(route==='/teacher')fragment='#/t/'+teacher;
  else if(/^\/student\/\d+$/.test(route)){const key=keys[Number(route.split('/').pop())];if(key)fragment='#/s/'+key;}
  if(!fragment){res.writeHead(404).end();return;}
  res.writeHead(302,{'Location':base+fragment,'Cache-Control':'no-store'}).end();
}).listen(5174,'127.0.0.1',()=>console.log('Private browser test entry ready on loopback'));
