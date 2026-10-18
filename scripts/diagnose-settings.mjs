import fs from 'node:fs';
const output = 'secrets/recovery-2026-10-19';
fs.mkdirSync(output, {recursive:true});
const token = fs.readFileSync('secrets/yandex.env','utf8').match(/^YANDEX_DISK_TOKEN=(.*)$/m)[1].trim();
const headers = {Authorization:`OAuth ${token}`};
const settingsPath = 'disk:/Песни учеников — настройки (не удалять).json';
const root = 'disk:/Песни для Notion';
const report = [];
async function probe(name, url, extra = {}) {
  try {
    const r=await fetch(url,{headers:{...headers,...extra},signal:AbortSignal.timeout(20000)});
    const data=Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(`${output}/${name}.bin`,data);
    let json; try{json=JSON.parse(data.toString('utf8'));}catch{}
    const row={name,status:r.status,bytes:data.length,json:!!json,
      students:json?.students?Object.keys(json.students).length:undefined};
    report.push(row);console.log(JSON.stringify(row));
    return {r,json};
  }catch(e){const row={name,error:e.name};report.push(row);console.log(JSON.stringify(row));return {};}
}
const api='https://cloud-api.yandex.net/v1/disk';
await probe('folders',`${api}/resources?${new URLSearchParams({path:root,limit:'1000',fields:'_embedded.items.name,_embedded.items.path,_embedded.items.resource_id,_embedded.items.type'})}`);
await probe('settings-metadata',`${api}/resources?${new URLSearchParams({path:settingsPath})}`);
const {json:link}=await probe('settings-link',`${api}/resources/download?${new URLSearchParams({path:settingsPath})}`);
if(link?.href){
  // Download URL is signed; do not forward the Disk OAuth header to it.
  const oldAuth=headers.Authorization;delete headers.Authorization;
  await probe('settings-content',link.href);
  await probe('settings-range',link.href,{Range:'bytes=0-65535'});
  headers.Authorization=oldAuth;
}
await probe('settings-webdav','https://webdav.yandex.ru/'+settingsPath.slice(6).split('/').map(encodeURIComponent).join('/'));
fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
