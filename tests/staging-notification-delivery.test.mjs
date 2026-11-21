import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { stage3Database } from './helpers/notification-stage3-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const [migration] = globSync('supabase/migrations/*_staging_notification_delivery_reliability.sql');
const { requireStagingEmailConfiguration, redirectStagingEmail, submitStagingEmail } =
  loadTypescriptModule('src/lib/workspace/staging-email.ts');

async function createFixture(t) {
  const f = await stage3Database();
  t.after(() => f.db.close());
  await f.activate();
  return f;
}

async function queueTestCopy(f, status = 'queued') {
  const id = crypto.randomUUID();
  await f.rows(`insert into workspace_commands.sales_email_deliveries
    (id,kind,source_id,sale_id,intended,original_mail,status) values($1,'legal',$1,$2,'{}','{}',$3)`,
  [id, f.ids.sale, status]);
  return id;
}

async function migrate(f) {
  await f.owner();
  await f.db.exec(readFileSync(migration, 'utf8'));
}

test('cutover keeps historical failures visible and excludes them from all worker sends', async t => {
  const f = await createFixture(t);
  const historical = await queueTestCopy(f, 'failed');
  await f.rows("update workspace_commands.sales_email_deliveries set last_error='original failure' where id=$1", [historical]);
  await migrate(f);
  const fresh = await queueTestCopy(f);
  const worker = crypto.randomUUID();
  assert.equal(await f.delivery(worker, 'claim', { id: historical }), null);
  assert.deepEqual(await f.delivery(worker, 'retry', { id: historical }), { scheduled: false });
  assert.equal((await f.delivery(worker, 'claim')).id, fresh);
  const [saved] = await f.rows('select last_error,held_at from workspace_commands.sales_email_deliveries where id=$1', [historical]);
  assert(saved.held_at);
  assert.equal(saved.last_error, 'original failure');
});

test('configuration and provider failures back off, become visible, and allow a bounded manual retry', async t => {
  const f = await createFixture(t);
  await migrate(f);
  const id = await queueTestCopy(f);
  const worker = crypto.randomUUID();
  for (let attempt = 1; attempt <= 6; attempt++) {
    assert.equal((await f.delivery(worker, 'claim')).id, id);
    const result = await f.delivery(worker, 'result', { id, status: 'failed', error: 'Provider submission failed (429).' });
    assert.equal(result.status, attempt === 6 ? 'failed' : 'retry_pending');
    const [saved] = await f.rows(`select consecutive_failures,attempts,last_error,
      round(extract(epoch from next_attempt_at-updated_at))::int as backoff
      from workspace_commands.sales_email_deliveries where id=$1`, [id]);
    assert.equal(saved.consecutive_failures, attempt);
    assert.equal(saved.attempts, 0);
    assert.equal(saved.backoff, [60, 120, 300, 900, 1800, 3600][attempt - 1]);
    assert.equal(saved.last_error, 'Provider submission failed (429).');
    assert.equal(await f.delivery(worker, 'claim'), null);
    await f.rows('update workspace_commands.sales_email_deliveries set next_attempt_at=clock_timestamp() where id=$1', [id]);
  }
  assert.equal(await f.delivery(worker, 'claim'), null);
  assert.deepEqual(await f.delivery(worker, 'retry', { id }), { scheduled: true });
  assert.equal((await f.delivery(worker, 'claim')).id, id);
  const accepted = await f.delivery(worker, 'result', { id, status: 'accepted', providerId: 'resend-test' });
  assert(accepted.acceptedAt);
  assert.equal(accepted.deliveredAt, null);
});

test('staging requires all preview settings and sends one copy carrying the intended recipients', async () => {
  const env = {
    VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_4s8vIyfrGh9DSGJcixTU5slevr5P',
    NEXT_PUBLIC_WORKSPACE_STAGING: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://vxkpvdtrldwwqiddoyof.supabase.co',
    RESEND_API_KEY: 'test-key', SALES_FROM_EMAIL: 'Bunnywell Portal <no-reply@bunnywell.co.uk>',
    SALES_STAGING_DELIVERY_ENABLED: '1', SALES_STAGING_DELIVERY_TO: 'carl@accoladeproperties.co.uk',
  };
  assert.throws(() => requireStagingEmailConfiguration({ ...env, SALES_STAGING_DELIVERY_TO: undefined }), /SALES_STAGING_DELIVERY_TO/);
  assert.throws(() => requireStagingEmailConfiguration({ ...env, VERCEL_ENV: 'production' }), /refused/);
  const { key, from } = requireStagingEmailConfiguration(env);
  const mail = { subject: 'Priors Gate · Unit LG06 — Reservation submitted', text: 'Test reservation.', html: '<p>Test reservation.</p>' };
  const intended = { to: ['developer@example.test'], cc: ['agent@example.test'], bcc: ['resident@example.test'] };
  const payload = redirectStagingEmail(mail, intended, from);
  assert.equal(await submitStagingEmail(payload, key, 'staging-sales/routine/example', async (url, request) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const sent = JSON.parse(request.body);
    assert.deepEqual(sent.to, ['carl@accoladeproperties.co.uk']);
    assert.deepEqual(sent.cc, []);
    assert.deepEqual(sent.bcc, []);
    assert.equal(sent.reply_to, sent.to[0]);
    assert.equal(sent.from, from);
    assert.equal(sent.subject, '[STAGING] ' + mail.subject);
    for (const address of Object.values(intended).flat()) {
      assert(sent.html.includes(address));
      assert(sent.text.includes(address));
    }
    return Response.json({ id: 'resend-test' });
  }), 'resend-test');
});
