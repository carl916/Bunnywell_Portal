import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { stage3Database } from './helpers/notification-stage3-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { selectEmailNotificationRecipients: select } =
  loadTypescriptModule('src/lib/workspace/email-notifications.ts');
const { eligibleNotificationItems: eligible, renderNotificationEmail: render } =
  loadTypescriptModule('src/lib/workspace/notification-email.ts');
const { redirectStagingEmail, submitStagingEmail } = loadTypescriptModule('src/lib/workspace/staging-email.ts');
const migration = name => readFileSync(globSync(`supabase/migrations/*_${name}.sql`)[0], 'utf8');

async function applyImmediateSales(f) {
  await f.db.exec(`
    alter table workspace_commands.notification_events add column details jsonb;
    alter table public.unit_sale_workflow_events add column if not exists actor_name text;
  `);
  await f.db.exec(migration('immediate_sales_notifications'));
}

async function capture(f, worker) {
  const result = [];
  for (let event; (event = await f.worker(worker, 'next_event'));) {
    const recipients = select(event.audience, event.event_id).map(r => r.userId);
    const payload = { eventId: event.id, recipientIds: recipients };
    await f.worker(worker, 'fanout', payload);
    await f.worker(worker, 'fanout', payload);
  }
  for (let batch; (batch = await f.worker(worker, 'next_batch'));) {
    const items = eligible(batch);
    const mail = render(batch, items);
    const response = await f.worker(worker, 'capture', { batchId: batch.batchId, revision: batch.revision, items, mail });
    result.push({ batch, items, mail, status: response.status });
  }
  return result;
}

test('submitted reservations, approval by an eligible recipient and tagged comments dispatch individually', async t => {
  const f = await stage3Database();
  t.after(() => f.db.close());
  await f.activate();
  await f.db.exec(migration('staging_notification_delivery_reliability'));
  await applyImmediateSales(f);
  const secondDeveloper = crypto.randomUUID();
  await f.rows("insert into profiles(id,email,full_name,role) values($1,'other-developer@example.test','Other developer','developer')", [secondDeveloper]);
  await f.rows("delete from user_building_access where user_id in ($1,$2)", [f.ids.outsider, f.ids.revoked]);
  await f.rows(`update workspace_commands.email_notification_settings set role_overrides =
    '{"reservation_approved":["developer","sales_agent"],"comment_added":["developer"],"reservation_queried":["developer"]}'`);
  const unitTwo = crypto.randomUUID(), saleTwo = crypto.randomUUID();
  await f.rows("insert into units(id,building_id,unit_number,sale_status) values($1,$2,'103','for_sale')", [unitTwo, f.ids.building]);
  await f.rows('insert into unit_sale_attempts(id,building_id,unit_id,created_by_user_id) values($1,$2,$3,$4)', [saleTwo, f.ids.building, unitTwo, f.ids.agent]);
  const version = await f.prepareReservation();
  const versionTwo = await f.prepareReservation(saleTwo, unitTwo);

  const first = await f.reservation('save_reservation', version, { user: 'agent' });
  await f.rpc('workspace_reservation_command', first.args);
  await f.reservation('save_reservation', versionTwo, { user: 'agent', sale: saleTwo, unit: unitTwo });
  await f.as('agent');
  await f.write('Separate comment tagging an eligible developer', { p_mentions: [f.ids.developer] });
  const reason = 'Please correct the buyer’s legal name.';
  await f.reservation('reject_reservation', version, { payload: { reason } });
  await f.reservation('save_reservation', version, { user: 'agent' });
  await f.reservation('approve_reservation', version);

  const worker = crypto.randomUUID();
  assert.equal((await f.worker(worker, 'claim')).claimed, true);
  const batches = await capture(f, worker);
  await f.worker(worker, 'release');
  assert(batches.length > 0);
  assert(batches.every(row => row.status === 'captured' && row.batch.events.length === 1));
  assert(batches.every(row => Date.parse(row.batch.dueAt) - Date.parse(row.batch.events[0].occurredAt) < 1000));
  const submissions = batches.filter(row => row.batch.events[0].eventId === 'reservation_submitted');
  assert.equal(submissions.length, 6);
  assert.equal(new Set(submissions.map(row => row.batch.saleId)).size, 2);
  assert(submissions.some(row => row.batch.saleId === saleTwo));

  const approvals = batches.filter(row => row.batch.events[0].eventId === 'reservation_approved');
  assert(approvals.some(row => row.batch.recipientId === f.ids.developer));
  assert(approvals.some(row => row.batch.recipientId === secondDeveloper));
  assert(!approvals.some(row => [f.ids.outsider, f.ids.revoked].includes(row.batch.recipientId)));
  const comments = batches.filter(row => row.batch.events[0].eventId === 'comment_added');
  assert.equal(comments.length, 2);
  assert.deepEqual(comments.find(row => row.batch.recipientId === f.ids.developer).items[0].reasons,
    ['comment_added', 'comment_mentioned']);
  const rejections = batches.filter(row => row.batch.events[0].eventId === 'reservation_queried');
  assert.equal(rejections.length, 2);
  assert(rejections.every(row => row.mail.subject.includes('Reservation rejected') &&
    row.mail.text.includes(reason) && row.mail.html.includes(reason)));

  const deliveryWorker = crypto.randomUUID();
  const d = await f.delivery(deliveryWorker, 'claim');
  const items = eligible(d.context), mail = render(d.context, items);
  const providerPayload = redirectStagingEmail(mail, d.intended, 'Bunnywell Portal <portal@example.test>');
  const release = await f.delivery(deliveryWorker, 'release_for_send', {
    id: d.id, revision: d.context.revision, items, mail, providerPayload,
  });
  await assert.rejects(submitStagingEmail(release.payload, 'stub', release.idempotencyKey,
    async () => Response.json({}, { status: 502 })), /502/);
  await f.delivery(deliveryWorker, 'result', { id: d.id, status: 'unknown', error: 'Provider submission failed (502).' });
  const [sale] = await f.rows('select workflow_status from unit_sale_attempts where id=$1', [f.ids.sale]);
  assert.equal(sale.workflow_status, 'approved');
  const [saved] = await f.rows('select delivery_state,provider_id from workspace_commands.sales_email_deliveries where id=$1', [d.id]);
  assert.deepEqual(saved, { delivery_state: 'retry_pending', provider_id: null });
});

test('outstanding historical envelopes keep their schedule and never absorb new events', async t => {
  const f = await stage3Database();
  t.after(() => f.db.close());
  await f.activate();
  const version = await f.prepareReservation();
  await f.reservation('save_reservation', version, { user: 'agent' });
  const priorWorker = crypto.randomUUID();
  await f.worker(priorWorker, 'claim');
  const event = await f.worker(priorWorker, 'next_event');
  await f.worker(priorWorker, 'fanout', {
    eventId: event.id, recipientIds: select(event.audience, event.event_id).map(r => r.userId),
  });
  await f.worker(priorWorker, 'release');
  const [prior] = await f.rows('select id,due_at from workspace_commands.notification_batches');
  await applyImmediateSales(f);
  await f.reservation('approve_reservation', version);
  const worker = crypto.randomUUID();
  await f.worker(worker, 'claim');
  const batches = await capture(f, worker);
  assert(batches.length > 0);
  assert(batches.every(row => row.batch.events.length === 1 && row.batch.events[0].eventId === 'reservation_approved'));
  const [retained] = await f.rows('select id,due_at,status,transaction_event_id from workspace_commands.notification_batches where id=$1', [prior.id]);
  assert.deepEqual(retained, { ...prior, status: 'pending', transaction_event_id: null });
});
