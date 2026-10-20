// Vendor the site's existing fonts; no credentials, no runtime CDN requests.
import fs from 'node:fs';
import crypto from 'node:crypto';
const directory='assets/fonts';fs.mkdirSync(directory,{recursive:true});
const endpoint='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Manrope:wght@400;500;600;700&display=swap';
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`Font HTTP ${r.status}`);return r;}
let css=await (await get(endpoint)).text();
const urls=[...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m=>m[1]))];
if(!urls.length)throw new Error('No font files returned');
for(const url of urls){
  const bytes=Buffer.from(await(await get(url)).arrayBuffer());
  const name=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,20)+new URL(url).pathname.match(/\.[a-z0-9]+$/)[0];
  fs.writeFileSync(`${directory}/${name}`,bytes);css=css.replaceAll(url,`./${name}`);
}
if(css.includes('https://'))throw new Error('Unexpected remote font dependency');
fs.writeFileSync(`${directory}/fonts.css`,'/* Self-hosted Google Fonts; see font-specific OFL licenses. */\n'+css);
for(const family of ['cormorantgaramond','manrope']){
  const license=await(await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`)).text();
  fs.writeFileSync(`${directory}/${family}-OFL.txt`,license);
}
console.log(JSON.stringify({fontFiles:urls.length,selfHosted:true}));
