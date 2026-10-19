import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../backend/index.js';
test('legacy URL forwards to Selectel without reading or mutating Yandex',async()=>{
  const old=globalThis.fetch;
  process.env.SELECTEL_API_URL='https://selectel.invalid/api';
  let calls=0;
  try{
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,process.env.SELECTEL_API_URL);assert.equal(JSON.parse(options.body).key,'existing-key');return Response.json({role:'student',students:[]});};
    const r=await handler({httpMethod:'POST',headers:{origin:'https://ekaterinasutova11-source.github.io'},body:JSON.stringify({action:'library',key:'existing-key'})});
    assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).role,'student');assert.equal(calls,1);
    assert.equal(r.headers['Access-Control-Allow-Origin'],'https://ekaterinasutova11-source.github.io');
    const options=await handler({httpMethod:'OPTIONS'});assert.equal(options.statusCode,204);assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});
    assert.equal((await handler({httpMethod:'POST',body:'{}'})).statusCode,424);
    globalThis.fetch=async()=>{throw new Error('network error');};
    assert.equal((await handler({httpMethod:'POST',body:'{}'})).statusCode,424);
  }finally{globalThis.fetch=old;delete process.env.SELECTEL_API_URL;}
});
test('cutover freeze rejects writes before touching source storage',async()=>{
  const old=globalThis.fetch;process.env.MIGRATION_READ_ONLY='true';
  globalThis.fetch=()=>{throw new Error('Source must not be contacted');};
  try{
    for(const action of ['uploadUrl','saveText','saveMeta','rename','delete','createStudent','resetLink']){
      const r=await handler({httpMethod:'POST',body:JSON.stringify({action,key:'test'})});assert.equal(r.statusCode,503);
    }
  }finally{globalThis.fetch=old;delete process.env.MIGRATION_READ_ONLY;}
});
