import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DEST,dir,read,save,hash,storage,sql} from './runtime.mjs';
const m=read('prepared-import'),backup=read('destination-before');
const buckets=sql(DEST,'select id,public from storage.buckets order by id');
for(const b of read('source-catalog').buckets){assert.equal(buckets.find(x=>x.id===b.id)?.public,b.public,'Bucket privacy must match');}
const results=fs.existsSync(path.join(dir,'uploaded-files.json'))?read('uploaded-files'):[];
let cursor=0;
async function worker(){while(cursor<m.files.length){
 const f=m.files[cursor++],key=f.bucket+'/'+f.name;
 assert(!backup.storage.some(o=>o.bucket_id===f.bucket&&o.name===f.name),'Source object collides with pre-existing fixture');
 const bytes=fs.readFileSync(path.join(dir,'source-files',f.sha256));assert.equal(hash(bytes),f.sha256);
 let existing=await storage(DEST,f.bucket,f.name);
 if(existing.ok){assert.equal(hash(Buffer.from(await existing.arrayBuffer())),f.sha256,'Destination file changed: '+key);}
 else{
  const error=await existing.json();assert(['404','400',404,400].includes(error.statusCode)&&/not found/i.test(error.message),'Unexpected storage read failure');
  const response=await storage(DEST,f.bucket,f.name,{bytes,contentType:f.contentType||'application/octet-stream'});
  if(!response.ok){fs.writeFileSync(path.join(dir,'last-upload-error.txt'),await response.text());throw Error('Upload failed; private response saved');}
  existing=await storage(DEST,f.bucket,f.name);assert(existing.ok);assert.equal(hash(Buffer.from(await existing.arrayBuffer())),f.sha256,'Uploaded bytes mismatch');
 }
 if(!results.some(x=>x.key===key))results.push({key,bucket:f.bucket,name:f.name,sha256:f.sha256,size:f.size,verifiedAt:new Date().toISOString()});
 save('uploaded-files',results);if(results.length%50===0)console.log('Destination files verified',results.length,'/',m.files.length);
}}
await Promise.all(Array.from({length:4},worker));assert.equal(results.length,m.files.length);console.log('All destination objects downloaded and checksum-verified:',results.length);
