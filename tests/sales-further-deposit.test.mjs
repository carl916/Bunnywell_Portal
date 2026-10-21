import test from 'node:test';
import assert from 'node:assert/strict';
import { furtherDepositDatabase } from './helpers/further-deposit-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { furtherDepositState,addCalendarMonths,londonInstant,londonDateTime,timingError }=loadTypescriptModule('src/lib/sales/further-deposit.ts');
const base={id:'source',sale_attempt_id:'sale',required:true,expected_amount:15000,percent:5,received_amount:0,timing:{basis:'fixed',date:'2027-04-01',time:'17:00'},months_after_exchange:null,exchanged_at:'2026-09-01',pc_date:'2027-10-01',deadline:null,terms_version:1};
async function fixture(t) {const f=await furtherDepositDatabase();t.after(()=>f.db.close());return f;}

test('UK fixed cut-off, exact boundary, 30 days, partial + overdue, excess, full receipt',()=>{
  assert.equal(londonInstant('2027-04-01','17:00'),'2027-04-01T16:00:00.000Z');
  assert.equal(londonInstant('2027-01-01','17:00'),'2027-01-01T17:00:00.000Z');
  assert.equal(londonInstant('2027-03-28','01:30'),null);
  assert.equal(londonInstant('2027-10-31','01:30'),null);
  assert.equal(furtherDepositState(base,Date.parse('2027-03-02T12:00Z')).timing,'Upcoming');
  assert.equal(furtherDepositState(base,Date.parse('2027-03-01T12:00Z')).timing,'Scheduled');
  assert.equal(furtherDepositState(base,Date.parse('2027-04-01T15:59:59Z')).timing,'Due today');
  const partial=furtherDepositState({...base,received_amount:10000},Date.parse('2027-04-01T16:00:00Z'));
  assert.equal(partial.timing,'Overdue');assert.equal(partial.payment,'Part received');assert.equal(partial.outstanding,5000);
  assert.equal(furtherDepositState({...base,received_amount:15000},Date.now()).outstanding,0);
  assert.equal(furtherDepositState({...base,received_amount:15000.01},Date.now()).excess,.01);
});
test('calendar months, legacy precision, missing anchors, PC forecasts, confirmed amendments and date-only deadlines',()=>{
  assert.equal(addCalendarMonths('2028-01-31',1),'2028-02-29');assert.equal(addCalendarMonths('2027-01-31',1),'2027-02-28');
  assert.equal(addCalendarMonths('2028-03-31',-1),'2028-02-29');assert.equal(addCalendarMonths('2027-03',1),null);
  assert.ok(timingError(null,null));assert.equal(timingError(null,0),null);
  const forecast={...base,timing:{basis:'before_pc',months:6}};
  assert.equal(furtherDepositState(forecast,Date.now()).forecast,true);
  assert.equal(furtherDepositState({...forecast,pc_date:'2027-10'},Date.now()).date,null);
  assert.equal(furtherDepositState({...base,timing:null,months_after_exchange:2},Date.now()).date,'2026-11-01');
  assert.equal(furtherDepositState({...base,pc_date:'2030-01-01'},Date.now()).date,'2027-04-01');
  const confirmed={...forecast,deadline:{date:'2027-04-01',time:null,instant:null}};
  assert.equal(furtherDepositState({...confirmed,pc_date:'2030-01-01'},Date.parse('2027-04-01T20:00Z')).timing,'Due today');
  assert.equal(furtherDepositState(confirmed,Date.parse('2027-04-01T23:00Z')).timing,'Overdue');
  const dateOnlyAmendment = furtherDepositState({...base,deadline:{date:'2027-04-01',time:null,instant:null}},Date.parse('2027-04-01T20:00Z'));
  assert.equal(dateOnlyAmendment.time,null);assert.equal(dateOnlyAmendment.timing,'Due today','Date-only amendment must not inherit the previous fixed time');
  assert.equal(furtherDepositState({...base,exchanged_at:'2027-04-02'},Date.now()).timing,'Deadline needs confirmation');
});
test('retained snapshot, early/partial/multiple/full receipts, retry and correction history',async t=>{
  const f=await fixture(t);const preview=await f.context();assert.equal(preview.further.expected_amount,15000);assert.equal(preview.exchanged,false);
  await assert.rejects(f.depositAction('record_further_receipt',await f.payload()),/legal exchange/);
  await f.exchange();const c=await f.context();assert.equal(c.further.expected_amount,15000);assert.equal(c.further.timing.instant,'2027-04-01T16:00:00+00:00');
  const p=await f.payload();const first=await f.depositAction('record_further_receipt',p);
  assert.deepEqual(await f.depositAction('record_further_receipt',p),first);
  assert.equal(first.received_instant,null);assert.equal(first.received_time,null);assert.ok(first.recorded_at);assert.equal(first.organisation_id,f.solicitorOrg);
  assert.equal((await f.context()).further.received_amount,10000);
  const second=await f.depositAction('record_further_receipt',await f.payload({amount:'5000'}));
  assert.equal((await f.context()).further.received_amount,15000);
  await assert.rejects(f.depositAction('correct_further_receipt',await f.payload({previousReceiptId:second.id,amount:'4000'})),/reason/);
  const correction=await f.depositAction('correct_further_receipt',await f.payload({previousReceiptId:second.id,amount:'4000',reason:'Ledger transcription corrected'}));
  const corrected=await f.context();assert.equal(corrected.further.received_amount,14000);assert.equal(corrected.receipts.length,3);assert.equal(correction.supersedes_id,second.id);
  await f.depositAction('void_further_receipt',await f.payload({previousReceiptId:correction.id,reason:'Wrong incoming transfer'}));assert.equal((await f.context()).further.received_amount,10000);
  await f.owner(); await assert.rejects(f.db.exec("update sale_further_deposit_receipts set amount=1"),/immutable/);
  await assert.rejects(f.db.exec("delete from unit_sale_workflow_events where event_type='further_deposit_received'"),/immutable/);
  assert.equal((await f.db.query('select workflow_status from unit_sale_attempts where id=$1',[f.ids.sale])).rows[0].workflow_status,'exchanged');
  assert.equal((await f.context('solicitor',f.ids.replacement)).receipts.length,0);
});
test('server amount/date/time checks, overpayment review and stale revisions',async t=>{
  const f=await fixture(t);await f.exchange();
  for(const amount of ['0','-1','NaN','1.001','Infinity','']) await assert.rejects(f.depositAction('record_further_receipt',await f.payload({amount})),/amount|GBP/);
  for(const date of ['2999-01-01','2026-02-30','']) await assert.rejects(f.depositAction('record_further_receipt',await f.payload({date})),/future|date|range/);
  await assert.rejects(f.depositAction('record_further_receipt',await f.payload(londonDateTime(Date.now()+600000))),/future/);
  await assert.rejects(f.depositAction('record_further_receipt',await f.payload({amount:'15001'})),/overpayment/);
  const receipt=await f.depositAction('record_further_receipt',await f.payload({amount:'15001',acknowledgeExcess:true}));assert.equal((await f.context()).further.received_amount,15001);
  await f.depositAction('correct_further_receipt',await f.payload({amount:'15000',previousReceiptId:receipt.id,reason:'Correction'}));
  await assert.rejects(f.depositAction('correct_further_receipt',await f.payload({previousReceiptId:receipt.id,reason:'Stale'})),/changed/);
});
test('permissions, cross-organisation, RLS, actor spoofing and developer deadline audit',async t=>{
  const f=await fixture(t);await f.exchange();const p=await f.payload();
  for(const user of ['developer','agent','outsider','revoked']) await assert.rejects(f.depositAction('record_further_receipt',p,user),/conveyancer|access denied/);
  await f.as('agent');await assert.rejects(f.rpc('sales_further_deposit_action',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_action:'record_further_receipt',p_payload:p}),/Actor access denied/);
  await f.owner();await f.db.query('update profiles set organisation_id=$1 where id=$2',[f.agentOrg,f.ids.solicitor]);await assert.rejects(f.depositAction('record_further_receipt',p),/organisation/);
  await f.owner();await f.db.query('update profiles set organisation_id=$1 where id=$2',[f.solicitorOrg,f.ids.solicitor]);await f.depositAction('record_further_receipt',p);
  const amendment=await f.payload({date:'2027-05-01',time:null,reason:'Agreed contract variation',previousDeadlineId:null});
  await assert.rejects(f.depositAction('confirm_further_deadline',amendment),/developer/);
  await f.depositAction('confirm_further_deadline',amendment,'developer');assert.equal((await f.context()).further.deadline.date,'2027-05-01');
  const firstDeadline=(await f.context()).deadlines[0];
  assert.equal((await f.depositAction('confirm_further_deadline',amendment,'developer')).id,firstDeadline.id);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.outsider]);await f.as('outsider');assert.deepEqual((await f.db.query('select * from sale_further_deposit_facts')).rows,[]);assert.deepEqual((await f.db.query('select * from sale_further_deposit_receipts')).rows,[]);
  await assert.rejects(f.db.exec('delete from sale_further_deposit_receipts'),/permission denied/);
});

test('pre-migration exchange receipt and audited corrections are reused exactly once',async t=>{
  let before;
  const f=await furtherDepositDatabase({initialiseTerms:false,beforeMigration:async old=>{
    await old.sent(await old.prepare());await old.action('solicitor','confirm_exchange',{date:londonDateTime().date});
    const source=(await old.rpc('sales_exchange_deposit_context',{p_sale:old.ids.sale,p_actor:old.ids.solicitor})).source;
    const receipt=await old.action('solicitor','confirm_exchange_deposit',{sourceId:source.id,date:'2026-08-30',confirmed:true});
    await old.action('solicitor','correct_exchange_deposit_date',{sourceId:source.id,previousReceiptId:receipt.id,date:'2026-08-31',reason:'Historic correction'});
    await old.owner();
    before={sources:(await old.db.query('select to_jsonb(s) row from sale_exchange_deposit_sources s order by id')).rows,
      receipts:(await old.db.query('select to_jsonb(r) row from sale_exchange_deposit_receipts r order by id')).rows};
  }});
  t.after(()=>f.db.close());const context=await f.context();assert.equal(context.exchange.receipt.revision,2);assert.equal(context.receipts.length,0);
  await f.owner();
  assert.deepEqual((await f.db.query('select to_jsonb(s) row from sale_exchange_deposit_sources s order by id')).rows,before.sources);
  assert.deepEqual((await f.db.query('select to_jsonb(r) row from sale_exchange_deposit_receipts r order by id')).rows,before.receipts);
});

test('retained explicit schedule credits and penny rounding do not deduct reservation fees again',async t=>{
  const f=await fixture(t);await f.owner();
  const snapshot={terms:{contract_price:300000.10,second_deposit_percent:5,reservation_fee:2000,reservation_fee_holder:'sales_agent'},
    schedule:[{payment_stage:'exchange',expected_amount:30000.01},{payment_stage:'delayed_deposit',expected_amount:14500.01},{label:'Unknown stage',expected_amount:99999}]};
  assert.equal(await f.rpc('sales_further_deposit_amount',{p_snapshot:snapshot}),'14500.01');
  assert.equal(await f.rpc('sales_further_deposit_amount',{p_snapshot:{terms:snapshot.terms}}),'15000.01');
});

test('building defaults update existing unreserved baselines, preserve overrides and frozen sales, and create no attempts',async t=>{
  const f=await fixture(t);await f.owner();
  await f.db.query('insert into building_sale_defaults(building_id,exchange_deposit_percent) values($1,10)',[f.ids.building]);
  const baseline=crypto.randomUUID(),override=crypto.randomUUID(),newUnit=crypto.randomUUID();
  for(const [id,rate] of [[baseline,10],[override,15]]) {
    await f.db.query("insert into units(id,building_id,unit_number,sale_status) values($1,$2,$3,'for_sale')",[id,f.ids.building,rate.toString()]);
    await f.db.query("insert into unit_sale_attempts(id,unit_id,building_id,workflow_status,is_system_baseline) values($1,$1,$2,'draft',true)",[id,f.ids.building]);
    await f.db.query('insert into unit_sale_terms(sale_attempt_id,contract_price,exchange_deposit_percent,completion_balance_percent) values($1,300000,$2::numeric,100-$2::numeric)',[id,rate]);
  }
  const retained=(await f.db.query('select to_jsonb(t) t from unit_sale_terms t where sale_attempt_id=$1',[f.ids.sale])).rows[0].t;
  const fixed={basis:'fixed',date:'2027-04-01',time:'17:00'};
  await f.db.query('update building_sale_defaults set second_deposit_enabled=true,second_deposit_percent=5,further_deposit_timing=$2 where building_id=$1',[f.ids.building,fixed]);
  const terms=(await f.db.query('select * from unit_sale_terms where sale_attempt_id=$1',[baseline])).rows[0];assert.equal(terms.second_deposit_percent,'5');assert.equal(terms.completion_balance_percent,'85');assert.equal(terms.further_deposit_timing.instant,'2027-04-01T16:00:00+00:00');
  assert.equal((await f.db.query('select second_deposit_enabled from unit_sale_terms where sale_attempt_id=$1',[override])).rows[0].second_deposit_enabled,false);
  assert.deepEqual((await f.db.query('select to_jsonb(t) t from unit_sale_terms t where sale_attempt_id=$1',[f.ids.sale])).rows[0].t,retained);
  await f.db.query("insert into units(id,building_id,unit_number,sale_status) values($1,$2,'new','for_sale')",[newUnit,f.ids.building]);
  assert.equal((await f.db.query('select count(*)::int n from unit_sale_attempts where unit_id=$1',[newUnit])).rows[0].n,0);
  // Exercise the actual API snapshot function used when a new unit is reserved.
  const {termsSnapshotFromDefaults}=loadTypescriptModule('src/app/api/sales/reservations/route.ts',{exports:['termsSnapshotFromDefaults'],overrides:{'@/lib/supabase/admin':{}}});
  const defaults=(await f.db.query('select * from building_sale_defaults where building_id=$1',[f.ids.building])).rows[0];
  const fresh=termsSnapshotFromDefaults({defaults,currentTerms:null});assert.equal(fresh.second_deposit_percent,5);assert.equal(fresh.further_deposit_timing.date,'2027-04-01');
  await f.exchange();const sourceBefore=await f.context();await f.owner();
  await f.db.query("update buildings set pc_date='2030-01-01' where id=$1",[f.ids.building]);
  await f.db.query('update building_sale_defaults set second_deposit_enabled=false,second_deposit_percent=null,further_deposit_timing=null where building_id=$1',[f.ids.building]);
  assert.equal((await f.db.query('select second_deposit_enabled from unit_sale_terms where sale_attempt_id=$1',[baseline])).rows[0].second_deposit_enabled,false);
  const sourceAfter=await f.context();assert.deepEqual(sourceAfter.further.timing,sourceBefore.further.timing);assert.equal(sourceAfter.further.expected_amount,15000);
});

test('concurrent/retried submissions use one receipt, stale totals are rejected, authenticated conveyancer can record',async t=>{
  const f=await fixture(t);await f.exchange();const payload=await f.payload();await f.as('solicitor');
  const args={p_sale:f.ids.sale,p_action:'record_further_receipt',p_payload:payload};
  const results=await Promise.all([f.rpc('sales_further_deposit_action',args),f.rpc('sales_further_deposit_action',args)]);assert.equal(results[0].id,results[1].id);
  await assert.rejects(f.rpc('sales_further_deposit_action',{...args,p_payload:{...payload,requestId:crypto.randomUUID()}}),/totals changed/);
  assert.equal((await f.context()).receipts.length,1);
});

test('new fixed settings require time; relative timing validation and original exchange receipt history survive',async t=>{
  const f=await fixture(t);await f.owner();
  await assert.rejects(f.db.query('insert into building_sale_defaults(building_id,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,further_deposit_timing) values($1,10,true,5,$2)',[f.ids.building,{basis:'fixed',date:'2027-04-01'}]),/deadline time/);
  await f.db.query('insert into building_sale_defaults(building_id,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,further_deposit_timing) values($1,10,true,5,$2)',[f.ids.building,{basis:'before_pc',months:6}]);
  await assert.rejects(f.db.query('update building_sale_defaults set further_deposit_timing=$2 where building_id=$1',[f.ids.building,{basis:'after_exchange',months:null}]),/calendar months/);
  await assert.rejects(f.db.query('update building_sale_defaults set second_deposit_percent=95 where building_id=$1',[f.ids.building]),/100/);
  await f.exchange();const c=await f.context();
  const original=await f.action('solicitor','confirm_exchange_deposit',{sourceId:c.exchange.source.id,date:'2026-09-01',confirmed:true});
  const corrected=await f.action('solicitor','correct_exchange_deposit_date',{sourceId:c.exchange.source.id,previousReceiptId:original.id,date:'2026-09-02',reason:'Synthetic correction'});
  assert.equal((await f.context()).exchange.receipt.id,corrected.id);assert.equal((await f.context()).receipts.length,0);
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));await f.notice();await f.uploadFiles();
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString(),confirmed:true}),/approv/);
  await f.approveDocuments();await f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString(),confirmed:true});
  assert.equal((await f.context()).receipts.length,0,'Documents and completion never invent receipts');
  await f.depositAction('record_further_receipt',await f.payload());assert.equal((await f.context()).further.received_amount,10000);
});

test('authorised roles share deposit terms before approval without changing the sale or receipt permissions', async t => {
  const f = await fixture(t);
  await f.owner();
  await f.db.query('update profiles set organisation_id=$1 where id=$2', [f.agentOrg, f.ids.agent]);
  await f.db.query('update unit_sale_terms set contract_price=211500 where sale_attempt_id=$1', [f.ids.sale]);
  for (const status of ['draft', 'awaiting_approval', 'rejected', 'approved']) {
    await f.owner();
    await f.db.query('update unit_sale_attempts set workflow_status=$1 where id=$2', [status, f.ids.sale]);
    const before = (await f.db.query('select to_jsonb(a) row from unit_sale_attempts a where id=$1', [f.ids.sale])).rows;
    const developer = await f.context('developer');
    for (const user of ['agent', 'solicitor']) {
      await f.as(user);
      const c = await f.rpc('sales_deposit_context', { p_sale: f.ids.sale });
      assert.deepEqual(c.exchange, developer.exchange);
      assert.deepEqual(c.further, developer.further);
      assert.deepEqual(c.receipts, developer.receipts);
      assert.deepEqual(c.deadlines, developer.deadlines);
      assert.equal(c.exchange.preview_amount, 21150);
      assert.equal(c.further.expected_amount, 10575);
      assert.equal(c.exchanged, false);
      assert.equal(c.canRecord, user === 'solicitor');
      assert.equal(c.canAmendDeadline, false);
    }
    await f.owner();
    assert.deepEqual((await f.db.query('select to_jsonb(a) row from unit_sale_attempts a where id=$1', [f.ids.sale])).rows, before);
    assert.equal((await f.db.query('select count(*)::int count from sale_exchange_deposit_sources where sale_attempt_id=$1', [f.ids.sale])).rows[0].count, 0);
  }
  await f.owner();
  await f.db.query("update profiles set role='admin' where id=$1", [f.ids.developer]);
  const admin = await f.context('developer');
  assert.equal(admin.exchange.preview_amount, 21150);
  assert.equal(admin.canRecord, false);
  await assert.rejects(f.depositAction('record_further_receipt', {}, 'agent'), /conveyancer/);
  await assert.rejects(f.depositAction('record_further_receipt', {}, 'solicitor'), /Record legal exchange/);
});

test('pre-approval deposit reads retain authentication, building scope, active-account and actor checks', async t => {
  const f = await fixture(t);
  await f.owner();
  await f.db.query("update unit_sale_attempts set workflow_status='draft' where id=$1", [f.ids.sale]);
  await f.db.query('delete from user_building_access where user_id=$1', [f.ids.outsider]);
  await f.db.query('update profiles set active=false where id=$1', [f.ids.revoked]);
  for (const user of ['outsider', 'revoked']) {
    await f.as(user);
    await assert.rejects(f.rpc('sales_deposit_context', { p_sale: f.ids.sale }), /access denied/);
  }
  await f.as('agent');
  await assert.rejects(f.rpc('sales_deposit_context', { p_sale: f.ids.sale, p_actor: f.ids.developer }), /Actor access denied/);
  await f.owner();
  await f.db.exec('set role anon');
  await assert.rejects(f.rpc('sales_deposit_context', { p_sale: f.ids.sale }), /permission denied/);
});
