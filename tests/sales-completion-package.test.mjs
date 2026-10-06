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

test('one or two files, atomic approval of exact versions, immutable replacement and legal completion gate',async t=>{
  const f=await ready(t);
  const statement=await f.upload();
  await assert.rejects(f.action('developer','approve_completion_package',await f.packageVersions()),/both completion documents/);
  await assert.rejects(f.action('developer','approve_statement',{versionId:statement}),/both current/);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
  const account=await f.upload('draft_statement_of_account');const pair=await f.packageVersions();
  await f.as('developer');await f.write('Both completion documents approved.');assert.equal((await context(f)).approved,false);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
  for(const role of ['solicitor','agent'])await assert.rejects(f.action(role,'approve_completion_package',pair),/role|access denied/);
  const approval=await f.action('developer','approve_completion_package',pair);assert.equal(approval.approved,true);
  assert.equal(approval.approval.statement_version_id,statement);assert.equal(approval.approval.account_version_id,account);assert.equal(approval.approval.approved_by,f.ids.developer);assert.ok(approval.approval.approved_at);
  assert.equal((await f.action('developer','approve_completion_package',pair)).approval.id,approval.approval.id);
  await f.service();assert.equal((await f.db.query('select sale_status from units where id=$1',[f.ids.unit])).rows[0].sale_status,'exchanged');
  const original=(await f.db.query('select * from unit_sale_document_versions where id=$1',[account])).rows[0];
  const replacement=await f.upload('draft_statement_of_account');assert.notEqual(replacement,account);assert.equal((await context(f)).approved,false);
  await assert.rejects(f.action('developer','approve_completion_package',pair),/documents changed/);
  await assert.rejects(f.action('solicitor','confirm_completion',{dateTime:new Date().toISOString()}),/both current/);
  await f.service();const retained=(await f.db.query('select * from unit_sale_document_versions where id=$1',[account])).rows[0];assert.deepEqual(retained,{...original,is_current:false});
  await assert.rejects(f.db.query('update unit_sale_document_versions set file_name=$1 where id=$2',['changed.pdf',account]),/immutable/);
  await assert.rejects(f.db.query('delete from unit_sale_document_versions where id=$1',[account]),/immutable/);
  await assert.rejects(f.db.query("update unit_sale_workflow_events set summary='changed' where event_type='completion_draft_statement_of_account_uploaded'"),/immutable/);
  await assert.rejects(f.db.query('update sale_completion_package_approvals set approved_at=now()'),/immutable|permission denied/);
  const renewed=await f.action('developer','approve_completion_package',await f.packageVersions());assert.notEqual(renewed.approval.id,approval.approval.id);
  await f.action('solicitor','confirm_completion',{dateTime:new Date(Date.now()-1000).toISOString()});
  await f.service();assert.equal((await f.db.query('select sale_status from units where id=$1',[f.ids.unit])).rows[0].sale_status,'completed');
  assert.equal((await f.db.query("select count(*)::int n from unit_sale_workflow_events where event_type='completion_documents_approved'")).rows[0].n,2);
  await f.upload('statement_of_account');await assert.rejects(f.uploadFiles(),/awaiting completion/);
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

test('queries identify each affected file and actor, invalidate package approval and survive replacements in activity',async t=>{
  const f=await ready(t);await f.uploadFiles();const pair=await f.packageVersions();
  await f.action('developer','approve_completion_package',pair);
  for(const bad of [{documentTypes:[],reason:'Why'},{documentTypes:['completion_statement'],reason:' '},{documentTypes:['statement_of_account'],reason:'Why'}])await assert.rejects(f.action('developer','query_completion_package',{...pair,...bad}),/affected|draft/);
  await f.action('developer','query_completion_package',{...pair,documentTypes:['completion_statement','draft_statement_of_account'],reason:'Correct balances'});assert.equal((await context(f)).approved,false);
  await f.service();const queries=(await f.db.query("select * from unit_sale_workflow_events where event_type='completion_documents_query_raised'")).rows;assert.equal(queries.length,2);
  for(const query of queries){assert.equal(query.created_by_user_id,f.ids.developer);assert.ok(query.actor_name);assert.ok(query.created_at);assert.equal(query.metadata.queryNote,'Correct balances');assert.ok(query.metadata.fileName);assert.ok(query.metadata.versionId);}
  await f.upload('completion_statement');assert.equal((await context(f)).approved,false);
  await f.service();assert.equal((await f.db.query("select status from unit_sale_documents where document_type='draft_statement_of_account'")).rows[0].status,'query_raised');
  await f.as('agent');const activity=await f.rpc('sale_activity_page',{p_sale:f.ids.sale});assert.equal(activity.filter(event=>event.event_type==='completion_documents_query_raised').length,2);
  await f.action('developer','approve_completion_package',await f.packageVersions());assert.equal((await context(f)).approved,true);
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
