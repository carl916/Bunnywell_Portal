import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';

const today=()=>new Date().toISOString().slice(0,10);
async function ready(t,options) {
  const f=await legalDatabase(options);t.after(()=>f.db.close());
  await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:today()});
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));await f.notice({noticeDate:today(),dueDate:today()});
  return f;
}
async function context(f) {await f.service();return f.rpc('sales_completion_package_context',{p_sale:f.ids.sale,p_actor:f.ids.developer});}

const review=(f,type,versionId,reason)=>f.action('developer',reason?'query_completion_document':'approve_completion_document',{documentType:type,versionId,reason});
async function docs(f){await f.service();return (await f.db.query("select * from unit_sale_documents where document_type in ('completion_statement','draft_statement_of_account') order by document_type")).rows;}

test('A/E: each exact version is approved independently, locks immediately and gates legal completion',async t=>{
  const f=await ready(t),statement=await f.upload(),account=await f.upload('draft_statement_of_account');
  for(const role of ['solicitor','agent','outsider'])await assert.rejects(f.action(role,'approve_completion_document',{documentType:'completion_statement',versionId:statement}),/role|denied/);
  for(const action of ['approve_statement','query_statement','approve_completion_package','query_completion_package'])await assert.rejects(f.action('developer',action,await f.packageVersions()),/separately/);
  assert.equal((await review(f,'draft_statement_of_account',account)).approved,false);
  const approved=(await docs(f))[1];assert.equal(approved.status,'approved');assert.equal(approved.approved_version_id,account);assert.equal(approved.approved_by_user_id,f.ids.developer);assert.ok(approved.approved_at);
  assert.equal((await docs(f))[0].status,'uploaded');
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
  await assert.rejects(f.upload('draft_statement_of_account'),/locked/);
  await assert.rejects(review(f,'draft_statement_of_account',account,'Change balance'),/locked/);
  assert.equal((await review(f,'completion_statement',statement)).approved,true);
  await review(f,'completion_statement',statement);assert.equal((await context(f)).approved,true);
  await assert.rejects(f.upload(),/locked/);
  await f.service();const events=(await f.db.query("select * from unit_sale_workflow_events where event_type='completion_documents_approved'")).rows;
  assert.equal(events.length,2);for(const event of events){assert.ok(event.metadata.versionId);assert.ok(event.actor_name);assert.equal(event.created_by_user_id,f.ids.developer);assert.ok(event.created_at);}
  await assert.rejects(f.db.query("update unit_sale_workflow_events set summary='changed' where event_type='completion_documents_approved'"),/immutable/);
  await f.action('solicitor','confirm_completion',{dateTime:new Date(Date.now()-1000).toISOString()});
  await f.service();assert.equal((await f.db.query('select sale_status from units where id=$1',[f.ids.unit])).rows[0].sale_status,'completed');
  await f.upload('statement_of_account');await assert.rejects(f.uploadFiles(),/awaiting completion/);
});

test('B/C/D/F: queries stay on their version, replacements need no query, other approval is unchanged',async t=>{
  const f=await ready(t);await f.uploadFiles();const pair=await f.packageVersions();
  await review(f,'completion_statement',pair.statementVersionId,'Missing service charge');
  await review(f,'completion_statement',pair.statementVersionId,'Missing service charge');
  assert.deepEqual((await docs(f)).map(d=>d.status),['query_raised','uploaded']);
  await review(f,'draft_statement_of_account',pair.accountVersionId);const approved=(await docs(f))[1];
  const replacement=await f.upload();let documents=await docs(f);
  assert.equal(documents[0].query_note,null);assert.equal(documents[0].status,'uploaded');assert.deepEqual(documents[1],approved);
  await assert.rejects(review(f,'completion_statement',pair.statementVersionId),/document changed/);
  await assert.rejects(review(f,'completion_statement',pair.statementVersionId,'Stale query'),/document changed/);
  const pendingReplacement=await f.upload();assert.notEqual(pendingReplacement,replacement);assert.deepEqual((await docs(f))[1],approved);
  await review(f,'completion_statement',pendingReplacement,'Another question');assert.deepEqual((await docs(f))[1],approved);
  const latest=await f.upload();await f.service();const queries=(await f.db.query("select * from unit_sale_workflow_events where event_type='completion_documents_query_raised' order by created_at")).rows;
  assert.equal(queries.length,2);assert.equal(queries[0].metadata.versionId,pair.statementVersionId);assert.equal(queries[0].metadata.queryNote,'Missing service charge');assert.equal(queries[0].created_by_user_id,f.ids.developer);assert.ok(queries[0].actor_name);assert.ok(queries[0].created_at);
  const versions=(await f.db.query('select * from unit_sale_document_versions where document_id=$1 order by version_number',[documents[0].id])).rows;
  assert.equal(versions.length,4);assert.equal(versions.filter(v=>v.is_current).length,1);assert.equal(versions.at(-1).id,latest);
  await assert.rejects(f.db.query('update unit_sale_document_versions set file_name=$1 where id=$2',['changed.pdf',pair.statementVersionId]),/immutable/);
  assert.equal((await context(f)).approved,false);await review(f,'completion_statement',latest);assert.equal((await context(f)).approved,true);
});

test('a current document can be reviewed before the other slot is uploaded; invalid and foreign references fail',async t=>{
  const f=await ready(t),statement=await f.upload();
  for(const body of [{documentType:'statement_of_account',versionId:statement},{documentType:'completion_statement',versionId:crypto.randomUUID()}])await assert.rejects(f.action('developer','approve_completion_document',body),/document changed/);
  await assert.rejects(f.action('developer','query_completion_document',{documentType:'completion_statement',versionId:statement,reason:' '}),/reason/);
  assert.equal((await review(f,'completion_statement',statement)).approved,false);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
});

test('batch upload rolls back both documents on failure, is idempotent, and rejects stale replacement and role bypass',async t=>{
  const f=await ready(t);const request=crypto.randomUUID();
  const files=['completion_statement','draft_statement_of_account'].map(type=>({type,expectedVersionId:null,path:f.ids.building+'/'+f.ids.sale+'/'+type+'.pdf',name:type+'.pdf',size:100,mime:'application/pdf'}));
  const submit=async(payload={})=>{await f.service('solicitor');return f.rpc('sales_completion_upload',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_request:request,p_files:files,...payload});};
  await assert.rejects(submit({p_files:[files[0],{...files[1],size:0}]}),/PDF/);
  await f.service();assert.equal((await f.db.query("select count(*)::int n from unit_sale_documents where document_type in ('completion_statement','draft_statement_of_account')")).rows[0].n,0);
  for(const p_files of [[],[files[0],files[0]],[{...files[0],type:''}],[...files,files[0]]])await assert.rejects(submit({p_files}),/Select|Assign/);
  for(const role of ['developer','agent'])await assert.rejects(submit({p_actor:f.ids[role]}),/access denied|role/);
  const saved=await submit();assert.equal(saved.length,2);assert.deepEqual((await submit()).sort((a,b)=>a.type.localeCompare(b.type)),saved.sort((a,b)=>a.type.localeCompare(b.type)));
  await f.as('agent');const activity=await f.rpc('sale_activity_page',{p_sale:f.ids.sale});
  for(const [type,title] of [['completion_statement_uploaded','Draft completion statement uploaded: completion_statement.pdf'],['completion_draft_statement_of_account_uploaded','Draft statement of account uploaded: draft_statement_of_account.pdf']]) {
    const event=activity.find(item=>item.event_type===type);assert.equal(event.summary,title);assert.ok(event.metadata.versionId);assert.equal(event.created_by_user_id,f.ids.solicitor);
  }
  await assert.rejects(submit({p_request:crypto.randomUUID()}),/current document changed/);
  await f.as('solicitor');await assert.rejects(f.rpc('sales_completion_upload',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_request:request,p_files:files}),/permission denied/);
  await f.service();await assert.rejects(f.rpc('sales_legal_register_document_before_package',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_type:'completion_statement',p_file:{}}),/permission denied/);
});

test('migration retains old single-file approval without inventing a draft account or package approval',async t=>{
  let oldVersion;
  const f=await legalDatabase({beforePackage:async base=>{
    await base.owner();await base.db.query("select set_config('app.sales_legal_write','on',true)");
    // Use one transaction so the existing legal guard sees the migration write flag.
    await base.db.exec('begin');await base.db.query("select set_config('app.sales_legal_write','on',true)");
    await base.db.query("update unit_sale_attempts set exchanged_at=current_date,completion_legacy_stage='arrangements',workflow_status='exchanged' where id=$1",[base.ids.sale]);
    await base.db.exec('commit');
    await base.db.query("select set_config('request.jwt.claim.role','service_role',false)");
    oldVersion=await base.rpc('sales_legal_register_document',{p_sale:base.ids.sale,p_actor:base.ids.solicitor,p_type:'completion_statement',p_file:{path:'legacy.pdf',name:'legacy.pdf',size:100}});
    await base.rpc('sales_legal_action',{p_sale:base.ids.sale,p_actor:base.ids.developer,p_action:'approve_statement',p_payload:{versionId:oldVersion}});
  }});t.after(()=>f.db.close());
  assert.equal((await context(f)).approved,false);await f.service();
  assert.equal((await f.db.query("select approved_version_id from unit_sale_documents where document_type='completion_statement'")).rows[0].approved_version_id,oldVersion);
  assert.equal((await f.db.query("select count(*)::int n from unit_sale_documents where document_type='draft_statement_of_account'")).rows[0].n,0);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
  const historical=(await f.db.query('select workflow_status,completed_at from unit_sale_attempts where id=$1',[f.ids.replacement])).rows[0];assert.equal(historical.workflow_status,'completed');assert.ok(historical.completed_at);
});
