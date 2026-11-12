import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SOURCE,DEST,dir,read,save,hash,buildings} from './runtime.mjs';
export const runId='2026-11-12-selected-legacy-v2';
const extraction=read('source-extraction'),data=structuredClone(extraction.data),catalog=read('destination-catalog');
assert.equal(read('check-conflicts').length,0);assert.equal(read('relationship-conflicts').length,0);
const files=read('source-file-downloads'),manifest=read('file-manifest');
assert.equal(files.length,manifest.files.length);assert(files.every(f=>f.sha256),'All file bytes must be available before preparing import');
for(const f of files){assert.equal(hash(fs.readFileSync(path.join(dir,'source-files',f.sha256))),f.sha256);assert.equal(manifest.files.find(x=>x.bucket===f.bucket&&x.name===f.name)?.metadata?.metadata?.size,f.size,'Source file size differs from Storage metadata');}
const backup=fs.readFileSync(path.join(dir,'destination-before.json'));assert.equal(hash(backup),read('destination-before-checksum').sha256);
for(const f of read('destination-recovery-files'))assert.equal(hash(fs.readFileSync(path.join(dir,'recovery-files',f.sha256))),f.sha256);
const transformations=[];
const beforeRows=read('destination-before').data,tradeMap=new Map();
for(const trade of data.trades){const existing=beforeRows['public.trades'].find(t=>t.name===trade.name);if(existing){for(const c of ['name','sort_order','active'])assert.equal(existing[c],trade[c],'Shared trade configuration conflicts');tradeMap.set(trade.id,existing);transformations.push({kind:'reuse-existing-trade',sourceId:trade.id,destinationId:existing.id,name:trade.name});}}
function replaceLinks(v,where){
 if(typeof v==='string'&&tradeMap.has(v)){transformations.push({kind:'trade-reference',where,sourceId:v,destinationId:tradeMap.get(v).id});return tradeMap.get(v).id;}
 if(typeof v==='string'&&v.includes('https://'+SOURCE+'.supabase.co/storage/')){
  transformations.push({kind:'storage-origin',where});
  return v.replace(/https?:\/\/[^\s<>"\\]+/g,link=>{let u;try{u=new URL(link);}catch{return link;}if(u.hostname!==SOURCE+'.supabase.co'||!u.pathname.startsWith('/storage/'))return link;u.hostname=DEST+'.supabase.co';if(u.pathname.startsWith('/storage/v1/object/sign/')){u.pathname=u.pathname.replace('/object/sign/','/object/authenticated/');u.search='';}return u.href;});
 }
 if(Array.isArray(v))return v.map((x,i)=>replaceLinks(x,where+'.'+i));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replaceLinks(x,where+'.'+k)]));
 return v;
}
const rows=[];
for(const [table,records]of Object.entries(data)){
 const pk=catalog.constraints.find(c=>c.table===table&&c.type==='p');assert(pk,'No primary key for '+table);
 const keys=/PRIMARY KEY \(([^)]+)\)/.exec(pk.definition)[1].split(', ');
 for(const original of records){
  const payload=table==='trades'&&tradeMap.has(original.id)?structuredClone(tradeMap.get(original.id)):replaceLinks(original,table+':'+(original.id||original.sale_attempt_id));
  if(table==='profiles'){payload.active=false;transformations.push({kind:'dormant-profile',id:payload.id,sourceActive:original.active,destinationActive:false});}
  const key=Object.fromEntries(keys.map(k=>[k,payload[k]])),sourceKey=Object.fromEntries(keys.map(k=>[k,original[k]]));
  rows.push({table_name:table,source_key:sourceKey,destination_key:key,source_hash:hash(original),payload,expected_hash:hash(payload)});
 }
}
assert.deepEqual(data.buildings.map(b=>b.id).sort(),Object.values(buildings).sort());
const sourceKeys=new Set(rows.map(r=>r.table_name+JSON.stringify(r.source_key)));assert.equal(sourceKeys.size,rows.length);
for(const r of rows){const before=beforeRows['public.'+r.table_name]||[];const existing=before.find(b=>Object.entries(r.destination_key).every(([k,v])=>b[k]===v));if(existing)assert(r.table_name==='trades'&&hash(existing)===r.expected_hash,'Pre-existing destination identity collision: '+r.table_name);}
save('prepared-import',{runId,source:SOURCE,destination:DEST,extractedAt:extraction.at,preparedAt:new Date().toISOString(),buildings,sourceHash:hash(extraction),backupHash:hash(backup),rows,files:files.map(f=>({...f,destinationBucket:f.bucket,destinationName:f.name})),transformations});
console.log('Prepared exact import manifest:',{runId,rows:rows.length,files:files.length,dormantActors:data.profiles.length,transformations:transformations.length});
