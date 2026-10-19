import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const [expectedFile,actualFile]=process.argv.slice(2);
const expected=new DatabaseSync(expectedFile,{readOnly:true}),actual=new DatabaseSync(actualFile,{readOnly:true});
try{
  for(const table of ['folders','files']){
    const sort=table==='folders'?'id':'folder,name';
    assert.deepEqual(actual.prepare(`SELECT * FROM ${table} WHERE deleted=0 ORDER BY ${sort}`).all(),expected.prepare(`SELECT * FROM ${table} WHERE deleted=0 ORDER BY ${sort}`).all(),`${table} differ`);
  }
  assert.equal(actual.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  console.log(JSON.stringify({databaseMatchesFinalSource:true,keysPreserved:true,files:actual.prepare('SELECT count(*) AS n FROM files WHERE deleted=0').get().n,spaces:actual.prepare('SELECT count(*) AS n FROM folders WHERE deleted=0').get().n}));
}finally{expected.close();actual.close();}
