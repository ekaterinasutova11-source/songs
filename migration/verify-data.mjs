// Prints only aggregate results, never file names or access keys.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const [database, blobs] = process.argv.slice(2);
if (!database || !blobs) throw new Error('Pass database and blob directory');
const db=new DatabaseSync(database,{readOnly:true});
try {
  if(db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity failure');
  const files=db.prepare('SELECT blob,size FROM files WHERE deleted=0').all();
  for(const row of files) {
    const sha=crypto.createHash('sha256');let size=0;
    for await(const chunk of fs.createReadStream(path.join(blobs,row.blob))){sha.update(chunk);size+=chunk.length;}
    if(size!==row.size||sha.digest('hex')!==row.blob)throw new Error('Blob integrity failure');
  }
  console.log(JSON.stringify({integrity:'ok',files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),folders:db.prepare('SELECT count(*) AS n FROM folders WHERE deleted=0').get().n}));
}finally{db.close();}
