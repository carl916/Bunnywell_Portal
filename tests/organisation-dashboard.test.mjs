import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, document, snag, NOW, sale, unit, building } from './helpers/dashboard-fixture.mjs';
const {deriveDashboard,filterWork,destinationUrl,dashboardRoleAllowed}=loadTypescriptModule('src/lib/dashboard/model.ts');
const {currentInformationSupplied,needsTrade}=loadTypescriptModule('src/lib/dashboard/snags.ts');
const {deadlineState,londonDate,londonMidnight,recentBusinessWindow}=loadTypescriptModule('src/lib/dashboard/dates.ts');
const {readComplete}=loadTypescriptModule('src/lib/dashboard/read.ts');
const kinds=input=>deriveDashboard(input).items.map(item=>item.kind);
const docs=()=>[document('completion_statement'),document('draft_statement_of_account')];

test('equivalent organisation accounts and repeated shared-account sessions see identical business work',()=>{
  const f=fixture({documents:docs(),viewer:{id:'one',role:'conveyancer',organisation_id:'legal-org'}});
  const first=deriveDashboard(f);f.viewer.id='two';const second=deriveDashboard(f);
  assert.deepEqual(first.items,second.items);assert.notEqual(first.scope.identity,second.scope.identity);
  assert.deepEqual(deriveDashboard(f).items,second.items);
  f.unread=0;f.last_login_at='2099-01-01';assert.deepEqual(deriveDashboard(f).items,second.items);
});
test('developer approvals belong to the team regardless of submission/account history',()=>{
  const f=fixture({sales:[{...sale,workflow_status:'reservation_submitted',reservation_approved_at:null,exchanged_at:null,reservation_submitted_at:'2026-10-02T12:00:00Z'}]});
  const task=deriveDashboard(f).items.find(i=>i.kind==='reservation_review');
  assert.equal(task.ours,true);assert.equal(task.waiting.since,'2026-10-02T12:00:00Z');
  f.viewer.id='another';assert.deepEqual(deriveDashboard(f).items.find(i=>i.kind==='reservation_review'),task);
});
test('returned reservation records current reason and return age; historical failed attempts do not count',()=>{
  const f=fixture({sales:[{...sale,workflow_status:'rejected',exchanged_at:null,reservation_approved_at:null,reservation_rejected_at:'2026-10-03T12:00:00Z',reservation_rejection_reason:'Correct buyer identity'}]});
  const task=deriveDashboard(f).items.find(i=>i.kind==='reservation_correct');assert.equal(task.context.text,'Correct buyer identity');assert.equal(task.ours,false);
  for(const status of ['failed','fallen_through','superseded','withdrawn'])assert.equal(kinds({...f,sales:[{...f.sales[0],workflow_status:status}]}).length,0);
  assert.equal(kinds({...f,sales:[{...f.sales[0],is_active:false}]}).length,0);
});
test('commercial approval is not duplicated after the reservation satisfied it',()=>{
  const f=fixture({sales:[{...sale,exchanged_at:null,workflow_status:'approved'}]});assert.ok(!kinds(f).includes('commercial_review'));
  f.sales[0].commercial_approved_at=null;assert.equal(kinds(f).filter(k=>k==='commercial_review').length,1);
});
test('direct authority clears stale request; exact expiry is retained and 48-hour warning used',()=>{
  const f=fixture({sales:[{...sale,workflow_status:'approved',exchanged_at:null,authority_requested_at:'2026-10-01T12:00:00Z'}],authorities:[{id:'auth-1',sale_attempt_id:sale.id,kind:'authority',version:1,issued_at:'2026-10-02T12:00:00Z',expires_at:'2026-10-09T12:00:00Z',sent_at:'2026-10-02T12:00:00Z',delivery_status:'sent'}]});
  const snapshot=deriveDashboard(f);assert.ok(!snapshot.items.some(i=>i.kind==='authority_request'));
  const action=snapshot.items.find(i=>i.kind==='exchange_progress');assert.equal(action.deadline.at,'2026-10-09T12:00:00Z');assert.equal(deadlineState(action.deadline,NOW),'soon');
  f.sales[0].exchanged_at='2026-10-04';f.now=NOW+7*86400000;assert.ok(!kinds(f).some(k=>k.startsWith('authority_')||k==='exchange_progress'));
});
test('expired and revoked authority renewal cycles exclude superseded authority and accepted exchange',()=>{
  const a={id:'auth',sale_attempt_id:sale.id,kind:'authority',version:1,issued_at:'2026-10-01T12:00:00Z',expires_at:'2026-10-02T12:00:00Z',delivery_status:'sent'};
  const f=fixture({sales:[{...sale,workflow_status:'approved',exchanged_at:null,authority_requested_at:'2026-10-03T12:00:00Z'}],authorities:[a]});
  assert.match(deriveDashboard(f).items.find(i=>i.kind==='authority_request').action,/renew/);
  f.sales[0].authority_requested_at=null;assert.ok(kinds(f).includes('authority_follow_up'));
  f.authorities[0]={...a,expires_at:'2026-12-01T12:00:00Z',revoked_at:'2026-10-02T12:00:00Z'};assert.ok(kinds(f).includes('authority_follow_up'));
  f.authorities[0].replaced_by='new';assert.ok(!kinds(f).includes('authority_follow_up'));
});
test('deposit receipt requires the matching expected full source amount and never blocks completion readiness',()=>{
  const f=fixture({documents:docs().map(d=>({...d,status:'approved',approved_version_id:d.unit_sale_document_versions[0].id})),depositSources:[{id:'source',sale_attempt_id:sale.id,expected_amount:25000}]});
  assert.ok(kinds(f).includes('deposit_receipt'));assert.ok(kinds(f).includes('legal_completion'));
  f.deposits=[{sale_attempt_id:sale.id,source_id:'source',received_amount:25000,expected_amount:25000}];assert.ok(!kinds(f).includes('deposit_receipt'));
  f.deposits[0].source_id='old';assert.ok(kinds(f).includes('deposit_receipt'));
});
test('notice authorisation identifies actual missing arrangements and does not impose expiry',()=>{
  const f=fixture({sales:[{...sale,completion_arrangements_confirmed_at:null,completion_authority_given_at:'2026-10-02T12:00:00Z',contractual_completion_date:null}]});
  const item=deriveDashboard(f).items.find(i=>i.kind==='notice_arrangements');assert.match(item.action,/notice issue date, saved contractual due date, notice PDF/);assert.equal(item.deadline,null);
  assert.ok(!kinds(f).some(k=>k.startsWith('missing_completion')||k.startsWith('review_')));
});
test('two missing or submitted completion documents count documents separately from affected sales',()=>{
  const f=fixture();assert.equal(deriveDashboard(f).items.filter(i=>i.kind.startsWith('missing_')).length,2);
  f.documents=docs();const result=deriveDashboard(f),ours=filterWork(result,'ours','sales');assert.equal(ours.tasks,2);assert.equal(ours.records,1);
  assert.equal(result.summaries.find(s=>s.key==='document_reviews').value,2);
});
test('independent approval, query and replacement use current versions only',()=>{
  const f=fixture({documents:[document('completion_statement','approved'),document('draft_statement_of_account','query_raised')]});
  assert.ok(!kinds(f).includes('review_completion_statement'));assert.ok(kinds(f).includes('replace_draft_statement_of_account'));assert.ok(!kinds(f).includes('legal_completion'));
  const before=deriveDashboard(f).items.find(i=>i.kind.startsWith('replace_'));
  f.documents[1]=document('draft_statement_of_account','uploaded','account-v2');const after=deriveDashboard(f).items.find(i=>i.kind.startsWith('review_'));
  assert.notEqual(before.id,after.id);assert.equal(after.cycleId,'account-v2');assert.ok(!kinds(f).includes('review_completion_statement'));
  f.documents[1].status='approved';f.documents[1].approved_version_id='account-v1';assert.ok(!kinds(f).includes('legal_completion'));
  f.documents[1].approved_version_id='account-v2';assert.ok(kinds(f).includes('legal_completion'));
});
test('a sale can appear in both queues without duplicating a record inside either queue',()=>{
  const f=fixture({documents:[document('completion_statement'),document('draft_statement_of_account','query_raised')]});const s=deriveDashboard(f);
  assert.equal(filterWork(s,'ours','sales').records,1);assert.equal(filterWork(s,'others','sales').records,1);
  assert.equal(new Set(s.items.map(i=>i.recordKey)).size,1);
});
test('saved contractual date and date-only due-today semantics survive London summer time',()=>{
  const f=fixture();let i=deriveDashboard(f).items.find(i=>i.kind==='completion_date');assert.equal(deadlineState(i.deadline,NOW),'today');
  f.sales[0].contractual_completion_date='2026-10-06';i=deriveDashboard(f).items.find(i=>i.kind==='completion_date');assert.equal(deadlineState(i.deadline,NOW),'overdue');
  f.sales[0].completed_at='2026-10-07';assert.ok(!kinds(f).includes('completion_date'));
});
test('calendar windows are start-inclusive/end-exclusive across both London DST transitions',()=>{
  assert.equal(londonDate(Date.parse('2026-07-01T23:30:00Z')),'2026-07-02');
  assert.equal(londonMidnight('2026-03-30')-londonMidnight('2026-03-29'),23*3600000);
  assert.equal(londonMidnight('2026-10-26')-londonMidnight('2026-10-25'),25*3600000);
  const w=recentBusinessWindow(Date.parse('2026-03-29T12:00:00Z'));assert.equal(w.end,londonMidnight('2026-03-30'));assert.equal(w.start,londonMidnight('2026-03-23'));
});
test('eligible late handover survives reporting closure; missing PC is context only',()=>{
  const f=fixture({sales:[],units:[{...unit,sale_status:'completed',completion_date:'2026-10-01'}]});assert.ok(kinds(f).includes('handover'));
  f.buildings[0].pc_confirmed=false;assert.ok(!kinds(f).includes('handover'));assert.equal(deriveDashboard(f).summaries.find(s=>s.key==='pc_ineligible').value,1);
});
test('information supplied follows only the latest current status cycle',()=>{
  const e=(id,old_value,new_value,day)=>({id,snag_id:'snag-1',event_type:'status_change',old_value,new_value,created_at:`2026-10-0${day}T12:00:00Z`});
  const events=[e('1','needs_more_info','open',1)];assert.equal(currentInformationSupplied(snag(),events)?.id,'1');
  events.push(e('2','open','closed',2),e('3','closed','open',3));assert.equal(currentInformationSupplied(snag(),events),null);
  events.push(e('4','open','needs_more_info',4),e('5','needs_more_info','open',5));assert.equal(currentInformationSupplied(snag(),events)?.id,'5');assert.equal(currentInformationSupplied(snag(),[]),null);
});
test('review age comes from entry to the current review, never a comment or updated_at',()=>{
  const s=snag({status:'resolved_by_contractor',updated_at:'2026-10-07T12:00:00Z',snag_events:[{id:'transition',snag_id:'snag-1',event_type:'status_change',old_value:'open',new_value:'resolved_by_contractor',created_at:'2026-10-01T12:00:00Z'},{id:'comment',snag_id:'snag-1',event_type:'comment',created_at:'2026-10-06T12:00:00Z'}]});
  assert.equal(deriveDashboard(fixture({sales:[],snags:[s]})).items[0].waiting.since,'2026-10-01T12:00:00Z');
  s.snag_events=[];const fallback=deriveDashboard(fixture({sales:[],snags:[s]})).items[0];assert.equal(fallback.waiting.fallback,true);assert.match(fallback.waiting.basis,/current cycle time unknown/);
});
test('contractor resolution waits on developer while supplied information returns to contractor',()=>{
  const f=fixture({sales:[],viewer:{id:'contractor',role:'contractor',organisation_id:'contractor-org'},snags:[snag({status:'resolved_by_contractor'})]});
  assert.equal(deriveDashboard(f).items[0].ours,false);f.snags[0].status='rejected_back_to_contractor';assert.equal(deriveDashboard(f).items[0].ours,true);
});
test('missing trade population is exactly active developer snags; no generic SLA invented',()=>{
  assert.equal(needsTrade(snag({trade_id:null})),true);for(const status of ['closed','resolved'])assert.equal(needsTrade(snag({status,trade_id:null})),false);
  assert.equal(needsTrade(snag({source_type:'leaseholder_defect',trade_id:null})),false);
  assert.equal(deriveDashboard(fixture({sales:[],snags:[snag({sla_due_date:'2026-01-01'})]})).items[0].deadline,null);
});
test('urgent resident defect is ordered ahead of routine sales work',()=>{
  const s=deriveDashboard(fixture({documents:docs(),snags:[snag({source_type:'leaseholder_defect',priority_code:'P1',status:'new',sla_due_date:'2026-10-07'})]}));assert.equal(s.items[0].source,'Resident defect');assert.equal(s.items[0].urgent,true);
});
test('fees respect supersession, voided payments and approved versus submitted positions',()=>{
  const f=fixture({invoices:[{id:'invoice',sale_attempt_id:sale.id,fee_milestone:'exchange',status:'approved',gross_amount:1200,expected_payable_amount:1200,approved_at:'2026-10-01',created_at:'2026-09-01'}],payments:[{invoice_id:'invoice',amount:1200,voided_at:'2026-10-02'}]});
  assert.ok(kinds(f).includes('fee_exchange_approved_unpaid'));f.payments[0].voided_at=null;assert.ok(!kinds(f).some(k=>k.startsWith('fee_')));
  f.invoices[0].status='superseded';assert.ok(!kinds(f).some(k=>k.startsWith('fee_')));
});
test('passed fixed-term date keeps tenancy occupied; never-let void has unknown age',()=>{
  const f=fixture({sales:[],units:[{...unit,rental_portfolio_status:'active'}],tenancies:[{id:'tenancy',unit_id:unit.id,tenancy_start_date:'2026-01-01',fixed_term_end_date:'2026-10-01',tenancy_end_date:null,created_at:'2026-01-01'}]});assert.ok(!kinds(f).includes('rental_void'));
  f.tenancies=[];const item=deriveDashboard(f).items.find(i=>i.kind==='rental_void');assert.equal(item.waiting.since,null);assert.match(item.waiting.basis,/unknown/);
  f.units[0].rental_portfolio_status='exited';assert.ok(!kinds(f).includes('rental_void'));
});
test('old tenant arrears never become the replacement tenant’s current risk',()=>{
  const f=fixture({sales:[],units:[{...unit,rental_portfolio_status:'active'}],tenancies:[{id:'new',unit_id:unit.id,tenancy_start_date:'2026-10-01',tenancy_end_date:null,created_at:'2026-10-01'}],arrears:[{id:'old-risk',tenancy_id:'old',status:'open',owner_action_required:true,intervention_level:'action_required',first_reported_at:'2026-08-01',last_reported_at:'2026-09-01'}]});assert.ok(!kinds(f).includes('rent_risk'));
});
test('pending resident requests remain complete beyond 100 and scoped to requested buildings',()=>{
  const f=fixture({sales:[],viewer:{id:'admin',role:'admin',organisation_id:null},accessRequests:Array.from({length:130},(_,n)=>({id:`r${n}`,created_at:'2026-10-01',requested_units:[{building_id:building.id}]}))});assert.equal(deriveDashboard(f).items.filter(i=>i.kind==='resident_access').length,130);
  f.viewer.role='developer';assert.equal(deriveDashboard(f).items.filter(i=>i.kind==='resident_access').length,0);
});
test('zero, partial failure, no buildings and role denial are distinct',()=>{
  const f=fixture({sales:[]});assert.equal(deriveDashboard(f).items.length,0);
  f.sources=f.sources.map(s=>s.key==='sales'?{...s,state:'unavailable'}:s);assert.equal(deriveDashboard(f).summaries.find(s=>s.key==='exchanged').value,null);
  f.buildings=[];f.units=[];assert.equal(deriveDashboard(f).buildings.length,0);
  for(const role of ['resident','user','agent','unknown'])assert.equal(dashboardRoleAllowed(role),false);
});
test('buildings with sales/rentals and no snags remain visible and overlap is labelled',()=>{
  const f=fixture({units:[{...unit,rental_portfolio_status:'active'}]});const s=deriveDashboard(f);assert.equal(s.buildings[0].sales,1);assert.equal(s.buildings[0].rentals,1);assert.equal(s.buildings[0].snags,0);
});
test('navigation encodes explicit scope, exact attempt/version and saved return scope',()=>{
  const url=destinationUrl({screen:'sales',buildingId:building.id,unitId:unit.id,saleId:sale.id,versionId:'version',section:'progression',anchor:'completion-documents-step'},'','dashboard');const p=new URL(url,'http://test');assert.equal(p.searchParams.get('building'),'all');assert.equal(p.searchParams.get('workSale'),sale.id);assert.equal(p.searchParams.get('workVersion'),'version');assert.equal(p.hash,'#completion-documents-step');
});
test('complete bounded retrieval works beyond API row limits and rejects truncation/change/failure',async()=>{
  const rows=Array.from({length:1201},(_,id)=>({id}));let calls=0;
  const result=await readComplete((from,to)=>{calls++;return Promise.resolve({data:rows.slice(from,Math.min(to+1,from+100)),count:rows.length,error:null});});assert.equal(result.length,1201);assert.equal(calls,13);
  await assert.rejects(readComplete(()=>Promise.resolve({data:[],count:3,error:null})),/incomplete/);
  await assert.rejects(readComplete(()=>Promise.resolve({data:[],count:null,error:null})),/count/);
  await assert.rejects(readComplete(()=>Promise.resolve({data:[],count:20001,error:null})),/bounded/);
  let n=0;await assert.rejects(readComplete(()=>Promise.resolve({data:[{id:++n}],count:n===1?3:4,error:null})),/changed/);
});

test("legacy arrangements with approved documents still require a saved contractual date",()=>{const f=fixture({sales:[{...sale,completion_arrangements_confirmed_at:null,completion_legacy_stage:"arrangements",contractual_completion_date:null}],documents:[document("completion_statement","approved"),document("draft_statement_of_account","approved")]});assert.ok(kinds(f).includes("notice_dates"));assert.ok(!kinds(f).includes("legal_completion"));f.sales[0].contractual_completion_date="2026-10-07";assert.ok(kinds(f).includes("legal_completion"));});

test("inconsistent unit stage blocks a portal-ready claim without changing canonical gates",()=>{const f=fixture({units:[{...unit,sale_status:"for_sale"}],documents:[document("completion_statement","approved"),document("draft_statement_of_account","approved")]});assert.ok(kinds(f).includes("sale_unit_reconciliation"));assert.ok(!kinds(f).includes("legal_completion"));});
