import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
async function context(f,user='solicitor') { await f.service(user);return f.rpc('sales_exchange_deposit_context',{p_sale:f.ids.sale,p_actor:f.ids[user]}); }
async function exchange(f) { const email=await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:today()});return email; }
async function fixture(t,options) { const f=await legalDatabase(options);t.after(()=>f.db.close());return f; }
async function confirmation(f,extra={}) { const {source}=await context(f);return {sourceId:source.id,date:'2026-09-01',confirmed:true,...extra}; }

test('exchange immediately unlocks receipt without confirming a deposit, and freezes executed terms',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await context(f),{source:null,receipt:null});
  await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{date:today(),confirmed:true}),/Record legal exchange/);
  const email=await exchange(f);
  const before=await context(f);assert.equal(before.source.expected_amount,25000);assert.equal(before.source.authority_id,email.id);assert.equal(before.source.terms_id,email.snapshot.terms.id);assert.equal(before.receipt,null);
  await f.owner();
  assert.equal((await f.db.query('select workflow_status from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0].workflow_status,'exchanged');
  assert.equal((await f.db.query('select sale_status from units where id=$1',[f.ids.unit])).rows[0].sale_status,'exchanged');
  // Simulate an external repair of live terms: deposit still reads the frozen authority.
  await f.db.exec('alter table unit_sale_terms disable trigger legal_terms_guard; alter table unit_sale_payment_schedule disable trigger legal_schedule_guard;');
  await f.db.query('update unit_sale_terms set contract_price=999999,exchange_deposit_percent=20,reservation_fee=50000 where sale_attempt_id=$1',[f.ids.sale]);
  await f.db.query("insert into unit_sale_payment_schedule(sale_attempt_id,payment_stage,expected_amount) values($1,'exchange',99999)",[f.ids.sale]);
  assert.deepEqual(await context(f),before);
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));
  await f.notice({noticeDate:today(),dueDate:today()});await f.uploadFiles();await f.action('developer','approve_completion_package',await f.packageVersions());
  await f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString(),confirmed:true});
  assert.equal((await context(f)).receipt,null,'Legal completion does not require a receipt or an agent invoice');
  const receipt=await f.action('solicitor','confirm_exchange_deposit',await confirmation(f));assert.equal(receipt.received_amount,25000,'Outstanding receipt can still be recorded after completion');
});

test('authorised schedule amount takes precedence; no reservation-holder, contribution or staged-deposit deductions',async t=>{
  const f=await fixture(t);await f.owner();
  await f.db.query("update unit_sale_terms set reservation_fee_holder='conveyancer',developer_contribution=10000,agent_contribution=3000 where sale_attempt_id=$1",[f.ids.sale]);
  await f.db.query("insert into unit_sale_payment_schedule(sale_attempt_id,sequence_no,payment_stage,due_event,expected_amount,includes_reservation_fee) values($1,1,'exchange','exchange',26250,true),($1,2,'delayed_deposit','manual_date',15000,false),($1,3,'completion','completion',210000,false)",[f.ids.sale]);
  await exchange(f);assert.equal((await context(f)).source.expected_amount,26250);
  await f.owner();
  for(const holder of ['sales_agent','developer','conveyancer','other']) {
    const snapshot={terms:{contract_price:250000,exchange_deposit_percent:10,reservation_fee:2000,reservation_fee_holder:holder},schedule:[{payment_stage:'exchange',due_event:'exchange',expected_amount:23000,includes_reservation_fee:true}]};
    assert.equal(Number(await f.rpc('sales_exchange_deposit_amount',{p_snapshot:snapshot})),23000,'Explicit authorised net amount is used as-is');
  }
  assert.equal(Number(await f.rpc('sales_exchange_deposit_amount',{p_snapshot:{terms:{contract_price:250000},schedule:[{payment_stage:'exchange',fixed_amount:12345},{payment_stage:'exchange',percent_of_contract_price:1}]}})),14845);
  assert.equal(await f.rpc('sales_exchange_deposit_amount',{p_snapshot:{terms:{contract_price:250000,exchange_deposit_percent:10},schedule:[{payment_stage:'exchange'}]}}),null,'An incomplete schedule is not replaced by an invented amount');
});

test('receipt validates role, building access, dates, full confirmation and server-owned fields',async t=>{
  const f=await fixture(t);await exchange(f);const payload=await confirmation(f);
  const permissions=loadTypescriptModule('src/lib/sales/permissions.ts');
  for(const role of ['admin','developer','sales_agent','user']) assert.equal(permissions.canPerformSalesAction(role,'confirm_exchange_deposit'),false);
  assert.equal(permissions.canPerformSalesAction('conveyancer','confirm_exchange_deposit'),true);
  for(const user of ['developer','agent','outsider','revoked']) await assert.rejects(f.action(user,'confirm_exchange_deposit',payload),/role|access denied/);
  for(const date of ['',null,'2026-02-30','2026-2-3','2999-01-01']) await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{...payload,date}),/date|range/);
  await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{...payload,confirmed:false}),/full expected/);
  await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{...payload,sourceId:crypto.randomUUID()}),/Reload/);
  for(const key of ['amount','receivedAmount','expectedAmount','recordedBy','authorityId']) await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{...payload,[key]:1}),/set by the legal workflow/);
  await f.as('agent');await assert.rejects(f.rpc('sales_legal_action',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_action:'confirm_exchange_deposit',p_payload:payload}),/Actor access denied/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.solicitor]);
  await assert.rejects(f.action('solicitor','confirm_exchange_deposit',payload),/access denied/);
  await assert.rejects(context(f),/access denied/);
});

test('receipt stores source, equal amounts, date, actor/time; retries are idempotent and history is immutable',async t=>{
  const f=await fixture(t);const email=await exchange(f);const payload=await confirmation(f);
  const receipt=await f.action('solicitor','confirm_exchange_deposit',payload);
  assert.equal(receipt.sale_attempt_id,f.ids.sale);assert.equal(receipt.expected_amount,25000);assert.equal(receipt.received_amount,25000);assert.equal(receipt.received_date,payload.date);assert.equal(receipt.recorded_by,f.ids.solicitor);assert.ok(receipt.recorded_by_name);assert.ok(receipt.recorded_at);assert.equal(receipt.revision,1);
  assert.deepEqual(await f.action('solicitor','confirm_exchange_deposit',payload),receipt);
  await f.owner();
  const [event]=(await f.db.query("select * from unit_sale_workflow_events where event_type='exchange_deposit_received'")).rows;
  assert.match(event.summary,/£25,000.00 recorded as received on 1 September 2026 by/);assert.equal(event.created_by_user_id,f.ids.solicitor);assert.equal(event.metadata.authorityId,email.id);assert.equal(event.metadata.receivedAmount,25000);assert.equal(event.metadata.receivedDate,payload.date);assert.ok(event.created_at);
  const projection=(await f.db.query('select sale_event_projection(e) projection from unit_sale_workflow_events e where id=$1',[event.id])).rows[0].projection;assert.equal(projection.metadata.receiptId,receipt.id);
  for(const sql of ["update sale_exchange_deposit_receipts set received_date='2026-01-01'","delete from sale_exchange_deposit_receipts","update sale_exchange_deposit_sources set expected_amount=1","update unit_sale_workflow_events set event_type='note' where event_type='exchange_deposit_received'","delete from unit_sale_workflow_events where event_type='exchange_deposit_received'"]) await assert.rejects(f.db.exec(sql),/immutable/);
  await f.as('solicitor');await assert.rejects(f.db.query('insert into sale_exchange_deposit_receipts(sale_attempt_id) values($1)',[f.ids.sale]),/permission denied/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.outsider]);
  await f.as('outsider');assert.deepEqual((await f.db.query('select * from sale_exchange_deposit_receipts')).rows,[]);
  for(const user of ['developer','agent','solicitor']) {const visible=await context(f,user);assert.equal(visible.receipt.id,receipt.id);}
});

test('date corrections append a revision and event, reject stale edits and preserve original receipt',async t=>{
  const f=await fixture(t);await exchange(f);const payload=await confirmation(f);const original=await f.action('solicitor','confirm_exchange_deposit',payload);
  await assert.rejects(f.action('solicitor','confirm_exchange_deposit',{...payload,date:'2026-09-02'}),/audited date correction/);
  const correction={sourceId:payload.sourceId,previousReceiptId:original.id,date:'2026-08-31',reason:'Corrected from the client account ledger'};
  await assert.rejects(f.action('agent','correct_exchange_deposit_date',correction),/role/);
  await assert.rejects(f.action('solicitor','correct_exchange_deposit_date',{...correction,reason:''}),/reason/);
  const corrected=await f.action('solicitor','correct_exchange_deposit_date',correction);assert.equal(corrected.revision,2);assert.equal(corrected.supersedes_id,original.id);assert.equal(corrected.received_amount,original.received_amount);
  await assert.rejects(f.action('solicitor','correct_exchange_deposit_date',correction),/Receipt changed/);
  assert.equal((await context(f)).receipt.id,corrected.id);
  await f.owner();const receipts=(await f.db.query('select to_jsonb(r) record from sale_exchange_deposit_receipts r order by revision')).rows;assert.deepEqual(receipts[0].record,original);assert.equal(receipts.length,2);
  const events=(await f.db.query("select * from unit_sale_workflow_events where event_type like 'exchange_deposit_%' order by created_at")).rows;assert.equal(events.length,2);assert.equal(events[1].metadata.previousDate,original.received_date);assert.equal(events[1].metadata.reason,correction.reason);
});

test('migration freezes historical locked terms with no invented receipts and leaves dates/terms unchanged',async t=>{
  let termsBefore;
  const f=await fixture(t,{beforeDeposit:async f=>{
    await f.owner();await f.db.exec("set app.sales_legal_write='on'");
    await f.db.query("update unit_sale_attempts set workflow_status='exchanged',exchanged_at='2026-07-01' where id=$1",[f.ids.sale]);
    termsBefore=(await f.db.query('select to_jsonb(t) t from unit_sale_terms t where sale_attempt_id=$1',[f.ids.sale])).rows[0].t;
    await f.db.exec("reset app.sales_legal_write");
  }});
  const state=await context(f);assert.equal(state.source.source_kind,'legacy_locked_terms');assert.equal(state.source.expected_amount,25000);assert.equal(state.receipt,null);
  await f.owner();assert.deepEqual((await f.db.query('select to_jsonb(t) t from unit_sale_terms t where sale_attempt_id=$1',[f.ids.sale])).rows[0].t,termsBefore);
  assert.equal((await f.db.query('select exchanged_at::text date from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0].date,'2026-07-01');
  const missing=await f.rpc('sales_exchange_deposit_context',{p_sale:f.ids.replacement,p_actor:f.ids.developer});assert.equal(missing.source.expected_amount,null);assert.equal(missing.receipt,null);
  await f.action('solicitor','confirm_exchange_deposit',await confirmation(f));
});

test('migration identifies the executed historical authority rather than another version or live terms',async t=>{
  const executed=crypto.randomUUID();
  const f=await fixture(t,{beforeDeposit:async f=>{
    await f.owner();await f.db.exec("set app.sales_legal_write='on'");
    const terms=(await f.db.query('select id,version_number from unit_sale_terms where sale_attempt_id=$1',[f.ids.sale])).rows[0];
    const snapshot={terms:{...terms,contract_price:262500,exchange_deposit_percent:10},schedule:[{payment_stage:'exchange',expected_amount:26250}]};
    await f.db.query("insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,sending_address,to_recipients,approved_by,issued_at,expires_at,exchanged_at) values($1,$2,'authority',1,$3,'Saved','Saved','sender@example.test',array['legal@example.test'],$4,'2026-07-01','2026-07-03','2026-07-02')",[executed,f.ids.sale,snapshot,f.ids.developer]);
    await f.db.query("insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,sending_address,to_recipients,approved_by,issued_at,expires_at) values($1,$2,'authority',2,$3,'Unused','Unused','sender@example.test',array['legal@example.test'],$4,'2026-07-03','2026-07-05')",[crypto.randomUUID(),f.ids.sale,{terms:{...terms,contract_price:999999,exchange_deposit_percent:10},schedule:[]},f.ids.developer]);
    await f.db.query("update unit_sale_attempts set workflow_status='exchanged',exchanged_at='2026-07-02' where id=$1",[f.ids.sale]);await f.db.exec('reset app.sales_legal_write');
  }});
  const state=await context(f);assert.equal(state.source.authority_id,executed);assert.equal(state.source.authority_version,1);assert.equal(state.source.expected_amount,26250);assert.equal(state.receipt,null);
});
