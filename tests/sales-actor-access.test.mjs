import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discussionDatabase, ids } from './helpers/discussion-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { historicalActorLabel, workflowActorLabel } = loadTypescriptModule('src/lib/sales/actor-identity.ts');

test('one building rule opens every sale and its comments without assignments', async (t) => {
  // Exercise upgrading directly from the original assignment model too.
  const f = await discussionDatabase({}, { includeBuildingAgentsMigration: false });
  t.after(() => f.db.close());
  await f.owner();
  await f.db.exec('delete from sale_participants');
  await f.db.query("update unit_sale_attempts set is_active=false,workflow_status='completed' where id=$1", [ids.replacement]);
  const building = crypto.randomUUID(), unit = crypto.randomUUID(), sale = crypto.randomUUID();
  await f.db.query("insert into buildings values($1,'Inaccessible building')", [building]);
  await f.db.query("insert into units values($1,$2,'201','for_sale')", [unit,building]);
  await f.db.query('insert into unit_sale_attempts(id,building_id,unit_id,created_by_user_id) values($1,$2,$3,$4)', [sale,building,unit,ids.revoked]);
  for (const actor of ['agent','solicitor']) {
    await f.as(actor);
    assert.deepEqual(new Set((await f.db.query('select id from unit_sale_attempts')).rows.map(r => r.id)), new Set([ids.sale,ids.replacement]));
    for (const p_sale of [ids.sale,ids.replacement]) {
      assert.equal(await f.rpc('can_access_sale_attempt', { target_sale_attempt_id: p_sale }), true);
      assert.equal(await f.rpc('can_discuss_sale', { p_sale }), true);
      await f.write(`Building-wide ${actor}`, { p_sale });
      assert.ok((await f.rpc('sale_comment_page', { p_sale })).comments.length);
    }
    assert.equal(await f.rpc('can_access_sale_attempt', { target_sale_attempt_id: sale }), false);
    await assert.rejects(f.write('Denied', { p_sale: sale }), /Sale access denied/);
    await assert.rejects(f.rpc('sale_comment_page', { p_sale: sale }), /Sale access denied/);
    assert.deepEqual(await f.rpc('sale_actor_names', { p_sales: [sale] }), []);
    for (const [fn,args] of [
      ['can_access_sale',{p_sale_id:sale,p_user_id:ids.developer}],
      ['sales_building_access',{p_building:building,p_user:ids.developer}],
      ['sale_discussion_candidate',{p_sale:sale,p_user:ids.developer}],
    ]) await assert.rejects(f.rpc(fn,args), /permission denied/);
  }
  await f.owner();
  assert.equal((await f.db.query('select count(*)::int n from sale_participants')).rows[0].n, 0);
  // Stale assignment rows cannot grant access or revoke current building access.
  await f.db.query('insert into sale_participants(sale_attempt_id,user_id,revoked_at) values($1,$2,now()),($3,$2,null)', [ids.sale,ids.agent,sale]);
  await f.as('agent');
  assert.equal(await f.rpc('can_discuss_sale', { p_sale: ids.sale }), true);
  assert.equal(await f.rpc('can_discuss_sale', { p_sale: sale }), false);
  await f.owner();
  await f.db.query("update profiles set role='user' where id=$1", [ids.agent]);
  await f.as('agent');
  assert.deepEqual((await f.db.query('select * from unit_sale_attempts')).rows, []);
  await assert.rejects(f.write('Wrong role'), /Sale access denied/);
  await f.as('developer');
  assert.equal(await f.rpc('can_discuss_sale', { p_sale: sale }), true);
  // The final migration can be rerun without removing audit data.
  await f.owner();
  await f.db.exec(readFileSync('supabase/migrations/20260908b_sale_actor_names.sql','utf8'));
  assert.equal((await f.db.query('select count(*)::int n from sale_comments')).rows[0].n, 4);
});

test('historical actors resolve through stored IDs with minimal output and record visibility', async (t) => {
  const f = await discussionDatabase(); t.after(() => f.db.close());
  const actor = Object.fromEntries(['approver','completer','uploader','commenter','hidden','unrelated','blank','payer','note'].map(k => [k,crypto.randomUUID()]));
  await f.owner();
  for (const [key,id] of Object.entries(actor)) {
    await f.db.query("insert into profiles(id,full_name,name,email,role) values($1,$2,$3,'private@example.test','developer')", [id,`  ${key} Full Name  `,`${key} Name`]);
  }
  await f.as(actor.commenter); await f.write('Historical comment');
  await f.owner();
  await f.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,created_by_user_id) values($1,'completion_documents_approved',$2),($1,'completion_recorded',$3)", [ids.sale,actor.approver,actor.completer]);
  // Legacy events have an ID but no snapshot; new events must retain old roles.
  await f.db.query("update unit_sale_workflow_events set actor_name=null,actor_role=null where event_type='completion_recorded'");
  const document = crypto.randomUUID();
  await f.db.query("insert into unit_sale_documents(id,sale_attempt_id,document_type,approved_by_user_id) values($1,$2,'legacy_attachment',$3)", [document,ids.sale,actor.approver]);
  await f.db.query("insert into unit_sale_document_versions(document_id,version_number,uploaded_by_user_id) values($1,1,$2)", [document,actor.uploader]);
  await f.db.query("insert into unit_sale_documents(sale_attempt_id,visibility,created_by_user_id) values($1,'internal_only',$2)", [ids.sale,actor.hidden]);
  await f.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,created_by_user_id,metadata) values($1,'commercial_model_saved',$2,'{}'),($1,'exchange_recorded',null,$3)", [ids.sale,actor.hidden,JSON.stringify({actor_id:actor.unrelated,created_by_user_id:actor.unrelated})]);
  await f.db.query('update unit_sale_attempts set updated_by_user_id=$1 where id=$2', [actor.unrelated,ids.replacement]);
  await f.db.query("insert into unit_sale_invoices(sale_attempt_id,approved_by_user_id) values($1,$2)", [ids.sale,actor.blank]);
  await f.db.query("insert into unit_sale_invoice_payments(sale_attempt_id,recorded_by_user_id,voided_by_user_id) values($1,$2,$2)", [ids.sale,actor.payer]);
  await f.db.query("insert into unit_sale_notes(sale_attempt_id,created_by_user_id) values($1,$2)", [ids.sale,actor.note]);
  await f.db.query("update profiles set full_name='   ' where id=$1", [actor.completer]);
  await f.db.query("update profiles set full_name='',name=' ' where id=$1", [actor.blank]);
  await f.db.query("update profiles set active=false,role='user' where id=any($1::uuid[])", [Object.values(actor)]);
  await f.db.query('delete from user_building_access where user_id=any($1::uuid[])', [Object.values(actor)]);
  for (const viewer of ['agent','solicitor']) {
    await f.as(viewer);
    assert.equal((await f.db.query('select id from profiles')).rows.length, 1, 'profile RLS still hides historical actors');
    const names = await f.rpc('sale_actor_names', { p_sales: [ids.sale,ids.sale] });
    const byId = new Map(names.map(p => [p.id,p]));
    assert.equal(names.length, byId.size);
    assert.ok(names.every(p => Object.keys(p).sort().join() === 'display_name,id'));
    for (const key of ['approver','uploader','commenter','payer','note']) assert.equal(byId.get(actor[key]).display_name, `${key} Full Name`);
    assert.equal(byId.get(actor.completer).display_name, 'completer Name');
    assert.equal(byId.get(actor.blank).display_name, 'Unknown user');
    assert.equal(byId.has(actor.hidden), false, 'internal events and documents do not expose actors');
    assert.equal(byId.has(actor.unrelated), false, 'metadata and other sales cannot inject profile IDs');
    const events = await f.rpc('sale_workflow_context', { p_sales: [ids.sale] });
    const approved = events.find(e => e.event_type==='completion_documents_approved');
    assert.equal(workflowActorLabel(approved,names), 'approver Full Name');
    assert.equal(approved.actor_role,'developer', 'historical snapshot survives a role change');
    assert.equal(workflowActorLabel(events.find(e => e.event_type==='completion_recorded'),names), 'completer Name');
    assert.equal(workflowActorLabel(events.find(e => e.event_type==='exchange_recorded'),names), 'Unknown user');
    const comments = (await f.rpc('sale_comment_page',{p_sale:ids.sale})).comments;
    assert.equal(comments[0].author_role,'developer');
    assert.ok(comments[0].author_name.includes('commenter Full Name'));
    assert.deepEqual(await f.rpc('sale_actor_names', { p_sales: [actor.approver] }), [], 'profile IDs are not sale IDs');
    assert.deepEqual(await f.rpc('sale_actor_names', { p_sales: [] }), []);
    assert.deepEqual(await f.rpc('sale_actor_names', { p_sales: null }), []);
    await assert.rejects(f.rpc('sale_actor_names', { p_sales: Array(501).fill(ids.sale) }), /Too many sales/);
  }
  await f.as('developer');
  assert.ok((await f.rpc('sale_actor_names',{p_sales:[ids.sale]})).some(p=>p.id===actor.hidden));
  await f.owner(); await f.db.query('delete from user_building_access where user_id=$1',[ids.agent]);
  await f.as('agent'); assert.deepEqual(await f.rpc('sale_actor_names',{p_sales:[ids.sale]}),[]);
  await f.owner(); await f.db.exec('set role anon');
  await assert.rejects(f.rpc('sale_actor_names',{p_sales:[ids.sale]}),/permission denied/);
});

test('Completion labels use snapshots, resolved display names and document approval IDs, never the viewer', () => {
  const profiles = [{id:'approver',display_name:'A Real Approver'}, {id:'completer',display_name:'A Real Completer'}, {id:'viewer',full_name:'Current Viewer'}];
  assert.equal(workflowActorLabel({created_by_user_id:'approver'},profiles),'A Real Approver');
  assert.equal(workflowActorLabel({created_by_user_id:'completer'},profiles),'A Real Completer');
  assert.equal(workflowActorLabel(undefined,profiles,'approver'),'A Real Approver');
  assert.equal(workflowActorLabel({created_by_user_id:'approver',actor_name:' Name at the time '},profiles),'Name at the time');
  assert.equal(workflowActorLabel({created_by_user_id:'approver',actor_name:' '},profiles),'A Real Approver');
  assert.equal(workflowActorLabel({created_by_user_id:null,actor_name:'Unattributed name'},profiles),'Unknown user');
  assert.equal(workflowActorLabel(undefined,profiles),'Unknown user');
  assert.equal(workflowActorLabel({created_by_user_id:'missing'},profiles),'Unknown user');
  assert.equal(historicalActorLabel({userId:'a',profiles:[{id:'a',full_name:' ',name:' Fallback Name '}]}),'Fallback Name');
});

test('payment attribution uses the recorded organisation, never the current profile organisation', () => {
  const { paymentRecorderLabel } = loadTypescriptModule('src/components/portal/sales/SalesReservationWorkflow.tsx', { exports: ['paymentRecorderLabel'] });
  const profiles = [{ id:'actor',display_name:'Resolved Recorder',organisation_id:'new-organisation' }];
  const payment = { recorded_by_user_id:'actor',recorded_by_organisation_name:'Organisation at payment' };
  assert.equal(paymentRecorderLabel(payment,profiles),'Resolved Recorder (Organisation at payment)');
  assert.equal(paymentRecorderLabel({...payment,recorded_by_organisation_name:null},profiles),'Resolved Recorder');
  assert.equal(paymentRecorderLabel({...payment,recorded_by_name:'Recorded Name'},profiles),'Recorded Name (Organisation at payment)');
});
