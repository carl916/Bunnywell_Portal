import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SOURCE,DEST,dir,read,save,cliPath,root,hash,sql,q} from './runtime.mjs';
const data=read('source-extraction').data;
const run=promisify(execFile);
async function download(project,bucket,name,file){
 if(![SOURCE,DEST].includes(project))throw Error('Unexpected project');
 if(fs.existsSync(file))file+='-'+randomUUID();
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const localTarget='./'+path.relative(root,file).replaceAll('\\','/');
 await run(cliPath,['storage','cp','--experimental','--remote='+project,'ss:///'+bucket+'/'+name,localTarget],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:1e6,windowsHide:true});
 return fs.readFileSync(file);
}
const refs=new Map(),exceptions=[];
function add(bucket,name,context){
 if(!bucket||!name)return;
 name=decodeURIComponent(name).replace(/^\/+/, '');
 if(name.split('/').some(p=>p==='..'))throw Error('Unsafe object name');
 const key=bucket+'/'+name;
 if(!refs.has(key))refs.set(key,{bucket,name,contexts:[]});
 if(!refs.get(key).contexts.includes(context))refs.get(key).contexts.push(context);
}
function scan(value,context){
 if(typeof value==='string'){
  for(const m of value.matchAll(/https?:\/\/[^\s<>"\\]+/g)){
   let u;try{u=new URL(m[0]);}catch{continue;}
   if(!u.pathname.startsWith('/storage/v1/object/'))continue;
   if(u.hostname!==SOURCE+'.supabase.co'){exceptions.push({type:'foreign-storage-origin',url:u.origin,context});continue;}
   const parts=u.pathname.replace(/^\/storage\/v1\/object\/(public\/|sign\/|authenticated\/)?/,'').split('/');add(parts.shift(),parts.join('/'),context);
  }
 }else if(Array.isArray(value))value.forEach((v,i)=>scan(v,context+'.'+i));
 else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))scan(v,context+'.'+k);
}
for(const [table,rows]of Object.entries(data))for(const row of rows)scan(row,table+':'+(row.id||row.sale_attempt_id));
for(const v of data.unit_sale_document_versions)add(v.storage_bucket,v.storage_path,'unit_sale_document_versions:'+v.id);
for(const p of data.snag_photos)for(const k of ['storage_path','thumbnail_storage_path','thumbnail_square_storage_path','thumbnail_landscape_storage_path','report_image_storage_path'])if(p[k])add('snag-images',p[k],'snag_photos:'+p.id+':'+k);
for(const s of data.snags)if(s.image_path&&!s.image_path.startsWith('http'))add('snag-images',s.image_path,'snags:'+s.id);
for(const r of data.snag_reports)if(r.file_path)add('snag-reports',r.file_path,'snag_reports:'+r.id);
for(const r of data.sale_completion_uploads)for(const f of r.files||[])if(f.path||f.storage_path||f.storagePath)add(f.bucket||f.storage_bucket||f.storageBucket||'completion-uploads',f.path||f.storage_path||f.storagePath,'sale_completion_uploads:'+r.id);
const sourceObjects=[];
const list=[...refs.values()];
for(let i=0;i<list.length;i+=100){const filters=list.slice(i,i+100).map(r=>`(bucket_id=${q(r.bucket)} and name=${q(r.name)})`).join(' or ');sourceObjects.push(...sql(SOURCE,`select bucket_id,name,metadata,created_at,updated_at from storage.objects where ${filters}`));}
for(const r of list)r.metadata=sourceObjects.find(o=>o.bucket_id===r.bucket&&o.name===r.name)||null;
save('file-manifest',{source:SOURCE,destination:DEST,at:new Date().toISOString(),files:list,exceptions});
const backup=read('destination-before');
const backupResults=fs.existsSync(path.join(dir,'destination-recovery-files.json'))?read('destination-recovery-files'):[];
for(const o of backup.storage){const existing=backupResults.find(f=>f.bucket===o.bucket_id&&f.name===o.name);if(existing&&fs.existsSync(path.join(dir,'recovery-files',existing.sha256))&&hash(fs.readFileSync(path.join(dir,'recovery-files',existing.sha256)))===existing.sha256)continue;const temp=path.join(dir,'recovery-files',hash(o.bucket_id+'/'+o.name));const bytes=await download(DEST,o.bucket_id,o.name,temp);const sha256=hash(bytes),file=path.join(dir,'recovery-files',sha256);fs.writeFileSync(file,bytes);backupResults.push({bucket:o.bucket_id,name:o.name,size:bytes.length,sha256});}
save('destination-recovery-files',backupResults);console.log('Backed up',backupResults.length,'destination files. Source references:',list.length);
const results=fs.existsSync(path.join(dir,'source-file-downloads.json'))?read('source-file-downloads'):[];
let cursor=0;
async function worker(){while(cursor<list.length){const r=list[cursor++],key=r.bucket+'/'+r.name;const previous=results.find(x=>x.key===key);if(previous?.sha256&&fs.existsSync(path.join(dir,'source-files',previous.sha256)))continue;
 if(previous)results.splice(results.indexOf(previous),1);
 const record={key,bucket:r.bucket,name:r.name};
 try{const temp=path.join(dir,'downloads',hash(key));const bytes=await download(SOURCE,r.bucket,r.name,temp);record.status=200;record.size=bytes.length;record.sha256=hash(bytes);record.contentType=r.metadata?.metadata?.mimetype;const file=path.join(dir,'source-files',record.sha256);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}catch(e){record.status='download-failed';record.error=String(e.stdout||e.stderr||e.message).slice(0,1500);}
 results.push(record);save('source-file-downloads',results);if(results.length%50===0)console.log('Downloaded/checked',results.length,'of',list.length);
}}
await Promise.all(Array.from({length:2},worker));
console.log('File extraction complete:',{references:list.length,downloaded:results.filter(r=>r.sha256).length,missing:results.filter(r=>!r.sha256).length,foreignOrigins:exceptions.length});
