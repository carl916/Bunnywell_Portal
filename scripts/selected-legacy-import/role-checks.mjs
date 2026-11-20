import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {read,save,keys,DEST,integrationRoot,buildings,hash} from './runtime.mjs';
const credentials=JSON.parse(fs.readFileSync(path.join(integrationRoot,'tmp/hosted-integration/test-access.json')));assert.equal(credentials.project,DEST);
const k=keys(DEST),origin='https://'+DEST+'.supabase.co',evidence=[];
const api=(route,token,body)=>fetch(origin+route,{method:body?'POST':'GET',redirect:'error',headers:{apikey:k.anon,Authorization:'Bearer '+(token||k.anon),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
for(const alias of ['developer','conveyancer','agent','agent-single','restricted','inactive']){
 const account=credentials.accounts.find(a=>a.alias===alias),auth=await api('/auth/v1/token?grant_type=password',null,{email:account.email,password:account.password});assert(auth.ok,'Review login failed: '+alias);const session=await auth.json(),token=session.access_token;
 try{
  for(const[name,id]of Object.entries(buildings)){
   const allowed=['developer','conveyancer'].includes(alias)||alias==='agent'&&name!=='Trinity Point';
   const r=await api('/rest/v1/rpc/workspace_building_facts',token,{p_building:id,p_unit:null,p_sale:null,p_include_snags:true});const body=await r.json();
   if(allowed){assert(r.ok,alias+' '+name);assert.equal(body.units.length,read('source-extraction').data.units.filter(u=>u.building_id===id).length);}
   else assert(!r.ok,'Unexpected building access: '+alias+' '+name);
   evidence.push({alias,building:name,allowed,status:r.status,units:allowed?body.units.length:0});
  }
  const source=read('source-extraction').data;
  const version=source.unit_sale_document_versions.find(v=>!v.redacted_at&&source.unit_sale_documents.find(d=>d.id===v.document_id&&d.document_type==='completion_statement'));
  const signed=await api('/storage/v1/object/sign/sale-documents/'+version.storage_path.split('/').map(encodeURIComponent).join('/'),token,{expiresIn:60});
  const allowed=['developer','conveyancer','agent'].includes(alias);
  assert.equal(signed.ok,allowed,'Private file access: '+alias);
  if(signed.ok){const data=await signed.json();const r=await fetch(origin+'/storage/v1'+data.signedURL,{redirect:'error'});assert(r.ok);assert.equal(hash(Buffer.from(await r.arrayBuffer())),read('prepared-import').files.find(f=>f.bucket==='sale-documents'&&f.name===version.storage_path).sha256);}
  evidence.push({alias,privateDocumentAllowed:allowed,status:signed.status});
 }finally{await fetch(origin+'/auth/v1/logout',{method:'POST',redirect:'error',headers:{apikey:k.anon,Authorization:'Bearer '+token}});}
}
const files=read('prepared-import').files,photo=files.find(f=>f.bucket==='snag-images'),privateFile=files.find(f=>f.bucket==='sale-documents');
for(const[f,allowed]of [[photo,true],[privateFile,false]]){const r=await fetch(origin+'/storage/v1/object/public/'+f.bucket+'/'+f.name.split('/').map(encodeURIComponent).join('/'),{redirect:'error'});assert.equal(r.ok,allowed);if(allowed)assert.equal(hash(Buffer.from(await r.arrayBuffer())),f.sha256);evidence.push({bucket:f.bucket,publicRead:allowed,status:r.status});}
save('role-verification',{at:new Date().toISOString(),project:DEST,method:'Real destination JWTs, reviewed building-facts RPC, destination private signer and downloaded checksums',results:evidence});console.log(JSON.stringify(evidence,null,2));
