import fs from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env,origin='http://localhost:3100';
if(env.UPLOAD_TEST_STAGING!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Staging only.');
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data:building}=await admin.from('buildings').select('id').eq('name','E2E Completion Upload 2026-09-22').single();
const {data:unit}=await admin.from('units').select('id').eq('building_id',building.id).eq('unit_number','UPLOAD-3').single();
const {data:sale}=await admin.from('unit_sale_attempts').select('id').eq('unit_id',unit.id).single();
const results=[];
const clients={},tokens={};
for(const [role,email] of Object.entries({admin:env.PLAYWRIGHT_ADMIN_EMAIL,conveyancer:'carl@accoladeproperties.co.uk',agent:'carl@bunnywell.co.uk'})){
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await client.auth.signInWithPassword({email,password:env.PLAYWRIGHT_ADMIN_PASSWORD});if(result.error)throw Error('Test sign-in failed.');clients[role]=client;tokens[role]=result.data.session.access_token;
}
const request=async(role,body)=>{const response=await fetch(origin+'/api/sales/legal',{method:'POST',headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:`Bearer ${tokens[role]}`}:{})},body:JSON.stringify({sale:sale.id,...body})});return {status:response.status,body:await response.json()};};
const meta={type:'completion_statement',expectedVersionId:null,name:'synthetic-completion.pdf',size:10485760,mime:'application/pdf'};
for(const role of ['anonymous','admin','agent']){assert.equal((await request(role,{action:'prepare_completion_upload',requestId:crypto.randomUUID(),files:[meta]})).status,400);results.push({check:`${role} denied`,pass:true});}
for(const files of [[],[meta,meta],[{...meta,size:10485761}],[{...meta,mime:'text/plain'}]])assert.equal((await request('conveyancer',{action:'prepare_completion_upload',requestId:crypto.randomUUID(),files})).status,400);
results.push({check:'invalid count, duplicate type, over-limit and MIME rejected before transfer',pass:true});
const scoped=await request('conveyancer',{action:'prepare_completion_upload',requestId:crypto.randomUUID(),files:[{...meta,size:8}]});assert.equal(scoped.status,200);
const target=scoped.body.files[0];
assert.ok((await clients.conveyancer.storage.from('completion-uploads').uploadToSignedUrl(target.path+'-wrong',target.token,new Blob(['%PDF-123'],{type:'application/pdf'}))).error);
results.push({check:'signed capability rejects a different object path',pass:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill('carl@accoladeproperties.co.uk');await page.getByLabel('Password',{exact:true}).fill(env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
 await page.goto(`${origin}/?screen=sales&building=${building.id}&salesUnitId=${unit.id}`);await page.getByRole('button',{name:/^Completion\b/}).click();const docs=page.locator('#completion-documents-step');
 await docs.getByLabel('Choose completion documents',{exact:true}).setInputFiles('test-results/upload-files/synthetic-completion.pdf');
 let id,dropFinal=true,storagePosts=0,resumedOffset=0;
 page.on('request',r=>{if(r.url().includes('/storage/v1/upload/resumable')&&r.method()==='POST')storagePosts++;});
 page.on('response',async r=>{if(r.request().method()==='HEAD'&&r.url().includes('/storage/v1/upload/resumable'))resumedOffset=Number(r.headers()['upload-offset']||0);});
 await page.route('**/api/sales/legal',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   const body=route.request().postDataJSON();if(body.action==='prepare_completion_upload')id=body.requestId;
   if(body.action==='finalize_completion_upload'&&dropFinal){dropFinal=false;const response=await route.fetch();assert.equal(response.status(),200);await route.abort();return;}
   await route.continue();
 });
 const patch=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().includes('/storage/v1/upload/resumable'),{timeout:60000});
 await docs.getByRole('button',{name:'Upload completion documents',exact:true}).click();await patch;
 await docs.getByRole('button',{name:'Pause upload',exact:true}).click();await docs.getByRole('button',{name:'Upload completion documents',exact:true}).waitFor();
 await page.getByRole('alert').filter({hasText:'Upload paused'}).waitFor();assert.equal(await docs.locator('[role="group"][aria-label^="Selected "]').count(),1);
 results.push({check:'pause retains the selected PDF',pass:true});
 await docs.getByRole('button',{name:'Upload completion documents',exact:true}).click();await page.getByRole('alert').filter({hasText:'Upload not confirmed'}).waitFor({timeout:90000});
 assert.ok(resumedOffset>=6*1024*1024);assert.equal(storagePosts,1);results.push({check:'interrupted TUS resumes from retained offset',pass:true,offset:resumedOffset});
 const before=await admin.from('unit_sale_document_versions').select('id').eq('completion_upload_id',id);assert.equal(before.data.length,1);
 await docs.getByRole('button',{name:'Upload completion documents',exact:true}).click();await docs.locator('[role="group"][aria-label^="Selected "]').first().waitFor({state:'detached',timeout:60000});assert.equal(storagePosts,1);
 const duplicated=await Promise.all([1,2].map(()=>request('conveyancer',{action:'finalize_completion_upload',requestId:id})));duplicated.forEach(r=>assert.equal(r.status,200));
 const after=await admin.from('unit_sale_document_versions').select('id').eq('completion_upload_id',id);assert.deepEqual(after.data,before.data);results.push({check:'lost final response and concurrent duplicate finalisation do not duplicate versions',pass:true});
 const {data:session}=await admin.from('sale_completion_uploads').select('files').eq('id',id).single();const path=session.files[0].path;
 for(const role of ['conveyancer','agent']){
   assert.ok((await clients[role].storage.from('completion-uploads').download(path)).error);
   assert.ok((await clients[role].storage.from('completion-uploads').createSignedUploadUrl(path)).error);
   assert.ok((await clients[role].rpc('sales_completion_upload_session',{p_sale:sale.id,p_actor:(await clients[role].auth.getUser()).data.user.id,p_request:id,p_action:'get'})).error);
 }
 results.push({check:'private objects and service-only session RPC deny browser reads and direct invocation',pass:true});
 await context.close();
}finally{fs.writeFileSync('artifacts/completion-direct-upload/recovery.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));await browser.close();}
