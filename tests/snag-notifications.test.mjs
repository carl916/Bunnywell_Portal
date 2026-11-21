import assert from 'node:assert/strict';
import test from 'node:test';
import { snagNotificationDatabase } from './helpers/snag-notification-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { renderSnagNotification: render } = loadTypescriptModule('src/lib/workspace/snag-notification-email.ts');
const { redirectStagingEmail: redirect, submitStagingEmail: submit } = loadTypescriptModule('src/lib/workspace/staging-email.ts');
const deliveries = 'workspace_commands.snag_notification_deliveries';
const events = 'workspace_commands.snag_notification_events';
const items = 'workspace_commands.snag_notification_items';
const iso = value => new Date(value).toISOString();

async function fixture(t) {
  const f = await snagNotificationDatabase();
  t.after(() => f.db.close());
  return f;
}

async function schedule(f, at) {
  const [row] = await f.rows('select workspace_commands.prepare_snag_notifications($1) as prepared', [at]);
  return row.prepared;
}

async function renderRelease(f, worker, delivery, replacementPayload) {
  const context = delivery.context;
  const mail = render(context);
  const providerPayload = replacementPayload ?? redirect(mail, { to: [context.recipient], cc: [], bcc: [] }, 'Portal <portal@example.test>');
  return f.worker('release_for_send', { id: delivery.id, revision: context.revision, mail, providerPayload }, worker);
}

test('ten routine events share one fixed cutoff, after-cutoff activity waits, and buildings stay separate', async t => {
  const f = await fixture(t);
  await f.rows("update workspace_commands.snag_notification_settings set frequency='twice_daily'");
  for (let index = 0; index < 10; index++) {
    const snag = await f.addSnag({ title: 'Routine snag ' + index });
    await f.rows(`update ${events} set occurred_at='2026-11-21 10:40Z'::timestamptz + make_interval(mins => $2) where snag_id=$1`,
      [snag, index * 3]);
  }
  const afterCutoff = await f.addSnag({ title: 'Exactly noon' });
  await f.rows(`update ${events} set occurred_at='2026-11-21 12:00Z' where snag_id=$1`, [afterCutoff]);
  const otherBuilding = await f.addSnag({ building: f.ids.otherBuilding, title: 'Different building' });
  await f.rows(`update ${events} set occurred_at='2026-11-21 11:59Z' where snag_id=$1`, [otherBuilding]);

  const early = await schedule(f, '2026-11-21T11:59:59Z');
  assert.equal(early.digests, 0);
  await schedule(f, '2026-11-21T12:15:00Z');
  const noon = await f.rows(`select building_id, cutoff_at, workspace_commands.snag_delivery_context(id) as context
    from ${deliveries} where recipient_id=$1 order by building_id`, [f.ids.developer]);
  assert.equal(noon.length, 2);
  const first = noon.find(row => row.building_id === f.ids.building);
  assert.equal(iso(first.cutoff_at), '2026-11-21T12:00:00.000Z');
  assert.equal(iso(first.context.periodStart), '2026-11-20T16:00:00.000Z');
  assert.equal(first.context.eventCount, 10);
  assert.equal(first.context.created, 10);
  assert.deepEqual(first.context.details, []);
  const message = render(first.context);
  assert.match(message.text, /10 recorded updates/);
  assert.match(message.text, /20 Nov 2026, 16:00 GMT to 21 Nov 2026, 12:00 GMT/);
  assert.match(message.html, new RegExp('building=' + f.ids.building));
  assert.doesNotMatch(message.text, /Routine snag 0|Different building|Exactly noon/);
  assert.equal(noon.find(row => row.building_id === f.ids.otherBuilding).context.eventCount, 1);

  assert.equal((await schedule(f, '2026-11-21T16:30:00Z')).digests > 0, true);
  assert.deepEqual(await schedule(f, '2026-11-21T16:45:00Z'), { events: 0, digests: 0 });
  const [later] = await f.rows(`select period_start,cutoff_at,workspace_commands.snag_delivery_context(id) context
    from ${deliveries} where recipient_id=$1 and building_id=$2 and cutoff_at='2026-11-21 16:00Z'`, [f.ids.developer, f.ids.building]);
  assert.equal(iso(later.period_start), '2026-11-21T12:00:00.000Z');
  assert.equal(later.context.eventCount, 1);
  assert.match(render(later.context).text, /Exactly noon/);
  assert.equal((await schedule(f, '2026-11-22T20:00:00Z')).digests, 0);
});

test('assignments, information requests, P1, reviews and explicit mentions generate targeted immediate alerts', async t => {
  const f = await fixture(t);
  const assigned = await f.addSnag({ org: f.ids.org, title: 'Allocated to main contractor' });
  const question = await f.addSnag({ title: 'Information needed' });
  const review = await f.addSnag({ title: 'Resolved for review' });
  await f.rows("update public.snags set status='needs_more_info' where id=$1", [question]);
  await f.rows("update public.snags set status='resolved_by_contractor' where id=$1", [review]);
  await f.addSnag({ priority: 'P1', org: f.ids.org, title: 'Urgent snag' });
  const mentionRequest = crypto.randomUUID();
  await f.comment(assigned, [f.ids.developer, f.ids.contractor], mentionRequest);
  await f.comment(assigned, [f.ids.developer, f.ids.contractor], mentionRequest);
  await f.comment(assigned, []);
  await assert.rejects(f.comment(assigned, [f.ids.otherContractor]), /must have access/);
  await f.as('authenticated', 'contractor');
  const candidates = (await f.db.query('select public.workspace_snag_mention_candidates($1,$2) as people',
    [f.ids.building, assigned])).rows[0].people;
  assert(candidates.some(person => person.id === f.ids.contractor));
  assert(!candidates.some(person => person.id === f.ids.otherContractor || person.id === f.ids.resident));
  assert(candidates.every(person => !('email' in person)));
  assert.equal((await f.db.query('select auth.uid() as actor')).rows[0].actor, f.ids.contractor);

  await f.worker('prepare');
  const immediate = await f.rows(`select e.event_key,q.recipient_id from ${deliveries} q
    join ${events} e on e.id=q.immediate_event_id where q.mode='immediate' order by e.event_key`);
  const recipientsOf = key => new Set(immediate.filter(row => row.event_key === key).map(row => row.recipient_id));
  assert.deepEqual(recipientsOf('assigned'), new Set([f.ids.contractor]));
  assert.deepEqual(recipientsOf('needs_information'), new Set([f.ids.developer]));
  assert.deepEqual(recipientsOf('ready_for_review'), new Set([f.ids.developer]));
  assert.deepEqual(recipientsOf('mentioned'), new Set([f.ids.developer, f.ids.contractor]));
  assert.deepEqual(recipientsOf('urgent'), new Set([f.ids.developer, f.ids.otherDeveloper, f.ids.contractor]));
  assert.equal(immediate.filter(row => row.event_key === 'mentioned').length, 2);
  const taggedDigestItems = await f.rows(`select i.event_id from ${items} i join ${events} e on e.id=i.event_id
    where e.event_key='mentioned' and i.cutoff_at is not null`);
  assert.deepEqual(taggedDigestItems, []);
});

test('digest access and recipient settings are checked again at release', async t => {
  const f = await fixture(t);
  await f.rows(`update workspace_commands.snag_notification_settings set overrides =
    '{"created":{"roles":["developer_representative"],"mode":"digest"}}'`);
  const visible = await f.addSnag({ title: 'Visible before revocation' });
  const hidden = await f.addSnag({ building: f.ids.otherBuilding, title: 'Hidden in a different building' });
  await f.rows(`update ${events} set occurred_at='2026-11-21 09:00Z' where snag_id in ($1,$2)`, [visible, hidden]);
  await schedule(f, '2026-11-21T16:00:00Z');
  const [queued] = await f.rows(`select id from ${deliveries} where recipient_id=$1 and building_id=$2`, [f.ids.representative, f.ids.building]);
  assert(queued);
  assert.equal((await f.rows(`select count(*)::int as s from ${deliveries}`))[0].s, 1);
  const worker = crypto.randomUUID();
  const claimed = await f.worker('claim', { id: queued.id }, worker);
  const original = render(claimed.context);
  assert.match(original.text, /Visible before revocation/);
  assert.doesNotMatch(original.text, /Hidden in a different building/);
  await f.rows('delete from public.user_building_access where user_id=$1', [f.ids.representative]);
  const release = await f.worker('release_for_send', { id: queued.id, revision: claimed.context.revision, mail: original }, worker);
  assert.deepEqual(release, { send: false, status: 'suppressed' });
  const [saved] = await f.rows(`select status,attempts,provider_id from ${deliveries} where id=$1`, [queued.id]);
  assert.deepEqual(saved, { status: 'suppressed', attempts: 0, provider_id: null });
});

test('recipient access agrees with the portal policy for each supported role and building', async t => {
  const f = await fixture(t);
  const inScope = await f.addSnag({ org: f.ids.org });
  const otherBuilding = await f.addSnag({ building: f.ids.otherBuilding });
  for (const user of ['developer', 'otherDeveloper', 'representative', 'contractor', 'otherContractor']) {
    for (const [building, snag] of [[f.ids.building, inScope], [f.ids.otherBuilding, otherBuilding]]) {
      await f.as('authenticated', user);
      const [actual] = (await f.db.query('select public.can_access_building($1) and public.can_access_snag($2) as allowed',
        [building, snag])).rows;
      const [recipient] = await f.rows('select workspace_commands.snag_notification_access($1,$2,$3) as allowed',
        [f.ids[user], building, snag]);
      assert.equal(recipient.allowed, actual.allowed, user + ' / ' + building);
    }
  }
});

test('digest retries have one identity and acceptance stays distinct from capture and inbox delivery', async t => {
  const f = await fixture(t);
  const snag = await f.addSnag();
  await f.rows(`update ${events} set occurred_at='2026-11-21 09:00Z' where snag_id=$1`, [snag]);
  await schedule(f, '2026-11-21T16:00:00Z');
  const [queued] = await f.rows(`select id from ${deliveries} where recipient_id=$1`, [f.ids.developer]);
  const worker = crypto.randomUUID();
  const claimed = await f.worker('claim', { id: queued.id }, worker);
  assert.equal(await f.worker('claim', { id: queued.id }), null);
  const capture = await f.worker('release_for_send', {
    id: claimed.id, revision: claimed.context.revision, mail: render(claimed.context),
  }, worker);
  assert.deepEqual(capture, { send: false, captured: true });
  const [draft] = await f.rows(`select attempts,captured_at,accepted_at from ${deliveries} where id=$1`, [queued.id]);
  assert(draft.captured_at);
  assert.equal(draft.attempts, 0);
  assert.equal(draft.accepted_at, null);
  const first = await renderRelease(f, worker, claimed);
  await f.worker('result', { id: claimed.id, status: 'unknown', error: 'Provider unavailable.' }, worker);
  await f.rows(`update ${deliveries} set next_attempt_at=clock_timestamp() where id=$1`, [queued.id]);
  const retry = await f.worker('claim', { id: queued.id }, worker);
  const again = await renderRelease(f, worker, retry, { ...first.payload, subject: '[STAGING] replacement payload' });
  assert.equal(again.idempotencyKey, first.idempotencyKey);
  assert.deepEqual(again.payload, first.payload);
  const providerId = await submit(again.payload, 'stub', again.idempotencyKey, async (url, request) => {
    const payload = JSON.parse(request.body);
    assert.deepEqual(payload.to, ['carl@accoladeproperties.co.uk']);
    assert.deepEqual(payload.cc, []);
    assert.deepEqual(payload.bcc, []);
    assert.match(payload.text, /Intended To:.*developer@example.test/);
    assert.match(payload.html, /developer@example.test/);
    return Response.json({ id: 'resend-digest-test' });
  });
  await f.worker('result', { id: queued.id, status: 'accepted', providerId }, worker);
  const [saved] = await f.rows(`select status,provider_id,delivered_at,cutoff_at from ${deliveries} where id=$1`, [queued.id]);
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.provider_id, 'resend-digest-test');
  assert.equal(saved.delivered_at, null);
  assert.equal(iso(saved.cutoff_at), '2026-11-21T16:00:00.000Z');
  assert.equal((await schedule(f, '2026-11-21T17:00:00Z')).digests, 0);
});

test('schedule respects the UK spring and autumn clock changes and exact cutoff boundaries', async t => {
  const f = await fixture(t);
  const cases = [
    ['2026-03-29T09:00:00Z', 'twice_daily', '2026-03-28T16:00:00.000Z', '2026-03-29T11:00:00.000Z'],
    ['2026-03-29T11:00:00Z', 'twice_daily', '2026-03-29T11:00:00.000Z', '2026-03-29T15:00:00.000Z'],
    ['2026-10-25T09:00:00Z', 'twice_daily', '2026-10-24T15:00:00.000Z', '2026-10-25T12:00:00.000Z'],
    ['2026-10-25T16:00:00Z', 'daily', '2026-10-25T16:00:00.000Z', '2026-10-26T16:00:00.000Z'],
  ];
  for (const [time, frequency, start, end] of cases) {
    const [period] = await f.rows('select * from workspace_commands.snag_digest_period($1,$2)', [time, frequency]);
    assert.equal(iso(period.period_start), start);
    assert.equal(iso(period.cutoff_at), end);
  }
});

test('optional notifications can be disabled while urgent alerts remain immediate', async t => {
  const f = await fixture(t);
  await f.as('authenticated', 'contractor');
  await assert.rejects(f.db.query('select public.workspace_snag_notification_settings($1)', [f.ids.contractor]), /permission denied/);
  await f.as('service_role', 'developer');
  const save = (request, payload) => f.db.query('select public.workspace_save_snag_notifications($1,$2,$3) as settings',
    [f.ids.developer, request, payload]);
  await assert.rejects(save(crypto.randomUUID(), { expectedVersion: 0, frequency: 'twice_daily',
    events: { urgent: { mode: 'digest', roles: ['developer'] } } }), /permitted delivery mode/);
  const request = crypto.randomUUID();
  const payload = { expectedVersion: 0, frequency: 'disabled', events: {} };
  const [saved] = (await save(request, payload)).rows;
  assert.equal(saved.settings.version, 1);
  assert.deepEqual((await save(request, payload)).rows[0], saved);
  await f.addSnag({ org: f.ids.org });
  await f.addSnag({ priority: 'P1' });
  await f.worker('prepare');
  const states = await f.rows(`select event_key,eligible_count from ${events} order by event_key`);
  assert(states.find(row => row.event_key === 'urgent').eligible_count > 0);
  assert(states.filter(row => row.event_key !== 'urgent').every(row => row.eligible_count === 0));
  assert.equal((await f.rows(`select count(*)::int as n from ${deliveries} where mode='digest'`))[0].n, 0);
});
