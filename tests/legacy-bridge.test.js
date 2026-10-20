import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../migration/legacy-site/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('legacy bridge preserves pupil, teacher, archive and Unicode song routes',()=>{
  for(const hash of ['#/s/abcdefgh1234','#/t/abcdefgh1234/archive','#/s/abcdefgh1234/song/'+encodeURIComponent('Песня / summer #1 ? + любовь')]){
    let result;const anchor={};
    vm.runInNewContext(script,{URL,document:{getElementById:()=>anchor},location:{search:'?utm_source=old',hash,replace:url=>{result=url;}}});
    const url=new URL(result);assert.equal(url.origin,'https://135.106.183.211');assert.equal(url.pathname,'/');
    assert.equal(url.hash,hash);assert.equal(url.search,'?utm_source=old');assert.equal(anchor.href,result);
  }
});
test('legacy bridge cannot redirect a private link to a query-controlled host',()=>{
  let result;
  vm.runInNewContext(script,{URL,document:{getElementById:()=>({})},location:{search:'?next=https://example.org/',hash:'#/s/abcdefgh1234',replace:url=>{result=url;}}});
  assert.equal(new URL(result).origin,'https://135.106.183.211');
});
