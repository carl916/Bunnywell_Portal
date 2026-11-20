import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
import {stage3Database} from './helpers/notification-stage3-database.mjs';
const {noticeDeadline,noticeValidation,noticeFilenameWarnings}=loadTypescriptModule('src/lib/sales/notice-contract.ts');
const {renderNotificationEmail}=loadTypescriptModule('src/lib/workspace/notification-email.ts');
const input={noticeDate:'2026-12-18',serviceDate:'2026-12-18',dueDate:'2027-01-06',basis:'on_notice',reason:'',serviceConfirmed:true};
test('notice dates exclude weekends, Christmas, substitute holidays, Easter and New Year',()=>{
 assert.equal(noticeDeadline('2026-12-18'), '2027-01-06');
 assert.equal(noticeDeadline('2026-04-02',1),'2026-04-07');
 assert.equal(noticeDeadline('2026-11-20',1),'2026-11-23');
 assert.equal(noticeDeadline('2026-02-30'),'');assert.equal(noticeDeadline('2029-01-02'),'');
 assert.equal(noticeValidation(input),'');assert.match(noticeValidation({...input,dueDate:input.serviceDate}),/follow/);
 assert.match(noticeValidation({...input,dueDate:'2027-01-07'}),/reason/);
 assert.equal(noticeValidation({...input,dueDate:'2027-01-07',reason:'Agreed extension'}),'');
 assert.equal(noticeValidation({...input,basis:'fixed_date',dueDate:'2026-12-18',reason:'Fixed date in signed contract'}),'');
 assert.match(noticeValidation({...input,serviceConfirmed:false}),/Confirm/);
});
test('filename hints allow reviewed mismatches, recognise plot numbers and unexpected types',()=>{
 assert.equal(noticeFilenameWarnings('G08 - Reservation form v3.pdf','G06').length,2);
 assert.equal(noticeFilenameWarnings('G06 - Notice.pdf','G06').length,0);
 assert.equal(noticeFilenameWarnings('Notice served.pdf','G06').length,0);
});
test('lifecycle emails use saved data, UK dates, escaping and exactly one CTA',()=>{
 const events=[{id:'exchange',eventId:'unit_exchanged',occurredAt:'2026-11-20T12:30:00Z',details:{actor:'Carl Gilbert',exchangeDate:'2026-11-19',purchaser:'Buyer <Company>'}},{id:'notice',eventId:'contractual_completion_date_changed',occurredAt:'2026-11-20T12:30:00Z',details:{oldDate:'2026-11-30',newDate:'2026-12-04',actor:'Jon'}},{id:'doc',eventId:'completion_documents_uploaded',occurrence:'completion_statement_replaced',occurredAt:'2026-11-20T12:30:00Z',details:{fileName:'Completion.pdf',documentType:'completion_statement',versionNumber:2,actor:'Jon'}}];
 const batch={building:'Test House',unit:'G06',saleId:'sale',buildingId:'building',unitId:'unit',events};const email=renderNotificationEmail(batch,events.map(e=>({eventId:e.id,reasons:[e.eventId]})));
 assert.equal((email.html.match(/<a href=/g)||[]).length,1);assert.match(email.text,/19 Nov 2026/);assert.match(email.text,/Carl Gilbert/);assert.match(email.text,/Previous completion date: 30 Nov 2026/);assert.match(email.text,/Version: 2/);assert(!email.html.includes('<Company>'));assert(!email.text.includes('undefined'));
 const out='artifacts/exchange-completion-refinements-20261120';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/email-grouped.html',email.html);
 for(const event of [...events,{id:'legal',eventId:'unit_legally_completed',occurredAt:'2026-11-20T12:30:00Z',details:{completionDate:'2026-11-20T11:15:00Z',purchaser:'Buyer',actor:'Jon'}},{id:'served',eventId:'contractual_completion_date_changed',occurredAt:'2026-11-20T12:30:00Z',details:{noticeRecorded:true,noticeDate:'2026-11-20',serviceDate:'2026-11-23',newDate:'2026-12-07',actor:'Jon'}}])fs.writeFileSync(out+'/email-'+event.id+'.html',renderNotificationEmail({...batch,events:[event]},[{eventId:event.id,reasons:[event.eventId]}]).html);
});
test('migration validates contractual dates transactionally, preserves duplicate notice submissions and queue events',async t=>{
 const f=await stage3Database();t.after(()=>f.db.close());await f.owner();
 // Load the actual Setup command so its guarded definition patch is exercised.
 for(const table of ['building_floors','areas'])await f.db.exec('create table if not exists public.'+table+'(id uuid)');
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120092849_delivery_team_assignment_restore.sql','utf8'));
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120111156_routine_email_occurrence.sql','utf8'));
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120122359_exchange_completion_refinements.sql','utf8'));
 for(const [service,days] of [['2026-12-18',10],['2026-04-02',1],['2026-11-20',5]]){
  const r=await f.db.query('select workspace_commands.notice_deadline($1::date,$2)::text value',[service,days]);assert.equal(r.rows[0].value,noticeDeadline(service,days));
 }
 await f.activate();await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:new Date().toISOString().slice(0,10)});await f.sent(await f.prepare({kind:'notice_authority',date:''}));
 const submit=async(due,reason='',request=crypto.randomUUID())=>{await f.service('solicitor');return f.rpc('sales_legal_submit_notice',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_request:request,p_notice:input.noticeDate,p_due:due,p_file:{path:f.ids.building+'/'+f.ids.sale+'/notice.pdf',name:'Notice.pdf',size:100,mime:'application/pdf',noticeTerms:{...input,reason}}})};
 await assert.rejects(submit(input.serviceDate),/follow/);assert.equal((await f.events()).filter(e=>e.event_id==='contractual_completion_date_changed').length,0);
 await assert.rejects(submit('2027-01-07'),/reason/);
 await f.rows('insert into building_sale_defaults(building_id,notice_working_days) values($1,5)',[f.ids.building]);
 await f.owner();const custom=await f.db.query('select workspace_commands.validate_notice($1,$2::date,$3::date,$4::jsonb) value',[f.ids.sale,input.noticeDate,noticeDeadline(input.serviceDate,5),input]);assert.equal(custom.rows[0].value.workingDays,5);
 await f.rows('update building_sale_defaults set notice_working_days=10 where building_id=$1',[f.ids.building]);
 const definition=await f.db.query("select pg_get_functiondef('public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb)'::regprocedure) value");assert.match(definition.rows[0].value,/notice_working_days=excluded.notice_working_days/);assert.match(definition.rows[0].value,/further_deposit_timing,notice_working_days,notice_service_provision/);
 const request=crypto.randomUUID();await submit(input.dueDate,'',request);await submit(input.dueDate,'',request);
 assert.equal((await f.events()).filter(e=>e.event_id==='contractual_completion_date_changed').length,1);
 const [saved]=await f.rows('select completion_service_date::text,completion_basis from unit_sale_attempts where id=$1',[f.ids.sale]);assert.equal(saved.completion_service_date,input.serviceDate);assert.equal(saved.completion_basis,'on_notice');
 await assert.rejects(f.action('solicitor','correct_completion_dates',{...input,date:'2027-01-07',previousNoticeDate:input.noticeDate,previousDate:input.dueDate}),/reason/);
 await f.action('solicitor','correct_completion_dates',{...input,reason:'Agreed extension',date:'2027-01-07',previousNoticeDate:input.noticeDate,previousDate:input.dueDate});
 assert.equal((await f.events()).filter(e=>e.event_id==='contractual_completion_date_changed').length,2);
 const details=await f.rows("select details from workspace_commands.notification_events where event_id='contractual_completion_date_changed' order by sequence");assert.equal(details[0].details.noticeRecorded,true);assert.equal(details[1].details.oldDate,input.dueDate);
 const [batch]=await f.rows("insert into workspace_commands.notification_batches(recipient_id,sale_id,opened_at,due_at) values($1,$2,now(),now()+interval '5 minutes') returning id",[f.ids.developer,f.ids.sale]);
 await f.rows('insert into workspace_commands.notification_batch_items(event_id,recipient_id,batch_id) select id,$1,$2 from workspace_commands.notification_events where sale_id=$3',[f.ids.developer,batch.id,f.ids.sale]);
 const [context]=await f.rows('select workspace_commands.notification_batch_context($1) value',[batch.id]);
 assert.equal(context.value.events.find(e=>e.eventId==='unit_exchanged').details.exchangeDate,new Date().toISOString().slice(0,10));
 assert.equal(context.value.events.find(e=>e.details?.noticeRecorded).details.serviceDate,input.serviceDate);
 await f.action('solicitor','correct_completion_dates',{...input,serviceDate:'2026-12-21',reason:'Corrected deemed service',date:'2027-01-07',previousNoticeDate:input.noticeDate,previousDate:'2027-01-07'});
 const [audit]=await f.rows("select metadata from unit_sale_workflow_events where summary='Contractual service details corrected' and sale_attempt_id=$1 order by created_at desc limit 1",[f.ids.sale]);assert.equal(audit.metadata.previousServiceDate,input.serviceDate);assert.equal(audit.metadata.serviceDate,'2026-12-21');

});


const {personLabel}=loadTypescriptModule('src/lib/workspace/activity-actors.ts');
test('person names replace generic account labels without changing known historical names',()=>{
 assert.equal(personLabel('Conveyancer',{full_name:'Jon Smith',name:'Conveyancer'}),'Jon Smith');
 assert.equal(personLabel('Jane Brown',{full_name:'Jane Smith'}),'Jane Brown');
});
test('status refresh is read-only and rejects unauthorised roles',async()=>{
 let calls=[];
 const {coreCommand}=loadTypescriptModule('src/lib/workspace/core-commands.ts',{overrides:{
  './sales-email-delivery':{deliverSalesEmails:()=>{throw Error('Unexpected send');}},
  './staging':{coreSalesEnabled:()=>true,hostedStaging:true,stagingEnabled:()=>true},'./server':{completion:async()=>({sale:{}}),check:async()=>{},ReadError:class extends Error{}},
  '@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:[],error:null}}})},
  './core-fetch':{coreCommandFetch:()=>{}}
 }});
 const scope={buildingId:'building',unitId:'unit',saleId:'sale'};
 await coreCommand({profile:{id:'admin',role:'admin'}},{action:'refresh_legal_delivery'},scope);
 assert.deepEqual(calls.map(x=>x[0]),['workspace_legal_test_delivery']);assert.equal(calls[0][1].p_action,undefined);
 calls=[];await assert.rejects(coreCommand({profile:{id:'agent',role:'sales_agent'}},{action:'refresh_legal_delivery'},scope),/administrator/);assert.equal(calls.length,0);
});
test('accepted deliveries only GET provider status, including 401, failure, bounce and unavailable responses',async()=>{
 for(const response of [{status:200,event:'delivered'},{status:200,event:'bounced'},{status:200,event:'failed'},{status:401},{status:503}]){
  const commands=[],http=[];
  const {deliverSalesEmails}=loadTypescriptModule('src/lib/workspace/sales-email-delivery.ts',{overrides:{'server-only':{},'./staging':{hostedStaging:true,stagingEnabled:()=>true,stagingOrigin:'https://fixture.invalid'},'./staging-email':{requireStagingEmailConfiguration:()=>({key:'test',from:'test'}),submitStagingEmail:()=>{throw Error('Unexpected provider POST')}},'@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>({rpc:async(_name,args)=>{commands.push(args);return {data:args.p_action==='claim'?{id:'delivery',provider_id:'accepted-id'}:{},error:null}}})}}});
  const prior=global.fetch;global.fetch=async(url,options)=>{http.push({url,options});return new Response(JSON.stringify({last_event:response.event}),{status:response.status})};
  try{await deliverSalesEmails('delivery',1)}finally{global.fetch=prior}
  assert.equal(http.length,1);assert.equal(http[0].options.method,undefined);assert(http[0].url.endsWith('/emails/accepted-id'));
  assert(!commands.some(c=>c.p_action==='release_for_send'));assert.equal(commands.at(-1).p_payload.status,response.status===200?response.event:'accepted');
 }
});

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('issued/captured authority suppresses redundant panel while unissued authority retains action',()=>{
 const base={asOf:'2026-11-20T12:00:00Z',enrolled:true,documents:[],emails:[],sale:{is_active:true,workflow_status:'approved'},deliveries:[]};
 function render(data,role='developer'){
  const {default:CoreSales}=loadTypescriptModule('src/components/experiments/building-integration/CoreSales.tsx',{overrides:{'@/lib/workspace/staging':{hostedStaging:true},'./useRecordRead':{useRecordRead:()=>({data,loading:false})},'./usePendingUpload':{usePendingUpload:()=>{}},'./TaskWorkspace':{Notice:({children})=>React.createElement('p',null,children),date:x=>x}}});
  return renderToStaticMarkup(React.createElement(CoreSales,{api:{},scope:{buildingId:'b',unitId:'u',saleId:'s'},role,section:'exchange',task:'authority',refresh:0,onSaved:()=>{}}));
 }
 assert.match(render(base),/Review exchange authority/);
 const issued={...base,emails:[{id:'a',kind:'authority',version:1,delivery_status:'captured_test',expires_at:'2026-11-22T12:00:00Z'}]};
 assert(!render(issued).includes('Review exchange authority'));assert(!render(issued).includes('Connected Sales actions'));
 assert(!render({...issued,sale:{...issued.sale,exchanged_at:'2026-11-20'}}).includes('Connected Sales actions'));
 const delivery={id:'d',status:'accepted',lastError:'Provider status unavailable (401)',intended:{to:['original@example.invalid'],cc:[]},actualDestination:'carl@accoladeproperties.co.uk'};
 const diagnostics=render({...issued,deliveries:[delivery]});assert.match(diagnostics,/Refresh delivery status/);assert(!diagnostics.includes('(401)'));assert.match(diagnostics,/<details/);
 assert(!render({...issued,deliveries:[delivery]},'sales_agent').includes('Staging delivery diagnostics'));
 const {AuthorityRecord}=loadTypescriptModule('src/components/experiments/building-integration/ProgressionRecord.tsx');
 const history=renderToStaticMarkup(React.createElement(AuthorityRecord,{record:{id:'authority',title:'Authority version 1',status:'captured_test',fields:[['Valid until','22 Nov 2026']],subject:'Saved subject',body:'Saved authority correspondence'}}));assert.match(history,/View saved authority correspondence/);assert.match(history,/Saved subject/);
});

test('current staging provider boundary is Carl-only and production configuration cannot enable it',()=>{
 const {redirectStagingEmail,requireStagingEmailConfiguration}=loadTypescriptModule('src/lib/workspace/staging-email.ts');
 const mail=redirectStagingEmail({subject:'Contracts exchanged',text:'Event text',html:'<p>Event text</p>'},{to:['intended@example.invalid'],cc:['copied@example.invalid'],bcc:[]},'Portal <test@example.invalid>');
 assert.deepEqual(mail.to,['carl@accoladeproperties.co.uk']);assert.deepEqual(mail.cc,[]);assert.deepEqual(mail.bcc,[]);assert.match(mail.text,/intended@example.invalid/);
 assert.throws(()=>requireStagingEmailConfiguration({VERCEL:'1',VERCEL_ENV:'production',RESEND_API_KEY:'not-a-real-key'}),/configuration/);
});
