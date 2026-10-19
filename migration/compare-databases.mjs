import {DatabaseSync} from 'node:sqlite';
const [expectedFile,actualFile]=process.argv.slice(2);
const expected=new DatabaseSync(expectedFile,{readOnly:true}),actual=new DatabaseSync(actualFile,{readOnly:true});
try{
  for(const table of ['folders','files']){
    const sort=table==='folders'?'id':'folder,name';
    const active=table==='files'?'deleted=0 AND folder IN (SELECT id FROM folders WHERE deleted=0)':'deleted=0';
    const a=actual.prepare(`SELECT * FROM ${table} WHERE ${active} ORDER BY ${sort}`).all();
    const e=expected.prepare(`SELECT * FROM ${table} WHERE ${active} ORDER BY ${sort}`).all();
    if(JSON.stringify(a)!==JSON.stringify(e))throw new Error(`${table} differ; private rows suppressed`);
  }
  if(actual.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity failure');
  console.log(JSON.stringify({databaseMatchesFinalSource:true,keysPreserved:true,files:actual.prepare('SELECT count(*) AS n FROM files WHERE deleted=0 AND folder IN (SELECT id FROM folders WHERE deleted=0)').get().n,spaces:actual.prepare('SELECT count(*) AS n FROM folders WHERE deleted=0').get().n}));
}finally{expected.close();actual.close();}
