import test from 'node:test';
import assert from 'node:assert/strict';
import {stage3Database} from './helpers/notification-stage3-database.mjs';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const root='./src/lib/workspace/';
const {selectEmailNotificationRecipients:select}=loadTypescriptModule(root+'email-notifications.ts');
const {renderNotificationEmail:render}=loadTypescriptModule(root+'notification-email.ts');
const {redirectStagingEmail:redirect,submitStagingEmail:submit,requireStagingEmailConfiguration:config,isStagingSalesRequest}=loadTypescriptModule(root+'staging-email.ts');
const today=()=>new Date().toISOString().slice(0,10);
const tomorrow=()=>new Date(Date.now()+86400000).toISOString().slice(0,10);
async function fixture(t){const f=await stage3Database();t.after(()=>f.db.close());await f.activate();return f;}
async function count(f,id){return (await f.events()).filter(e=>e.event_id===id).length;}
async function tick(f){const w=crypto.randomUUID();await f.worker(w,'claim');await f.worker(w,'release');}
async function prepareReservation(f){
 await f.rows("update unit_sale_attempts set workflow_status='draft',updated_at=clock_timestamp() where id=$1",[f.ids.sale]);
 await f.rows("update units set sale_status='for_sale' where id=$1",[f.ids.unit]);
 const doc=(await f.rows("insert into unit_sale_documents(sale_attempt_id,document_type,status) values($1,'reservation_form','uploaded') returning id",[f.ids.sale]))[0];
 const v=(await f.rows("insert into unit_sale_document_versions(document_id,version_number,file_name) values($1,1,'reservation.pdf') returning id",[doc.id]))[0];return v.id;
}
async function reservation(f,action,version,payload={},request=crypto.randomUUID(),user='developer'){
 const [a]=await f.rows('select updated_at from unit_sale_attempts where id=$1',[f.ids.sale]);
 const [terms]=await f.rows('select to_jsonb(t) value from unit_sale_terms t where sale_attempt_id=$1 and is_current',[f.ids.sale]);
 await f.service(user);
 const args={p_building:f.ids.building,p_unit:f.ids.unit,p_sale:f.ids.sale,p_actor:f.ids[user],p_request:request,p_action:action,p_expected:a.updated_at,
  p_payload:{buyerPersonName:'Synthetic buyer',buyerEmail:'buyer@example.invalid',buyerPhone:'02000000000',buyerSolicitorName:'Test solicitor',reservationDate:today(),reservationTermsChecked:true,versionId:version,...payload},
  p_expected_terms:terms?.value??null,p_expected_defaults:null,p_terms:{contract_price:250000,exchange_deposit_percent:10,completion_balance_percent:90},p_schedule:[{sequenceNo:1,paymentStage:'exchange',percentOfContractPrice:10},{sequenceNo:2,paymentStage:'completion',percentOfContractPrice:90}]};
 const result=await f.rpc('workspace_reservation_command',args);return {result,args};
}

test('real reservation commands: submit, query, resubmit, reject, approval; retries and failed/draft commands',async t=>{
 const f=await fixture(t),version=await prepareReservation(f);
 await reservation(f,'save_reservation_draft',version);assert.equal((await f.events()).length,0);
 await assert.rejects(reservation(f,'save_reservation',version,{buyerEmail:''}),/required/);assert.equal((await f.events()).length,0);
 const submitted=await reservation(f,'save_reservation',version);await f.rpc('workspace_reservation_command',submitted.args);assert.equal(await count(f,'reservation_submitted'),1);
 await assert.rejects(reservation(f,'query_reservation',version,{reason:'query'},crypto.randomUUID(),'agent'),/developers/);
 const query=await reservation(f,'query_reservation',version,{reason:'Please revise'});await f.rpc('workspace_reservation_command',query.args);assert.equal(await count(f,'reservation_queried'),1);
 await reservation(f,'save_reservation',version);assert.equal(await count(f,'reservation_submitted'),2);
 await reservation(f,'reject_reservation',version,{reason:'Incorrect details'});assert.equal(await count(f,'reservation_queried'),2);
 await reservation(f,'save_reservation',version);await reservation(f,'approve_reservation',version);assert.equal(await count(f,'reservation_approved'),1);
});

test('real legal commands and scheduled expiry cover exchange, completion and handover events',async t=>{
 const f=await fixture(t);
 await f.action('agent','request_authority');await f.action('agent','request_authority');assert.equal(await count(f,'exchange_authority_requested'),1);
 const revoked=await f.sent(await f.prepare({date:new Date(Date.now()+1000).toISOString()}));await f.action('developer','revoke_authority',{emailId:revoked.id,reason:'Changed terms'});assert.equal(await count(f,'exchange_authority_revoked'),1);
 await f.action('agent','request_authority');assert.equal(await count(f,'exchange_authority_requested'),2);
 const expired=await f.sent(await f.prepare({date:new Date(Date.now()+1000).toISOString()}));
 await new Promise(r=>setTimeout(r,1100));await tick(f);await tick(f);assert.equal(await count(f,'exchange_authority_expired'),1);
 await f.action('agent','request_authority');const authority=await f.sent(await f.prepare({date:new Date(Date.now()+1000).toISOString()}));
 await f.action('solicitor','confirm_exchange',{date:today()});await f.action('solicitor','confirm_exchange',{date:today()});assert.equal(await count(f,'unit_exchanged'),1);
 // Revoked, superseded and exchanged authorities never expire into a new item.
 await new Promise(r=>setTimeout(r,1100));await tick(f);assert.equal(await count(f,'exchange_authority_expired'),1);
 await f.action('agent','request_notice_authority');await f.action('agent','request_notice_authority');assert.equal(await count(f,'notice_authority_requested'),1);
 await f.sent(await f.prepare({kind:'notice_authority',date:''}));const notice=await f.notice({noticeDate:today(),dueDate:today()});assert.equal(await count(f,'contractual_completion_date_changed'),1);
 await f.action('solicitor','correct_completion_dates',{noticeDate:today(),date:today(),previousNoticeDate:today(),previousDate:today()});assert.equal(await count(f,'contractual_completion_date_changed'),1);
 await f.action('solicitor','correct_completion_dates',{noticeDate:today(),date:tomorrow(),previousNoticeDate:today(),previousDate:today()});assert.equal(await count(f,'contractual_completion_date_changed'),2);
 await f.action('solicitor','correct_completion_dates',{noticeDate:today(),date:today(),previousNoticeDate:today(),previousDate:tomorrow()});assert.equal(await count(f,'contractual_completion_date_changed'),3);
 await f.uploadFiles();assert.equal(await count(f,'completion_documents_uploaded'),2);let pair=await f.packageVersions();
 const query={documentType:'completion_statement',versionId:pair.statementVersionId,reason:'Missing figure'};
 await f.action('developer','query_completion_document',query);await f.action('developer','query_completion_document',query);assert.equal(await count(f,'completion_document_queried'),1);
 await f.action('developer','approve_completion_document',{documentType:'draft_statement_of_account',versionId:pair.accountVersionId});assert.equal(await count(f,'completion_documents_approved'),0);
 await f.upload('completion_statement');assert.equal(await count(f,'completion_documents_uploaded'),3);
 await assert.rejects(f.action('developer','approve_completion_document',{documentType:'completion_statement',versionId:pair.statementVersionId}),/changed/);pair=await f.packageVersions();
 const approval={documentType:'completion_statement',versionId:pair.statementVersionId};
 await f.service();await Promise.all([f.rpc('sales_legal_action',{p_sale:f.ids.sale,p_actor:f.ids.developer,p_action:'approve_completion_document',p_payload:approval}),f.rpc('sales_legal_action',{p_sale:f.ids.sale,p_actor:f.ids.developer,p_action:'approve_completion_document',p_payload:approval})]);assert.equal(await count(f,'completion_documents_approved'),1);
 await f.action('solicitor','confirm_completion',{dateTime:new Date(Date.now()-1000).toISOString()});await f.action('solicitor','confirm_completion',{dateTime:new Date(Date.now()-1000).toISOString()});assert.equal(await count(f,'unit_legally_completed'),1);
 const handover=crypto.randomUUID();await f.rows('insert into handovers(id,unit_id,handover_date) values($1,$2,$3)',[handover,f.ids.unit,today()]);assert.equal(await count(f,'handover_completed'),1);
});

test('return-to-market command retains ended redacted attempt and never links a replacement buyer',async t=>{
 const f=await fixture(t);await f.rows('update unit_sale_attempts set reservation_approved_at=now(),reservation_approved_by_user_id=$1 where id=$2',[f.ids.developer,f.ids.sale]);await f.service();
 await f.rpc('return_pre_exchange_unit_for_sale',{p_sale_attempt_id:f.ids.sale,p_actor_user_id:f.ids.developer,p_reason:'Controlled withdrawal',p_source:'test'});
 const events=await f.events();assert.equal(events.length,1);assert.equal(events[0].event_id,'sale_fallen_through');assert.equal(events[0].sale_id,f.ids.sale);
 await f.rows('update unit_sale_attempts set unit_id=$1 where id=$2',[f.ids.unit,f.ids.replacement]);
 const w=crypto.randomUUID();await f.worker(w,'claim');const e=await f.worker(w,'next_event');await f.worker(w,'fanout',{eventId:e.id,recipientIds:select(e.audience,e.event_id).map(x=>x.userId)});
 await f.rows("update workspace_commands.notification_batches set opened_at=opened_at-interval '6 minutes',due_at=due_at-interval '6 minutes'");const b=await f.worker(w,'next_batch');const mail=render(b,[{eventId:e.id,reasons:['sale_fallen_through']}]);assert(mail.text.includes('sale='+f.ids.sale));assert(!mail.text.includes(f.ids.replacement));assert(!mail.text.includes('Original Buyer'));
});

test('formal issue outside routine enrolment, preview-free capture and immutable safe retry',async t=>{
 const f=await fixture(t);await f.rows('delete from workspace_commands.test_journeys where sale_id=$1',[f.ids.sale]);
 const snap=await f.snapshot();assert.equal((await f.rows('select * from workspace_commands.sales_email_deliveries')).length,0);
 const id=crypto.randomUUID(),args={p_sale:f.ids.sale,p_actor:f.ids.developer,p_request:id,p_kind:'authority',p_snapshot:snap,p_email:{subject:'Authority original subject',body:'Formal original wording',html:'<p>Formal original wording</p>',from:'Portal <portal@example.test>',bcc:[{email:'audit@example.test',name:'Audit'}],attachments:[{filename:'authority.pdf',content:'JVBERi0='}]},p_date:new Date(Date.now()+86400000).toISOString()};
 await f.service();await f.rpc('workspace_capture_legal_email',args);await f.rpc('workspace_capture_legal_email',args);
 assert.equal((await f.rows('select * from workspace_commands.sales_email_deliveries')).length,1);
 assert.equal((await f.events()).length,0);
 const worker=crypto.randomUUID(),d=await f.delivery(worker,'claim');const payload=redirect(d.original_mail,d.intended,'Portal <portal@example.test>');
 let released=await f.delivery(worker,'release_for_send',{id:d.id,providerPayload:payload});assert(released.send);
 await f.delivery(worker,'result',{id:d.id,status:'unknown',error:'Timeout'});await f.rows('update workspace_commands.sales_email_deliveries set next_attempt_at=now()');
 const retry=await f.delivery(worker,'claim');released=await f.delivery(worker,'release_for_send',{id:retry.id,providerPayload:{...payload,subject:'changed'}});assert.deepEqual(released.payload,payload);
 const calls=[],stub=async(url,options)=>{calls.push({url,...options,payload:JSON.parse(options.body)});return Response.json({id:'provider-one'});};
 await submit(released.payload,'stub-key',released.idempotencyKey,stub);await submit(released.payload,'stub-key',released.idempotencyKey,stub);
 for(const c of calls){assert.deepEqual(c.payload.to,['carl@accoladeproperties.co.uk']);assert.deepEqual(c.payload.cc,[]);assert.deepEqual(c.payload.bcc,[]);assert.equal(c.payload.reply_to,'carl@accoladeproperties.co.uk');assert.equal(c.payload.attachments.length,1);assert.match(c.payload.text,/legal@example.test/);assert.match(c.payload.text,/sales@example.test/);assert.match(c.payload.text,/audit@example.test/);assert.match(c.payload.text,/Formal original wording/);}
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 await f.delivery(worker,'result',{id:d.id,status:'accepted',providerId:'provider-one'});await f.service();await f.rpc('workspace_legal_test_delivery',{p_sale:f.ids.sale,p_actor:f.ids.developer,p_action:'retry',p_email:id});
 const accepted=await f.delivery(worker,'claim');assert.equal(accepted.provider_id,'provider-one');assert.equal((await f.delivery(worker,'release_for_send',{id:d.id})).send,false);
 const [email]=await f.rows('select * from sale_legal_emails where id=$1',[id]);assert.equal(email.sent_at,null);assert.equal(email.resend_message_id,null);assert.equal(email.delivery_status,'captured_test');
});

test('final redirect rejects unsafe payload/configuration and preserves different recipient copies',async()=>{
 assert.equal(isStagingSalesRequest('https://staging.bunnywell.co.uk/api/sales/legal',{}),true);
 assert.equal(isStagingSalesRequest('https://preview.vercel.app/api/sales/legal',{VERCEL_ENV:'preview',NEXT_PUBLIC_SUPABASE_URL:'wrong'}),true);
 assert.equal(isStagingSalesRequest('https://portal.bunnywell.co.uk/api/sales/legal',{VERCEL_ENV:'production'}),false);
 const mail={subject:'A subject',text:'Exact text',html:'<html><body><p>Exact body</p></body></html>'};
 const one=redirect(mail,{to:[{name:'Person One',role:'conveyancer',email:'one@example.test'}],cc:['cc@example.test'],bcc:['bcc@example.test']},'Portal <portal@example.test>');
 const two=redirect({...mail,text:'Different qualified content'},{to:['two@example.test'],cc:[],bcc:[]},'Portal <portal@example.test>');assert.notEqual(one.text,two.text);assert.equal(one.subject,'[STAGING] A subject');
 await assert.rejects(submit({...one,cc:['bad@example.test']},'key','staging-sales/routine/id',()=>{throw Error('must not call')}),/Unsafe/);
 assert.throws(()=>config({}),/configuration/);assert.throws(()=>config({NEXT_PUBLIC_SUPABASE_URL:'https://vxkpvdtrldwwqiddoyof.supabase.co',NEXT_PUBLIC_WORKSPACE_STAGING:'1',SALES_STAGING_DELIVERY_ENABLED:'1',SALES_STAGING_DELIVERY_TO:'wrong@example.test',RESEND_API_KEY:'key',SALES_FROM_EMAIL:'sender'}),/configuration/);
});

test('protocol rollout blocks old worker and never backfills historical correspondence',async t=>{
 const f=await fixture(t);await f.service();assert.equal((await f.rpc('workspace_notification_worker',{p_worker:crypto.randomUUID(),p_action:'claim'})).upgradeRequired,true);
 assert.equal((await f.rows('select * from workspace_commands.sales_email_deliveries')).length,0);
 await f.as('agent');await assert.rejects(f.rpc('workspace_sales_email_delivery',{p_worker:crypto.randomUUID(),p_action:'claim'}),/permission denied/);
});

test('routine release rechecks settings/access, keeps captures separate, and sends distinct intended-recipient identities',async t=>{
 const f=await fixture(t);await f.service();
 await f.action('agent','request_authority');await f.as('agent');await f.write('Only the developer is mentioned',{p_mentions:[f.ids.developer]});
 const w=crypto.randomUUID();await f.worker(w,'claim');let event;
 while((event=await f.worker(w,'next_event')))await f.worker(w,'fanout',{eventId:event.id,recipientIds:select(event.audience,event.event_id).map(x=>x.userId)});
 await f.rows("update workspace_commands.notification_events set occurred_at=occurred_at-interval '6 minutes'");
 await f.rows("update workspace_commands.notification_batches set opened_at=opened_at-interval '6 minutes',due_at=due_at-interval '6 minutes'");
 let batch;while((batch=await f.worker(w,'next_batch'))){const items=batch.events.flatMap(e=>{const r=select(e.current,e.eventId).find(x=>x.userId===batch.recipientId);return r?[{eventId:e.id,reasons:r.eventIds}]:[]});await f.worker(w,'capture',{batchId:batch.batchId,revision:batch.revision,items,mail:render(batch,items)});}
 await f.worker(w,'release');
 // Removing a role after capture suppresses its queued copy at the final release.
 await f.rows('delete from user_building_access where user_id=$1',[f.ids.agent]);
 const captured=await f.rows('select * from workspace_commands.notification_captures');assert(captured.length>1);assert(captured.every(c=>!c.external_delivery));
 const keys=[],messages=[],dw=crypto.randomUUID();let d;
 while((d=await f.delivery(dw,'claim'))){
  const b=d.context,items=b.events.flatMap(e=>{const r=e.current&&select(e.current,e.eventId).find(x=>x.userId===b.recipientId);return r?[{eventId:e.id,reasons:r.eventIds}]:[]});const mail=render(b,items);
  const intended={to:[{name:b.recipientName,role:b.recipientRole,email:b.email}],cc:[],bcc:[]};
  const release=await f.delivery(dw,'release_for_send',{id:d.id,revision:b.revision,items,mail,providerPayload:redirect(mail,intended,'Portal <portal@example.test>')});
  if(b.recipientId===f.ids.agent){assert.equal(release.send,false);continue;}
  assert(release.send);keys.push(release.idempotencyKey);messages.push(release.payload);
  await submit(release.payload,'stub-key',release.idempotencyKey,async(url,options)=>{const sent=JSON.parse(options.body);assert.deepEqual(sent.to,['carl@accoladeproperties.co.uk']);assert.deepEqual(sent.cc,[]);assert.deepEqual(sent.bcc,[]);return Response.json({id:'provider-'+d.id});});
  await f.delivery(dw,'result',{id:d.id,status:'accepted',providerId:'provider-'+d.id});
 }
 assert(keys.length>=2);assert.equal(new Set(keys).size,keys.length);assert(messages.some(x=>x.text.includes('mentioned you')));assert(messages.some(x=>!x.text.includes('mentioned you')));
});

test('unknown sends cannot be retried outside the safe provider idempotency window',async t=>{
 const f=await fixture(t);const snap=await f.snapshot(),id=crypto.randomUUID();await f.service();
 await f.rpc('workspace_capture_legal_email',{p_sale:f.ids.sale,p_actor:f.ids.developer,p_request:id,p_kind:'authority',p_snapshot:snap,p_email:{subject:'Original',body:'Body',html:'<p>Body</p>',from:'Portal'},p_date:new Date(Date.now()+86400000).toISOString()});
 const w=crypto.randomUUID(),d=await f.delivery(w,'claim');await f.delivery(w,'release_for_send',{id:d.id,providerPayload:redirect(d.original_mail,d.intended,'Portal')});await f.delivery(w,'result',{id:d.id,status:'unknown'});
 await f.rows("update workspace_commands.sales_email_deliveries set first_attempt_at=clock_timestamp()-interval '24 hours',next_attempt_at=clock_timestamp()");await f.delivery(w,'claim');assert.equal((await f.delivery(w,'release_for_send',{id:d.id})).send,false);
 assert.equal((await f.rows('select status from workspace_commands.sales_email_deliveries'))[0].status,'reconciliation_required');
});

test('a superseded authority deadline cannot enqueue expiry, and preview/issue do not create request notifications',async t=>{
 const f=await fixture(t);await f.snapshot();assert.equal((await f.events()).length,0);
 const earlier=await f.sent(await f.prepare({date:new Date(Date.now()+1000).toISOString()}));
 const replacement=await f.sent(await f.prepare({date:new Date(Date.now()+86400000).toISOString()}));
 assert.equal((await f.rows('select replaced_by from sale_legal_emails where id=$1',[earlier.id]))[0].replaced_by,replacement.id);
 await new Promise(r=>setTimeout(r,1100));await tick(f);await tick(f);assert.equal(await count(f,'exchange_authority_expired'),0);assert.equal(await count(f,'exchange_authority_requested'),0);
});

test('new mail precedes accepted-message polling; unavailable confirmation backs off without resending',async t=>{
 const f=await fixture(t),accepted=crypto.randomUUID(),queued=crypto.randomUUID();
 await f.rows("insert into workspace_commands.sales_email_deliveries(id,kind,source_id,sale_id,intended,original_mail,status,provider_id,created_at) values($1,'legal',$1,$3,'{}','{}','accepted','existing-provider-id',now()-interval '1 day'),($2,'legal',$2,$3,'{}','{}','queued',null,now())",[accepted,queued,f.ids.sale]);
 const first=await f.delivery(crypto.randomUUID(),'claim');assert.equal(first.id,queued);
 const w=crypto.randomUUID(),second=await f.delivery(w,'claim');assert.equal(second.id,accepted);
 await f.delivery(w,'result',{id:accepted,status:'accepted',providerId:'existing-provider-id',error:'Provider status unavailable (401).'});
 const [saved]=await f.rows('select * from workspace_commands.sales_email_deliveries where id=$1',[accepted]);assert.equal(saved.attempts,0);assert.equal(saved.status,'accepted');assert(new Date(saved.next_attempt_at)-Date.now()>3500000);
 await f.rows('update workspace_commands.sales_email_deliveries set next_attempt_at=now() where id=$1',[accepted]);await f.delivery(w,'claim');await f.delivery(w,'result',{id:accepted,status:'delivered',providerId:'existing-provider-id'});
 const [confirmed]=await f.rows('select * from workspace_commands.sales_email_deliveries where id=$1',[accepted]);assert(confirmed.delivered_at);assert.equal(confirmed.actual_destination,'carl@accoladeproperties.co.uk');
});
