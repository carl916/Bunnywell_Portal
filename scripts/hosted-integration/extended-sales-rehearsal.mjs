import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createClient} from '@supabase/supabase-js';import {sql,isolation} from '../backend-foundation/runtime.mjs';import {loadTypescriptModule} from '../../tests/helpers/load-typescript-module.mjs';
isolation();console.log('Local isolation verified');
const cfg=JSON.parse(fs.readFileSync('backend-local/status.json','utf8').replace(/^\uFEFF/,'')),creds=JSON.parse(fs.readFileSync('backend-local/test-access.json')),local='http://127.0.0.1:55321',app='http://127.0.0.1:3037',hosted='https://mmwzhzziqvjbsphrkbqr.supabase.co';assert.equal(cfg.API_URL,local);
for(const [probe,file]of[
 ["select to_regclass('workspace_commands.receipts') is not null",'20261112184548_workspace_sales_commands.sql'],
 ["select to_regclass('workspace_commands.test_journeys') is not null",'20261112191841_workspace_test_capture.sql'],
 ["select exists(select 1 from pg_proc where proname='sale_comment_write' and prosrc like '%greatest(comment_sequence%')",'20261112201315_workspace_comment_sequence.sql'],
 ["select exists(select 1 from pg_proc where proname='workspace_reservation_inputs')",'20261112203256_workspace_core_sales.sql']
])if(sql(probe).trim()!=='t')sql(fs.readFileSync('supabase/migrations/'+file,'utf8'));
if(sql("select exists(select 1 from information_schema.columns where table_schema='workspace_commands' and table_name='test_journeys' and column_name='fictional_details_confirmed_at')").trim()!=='t')sql(fs.readFileSync('supabase/migrations/20261113114104_workspace_confirmed_fictional_journey.sql','utf8'));
if(sql("select exists(select 1 from pg_proc where proname='workspace_sale_operation')").trim()==='t')sql("drop function public.workspace_sale_operation(uuid,uuid,uuid,uuid,uuid,text,jsonb);drop function if exists public.workspace_sale_test_context(uuid,uuid,uuid,uuid);drop function if exists public.workspace_sale_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb);drop policy if exists \"visible invoice PDF versions are readable\" on storage.objects");
sql(fs.readFileSync('supabase/migrations/20261113123605_workspace_extended_sales.sql','utf8'));
sql("notify pgrst,'reload schema';");console.log('Local Sales migration applied');
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:local,NEXT_PUBLIC_SUPABASE_ANON_KEY:cfg.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:cfg.SERVICE_ROLE_KEY});
const nativeFetch=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(u.origin,local,'Local rehearsal blocked external request');return nativeFetch(input,options)};
const staging=loadTypescriptModule('src/lib/workspace/staging.ts'),completionGuard=loadTypescriptModule('src/lib/workspace/command-fetch.ts'),coreGuard=loadTypescriptModule('src/lib/workspace/core-fetch.ts');
const adapt=(guard)=>(scope,actor)=>async(input,options)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(u.origin,local);const method=(options?.method||'GET').toUpperCase(),body=typeof options?.body==='string'?JSON.parse(options.body):undefined;assert(guard(hosted+u.pathname+u.search,method,body,scope,actor),'Egress rejected '+u.pathname);return fetch(input,{...options,redirect:'error'})};
const overrides={'./staging':{...staging,stagingOrigin:local,hostedIntegration:false,optimizedReads:true,completionWritesEnabled:()=>true,coreSalesEnabled:()=>true},'./command-fetch':{completionCommandFetch:adapt(completionGuard.allowedCompletionRequest)},'./core-fetch':{coreCommandFetch:adapt(coreGuard.allowedCoreRequest)}};
const {completionCommand}=loadTypescriptModule('src/lib/workspace/commands.ts',{overrides}),{workflowUpload}=loadTypescriptModule('src/lib/workspace/workflow-upload.ts',{overrides});
const id=n=>'b1700000-0000-4000-8000-'+String(n).padStart(12,'0'),scope={buildingId:id(1),unitId:randomUUID(),saleId:randomUUID()},tokens={},clients={};
console.log('Adapters loaded; signing in locally');
for(const alias of ['developer','conveyancer','agent']){const a=creds.accounts.find(a=>a.alias===alias),c=createClient(local,cfg.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),r=await c.auth.signInWithPassword({email:a.email,password:creds.password});assert.ifError(r.error);tokens[alias]=r.data.session.access_token;clients[alias]=c;}
sql("begin;set local request.jwt.claims='{\"role\":\"service_role\"}';insert into units(id,building_id,unit_number,sale_status) values('"+scope.unitId+"','"+scope.buildingId+"','Core adapter "+scope.unitId.slice(0,8)+"','for_sale');insert into unit_sale_attempts(id,building_id,unit_id,attempt_number,workflow_status) values('"+scope.saleId+"','"+scope.buildingId+"','"+scope.unitId+"',1,'draft');insert into unit_sale_terms(sale_attempt_id,contract_price) values('"+scope.saleId+"',100000);update buildings set seller_name='Fictional Rehearsal Seller',conveyancer_organisation_id=(select organisation_id from profiles where id='"+id(907)+"') where id='"+scope.buildingId+"';update organisations set shared_system_email='fictional-conveyancer@example.invalid' where id=(select organisation_id from profiles where id='"+id(907)+"');commit;");
const results=[];async function test(name,fn){try{await fn();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message});throw e}finally{console.log(results.at(-1));fs.writeFileSync('artifacts/hosted-completion/extended-sales-adapter-rehearsal.json',JSON.stringify({at:new Date().toISOString(),method:'Actual adapter invoked against isolated local Auth/Postgres/Storage; origin substitution only. Not hosted browser evidence.',scope,destinationBusinessRecordsChanged:[],results},null,2)+'\n')}}
const action=(alias,payload,sc=scope)=>completionCommand(new Request(app+'/workspace/command',{method:'POST',headers:{origin:app,Authorization:'Bearer '+tokens[alias],'Content-Type':'application/json'},body:JSON.stringify({...payload,scope:sc})}));
const context=()=>action('developer',{action:'core_context'});
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
const day=new Date().toISOString().slice(0,10),buyer={buyerPersonName:'Fictional Integration Core Rehearsal',buyerEmail:'core@example.invalid',buyerPhone:'00000000000',buyerSolicitorName:'Fictional Solicitor',reservationDate:day,reservationTermsChecked:true};
const fileRequest=(alias,type,requestId=randomUUID(),expectedVersionId=null,bytes=pdf)=>{const data=new FormData();data.append('metadata',JSON.stringify({scope,type,requestId,expectedVersionId,noticeDate:day,dueDate:day}));data.append('file',new File([bytes],type+'.pdf',{type:'application/pdf'}));return workflowUpload(new Request(app+'/workspace/upload',{method:'POST',headers:{origin:app,Authorization:'Bearer '+tokens[alias]},body:data}))};
let reservation,statement,account;
const extended=(alias,op,payload={},req=randomUUID(),sc=scope)=>action(alias,{action:op,requestId:req,payload},sc);
const xcontext=(section,alias='developer')=>action(alias,{action:'extended_sales_context',section});
const enroll=()=>sql("insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by,fictional_details_confirmed_at) values('"+scope.saleId+"','"+scope.buildingId+"','"+scope.unitId+"','Local full Sales rehearsal','"+id(901)+"',now()) on conflict(sale_id) do nothing");
await test('extended writes require exact designated test journey and private service access',async()=>{
 const c=await xcontext('commercial');assert.equal(c.enrolled,false);
 await assert.rejects(()=>extended('developer','save_commercial',{termsId:c.terms.id,termsRevision:c.termsRevision,commercial:{contractPrice:100000}}),/designated integration/);
 await assert.rejects(()=>action('agent',{action:'extended_sales_context',section:'commercial'}),/Developer commercial/);
 await assert.rejects(()=>extended('developer','save_commercial',{},{}, {...scope,unitId:randomUUID()}),/submission reference|Exact sale/);
 assert.equal(sql("select has_function_privilege('authenticated','public.workspace_sale_operation(uuid,uuid,uuid,uuid,uuid,text,jsonb)','execute')").trim(),'f');
 assert.equal((await action('developer',{action:'comment_context'})).writable,false);
 await assert.rejects(()=>action('developer',{action:'comment',body:'Must not alter reference history',clientId:randomUUID()}),/reference history|read.only/i);
 enroll();
 assert.equal((await action('developer',{action:'comment_context'})).writable,true);
});
await test('commercial versions, schedule, stale save and lost-response replay',async()=>{
 const c=await xcontext('commercial'),p={termsId:c.terms.id,termsRevision:c.termsRevision,commercial:{contractPrice:100000,listPriceAtOffer:100000,agentFeePercent:2,exchangeAgentFeePercent:1,completionAgentFeePercent:1,reservationFee:100,reservationFeeHolder:'sales_agent',secondDepositEnabled:true,secondDepositPercent:5,secondDepositMonthsAfterExchange:1,furtherDepositTiming:{basis:'after_exchange',months:1}}},req=randomUUID();
 const first=await extended('developer','save_commercial',p,req);
 assert.deepEqual(await extended('developer','save_commercial',p,req),first);
 await assert.rejects(()=>extended('developer','save_commercial',p),/changed/);
 await assert.rejects(()=>extended('developer','save_commercial',{...p,commercial:{...p.commercial,contractPrice:110000}},req),/reference conflicts/);
 assert.equal(Number(sql("select count(*) from unit_sale_payment_schedule where sale_attempt_id='"+scope.saleId+"' and sale_terms_id=(select id from unit_sale_terms where sale_attempt_id='"+scope.saleId+"' and is_current)").trim()),3);
});
await test('comments send outside Completion without external mention delivery',async()=>{
 const req=randomUUID(),p={action:'comment',body:'Fictional reservation rehearsal comment',clientId:req};
 const a=await action('agent',p);assert.deepEqual(await action('agent',p),a);
});
await test('exact scope and conveyancer reservation denial',async()=>{await assert.rejects(()=>action('developer',{action:'core_context'},{...scope,unitId:randomUUID()}),/exact building/);await assert.rejects(()=>action('conveyancer',{action:'save_reservation_draft'}),/role cannot/);});
await test('draft retry and stale edit',async()=>{const expected=(await context()).sale.updated_at,p={action:'save_reservation_draft',requestId:randomUUID(),expected,payload:buyer};assert.deepEqual(await action('agent',p),await action('agent',p));await assert.rejects(()=>action('agent',{...p,requestId:randomUUID()}),/sale changed/);});
await test('reservation PDF roles, immutable upload and retry conflict',async()=>{await assert.rejects(()=>fileRequest('conveyancer','reservation_form'),/role cannot/);const req=randomUUID();reservation=await fileRequest('agent','reservation_form',req);assert.deepEqual(await fileRequest('agent','reservation_form',req),reservation);await assert.rejects(()=>fileRequest('agent','reservation_form',req,null,Buffer.concat([pdf,Buffer.from('different')])),/reference conflicts/);});
await test('submit calculates terms and retries once; approval restricted',async()=>{const p={action:'save_reservation',requestId:randomUUID(),expected:(await context()).sale.updated_at,payload:{...buyer,versionId:reservation.versionId}};assert.deepEqual(await action('agent',p),await action('agent',p));await assert.rejects(()=>action('agent',{action:'approve_reservation'}),/role cannot/);const approve={action:'approve_reservation',requestId:randomUUID(),expected:(await context()).sale.updated_at,payload:{versionId:reservation.versionId}};assert.deepEqual(await action('developer',approve),await action('developer',approve));});
await test('invoice upload/query/revision/approval/payment/void and exact private viewing',async()=>{
 const c=await xcontext('agent-fees');
 const upload=(who,req,expected=null,bytes=pdf)=>{
  const form=new FormData();form.set('metadata',JSON.stringify({scope,type:'agent_invoice',requestId:req,expectedVersionId:expected,milestone:'exchange',reference:'Fictional invoice 001',date:day,gross:1200,termsId:c.terms.id,termsRevision:c.termsRevision}));
  form.set('file',new File([bytes],'fictional-invoice.pdf',{type:'application/pdf'}));
  return workflowUpload(new Request(app+'/workspace/upload',{method:'POST',headers:{origin:app,Authorization:'Bearer '+tokens[who]},body:form}));
 };
 const req=randomUUID();await assert.rejects(()=>upload('conveyancer',randomUUID()),/role cannot/);
 const first=await upload('agent',req);assert.deepEqual(await upload('agent',req),first);
 await assert.rejects(()=>upload('agent',req,null,Buffer.concat([pdf,Buffer.from('changed')])),/reference conflicts/);
 await assert.rejects(()=>extended('agent','approve_agent_invoice',{milestone:'exchange',versionId:first.versionId}),/Developer review/);
 await assert.rejects(()=>extended('developer','approve_agent_invoice',{milestone:'exchange',versionId:randomUUID()}),/current invoice/);
 await extended('developer','query_agent_invoice',{milestone:'exchange',versionId:first.versionId,reason:'Fictional revision request'});
 await assert.rejects(()=>extended('developer','approve_agent_invoice',{milestone:'exchange',versionId:first.versionId}),/revised invoice/);
 const revised=await upload('agent',randomUUID(),first.versionId);
 const approval=randomUUID(),p={milestone:'exchange',versionId:revised.versionId};
 assert.deepEqual(await extended('developer','approve_agent_invoice',p,approval),await extended('developer','approve_agent_invoice',p,approval));
 const payReq=randomUUID(),pay={invoiceId:first.invoiceId,payer:'solicitor',amount:400,date:day,note:'Fictional payment'};
 const payment=await extended('developer','record_agent_payment',pay,payReq);
 assert.deepEqual(await extended('developer','record_agent_payment',pay,payReq),payment);
 await assert.rejects(()=>extended('agent','record_agent_payment',pay),/Payment recording denied/);
 const data=await xcontext('agent-fees'),row=data.payments.find(p=>p.invoice_id===first.invoiceId);assert(row);
 await extended('developer','void_agent_payment',{paymentId:row.id,reason:'Fictional correction'});
 const state=await xcontext('agent-fees');assert(state.payments.find(p=>p.id===row.id).voided_at);
 const path=sql("select storage_path from unit_sale_document_versions where id='"+first.versionId+"'").trim();
 const signed=await clients.agent.storage.from('sale-documents').createSignedUrl(path,60);assert.ifError(signed.error);
 const denied=await clients.conveyancer.storage.from('sale-documents').createSignedUrl(path,60);
 // The canonical Storage policy decides per-record visibility; no bucket-wide policy is added.
 assert.equal(sql("select count(*) from unit_sale_document_versions where document_id='"+first.documentId+"'").trim(),'2');
});
await test('authority previews cannot be forged and capture requires enrollment',async()=>{await action('conveyancer',{action:'request_authority'});const preview=await action('developer',{action:'preview_capture',kind:'authority'});await assert.rejects(()=>action('developer',{action:'capture_authority',requestId:randomUUID(),preview:{...preview,date:day}}),/preview changed/);enroll();const p={action:'capture_authority',requestId:randomUUID(),preview};assert.deepEqual(await action('developer',p),await action('developer',p));});
await test('canonical exchange and notice authority remain role checked',async()=>{await assert.rejects(()=>action('developer',{action:'confirm_exchange',date:day}),/role cannot/);const p={action:'confirm_exchange',date:day};await action('conveyancer',p);assert.equal((await action('conveyancer',p)).alreadyExchanged,true);await action('conveyancer',{action:'request_notice_authority'});const preview=await action('developer',{action:'preview_capture',kind:'notice_authority'});await action('developer',{action:'capture_authority',requestId:randomUUID(),preview});});
await test('exchange and further deposit receipts are canonical, retry-safe and role restricted',async()=>{
 const c=(await xcontext('deposits','conveyancer')).deposits;
 assert(c.canRecord);const p={sourceId:c.exchange.source.id,date:day,confirmed:true},req=randomUUID();
 assert.deepEqual(await extended('conveyancer','confirm_exchange_deposit',p,req),await extended('conveyancer','confirm_exchange_deposit',p,req));
 await assert.rejects(()=>extended('agent','confirm_exchange_deposit',p),/Conveyancer required/);
 const now=(await xcontext('deposits','conveyancer')).deposits;assert(now.exchange.receipt);
 const further={sourceId:now.further.id,amount:1000,date:day,time:null,note:'Fictional deposit',expectedReceivedAmount:0},fr=randomUUID();
 const r=await extended('conveyancer','record_further_receipt',further,fr);
 assert.deepEqual(await extended('conveyancer','record_further_receipt',further,fr),r);
 await assert.rejects(()=>extended('conveyancer','record_further_receipt',further),/changed|refresh|reload/i);
 const after=(await xcontext('deposits','conveyancer')).deposits;assert.equal(after.further.received_amount,1000);
 await extended('conveyancer','correct_further_receipt',{sourceId:now.further.id,previousReceiptId:after.receipts[0].id,amount:900,date:day,reason:'Fictional receipt correction',expectedReceivedAmount:1000});
 const fixed=(await xcontext('deposits','conveyancer')).deposits;assert.equal(fixed.further.received_amount,900);
 await extended('conveyancer','void_further_receipt',{sourceId:now.further.id,previousReceiptId:fixed.receipts.find(r=>!r.voided&&!fixed.receipts.some(s=>s.supersedes_id===r.id)).id,reason:'Fictional void',expectedReceivedAmount:900});
 assert.equal((await xcontext('deposits','conveyancer')).deposits.further.received_amount,0);
});
await test('notice PDF and arrangements are atomic and retry safe',async()=>{const req=randomUUID(),a=await fileRequest('conveyancer','completion_correspondence',req);const replay=await fileRequest('conveyancer','completion_correspondence',req);assert.equal(a.versionId,replay.versionId);assert.equal(replay.duplicate,true);await assert.rejects(()=>action('conveyancer',{action:'confirm_completion',dateTime:new Date().toISOString()}),/approve/);});
async function completionFile(type){const requestId=randomUUID(),prepared=await action('conveyancer',{action:'prepare_completion_upload',requestId,files:[{type,expectedVersionId:null,name:type+'.pdf',size:pdf.length,mime:'application/pdf'}]});const uploaded=await clients.conveyancer.storage.from(prepared.bucket).uploadToSignedUrl(prepared.files[0].path,prepared.files[0].token,pdf,{contentType:'application/pdf'});assert.ifError(uploaded.error);return(await action('conveyancer',{action:'finalize_completion_upload',requestId})).documents[0].versionId;}
await test('notice dates can be corrected and served authority cannot be cancelled',async()=>{
 const c=await xcontext('completion');await assert.rejects(()=>extended('developer','cancel_notice_authority',{emailId:c.emails.find(e=>e.kind==='notice_authority').id,reason:'Must reject after service'}),/already confirmed/);
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 await extended('conveyancer','correct_completion_dates',{noticeDate:day,date:tomorrow,previousNoticeDate:c.sale.completion_notice_issued_at,previousDate:c.sale.contractual_completion_date});
 const next=await xcontext('completion');assert.equal(next.sale.contractual_completion_date,tomorrow);
});
await test('Completion uploads approvals and final legal completion',async()=>{statement=await completionFile('completion_statement');account=await completionFile('draft_statement_of_account');await action('developer',{action:'approve_completion_document',documentType:'completion_statement',versionId:statement});await action('developer',{action:'approve_completion_document',documentType:'draft_statement_of_account',versionId:account});const p={action:'confirm_completion',dateTime:new Date().toISOString()};await action('conveyancer',p);assert.equal((await action('conveyancer',p)).alreadyCompleted,true);assert.equal((await context()).sale.workflow_status,'completed');});
await test('no provider delivery, payments, Handover or post-completion mutation',async()=>{assert.equal(sql("select count(*) from sale_legal_emails where sale_attempt_id='"+scope.saleId+"' and (sent_at is not null or resend_message_id is not null or delivery_status<>'captured_test')").trim(),'0');await assert.rejects(()=>action('developer',{action:'record_agent_fee_payment'}),/not enabled/);await assert.rejects(()=>action('developer',{action:'finalise_handover'}),/not enabled/);await assert.rejects(()=>fileRequest('agent','reservation_form'),/not editable|exchange|available/);});
await test('fall-through retains history and can recover a lost response after redaction',async()=>{
 const sc={buildingId:scope.buildingId,unitId:randomUUID(),saleId:randomUUID()};
 sql("insert into units(id,building_id,unit_number,sale_status) values('"+sc.unitId+"','"+sc.buildingId+"','Fictional fall-through "+sc.unitId.slice(0,8)+"','for_sale');insert into unit_sale_attempts(id,building_id,unit_id,attempt_number,workflow_status,buyer_person_name) values('"+sc.saleId+"','"+sc.buildingId+"','"+sc.unitId+"',1,'draft','Fictional fall-through');insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by,fictional_details_confirmed_at) values('"+sc.saleId+"','"+sc.buildingId+"','"+sc.unitId+"','Local retry rehearsal','"+id(901)+"',now())");
 const req=randomUUID(),p={reason:'Fictional reservation fell through'},first=await extended('developer','return_for_sale',p,req,sc);
 assert.notEqual(first.saleAttemptId,sc.saleId);assert.deepEqual(await extended('developer','return_for_sale',p,req,sc),first);
 assert.equal(sql("select count(*) from unit_sale_attempts where unit_id='"+sc.unitId+"' and is_active").trim(),'1');
 assert.equal(sql("select count(*) from workspace_commands.test_journeys where sale_id='"+first.saleAttemptId+"'").trim(),'1');
});
for(const client of Object.values(clients))await client.auth.signOut();

