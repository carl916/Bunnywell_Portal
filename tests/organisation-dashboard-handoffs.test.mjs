import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, building, unit } from './helpers/dashboard-fixture.mjs';
const {deriveDashboard,filterWork}=loadTypescriptModule('src/lib/dashboard/model.ts');

test('PostgreSQL legal handoffs refresh both team queues, preserve sibling approval and reject stale colleagues',async t=>{
 const f=await legalDatabase();t.after(()=>f.db.close());
 await f.owner();
 for(const [name,role,org] of [['developer2','developer',null],['solicitor2','conveyancer',f.solicitorOrg]]){
  f.ids[name]=crypto.randomUUID();await f.db.query('insert into profiles(id,role,full_name,organisation_id) values($1,$2,$3,$4)',[f.ids[name],role,`Synthetic ${name}`,org]);
  await f.db.query('insert into user_building_access values($1,$2)',[f.ids[name],f.ids.building]);
 }
 await f.db.query('update profiles set organisation_id=$1 where id=$2',[f.solicitorOrg,f.ids.solicitor]);
 const now=Date.now(),today=new Date(now).toISOString().slice(0,10);
 async function work(who){
  await f.as(who);const visible=await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale]);assert.equal(visible.rows.length,1);
  const events=await f.rpc('sale_workflow_context',{p_sales:[f.ids.sale]});
  await f.service(who);
  const rows=async table=>JSON.parse(JSON.stringify((await f.db.query(`select * from ${table} where sale_attempt_id=$1`,[f.ids.sale])).rows));
  const sale=JSON.parse(JSON.stringify(visible.rows[0])),documents=await rows('unit_sale_documents');
  for(const d of documents)d.unit_sale_document_versions=JSON.parse(JSON.stringify((await f.db.query('select * from unit_sale_document_versions where document_id=$1',[d.id])).rows));
  return deriveDashboard(fixture({now,viewer:{id:f.ids[who],role:who.startsWith('developer')?'developer':'conveyancer',organisation_id:who.startsWith('developer')?null:f.solicitorOrg},organisations:[{id:f.solicitorOrg,name:"Legal Team"}],buildings:[{...building,id:f.ids.building,conveyancer_organisation_id:f.solicitorOrg}],units:[{...unit,id:f.ids.unit,building_id:f.ids.building,sale_status:sale.completed_at?'completed':sale.exchanged_at?'exchanged':'reserved'}],sales:[{...sale,conveyancer_organisation_id:f.solicitorOrg}],documents,authorities:await rows('sale_legal_emails'),deposits:await rows('sale_exchange_deposit_receipts'),depositSources:await rows('sale_exchange_deposit_sources'),saleEvents:events}));
 }
 const tasks=async who=>(await work(who)).items.map(i=>i.kind);
 await f.action('agent','request_authority');assert.ok((await tasks('developer')).includes('authority_request'));
 assert.deepEqual((await work('developer')).items,(await work('developer2')).items);
 await f.sent(await f.prepare());assert.ok(!(await tasks('developer')).includes('authority_request'));assert.ok((await tasks('solicitor')).includes('exchange_progress'));
 assert.deepEqual((await work('solicitor')).items,(await work('solicitor2')).items);
 await f.action('solicitor2','confirm_exchange',{date:today});assert.ok(!(await tasks('solicitor')).includes('exchange_progress'));assert.ok((await tasks('solicitor')).includes('deposit_receipt'));
 await f.sent(await f.prepare({kind:'notice_authority',date:''}));await f.notice({noticeDate:today,dueDate:today});
 assert.equal((await tasks('solicitor')).filter(k=>k.startsWith('missing_')).length,2);
 await f.uploadFiles();const pair=await f.packageVersions();
 assert.equal(filterWork(await work('developer'),'ours','sales').items.filter(i=>i.kind.startsWith('review_')).length,2);
 await f.action('developer2','approve_completion_document',{documentType:'draft_statement_of_account',versionId:pair.accountVersionId});
 await f.action('developer','query_completion_document',{documentType:'completion_statement',versionId:pair.statementVersionId,reason:'Synthetic balance query'});
 const queried=(await work('solicitor')).items.find(i=>i.kind==='replace_completion_statement');assert.equal(queried.context.text,'Synthetic balance query');assert.equal(queried.ours,true);
 assert.equal(filterWork(await work('developer2'),'ours','sales').items.filter(i=>i.kind.startsWith('review_')).length,0);
 const replacement=await f.upload();await assert.rejects(f.action('developer2','approve_completion_document',{documentType:'completion_statement',versionId:pair.statementVersionId}),/changed/);
 assert.ok(!(await tasks('solicitor')).includes('replace_completion_statement'));assert.ok(!(await tasks('developer')).includes('review_draft_statement_of_account'));
 await f.action('developer2','approve_completion_document',{documentType:'completion_statement',versionId:replacement});
 assert.ok((await tasks('solicitor')).includes('legal_completion'));assert.ok((await tasks('solicitor')).includes('deposit_receipt'));
 const completedAt=new Date().toISOString();await f.action('solicitor','confirm_completion',{dateTime:completedAt});await f.action('solicitor2','confirm_completion',{dateTime:completedAt});
 assert.ok(!(await tasks('solicitor')).includes('legal_completion'));assert.ok((await tasks('developer')).includes('handover'));
 await f.service();assert.equal((await f.db.query("select count(*)::int n from unit_sale_workflow_events where sale_attempt_id=$1 and event_type='completion_recorded'",[f.ids.sale])).rows[0].n,1);
});
