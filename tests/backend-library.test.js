import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TEACHER_KEY='test-teacher'; process.env.ROOT='disk:/test'; process.env.SETTINGS='disk:/settings';
const {handler}=await import('../backend/index.js');
test('unreadable pupil metadata cannot hide songs or overwrite existing notes', async()=>{
  const previous=globalThis.fetch;
  let writes=0;
  globalThis.fetch=async(input,opts={})=>{
    const url=new URL(input);
    if(opts.method==='PUT' || url.pathname.endsWith('/upload')){writes++;throw new Error('Unexpected write');}
    if(url.hostname==='settings.invalid')return Response.json({students:{a:{key:'pupil-a'},b:{key:'pupil-b'}}});
    if(url.hostname==='meta.invalid')return new Response('',{status:500});
    if(url.hostname==='healthy.invalid')return Response.json({songs:{song:{notes:'Existing notes'}}});
    const path=url.searchParams.get('path');
    if(url.pathname.endsWith('/download'))return Response.json({href:path==='disk:/settings'?'https://settings.invalid':path.includes('/A/')?'https://meta.invalid':'https://healthy.invalid'});
    if(path==='disk:/test')return Response.json({_embedded:{total:2,items:[{type:'dir',name:'A',path:'disk:/test/A',resource_id:'a'},{type:'dir',name:'B',path:'disk:/test/B',resource_id:'b'}]}});
    return Response.json({_embedded:{total:2,items:[{type:'file',name:'song.mp3'},{type:'file',name:'Данные сайта (не удалять).json'}]}});
  };
  const request=body=>handler({httpMethod:'POST',body:JSON.stringify(body)});
  try{
    const response=await request({action:'library',key:'test-teacher'});
    assert.equal(response.statusCode,200);
    const data=JSON.parse(response.body);
    assert.equal(data.students.length,2);
    assert.equal(data.students[0].metadataUnavailable,true);
    assert.deepEqual(data.students[0].files.map(f=>f.name),['song.mp3']);
    assert.equal(data.students[1].meta.song.notes,'Existing notes');
    const save=await request({action:'saveMeta',folder:'a',song:'song',key:'pupil-a',patch:{notes:'New notes'}});
    assert.equal(save.statusCode,502); assert.equal(writes,0);
    const denied=await request({action:'library',key:'unknown'});
    assert.equal(denied.statusCode,403);
  }finally{globalThis.fetch=previous;}
});

test('stalled access settings fail within the read deadline without writing replacement settings', async()=>{
  const previous=globalThis.fetch, previousTimeout=AbortSignal.timeout, previousError=console.error;
  const budgets=[];
  let writes=0;
  AbortSignal.timeout=ms=>{budgets.push(ms);return previousTimeout(30);};
  console.error=()=>{};
  globalThis.fetch=async(input,opts={})=>{
    const url=new URL(input);
    if(opts.method==='PUT' || url.pathname.endsWith('/upload'))writes++;
    if(url.pathname.endsWith('/download'))return new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true});
    });
    return Response.json({_embedded:{total:0,items:[]}});
  };
  try{
    const result=await handler({httpMethod:'POST',body:JSON.stringify({action:'library',key:'test-teacher'})});
    assert.equal(result.statusCode,500);assert.equal(writes,0);
    assert.deepEqual(budgets,[8000,8000]);
  }finally{globalThis.fetch=previous;AbortSignal.timeout=previousTimeout;console.error=previousError;}
});
