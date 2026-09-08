import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionDatabase, ids } from './helpers/discussion-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { activityPresentation, mergeComments, discussionDraftKey } = loadTypescriptModule('src/lib/sales/discussion.ts');

test('discussion migration and permission, history, isolation and unread contracts in PostgreSQL', async (t) => {
  const f = await discussionDatabase(); t.after(() => f.db.close());
  let original;
  await t.test('building agents and building conveyancer share one sale; agents without building access are denied', async () => {
    for (const actor of ['agent','developer','solicitor','outsider']) { await f.as(actor); const id = await f.write(`Update from ${actor}`); original ??= id; assert.ok((await f.rpc('sale_comment_page', { p_sale: ids.sale })).comments.some((c) => c.id === id)); }
    await f.owner(); await f.db.query('delete from user_building_access where user_id=$1', [ids.revoked]);
    await f.as('revoked');
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.sale }), /not assigned/);
    await assert.rejects(f.write('intrusion'), /not assigned/);
    assert.deepEqual((await f.db.query('select * from sale_comments')).rows, []);
    await assert.rejects(f.rpc('sale_discussion_people', { p_sale: ids.sale }), /not assigned/);
  });
  await t.test('untouched organisation agents inherit access and lose it with building or account access', async () => {
    const agent = crypto.randomUUID(), org = crypto.randomUUID();
    await f.owner();
    await f.db.query("insert into organisations values($1,'Agency')", [org]);
    await f.db.query("insert into profiles(id,role,organisation_id) values($1,'sales_agent',$2)", [agent,org]);
    await f.db.query("insert into building_organisations values($1,$2,'sales_agent',true)", [ids.building,org]);
    await f.as(agent);
    assert.ok((await f.rpc('sale_comment_page', { p_sale: ids.sale })).comments.length > 0);
    assert.ok((await f.db.query('select * from sale_comments')).rows.length > 0);
    assert.ok((await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale] > 0);
    assert.ok((await f.rpc('sale_discussion_people', { p_sale: ids.sale })).some(p => p.id === agent));
    await f.rpc('sale_activity_page', { p_sale: ids.sale });
    await f.as('developer');
    await assert.rejects(f.rpc('sale_discussion_assign', { p_sale: ids.sale, p_user: agent, p_assigned: false }), /building permissions/);
    await f.owner();
    await f.db.query('update profiles set active=false where id=$1', [agent]);
    await f.as(agent);
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.sale }), /not assigned/);
    await f.owner();
    await f.db.query('update profiles set active=true where id=$1', [agent]);
    await f.db.query('update building_organisations set active=false where organisation_id=$1', [org]);
    await f.as(agent);
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.sale }), /not assigned/);
    assert.deepEqual((await f.db.query('select * from sale_comments')).rows, []);
  });
  await t.test('mentions are eligible user IDs; retries deduplicate both comment and notification', async () => {
    await f.as('agent'); const p_client = crypto.randomUUID();
    const args = { p_client, p_mentions: [ids.solicitor,ids.agent] };
    const first = await f.write('@Test solicitor please review', args);
    assert.equal(await f.write('@Test solicitor please review', args), first);
    await assert.rejects(f.write('Revised after a lost response', args), /already sent/);
    await assert.rejects(f.write('wrong recipient', { p_mentions: [ids.revoked] }), /no longer has access/);
    assert.deepEqual(await f.rpc('sale_mentions_inbox'), []);
    await f.as('solicitor'); assert.equal((await f.rpc('sale_mentions_inbox')).length, 1);
    await f.as('agent'); await f.rpc('sale_comment_write', { p_sale: ids.sale, p_body: '@Test solicitor please review again', p_client: crypto.randomUUID(), p_comment: first, p_version: 1, p_mentions: [ids.solicitor] });
    await f.as('solicitor'); assert.equal((await f.rpc('sale_mentions_inbox')).length, 1);
  });
  await t.test('same-sale replies, author-only edits, revision retention and optimistic edit conflicts', async () => {
    await f.as('agent'); const reply = await f.write('Follow-up', { p_parent: original });
    await f.rpc('sale_comment_write', { p_sale: ids.sale, p_comment: reply, p_version: 1, p_body: 'Edited follow-up', p_client: crypto.randomUUID() });
    assert.equal((await f.rpc('sale_comment_history', { p_sale: ids.sale, p_comment: reply }))[0].body, 'Follow-up');
    await assert.rejects(f.rpc('sale_comment_write', { p_sale: ids.sale, p_comment: reply, p_version: 1, p_body: 'Conflict', p_client: crypto.randomUUID() }), /another device/);
    await f.as('solicitor'); await assert.rejects(f.rpc('sale_comment_write', { p_sale: ids.sale, p_comment: reply, p_version: 2, p_body: 'Not mine', p_client: crypto.randomUUID() }), /Only the author/);
    await f.as('outsider'); await assert.rejects(f.write('Cross-sale reply', { p_sale: ids.replacement, p_parent: reply }), /Reply must refer/);
    assert.equal((await f.rpc('sale_comment_history', { p_sale: ids.sale, p_comment: reply })).length, 1);
  });
  await t.test('reads acknowledge only presented IDs; own comments excluded, edits do not increase unread', async () => {
    await f.as('developer'); const before = (await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale];
    const page = await f.rpc('sale_comment_page', { p_sale: ids.sale });
    assert.equal((await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale], before, 'fetching does not read');
    const unread = page.comments.filter((c) => c.unread);
    await f.rpc('sale_comment_read', { p_sale: ids.sale, p_comments: [unread.at(-1).id] });
    await f.rpc('sale_comment_read', { p_sale: ids.sale, p_comments: [unread[0].id] });
    assert.equal((await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale], before - 2);
    const state = (await f.db.query('select last_presented_sequence from sale_comment_read_state')).rows[0];
    assert.equal(Number(state.last_presented_sequence), unread.at(-1).sequence);
    await f.write('My own comment'); assert.equal((await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale], before - 2);
    await f.as('agent'); await f.rpc('sale_comment_write', { p_sale: ids.sale, p_comment: original, p_version: 1, p_body: 'Changed text', p_client: crypto.randomUUID() });
    await f.as('developer'); assert.equal((await f.rpc('sale_comment_unread', { p_sales: [ids.sale] }))[ids.sale], before - 2);
  });
  await t.test('server enforces limits and forbids raw mutation / audit payload access', async () => {
    await f.as('agent');
    for (const body of ['', '   ', '\n\t ', 'a'.repeat(5001), ' '.repeat(5001) + 'x']) await assert.rejects(f.write(body), /characters|check constraint/);
    await assert.rejects(f.db.query("update sale_comments set body='silent'"), /permission denied/);
    await assert.rejects(f.db.query('select * from unit_sale_workflow_events'), /permission denied/);
    await assert.rejects(f.rpc('sale_discussion_access', { p_sale: ids.sale, p_user: ids.developer }), /permission denied/);
  });
  await t.test('revocation blocks comments, history, mentions, notifications and direct RLS reads', async () => {
    await f.owner(); await f.db.query('delete from user_building_access where user_id=$1', [ids.solicitor]);
    await f.as('solicitor');
    for (const [fn, args] of [['sale_comment_page', { p_sale: ids.sale }], ['sale_comment_history', { p_sale: ids.sale, p_comment: original }], ['sale_comment_read', { p_sale: ids.sale, p_comments: [original] }], ['sale_discussion_people', { p_sale: ids.sale }], ['sale_activity_page', { p_sale: ids.sale }]]) await assert.rejects(f.rpc(fn, args), /not assigned/);
    assert.deepEqual(await f.rpc('sale_mentions_inbox'), []); assert.equal((await f.db.query('select * from sale_comments')).rows.length, 0);
    await f.as('agent'); await assert.rejects(f.write('stale mention', { p_mentions: [ids.solicitor] }), /no longer has access/);
    await assert.rejects(f.rpc('sale_comment_write', { p_sale: ids.sale, p_comment: original, p_version: 2, p_body: 'Invalid edited mention', p_client: crypto.randomUUID(), p_mentions: [ids.solicitor] }), /no longer has access/);
  });
  await t.test('replacement buyer has a new identity; draft discussion does not record a reservation', async () => {
    await f.owner(); await assert.rejects(f.db.query("update unit_sale_attempts set buyer_name='Replacement Buyer' where id=$1", [ids.sale]), /replacement buyer/);
    await f.db.query("update unit_sale_attempts set is_active=false,workflow_status='fallen_through' where id=$1", [ids.sale]);
    await f.as('outsider'); const sale = await f.rpc('sale_discussion_start', { p_unit: ids.unit });
    assert.notEqual(sale, ids.sale); assert.equal(await f.rpc('sale_discussion_start', { p_unit: ids.unit }), sale);
    assert.deepEqual((await f.rpc('sale_comment_page', { p_sale: sale })).comments, []);
    await f.write('Before reservation', { p_sale: sale });
    assert.ok((await f.rpc('sale_comment_page', { p_sale: ids.sale })).comments.length > 0);
    await f.owner(); const row = (await f.db.query('select workflow_status,is_system_baseline from unit_sale_attempts where id=$1', [sale])).rows[0];
    assert.equal(row.workflow_status, 'draft'); assert.equal(row.is_system_baseline, false);
    assert.equal((await f.db.query('select sale_status from units where id=$1', [ids.unit])).rows[0].sale_status, 'for_sale');
    assert.equal((await f.db.query('select count(*)::int count from unit_sale_workflow_events where sale_attempt_id=$1', [sale])).rows[0].count, 0);
    await f.as('agent'); assert.ok((await f.rpc('sale_comment_page', { p_sale: ids.sale })).comments.length > 0);
  });
  await t.test('stable pagination retains more than the initial history and validates deep links', async () => {
    await f.as('developer'); for (let i=0; i<65; i++) await f.write(`Page ${i}`);
    const page = await f.rpc('sale_comment_page', { p_sale: ids.sale, p_after: 0 });
    assert.equal(page.comments.length,50); assert.equal(page.hasAfter,true);
    const next = await f.rpc('sale_comment_page', { p_sale: ids.sale, p_after: page.comments.at(-1).sequence });
    assert.ok(next.comments.every((c) => c.sequence>page.comments.at(-1).sequence));
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.replacement, p_target: original }), /unavailable/);
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.sale, p_unit: ids.otherUnit }), /selected unit/);
  });
  await t.test('completed discussions remain open; building and account revocation still apply', async () => {
    await f.owner(); await f.db.query("update unit_sale_attempts set workflow_status='completed' where id=$1", [ids.sale]);
    await f.as('agent'); await f.write('Approved, exchanged and completed are discussion text only.');
    await f.owner(); await f.db.query('delete from user_building_access where user_id=$1', [ids.agent]);
    await f.as('agent'); await assert.rejects(f.write('no building access'), /not assigned/);
    await f.owner(); await f.db.query('update profiles set active=false where id=$1', [ids.developer]);
    await f.as('developer'); await assert.rejects(f.rpc('sale_comment_page', { p_sale: ids.sale }), /not assigned/);
  });
});

test('document triggers write distinct subjects and viewer-safe timeline projections', async (t) => {
  const f = await discussionDatabase(); t.after(() => f.db.close()); await f.owner();
  const documents=[];
  for (const type of ['completion_statement','statement_of_account']) {
    const id=crypto.randomUUID(); documents.push(id);
    await f.db.query('insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status,updated_by_user_id) values($1,$2,$3,$3,$4,$5)',[id,ids.sale,type,'uploaded',ids.developer]);
    await f.db.query('insert into unit_sale_document_versions(document_id,version_number,file_name,uploaded_by_user_id) values($1,1,$2,$3)',[id,`${type}.pdf`,ids.agent]);
  }
  await f.db.query("update unit_sale_documents set status='approved' where sale_attempt_id=$1",[ids.sale]);
  await f.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,summary,metadata) values($1,'commercial_model_saved','SECRET margin 12345','{\"developerMargin\":12345}'),($1,'completion_documents_approved','Completion statement and statement of account approved.','{}')",[ids.sale]);
  await f.as('agent'); const timeline=await f.rpc('sale_activity_page',{p_sale:ids.sale});
  assert.equal(timeline.length,5); assert.ok(!JSON.stringify(timeline).includes('SECRET')); assert.ok(!JSON.stringify(timeline).includes('developerMargin'));
  const approvals=timeline.filter((e)=>e.event_type==='completion_documents_approved');
  assert.deepEqual(new Set(approvals.map((e)=>activityPresentation(e).title)),new Set(['Completion statement approved','Statement of account approved','Completion statement and statement of account approved.']));
  assert.equal(approvals.filter((e)=>e.version_id).length,2);
  assert.ok(timeline.filter((e)=>e.metadata.fileName).every((e)=>e.metadata.versionNumber===1));
  await f.owner(); await f.db.query("update unit_sale_documents set status='query_raised',query_note='Correct totals' where id=$1",[documents[1]]);
  await f.as('agent'); const updated=await f.rpc('sale_activity_page',{p_sale:ids.sale});
  assert.ok(updated.some((e)=>activityPresentation(e).title==='Statement of account rejected' && e.metadata.queryNote==='Correct totals'));
  await f.owner(); await f.db.query('update unit_sale_document_versions set redacted_at=now() where document_id=$1',[documents[1]]);
  await f.as('agent'); assert.ok((await f.rpc('sale_activity_page',{p_sale:ids.sale})).filter((e)=>e.metadata.documentType==='statement_of_account').every((e)=>e.version_id===null));
  await f.owner(); await f.db.query("update unit_sale_documents set visibility='internal_only' where id=$1",[documents[0]]);
  await f.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,summary,metadata) values($1,'reservation_submitted','SECRET margin 12345','{\"developerMargin\":12345}')",[ids.sale]);
  await f.as('agent'); const safe=await f.rpc('sale_activity_page',{p_sale:ids.sale});
  assert.ok(!JSON.stringify(safe).includes('SECRET')); assert.ok(!safe.some((e)=>e.metadata.documentType==='completion_statement'));
});

test('client ordering, draft isolation and legacy presentation', () => {
  const current={id:'a',sequence:2,version:2,body:'new',unread:false};
  assert.equal(mergeComments([current],[{...current,version:1,body:'stale'}])[0].body,'new');
  assert.notEqual(discussionDraftKey('a','sale'),discussionDraftKey('b','sale'));
  assert.notEqual(discussionDraftKey('a','sale'),discussionDraftKey('a','replacement'));
  assert.equal(activityPresentation({event_type:'completion_documents_approved',summary:'Original historical wording',metadata:{}}).title,'Original historical wording');
});

test('document deep links recheck current discussion access, transaction and document visibility before signing', async () => {
  const { signedDocumentVersionUrl } = loadTypescriptModule('src/app/api/sales/reservations/route.ts', { exports: ['signedDocumentVersionUrl'] });
  for (const scenario of ['allowed','revoked','other_sale','internal_document']) {
    let signed = false;
    const client = {
      from(table) {
        const data = table === 'unit_sale_document_versions' ? { id:'version',document_id:'document',storage_bucket:'sale-documents',storage_path:'synthetic.pdf',file_name:'synthetic.pdf' }
          : table === 'unit_sale_documents' ? { id:'document',sale_attempt_id: scenario === 'other_sale' ? ids.replacement : ids.sale,visibility:scenario === 'internal_document'?'internal_only':'shared_sale_file' }
          : table === 'unit_sale_attempts' ? { id:ids.sale,building_id:ids.building }
          : table === 'user_building_access' ? [{building_id:ids.building}] : [];
        const q={ select(){return q;},eq(){return q;},neq(){return q;},maybeSingle(){return Promise.resolve({data,error:null});},then(resolve){return Promise.resolve({data,error:null}).then(resolve);} }; return q;
      },
      rpc: async()=>({data:scenario!=='revoked',error:null}),
      storage:{from:()=>({createSignedUrl:async()=>{signed=true;return {data:{signedUrl:'https://example.test/synthetic.pdf'},error:null};}})},
    };
    const call=signedDocumentVersionUrl(client,{id:ids.agent,role:'sales_agent',organisation_id:null},'version',ids.sale);
    if(scenario==='allowed'){assert.equal((await call).fileName,'synthetic.pdf');assert.ok(signed);}
    else {await assert.rejects(call,/access|belong/);assert.equal(signed,false);}
  }
});

test('sale actor names resolve historical staff for both external roles without exposing profiles', async (t) => {
  const f = await discussionDatabase(); t.after(() => f.db.close());
  await f.owner();
  await f.db.query("update profiles set active=false,email='private@example.test' where id=$1", [ids.developer]);
  await f.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,created_by_user_id) values($1,'completion_recorded',$2)", [ids.sale,ids.developer]);
  for (const actor of ['agent','solicitor']) {
    await f.as(actor);
    const names = await f.rpc('sale_actor_names', { p_sales: [ids.sale] });
    const developer = names.find(p => p.id === ids.developer);
    assert.equal(developer.full_name,'Test developer');
    assert.deepEqual(Object.keys(developer).sort(),['full_name','id','name','role']);
    assert.ok(!names.some(p => p.id === ids.outsider), 'unrelated sale actors stay hidden');
    await f.owner();
    await f.db.query('delete from user_building_access where user_id=$1', [ids[actor]]);
    await f.as(actor);
    assert.deepEqual(await f.rpc('sale_actor_names', { p_sales: [ids.sale] }), []);
  }
});
