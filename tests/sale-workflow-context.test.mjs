import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workflowContextDatabase, migration } from './helpers/workflow-context-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const uuid = n => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
async function fixture(t, options) {
  const f = await workflowContextDatabase(options);
  t.after(() => f.db.close());
  return f;
}
async function event(f, { id = crypto.randomUUID(), sale = f.ids.sale, type = 'reservation_submitted',
  at = '2030-01-01T12:00:00Z', metadata = {}, actor = f.ids.developer, summary = 'Saved historical summary' } = {}) {
  await f.owner();
  await f.db.query(`insert into unit_sale_workflow_events
    (id,sale_attempt_id,event_type,created_at,metadata,created_by_user_id,summary,from_status,to_status)
    values($1,$2,$3,$4,$5,$6,$7,'draft','approved')`,
  [id,sale,type,at,JSON.stringify(metadata),actor,summary]);
  return id;
}
async function otherSale(f) {
  await f.owner();
  const building = uuid(701), unit = uuid(702), sale = uuid(703);
  await f.db.query('insert into buildings(id,name) values($1,$2)', [building,'Other building']);
  await f.db.query("insert into units(id,building_id,unit_number,sale_status) values($1,$2,'201','for_sale')", [unit,building]);
  await f.db.query('insert into unit_sale_attempts(id,building_id,unit_id) values($1,$2,$3)', [sale,building,unit]);
  await event(f,{sale});
  return { building,unit,sale };
}

test('migration preserves catalog properties, helper definitions, ACLs, OID and audit records; rollback restores the body', async t => {
  const f = await fixture(t);
  const id = await event(f);
  const snapshot = await f.compare('developer');
  const catalog = await f.catalog();
  const before = (await f.db.query('select to_jsonb(e) data from unit_sale_workflow_events e order by id')).rows;
  // Preserve deployment-specific grants too, not merely the expected defaults.
  await f.db.exec('create role reporting_reader;grant execute on function public.sale_workflow_context(uuid[]) to reporting_reader');
  const extraAcl = await f.catalog();
  await f.db.exec(migration);
  assert.deepEqual(await f.catalog(),extraAcl);
  assert.deepEqual((await f.db.query('select to_jsonb(e) data from unit_sale_workflow_events e order by id')).rows,before);
  assert.ok(snapshot.some(e => e.id === id));
  const properties = catalog.find(x => x.signature === 'sale_workflow_context(uuid[])');
  assert.equal(properties.provolatile,'s');assert.equal(properties.prosecdef,true);
  assert.equal(properties.proisstrict,false);assert.equal(properties.proparallel,'u');
  assert.deepEqual(properties.proconfig,['search_path=public']);
  assert.equal(properties.returns,'jsonb');
  const grants = (await f.db.query(`select
    has_function_privilege('anon','public.sale_workflow_context(uuid[])','execute') anon,
    has_function_privilege('authenticated','public.sale_workflow_context(uuid[])','execute') authenticated,
    has_function_privilege('service_role','public.sale_workflow_context(uuid[])','execute') service_role`)).rows[0];
  assert.deepEqual(grants,{anon:false,authenticated:true,service_role:true});
  assert.equal((await f.compare('anon')).error.code,'42501');
  await f.as('agent');
  await assert.rejects(f.db.query('select * from unit_sale_workflow_events'),/permission denied/);
  await assert.rejects(f.rpc('can_access_sale',{p_sale_id:f.ids.sale,p_user_id:f.ids.developer}),/permission denied/);
  await f.owner();
  await f.db.exec(readFileSync('docs/sale-workflow-context/rollback.sql','utf8'));
  assert.equal((await f.catalog()).find(x => x.signature === properties.signature).definition,f.original.definition);
  assert.deepEqual((await f.catalog()).map(x => x.signature === properties.signature ? {...x,definition:properties.definition} : x),extraAcl);
});

test('all application roles, active developer, inactive users, missing identity and mixed buildings retain exact access', async t => {
  const f = await fixture(t), other = await otherSale(f);
  await event(f);
  await event(f,{type:'commercial_model_saved',summary:'Internal commercial details'});
  await f.owner();
  for (const role of ['developer_representative','contractor','resident']) await f.db.exec("alter type user_role add value '" + role + "'");
  const roles=['admin','developer','sales_agent','conveyancer','developer_representative','contractor','resident','user'];
  for (let i=0;i<roles.length;i++) {
    const id=uuid(100+i),role=roles[i];
    await f.db.query('insert into profiles(id,role,full_name) values($1,$2,$3)',[id,role,'Synthetic '+role]);
    await f.db.query('insert into user_building_access values($1,$2)',[id,f.ids.building]);
    const rows=await f.compare(id,[other.sale,f.ids.sale,f.ids.sale,null]);
    const allowed=['admin','developer','sales_agent','conveyancer'].includes(role);
    assert.equal(rows.length>0,allowed,role);
    assert.equal(rows.some(e=>e.sale_attempt_id===other.sale),['admin','developer'].includes(role));
    assert.equal(rows.some(e=>e.event_type==='commercial_model_saved'),['admin','developer'].includes(role));
    await f.db.query('update profiles set active=false where id=$1',[id]);
    assert.deepEqual(await f.compare(id,[f.ids.sale,other.sale]),[],role+' inactive');
  }
  assert.deepEqual(await f.compare(uuid(999),[f.ids.sale,other.sale]),[]);
  assert.deepEqual(await f.compare('',[f.ids.sale,other.sale]),[]);
  await f.db.query('delete from user_building_access where user_id=$1',[f.ids.outsider]);
  assert.deepEqual(await f.compare('outsider',[f.ids.sale,other.sale]),[]);
});

test('external organisation and explicit building grants are reevaluated after revocation', async t => {
  const f=await fixture(t),other=await otherSale(f);await event(f);
  const org=uuid(201),agent=uuid(202),conveyancer=uuid(203);
  await f.db.query("insert into organisations values($1,'External team')",[org]);
  for(const [id,role] of [[agent,'sales_agent'],[conveyancer,'conveyancer']])
    await f.db.query('insert into profiles(id,role,organisation_id) values($1,$2,$3)',[id,role,org]);
  await f.db.query("insert into building_organisations values($1,$2,'sales_agent',true),($1,$2,'conveyancer',true)",[f.ids.building,org]);
  for(const id of [agent,conveyancer]) {
    const rows=await f.compare(id,[other.sale,f.ids.sale]);
    assert.ok(rows.length);assert.ok(rows.every(e=>e.sale_attempt_id===f.ids.sale));
  }
  await f.db.query("update building_organisations set active=false where role_on_project='sales_agent'");
  assert.deepEqual(await f.compare(agent,[f.ids.sale,other.sale]),[]);
  assert.ok((await f.compare(conveyancer)).length);
  await f.db.query('update profiles set organisation_id=null where id=$1',[conveyancer]);
  assert.deepEqual(await f.compare(conveyancer),[]);
  await f.db.query('insert into user_building_access values($1,$2)',[agent,other.building]);
  const buildingGrant=await f.compare(agent,[f.ids.sale,other.sale]);
  assert.equal(buildingGrant.length,1);assert.equal(buildingGrant[0].sale_attempt_id,other.sale);
  await f.db.query('delete from user_building_access where user_id=$1',[agent]);
  assert.deepEqual(await f.compare(agent,[f.ids.sale,other.sale]),[]);
});

test('a hidden newer event cannot suppress an older visible event; version history, redaction and snapshots match', async t => {
  const f=await fixture(t);
  const shared=uuid(301),hidden=uuid(302),foreign=uuid(303),oldVersion=uuid(304),newVersion=uuid(305);
  await f.db.query(`insert into unit_sale_documents(id,sale_attempt_id,document_type,visibility)
    values($1,$4,'reservation_form','shared_sale_file'),($2,$4,'reservation_form','internal_only'),
    ($3,$5,'reservation_form','shared_sale_file')`,[shared,hidden,foreign,f.ids.sale,f.ids.replacement]);
  await f.db.query(`insert into unit_sale_document_versions(id,document_id,version_number,is_current,file_name,uploaded_by_user_id)
    values($1,$3,1,false,'historical.pdf',$4),($2,$3,2,true,'current.pdf',$4)`,[oldVersion,newVersion,shared,f.ids.developer]);
  const visible=await event(f,{id:uuid(310),type:'reservation_form_replaced',metadata:{documentId:shared,versionId:oldVersion}});
  const invisible=await event(f,{id:uuid(311),type:'reservation_form_replaced',at:'2030-01-02T12:00:00Z',metadata:{documentId:hidden,versionId:newVersion}});
  const crossSale=await event(f,{type:'reservation_form_replaced',at:'2030-01-03T12:00:00Z',metadata:{documentId:foreign}});
  await f.db.query("update profiles set full_name='Changed name',role='user',active=false where id=$1",[f.ids.developer]);
  for(const who of ['agent','solicitor']) {
    const rows=await f.compare(who),selected=rows.find(e=>e.event_type==='reservation_form_replaced');
    assert.equal(selected.id,visible);assert.equal(selected.version_id,oldVersion);
    assert.equal(selected.actor_name,'Test developer');assert.equal(selected.actor_role,'developer');
    assert.ok(!rows.some(e=>[invisible,crossSale].includes(e.id)));
  }
  await f.db.query("update profiles set role='developer',active=true where id=$1",[f.ids.developer]);
  assert.equal((await f.compare('developer')).find(e=>e.event_type==='reservation_form_replaced').id,crossSale);
  await f.db.query('update unit_sale_document_versions set redacted_at=now() where id=$1',[oldVersion]);
  assert.equal((await f.compare('agent')).find(e=>e.id===visible).version_id,null);
  await f.db.query('update unit_sale_document_versions set redacted_at=null where id=$1',[oldVersion]);
  await f.db.query('update unit_sale_documents set redacted_at=now() where id=$1',[shared]);
  assert.equal((await f.compare('solicitor')).find(e=>e.id===visible).version_id,null);
  await f.db.query("update unit_sale_documents set redacted_at=null,visibility='conveyancer' where id=$1",[shared]);
  assert.ok(!(await f.compare('agent')).some(e=>e.id===visible));
  assert.equal((await f.compare('solicitor')).find(e=>e.id===visible).version_id,oldVersion);
});

test('empty, null, duplicate, unknown and 500 IDs match; 501 IDs reject before deduplication', async t => {
  const f=await fixture(t);await event(f);
  for(const input of [[],null,[null],[uuid(999)],[f.ids.sale,f.ids.sale],Array(500).fill(f.ids.sale),
    [f.ids.sale,...Array.from({length:499},(_,i)=>uuid(1000+i))]]) {
    const rows=await f.compare('agent',input);
    assert.equal(rows.length,input?.includes(f.ids.sale)?1:0);
  }
  for(const who of ['agent','outsider','']) {
    const result=await f.compare(who,Array(501).fill(f.ids.sale));
    assert.deepEqual(result.error,{code:'P0001',message:'Too many sales.'});
  }
});

test('large histories keep latest visible rows and deterministic timestamp/UUID ordering without truncation', async t => {
  const f=await fixture(t);
  await f.db.query(`insert into unit_sale_workflow_events(id,sale_attempt_id,event_type,created_at,summary,created_by_user_id)
    select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      case when n%2=0 then $1::uuid else $2::uuid end,
      'historical_type_'||(n%120)::text,'2030-01-01T12:00:00Z'::timestamptz + (n%5)*interval '1 second',
      'Historical event '||n,$3::uuid from generate_series(1,12000)n`,[f.ids.sale,f.ids.replacement,f.ids.developer]);
  const input=[f.ids.sale,f.ids.replacement],rows=await f.compare('developer',input);
  assert.equal(rows.length,120);
  assert.deepEqual(rows,[...rows].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)));
  const expected=(await f.db.query(`select id from
    (select distinct on(sale_attempt_id,event_type) id,created_at from unit_sale_workflow_events
     order by sale_attempt_id,event_type,created_at desc,id desc)q order by created_at desc,id desc`)).rows.map(e=>e.id);
  assert.deepEqual(rows.map(e=>e.id),expected);
  for(let i=0;i<3;i++)assert.deepEqual(await f.compare('developer',[...input].reverse()),rows);
  assert.deepEqual(await f.compare('agent',input),[]);
});

test('real helper invocation counts fall without instrumentation wrappers or altered permissions', async t => {
  const f=await fixture(t);
  for(let i=0;i<12;i++)await event(f,{sale:i%2?f.ids.sale:f.ids.replacement,id:uuid(400+i)});
  async function counts(old) {
    await f.owner();await f.db.exec("begin;set local track_functions='all'");
    if(old)await f.db.exec(f.original.definition);
    const before = Object.fromEntries((await f.db.query("select funcname,calls from pg_stat_xact_user_functions where schemaname='public'")).rows.map(x=>[x.funcname,x.calls]));
    await f.as('agent');
    await f.db.query('select public.sale_workflow_context($1::uuid[])',[ [f.ids.sale,f.ids.replacement] ]);
    await f.owner();
    const rows=(await f.db.query("select funcname,calls from pg_stat_xact_user_functions where schemaname='public' and funcname in ('can_access_sale_attempt','sale_event_projection')")).rows;
    await f.db.exec('rollback');
    return Object.fromEntries(rows.map(x=>[x.funcname,x.calls-(before[x.funcname]??0)]));
  }
  assert.deepEqual(await counts(true),{can_access_sale_attempt:12,sale_event_projection:24});
  assert.deepEqual(await counts(false),{can_access_sale_attempt:2,sale_event_projection:12});
});

test('authority request, revocation, renewal and reissue histories retain complete context and Sales calculations', async t => {
  const f=await fixture(t,{legal:true});
  const {exchangeAuthorityState}=loadTypescriptModule('src/lib/sales/authority-state.ts');
  await f.action('agent','request_authority');const one=await f.sent(await f.prepare());
  await f.action('developer','revoke_authority',{emailId:one.id,reason:'Revised terms'});
  await f.action('solicitor','request_authority');
  for(const who of ['developer','agent','solicitor'])assert.ok((await f.compare(who)).some(e=>e.event_type==='authority_revoked'));
  await f.owner();
  const revoked=(await f.db.query('select to_jsonb(e) data from sale_legal_emails e where id=$1',[one.id])).rows[0].data;
  const two=await f.sent(await f.prepare());
  const rows=await f.compare('solicitor');
  assert.ok(rows.some(e=>e.event_type==='authority_reissued'));
  await f.owner();
  const emails=(await f.db.query('select * from sale_legal_emails order by version')).rows;
  const normalised=JSON.parse(JSON.stringify(emails));
  const state=exchangeAuthorityState(normalised,rows,null,false,Date.now());
  assert.equal(state.current.id,two.id);assert.equal(state.issued,true);assert.equal(state.pending,false);
  assert.ok(emails[0].revoked_at);
  assert.deepEqual((await f.db.query('select to_jsonb(e) data from sale_legal_emails e where id=$1',[one.id])).rows[0].data,revoked);
  await f.db.query('delete from user_building_access where user_id=$1',[f.ids.solicitor]);
  assert.deepEqual(await f.compare('solicitor'),[]);
});

test('real completion package queries, replacements and approvals retain full metadata and version context', async t => {
  const f=await fixture(t,{legal:true}),today=new Date().toISOString().slice(0,10);
  await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:today});
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));
  await f.notice({noticeDate:today,dueDate:today});
  await f.uploadFiles();const pair=await f.packageVersions();
  await f.action('developer','query_completion_document',{documentType:'completion_statement',versionId:pair.statementVersionId,reason:'Saved query'});
  for(const who of ['developer','agent','solicitor']) {
    const rows=await f.compare(who),query=rows.find(e=>e.event_type==='completion_documents_query_raised');
    assert.equal(query.version_id,pair.statementVersionId);assert.equal(query.metadata.queryNote,'Saved query');
  }
  const replacement=await f.upload();
  await f.action('developer','approve_completion_document',{documentType:'completion_statement',versionId:replacement});
  for(const who of ['developer','agent','solicitor']) {
    const rows=await f.compare(who);
    assert.equal(rows.find(e=>e.event_type==='completion_documents_approved').version_id,replacement);
    assert.equal(rows.find(e=>e.event_type==='completion_documents_query_raised').version_id,pair.statementVersionId);
  }
});
