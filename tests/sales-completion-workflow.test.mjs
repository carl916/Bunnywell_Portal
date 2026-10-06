import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

async function apiFixture(t) {
  const f=await legalDatabase(); t.after(()=>f.db.close());
  let user='developer';
  const calls=[];
  const storage=new Map(); let uploadFailure=false; let loseNoticeResponse=false; let uploadCount=0;let failUploadAt=0;let losePackageResponse=false;
  const client={
    storage:{from:()=>({upload:async(path,bytes)=>{if(uploadFailure||++uploadCount===failUploadAt)return {error:new Error('Upload failed')};storage.set(path,bytes);return {error:null};},remove:async(paths)=>{for(const path of paths)storage.delete(path);return {error:null};}})},
    auth:{getUser:async()=>({data:{user:{id:f.ids[user]}},error:null})},
    rpc:async(name,args)=>{await f.service(user);try{const data=await f.rpc(name,args);if(name==='sales_legal_submit_notice'&&loseNoticeResponse||name==='sales_completion_upload'&&losePackageResponse)return {error:new Error('Response interrupted')};return {data,error:null};}catch(error){return {data:null,error};}},
    from(table){
      const conditions=[],values=[];let single=false;
      const query={
        select(){return query;},
        eq(key,value){values.push(value);conditions.push(`"${key}"=$${values.length}`);return query;},
        single(){single=true;return query;},
        then(resolve,reject){return (async()=>{await f.service(user);const rows=(await f.db.query(`select * from "${table}"${conditions.length?' where '+conditions.join(' and '):''}`,values)).rows;return {data:single?rows[0]:rows,error:null};})().then(resolve,reject);},
      };return query;
    },
  };
  const env={NEXT_PUBLIC_APP_URL:process.env.NEXT_PUBLIC_APP_URL,DIGEST_APP_URL:process.env.DIGEST_APP_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,RESEND_API_KEY:process.env.RESEND_API_KEY,DIGEST_DRY_RUN_EMAIL:process.env.DIGEST_DRY_RUN_EMAIL};
  process.env.NEXT_PUBLIC_APP_URL='https://portal.example.test';delete process.env.DIGEST_APP_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-signing-key';process.env.RESEND_API_KEY='synthetic-resend-key';delete process.env.DIGEST_DRY_RUN_EMAIL;
  t.after(()=>{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  let response=()=>Response.json({id:'synthetic-resend-message'});
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');calls.push(init);return response();});
  const route=loadTypescriptModule('src/app/api/sales/legal/route.ts',{overrides:{'@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>client,requiredEnv:name=>{if(!process.env[name])throw new Error(`${name} missing`);return process.env[name];}}}});
  async function post(payload){const result=await route.POST(new Request('http://localhost/api/sales/legal',{method:'POST',headers:{authorization:'Bearer synthetic',...(payload instanceof FormData?{}:{'content-type':'application/json'})},body:payload instanceof FormData?payload:JSON.stringify({sale:f.ids.sale,...payload})}));return {status:result.status,...await result.json()};}
  async function preview(){return post({action:'preview',kind:'authority',date:new Date(Date.now()+172800000).toISOString()});}
  function noticeForm({file=new File(['%PDF-1.7\nnotice'],'notice.pdf',{type:'application/pdf'}),requestId=crypto.randomUUID(),action='confirm_notice',expected='',noticeDate='2026-09-01',date='2026-09-15'}={}) {
    const form=new FormData();for(const [key,value]of Object.entries({sale:f.ids.sale,action,documentType:'completion_correspondence',noticeDate,date,requestId,expectedVersionId:expected}))form.set(key,value);
    if(file)form.set('file',file);return form;
  }
  return {...f,calls,post,preview,storage,noticeForm,failUploadAt:value=>{uploadCount=0;failUploadAt=value;},losePackageResponse:value=>{losePackageResponse=value;},failUpload:value=>{uploadFailure=value;},loseNoticeResponse:value=>{loseNoticeResponse=value;},asUser:name=>{user=name;},respond:fn=>{response=fn;}};
}

test('deposit API authorises conveyancers and records only the frozen full amount',async t=>{
  const f=await apiFixture(t);await f.sent(await f.prepare());
  f.asUser('solicitor');
  const exchanged=await f.post({action:'confirm_exchange',date:new Date().toISOString().slice(0,10)});assert.equal(exchanged.status,200);
  await f.service('solicitor');const {source}=await f.rpc('sales_exchange_deposit_context',{p_sale:f.ids.sale,p_actor:f.ids.solicitor});
  const payload={action:'confirm_exchange_deposit',sourceId:source.id,date:'2026-09-01',confirmed:true};
  for(const user of ['agent','developer','outsider']) {f.asUser(user);assert.equal((await f.post(payload)).status,400);}
  f.asUser('solicitor');assert.match((await f.post({...payload,date:''})).error,/date/);assert.match((await f.post({...payload,receivedAmount:1})).error,/set by the legal workflow/);
  const result=await f.post(payload);assert.equal(result.status,200);assert.equal(result.received_amount,25000);assert.equal(result.recorded_by,f.ids.solicitor);assert.equal(result.source_id,source.id);
  assert.equal((await f.post(payload)).id,result.id);assert.equal(f.calls.length,0);
});

test('server preview uses live contacts and rejects stale approval after recipient edits',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();
  assert.equal(preview.status,200);assert.equal(f.calls.length,0);
  assert.deepEqual(preview.to,['legal@example.test']);assert.deepEqual(preview.cc,['sales@example.test']);
  assert.match(preview.subject,/Authority to Exchange/);assert.match(preview.body,/Seller SPV Ltd/);assert.match(preview.body,/Test developer/);
  assert.match(preview.body,/expire automatically/);assert.match(preview.body,/£250,000/);
  await f.owner();await f.db.query("update organisations set shared_system_email='updated@example.test' where id=$1",[f.solicitorOrg]);
  const stale=await f.post({action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId:crypto.randomUUID()});
  assert.match(stale.error,/fresh preview/);assert.equal(f.calls.length,0);
  const current=await f.post({action:'preview',kind:'authority',date:preview.date});assert.deepEqual(current.to,['updated@example.test']);
  await f.owner();await f.db.query('update organisations set shared_system_email=null where id=$1',[f.solicitorOrg]);
  const missing=await f.preview();assert.equal(missing.status,400);assert.match(missing.settingsUrl,/organisation-/);assert.match(missing.error,/shared system email/);
});

test('send persists exact rendering and repeat confirmation does not duplicate the email',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();const payload={action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId:crypto.randomUUID()};
  const sent=await f.post(payload);assert.equal(sent.status,200);assert.equal(sent.email.resend_message_id,'synthetic-resend-message');
  assert.equal(sent.email.body,preview.body);assert.equal(sent.email.subject,preview.subject);assert.deepEqual(sent.email.to_recipients,preview.to);assert.deepEqual(sent.email.cc_recipients,preview.cc);
  assert.equal(sent.email.html_body,preview.html);assert.equal(JSON.parse(f.calls[0].body).html,preview.html);assert.equal(JSON.parse(f.calls[0].body).text,preview.body);
  assert.ok(preview.html.includes(f.ids.sale));assert.ok(preview.html.includes(f.ids.unit));
  assert.equal(JSON.parse(f.calls[0].body).from,sent.email.sending_address);
  assert.equal((await f.post(payload)).status,200);assert.equal(f.calls.length,1);
  await f.service();await assert.rejects(f.db.query("update sale_legal_emails set html_body='<p>Changed</p>' where id=$1",[sent.email.id]),/legal workflow|immutable/);
});

test('a changed canonical link invalidates the email preview and legacy retries remain text-only',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();
  process.env.NEXT_PUBLIC_APP_URL='https://another.example.test';
  assert.match((await f.post({action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId:crypto.randomUUID()})).error,/fresh preview/);assert.equal(f.calls.length,0);
  const legacy=await f.prepare();await f.post({action:'retry_email',emailId:legacy.id});
  const payload=JSON.parse(f.calls[0].body);assert.equal(payload.text,'Saved exact body');assert.equal(payload.html,undefined);
});

test('uncertain sends retry the exact saved message with the same Resend idempotency key',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();const requestId=crypto.randomUUID();
  f.respond(()=>new Response('unavailable',{status:503}));
  const failed=await f.post({action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId});assert.equal(failed.status,400);
  await f.service();assert.equal((await f.db.query('select delivery_status from sale_legal_emails where id=$1',[requestId])).rows[0].delivery_status,'unknown');
  f.respond(()=>Response.json({id:'reconciled-message'}));
  const retry=await f.post({action:'retry_email',emailId:requestId});assert.equal(retry.status,200);
  assert.equal(f.calls[0].headers['Idempotency-Key'],f.calls[1].headers['Idempotency-Key']);assert.equal(f.calls[0].body,f.calls[1].body);
});

test('API rejects cross-role actions and preserves the database permission checks',async t=>{
  const f=await apiFixture(t);
  for(const role of ['agent','solicitor']) {f.asUser(role);assert.match((await f.preview()).error,/authorised developer/);}
  f.asUser('developer');assert.match((await f.post({action:'confirm_completion',dateTime:new Date().toISOString()})).error,/role/);
  f.asUser('agent');assert.match((await f.post({action:'approve_statement',versionId:crypto.randomUUID()})).error,/role/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.agent]);
  assert.match((await f.post({action:'request_authority'})).error,/access denied/);
  assert.equal(f.calls.length,0);
});

const noticeTools=loadTypescriptModule('src/lib/sales/completion-notice.ts');
const today=()=>new Date().toISOString().slice(0,10);
function completionForm(f,{files=[new File(['%PDF-1.7\nstatement'],'completion.pdf',{type:'application/pdf'}),new File(['%PDF-1.7\naccount'],'account.pdf',{type:'application/pdf'})],assignments=[{type:'completion_statement',expectedVersionId:null},{type:'draft_statement_of_account',expectedVersionId:null}],requestId=crypto.randomUUID()}={}) {
  const form=new FormData();form.set('sale',f.ids.sale);form.set('action','upload_completion_documents');form.set('requestId',requestId);form.set('assignments',JSON.stringify(assignments));files.forEach(file=>form.append('files',file));return form;
}
test('legacy completion multipart transport is retired without storing files',async t=>{
  const f=await apiFixture(t);f.asUser('solicitor');
  const result=await f.post(completionForm(f));assert.equal(result.status,400);assert.match(result.error,/retired/);assert.equal(f.storage.size,0);
});
async function exchange(f) {await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:today(),depositConfirmed:true});}
async function authorise(f) {await exchange(f);return f.sent(await f.prepare({kind:'notice_authority',date:''}));}

test('ten working days excludes the notice day, weekends and timezone changes; calendar date validation',()=>{
  for(const [notice,due]of [['2026-09-18','2026-10-02'],['2026-09-19','2026-10-02'],['2026-10-23','2026-11-06'],['2026-12-25','2027-01-08']])assert.equal(noticeTools.addWorkingDays(notice),due);
  assert.equal(noticeTools.addWorkingDays('2026-02-30'),'');
  assert.equal(noticeTools.validNoticeDates('2026-09-10','2026-09-09'),false);
  assert.equal(noticeTools.validNoticeDates('2026-09-10','2026-09-10'),true);
  assert.equal(noticeTools.validNoticeDates('','2026-09-10'),false);
});

for(const requester of ['agent','solicitor'])test(`${requester} requests notice authority once, with actor snapshot and developer notification`,async t=>{
  const f=await legalDatabase();t.after(()=>f.db.close());await exchange(f);
  await f.action(requester,'request_notice_authority');await f.action(requester==='agent'?'solicitor':'agent','request_notice_authority');
  await f.service();const events=(await f.db.query("select * from unit_sale_workflow_events where event_type='authority_notice_requested'")).rows;
  assert.equal(events.length,1);assert.equal(events[0].created_by_user_id,f.ids[requester]);assert.ok(events[0].created_at);assert.equal(events[0].actor_role,requester==='agent'?'sales_agent':'conveyancer');
  assert.equal((await f.db.query('select count(*)::int n from sale_mention_notifications where recipient_id=$1',[f.ids.developer])).rows[0].n,1);
  const email=await f.sent(await f.prepare({kind:'notice_authority',date:''}));assert.deepEqual(email.cc_recipients,['sales@example.test']);
  await assert.rejects(f.action(requester,'request_notice_authority'),/already available/);
  const sale=(await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0];
  assert.equal(sale.completion_authority_requested_by,f.ids[requester]);assert.equal(sale.completion_authority_given_by,f.ids.developer);assert.ok(sale.completion_authority_given_at);
});

test('developer gives notice authority directly using the signed preview, with no date and the building sales-agent CC',async t=>{
  const f=await apiFixture(t);await exchange(f);
  const preview=await f.post({action:'preview',kind:'notice_authority'});
  assert.equal(preview.status,200);assert.equal(preview.date,'');assert.deepEqual(preview.cc,['sales@example.test']);assert.match(preview.subject,/Authority to Serve Notice/);assert.match(preview.body,/serve notice under the contract/);assert.doesNotMatch(preview.body,/proposed|completion date of/i);
  const payload={action:'send',kind:preview.kind,token:preview.token,requestId:crypto.randomUUID()};
  assert.equal((await f.post(payload)).status,200);assert.equal((await f.post(payload)).status,200);assert.equal(f.calls.length,1);
  await f.service();const sale=(await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0];
  assert.equal(sale.completion_authority_requested_at,null);assert.equal(sale.contractual_completion_date,null);assert.equal(sale.completion_authority_given_by,f.ids.developer);
  assert.equal((await f.db.query("select count(*)::int n from unit_sale_workflow_events where event_type='authority_notice_given'")).rows[0].n,1);
  assert.match((await f.post({...payload,requestId:crypto.randomUUID()})).error,/already available/);
});

test('backend blocks roles, forged state, old endpoints and later actions before authority and confirmation',async t=>{
  const f=await legalDatabase();t.after(()=>f.db.close());await exchange(f);
  await assert.rejects(f.notice(),/Awaiting developer authority/);
  await assert.rejects(f.upload(),/Confirm completion arrangements/);
  await assert.rejects(f.upload('completion_correspondence'),/notice submission/);
  await assert.rejects(f.action('developer','approve_completion_package',{}),/Confirm completion arrangements/);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current completion documents/);
  await assert.rejects(f.action('developer','request_notice_authority'),/access denied/);
  for(const user of ['agent','solicitor']) {
    await f.service(user);await assert.rejects(f.rpc('sales_legal_prepare_email',{p_sale:f.ids.sale,p_actor:f.ids[user],p_id:crypto.randomUUID(),p_kind:'notice_authority',p_snapshot:await f.snapshot(user),p_email:{},p_date:''}),/access denied/);
  }
  await f.as('agent');await assert.rejects(f.db.query('update unit_sale_attempts set completion_authority_given_at=now() where id=$1',[f.ids.sale]),/legal workflow/);
  await assert.rejects(f.db.query("update unit_sale_attempts set completion_legacy_stage='arrangements' where id=$1",[f.ids.sale]),/legal workflow/);
  await assert.rejects(f.rpc('sales_legal_action_before_notice',{p_sale:f.ids.sale,p_actor:f.ids.agent,p_action:'confirm_arrangements',p_payload:{}}),/permission denied/);
  await assert.rejects(f.rpc('sales_legal_submit_notice',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_request:crypto.randomUUID(),p_file:{}}),/permission denied/);
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));
  for(const user of ['developer','agent'])await assert.rejects(f.notice({user}),/access denied/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.solicitor]);
  await assert.rejects(f.notice(),/access denied/);
});

test('one-click notice submission rejects missing, empty, oversized, non-PDF and invalid dates without partial state',async t=>{
  const f=await apiFixture(t);await authorise(f);f.asUser('solicitor');
  for(const file of [null,new File([],'empty.pdf',{type:'application/pdf'}),new File(['text'],'notice.txt',{type:'text/plain'}),new File(['%PDF-'],'notice.pdf',{type:'text/plain'}),new File(['not a pdf'],'fake.pdf',{type:'application/pdf'}),new File([new Uint8Array(10*1024*1024+1)],'big.pdf',{type:'application/pdf'})]) {
    const result=await f.post(f.noticeForm({file}));assert.equal(result.status,400);assert.match(result.error,/PDF/);
  }
  for(const dates of [{noticeDate:''},{date:''},{noticeDate:'2026-02-30'},{noticeDate:'2026-09-20',date:'2026-09-19'}])assert.equal((await f.post(f.noticeForm(dates))).status,400);
  assert.equal(f.storage.size,0);await f.service();assert.equal((await f.db.query('select count(*)::int n from unit_sale_document_versions')).rows[0].n,0);
  f.failUpload(true);assert.match((await f.post(f.noticeForm())).error,/Upload failed/);f.failUpload(false);
  await f.owner();await f.db.exec("create function fail_notice_event() returns trigger language plpgsql as $$begin if new.event_type='completion_arrangements_confirmed' then raise exception 'Simulated audit failure'; end if; return new; end$$;create trigger fail_notice_event before insert on unit_sale_workflow_events for each row execute function fail_notice_event();");
  assert.match((await f.post(f.noticeForm())).error,/Simulated audit failure/);assert.equal(f.storage.size,0);
  await f.owner();assert.equal((await f.db.query('select count(*)::int n from unit_sale_document_versions')).rows[0].n,0);assert.equal((await f.db.query('select completion_arrangements_confirmed_at from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0].completion_arrangements_confirmed_at,null);
  await f.db.exec('drop trigger fail_notice_event on unit_sale_workflow_events');
  const form=f.noticeForm();const result=await f.post(form);assert.equal(result.status,200);assert.equal(f.storage.size,1);
  const duplicate=await f.post(form);assert.equal(duplicate.versionId,result.versionId);assert.equal(f.storage.size,1);
  await f.service();const sale=(await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0];
  assert.equal(sale.completion_notice_issued_at.toISOString().slice(0,10),'2026-09-01');assert.equal(sale.contractual_completion_date.toISOString().slice(0,10),'2026-09-15');assert.equal(sale.completion_arrangements_confirmed_by,f.ids.solicitor);assert.ok(sale.completion_arrangements_confirmed_at);
});

test('a lost RPC response never removes the committed PDF and a retry reconciles it',async t=>{
  const f=await apiFixture(t);await authorise(f);f.asUser('solicitor');f.loseNoticeResponse(true);
  const form=f.noticeForm();assert.equal((await f.post(form)).status,400);assert.equal(f.storage.size,1);
  f.loseNoticeResponse(false);assert.equal((await f.post(form)).status,200);assert.equal(f.storage.size,1);
});

test('concurrent confirmations and stale replacements retain exactly one current version and immutable history',async t=>{
  const f=await legalDatabase();t.after(()=>f.db.close());await authorise(f);await f.service('solicitor');
  const args={p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_file:{path:f.ids.building+'/'+f.ids.sale+'/notice.pdf',name:'notice.pdf',size:100,mime:'application/pdf'},p_notice:'2026-09-01',p_due:'2026-09-15'};
  const results=await Promise.allSettled([f.rpc('sales_legal_submit_notice',{...args,p_request:crypto.randomUUID()}),f.rpc('sales_legal_submit_notice',{...args,p_request:crypto.randomUUID()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/already confirmed/);
  const first=results.find(r=>r.status==='fulfilled').value;
  const next=await f.notice({replace:true,expected:first.versionId});assert.notEqual(next.versionId,first.versionId);
  await assert.rejects(f.notice({replace:true,expected:first.versionId}),/PDF changed/);
  const versions=(await f.db.query('select * from unit_sale_document_versions order by version_number')).rows;assert.equal(versions.length,2);assert.equal(versions[0].is_current,false);assert.equal(versions[1].is_current,true);assert.equal(versions[0].storage_path,args.p_file.path);
  await f.owner();await assert.rejects(f.db.exec("begin;select set_config('app.sales_legal_write','on',true);update unit_sale_document_versions set file_name='changed.pdf';commit;"),/immutable/);await f.db.exec('rollback');
  await f.action('solicitor','correct_completion_dates',{noticeDate:'2026-09-02',date:'2026-09-16',previousNoticeDate:'2026-09-01',previousDate:'2026-09-15'});
  await assert.rejects(f.action('solicitor','correct_completion_dates',{noticeDate:'2026-09-03',date:'2026-09-17',previousNoticeDate:'2026-09-01',previousDate:'2026-09-15'}),/Dates changed/);
  await f.as('agent');const events=await f.rpc('sale_activity_page',{p_sale:f.ids.sale});
  for(const type of ['authority_notice_given','completion_arrangements_confirmed','completion_correspondence_replaced','completion_arrangements_dates_corrected']) {
    const found=events.filter(e=>e.event_type===type);assert.equal(found.length,1,type);assert.ok(found[0].actor_name);assert.ok(found[0].actor_role);assert.ok(found[0].created_at);
  }
  await f.service();await assert.rejects(f.db.query("delete from unit_sale_workflow_events where event_type='completion_arrangements_dates_corrected'"),/immutable/);
});

test('migration preserves legacy dates and documents without inventing authority or confirmation actors',async t=>{
  const f=await legalDatabase({beforeNotice:async f=>{
    await f.db.exec("begin;select set_config('app.sales_legal_write','on',true);");
    await f.db.query("update unit_sale_attempts set exchanged_at='2026-08-01',contractual_completion_date='2026-08-15',completion_notice_issued_at='2026-08-02',workflow_status='exchanged' where id=$1",[f.ids.sale]);
    await f.db.query("insert into unit_sale_documents(sale_attempt_id,document_type,title,status) values($1,'completion_correspondence','Historical PDF','uploaded')",[f.ids.sale]);
    await f.db.exec('commit');
  }});t.after(()=>f.db.close());await f.service();
  const sale=(await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0];
  assert.equal(sale.completion_legacy_stage,'arrangements');assert.equal(sale.completion_authority_given_by,null);assert.equal(sale.completion_authority_given_at,null);assert.equal(sale.completion_arrangements_confirmed_at,null);
  assert.equal(sale.contractual_completion_date.toISOString().slice(0,10),'2026-08-15');assert.equal(sale.completion_notice_issued_at.toISOString().slice(0,10),'2026-08-02');
  assert.deepEqual(noticeTools.completionNoticeState(sale),{authorised:true,confirmed:true});await f.upload();
  assert.equal((await f.db.query("select count(*)::int n from unit_sale_documents where title='Historical PDF'")).rows[0].n,1);
});
