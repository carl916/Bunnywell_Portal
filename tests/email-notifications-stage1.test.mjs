import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { discussionDatabase, ids } from './helpers/discussion-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const app = '.';
const migration = fs.readFileSync('supabase/migrations/20261119164807_email_notifications_stage1.sql', 'utf8');
const { selectEmailNotificationRecipients: select } = loadTypescriptModule(app + '/src/lib/workspace/email-notifications.ts');

test('notification settings and selection against PostgreSQL access rules', async t => {
  const f = await discussionDatabase(); t.after(() => f.db.close());
  await f.owner();
  await f.db.exec(`
    create schema workspace_commands;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create schema portal_audit;
    create function portal_audit.actor() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
    begin
      if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor
        or not exists(select 1 from profiles where id=p_actor and active and role in ('admin','developer'))
      then raise exception 'Verified Setup administrator required.' using errcode='42501'; end if;
    end $$;
    create table workspace_commands.operation_receipts(id uuid primary key,actor_id uuid,action text,target_id uuid,input jsonb,result jsonb);
    alter table audit_events add column category text,add column action_id uuid,add column source text,add column outcome text;
    alter table unit_sale_attempts add column redacted_at timestamptz;
    update profiles set email='fixture-'||id||'@example.invalid';
  `);
  await f.db.exec(migration);
  const service = async (actor = ids.developer) => {
    await f.owner();
    await f.db.query("select set_config('request.jwt.claims',$1,false),set_config('test.actor',$2,false)", [JSON.stringify({ role: 'service_role' }), actor]);
    await f.db.exec('set role service_role');
  };
  const read = () => f.rpc('workspace_email_notification_settings', { p_actor: ids.developer });
  const save = (payload, requestId = crypto.randomUUID(), actor = ids.developer) => f.rpc('workspace_save_email_notifications', { p_actor: actor, p_request: requestId, p_payload: payload });
  const context = (saleId = ids.sale, commentId = null) => f.rpc('workspace_email_notification_context', { p_sale: saleId, p_comment: commentId });
  await service();
  let settings = await read();

  await t.test('all 16 role defaults and independent mentions default', () => {
    assert.equal(settings.events.length, 17); assert.equal(settings.version, 0);
    const expected = {
      reservation_submitted: ['developer'], reservation_queried: ['sales_agent'], notice_authority_requested: ['developer'],
      completion_documents_uploaded: ['developer'], completion_document_queried: ['conveyancer'], completion_documents_approved: ['conveyancer'], comment_added: [],
    };
    for (const event of settings.events.filter(e => e.kind === 'roles')) assert.deepEqual(event.roles, expected[event.id] ?? ['developer','sales_agent','conveyancer']);
    assert.equal(settings.events.find(e => e.id === 'comment_mentioned').enabled, true);
  });
  const empty = { expectedVersion: 0, roles: { reservation_approved: [] }, mentionsEnabled: true }, requestId = crypto.randomUUID();
  await t.test('empty selection persists; retry is idempotent and audited once', async () => {
    settings = await save(empty, requestId); assert.equal(settings.version, 1);
    assert.deepEqual((await read()).events.find(e => e.id === 'reservation_approved').roles, []);
    assert.deepEqual(await save(empty, requestId), settings);
    await f.owner(); assert.equal((await f.db.query('select count(*)::int n from audit_events')).rows[0].n, 1); await service();
    assert.deepEqual(select(await context(), 'reservation_approved'), []);
  });
  await t.test('stale writes, conflicting retries, malformed roles and unknown events fail atomically', async () => {
    await assert.rejects(save(empty), /changed/);
    await assert.rejects(save({ ...empty, mentionsEnabled: false }, requestId), /conflicts/);
    for (const roles of [{ unknown: [] }, { comment_added: ['admin'] }, { comment_added: null }, { comment_added: ['developer','developer'] }]) {
      await assert.rejects(save({ ...empty, expectedVersion: 1, roles }), /Unknown|invalid|valid/);
    }
    assert.equal((await read()).version, 1);
  });
  await t.test('future events inherit defaults while saved empty and existing rows survive older-client saves', async () => {
    await f.owner();
    const before = (await f.db.query('select pg_get_functiondef(\'workspace_commands.email_notification_catalogue()\'::regprocedure) def')).rows[0].def;
    await f.db.exec(before.replace("\n ]'::jsonb", ",\n {\"id\":\"future_event\",\"label\":\"Future event\",\"kind\":\"roles\",\"roles\":[\"sales_agent\"]}\n ]'::jsonb"));
    await service();
    assert.deepEqual((await read()).events.find(e => e.id === 'future_event').roles, ['sales_agent']);
    settings = await save({ expectedVersion: 1, roles: { future_event: [] }, mentionsEnabled: true });
    settings = await save({ expectedVersion: settings.version, roles: { comment_added: [] }, mentionsEnabled: true });
    assert.deepEqual(settings.events.find(e => e.id === 'future_event').roles, []);
    assert.deepEqual(settings.events.find(e => e.id === 'reservation_approved').roles, []);
    await f.owner(); await f.db.exec(before); await service();
  });
  await t.test('non-admin actors and forged actor headers cannot read or save settings', async () => {
    await service(ids.agent);
    await assert.rejects(read(), /administrator/);
    await assert.rejects(save({ expectedVersion: settings.version, roles: {}, mentionsEnabled: false }, crypto.randomUUID(), ids.agent), /administrator/);
    await service();
  });
  await t.test('browser roles cannot call service RPCs or access the private settings table', async () => {
    for (const role of ['anon','authenticated']) {
      await f.owner(); await f.db.exec('set role ' + role);
      await assert.rejects(read(), /permission denied/);
      await assert.rejects(save(empty), /permission denied/);
      await assert.rejects(context(), /permission denied/);
      await assert.rejects(f.db.exec('select * from workspace_commands.email_notification_settings'), /permission denied/);
    }
    await service();
  });
  const building2 = crypto.randomUUID(), unit2 = crypto.randomUUID(), sale2 = crypto.randomUUID();
  await t.test('one configuration spans buildings but agent eligibility stays scoped', async () => {
    await f.owner();
    await f.db.query('insert into buildings values($1,$2)', [building2, 'Other Building']);
    await f.db.query('insert into units values($1,$2,$3,$4)', [unit2,building2,'1','for_sale']);
    await f.db.query('insert into unit_sale_attempts(id,building_id,unit_id) values($1,$2,$3)', [sale2,building2,unit2]);
    await f.db.query('delete from user_building_access where user_id=$1', [ids.revoked]);
    await service();
    const a = await context(), b = await context(sale2);
    assert.deepEqual(a.settings, b.settings);
    assert(select(a, 'unit_exchanged').some(r => r.userId === ids.agent));
    assert(!select(b, 'unit_exchanged').some(r => r.userId === ids.agent));
    assert(!select(a, 'unit_exchanged').some(r => r.userId === ids.revoked));
  });
  let comment;
  await t.test('mentions work with ordinary comment emails off and preserve comment identity', async () => {
    await f.as('developer'); comment = await f.write('Notification fixture', { p_mentions: [ids.agent] });
    await service();
    const facts = await context(ids.sale, comment), recipients = select(facts, 'comment_added');
    assert.equal(recipients.length, 1); assert.equal(recipients[0].userId, ids.agent);
    assert.equal(recipients[0].commentId, comment); assert.deepEqual(recipients[0].eventIds, ['comment_mentioned']);
    assert.deepEqual(select(facts, 'comment_mentioned'), recipients);
    await assert.rejects(context(sale2, comment), /Comment unavailable/);
  });
  await t.test('roles and mentions overlap once; multi-role and duplicate candidate facts deduplicate by user', async () => {
    settings = await save({ expectedVersion: settings.version, roles: { comment_added: ['developer','sales_agent','conveyancer'] }, mentionsEnabled: true });
    const facts = await context(ids.sale, comment);
    const candidate = facts.candidates.find(c => c.userId === ids.agent);
    candidate.roles = ['developer','sales_agent','conveyancer']; facts.candidates.push({ ...candidate });
    const recipient = select(facts, 'comment_added').filter(r => r.userId === ids.agent);
    assert.equal(recipient.length, 1); assert.deepEqual(recipient[0].eventIds, ['comment_added','comment_mentioned']);
    assert.deepEqual(recipient[0].reasons, ['role','mention']);
  });
  await t.test('comment visibility and changed sale access suppress ordinary and mention recipients', async () => {
    const facts = await context(ids.sale, comment);
    facts.candidates.find(c => c.userId === ids.agent).canViewComment = false;
    assert(!select(facts, 'comment_added').some(r => r.userId === ids.agent));
    assert(!select(facts, 'comment_mentioned').some(r => r.userId === ids.agent));
    await f.owner(); await f.db.query('delete from user_building_access where user_id=$1', [ids.agent]); await service();
    assert(!select(await context(ids.sale, comment), 'comment_added').some(r => r.userId === ids.agent));
  });
  await t.test('disabled mentions are independent of ordinary role notifications', async () => {
    settings = await save({ expectedVersion: settings.version, roles: { comment_added: ['developer'] }, mentionsEnabled: false });
    assert.deepEqual(select(await context(ids.sale, comment), 'comment_mentioned'), []);
    assert(select(await context(ids.sale, comment), 'comment_added').some(r => r.userId === ids.developer));
  });
  await t.test('inactive users, redacted sales and invalid event/comment combinations fail closed', async () => {
    await f.owner(); await f.db.query('update profiles set active=false where id=$1', [ids.solicitor]); await service();
    assert(!select(await context(), 'unit_exchanged').some(r => r.userId === ids.solicitor));
    assert.throws(() => select({ settings, candidates: [], saleId: ids.sale, commentId: null }, 'comment_added'), /comment is required/);
    assert.throws(() => select({ settings, candidates: [], saleId: ids.sale, commentId: comment }, 'unit_exchanged'), /does not accept/);
    assert.throws(() => select({ settings, candidates: [], saleId: ids.sale, commentId: null }, 'unknown'), /Unknown/);
    await f.owner(); await f.db.query('update unit_sale_attempts set redacted_at=now() where id=$1', [sale2]); await service();
    await assert.rejects(context(sale2), /Sale unavailable/);
  });
});
