// A disposable session with NO issued upload capability: ageing this fixture
// cannot make a still-valid browser token writable again after cleanup.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env;
if(env.UPLOAD_TEST_STAGING!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Staging only.');
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data:building,error:be}=await client.from('buildings').select('id').eq('name','E2E Completion Upload 2026-09-22').single();assert.equal(be,null);
const {data:unit,error:ue}=await client.from('units').select('id').eq('building_id',building.id).eq('unit_number','UPLOAD-3').single();assert.equal(ue,null);
const {data:sale,error:se}=await client.from('unit_sale_attempts').select('id').eq('unit_id',unit.id).single();assert.equal(se,null);
const {data:actor,error:ae}=await client.from('profiles').select('id').eq('email','carl@accoladeproperties.co.uk').single();assert.equal(ae,null);
const {data:documents,error:de}=await client.from('unit_sale_documents').select('id,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current)').eq('sale_attempt_id',sale.id).eq('document_type','draft_statement_of_account');assert.equal(de,null);
const expected=documents[0]?.unit_sale_document_versions.find(v=>v.is_current)?.id??null;
const request=crypto.randomUUID();
const {data:session,error:pe}=await client.rpc('sales_completion_upload_session',{p_sale:sale.id,p_actor:actor.id,p_request:request,p_action:'begin',p_files:[{type:'draft_statement_of_account',name:'synthetic-cleanup.pdf',size:8,mime:'application/pdf',expectedVersionId:expected}]});assert.equal(pe,null);
const path=session.files[0].path;
assert.equal((await client.storage.from('completion-uploads').upload(path,Buffer.from('%PDF-123'),{contentType:'application/pdf',upsert:false})).error,null);
assert.equal((await client.storage.from('completion-uploads').copy(path,path,{destinationBucket:'sale-documents'})).error,null);
assert.equal((await client.from('sale_completion_uploads').update({expires_at:new Date(Date.now()-27*3600000).toISOString()}).eq('id',request).eq('sale_id',sale.id).eq('state','pending')).error,null);
const unauth=await fetch('https://staging.bunnywell.co.uk/api/cron/completion-uploads');assert.equal(unauth.status,401);
let viaEndpoint=false;
if(env.CRON_SECRET){const response=await fetch('https://staging.bunnywell.co.uk/api/cron/completion-uploads',{headers:{Authorization:`Bearer ${env.CRON_SECRET}`}});assert.equal(response.status,200);viaEndpoint=true;}
else {const {cleanCompletionUploads}=loadTypescriptModule('src/lib/sales/completion-upload-server.ts');assert.ok((await cleanCompletionUploads(client)).cleaned>=1);}
for(const bucket of ['completion-uploads','sale-documents'])assert.ok((await client.storage.from(bucket).info(path)).error);
const {data:cleaned}=await client.from('sale_completion_uploads').select('state,cleaned_at').eq('id',request).single();assert.equal(cleaned.state,'expired');assert.ok(cleaned.cleaned_at);
const {data:versions}=await client.from('unit_sale_document_versions').select('id').eq('completion_upload_id',request);assert.equal(versions.length,0);
const result={environment:'staging',unauthenticatedEndpointStatus:401,expiredFixtureCleaned:true,quarantineRemoved:true,unregisteredFinalCopyRemoved:true,issuedCapabilities:0,authenticatedEndpointVerified:viaEndpoint,workerVerified:true,remaining:viaEndpoint?null:'Authenticated deployed endpoint check needs staging CRON_SECRET. Vercel preview cron scheduling does not run automatically.'};
fs.writeFileSync('artifacts/completion-direct-upload/staging-cleanup.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
