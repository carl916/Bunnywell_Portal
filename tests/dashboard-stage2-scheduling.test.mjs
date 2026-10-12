import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { dashboardReadClient, until } from './helpers/dashboard-read-client.mjs';
import { building, unit, sale, NOW } from './helpers/dashboard-fixture.mjs';
const { loadDashboardInput, DashboardAccessError } = loadTypescriptModule('src/lib/dashboard/read.ts');
const { dashboardResponse } = loadTypescriptModule('src/lib/dashboard/response.ts');
const state = (input, key) => input.sources.find(s => s.key === key)?.state;
const started = (f, name) => f.calls.some(c => c.name === name);
const ended = (f, name) => f.calls.some(c => c.name === name && c.ended);
const read = (f, scope = '', mode = 'dashboard') => loadDashboardInput(f.client, f.profile, scope, NOW, mode);

test('Sales dependencies and Fees run while unrelated snags and tenancies are outstanding', async t => {
  const f = dashboardReadClient({ hold: ['snags', 'unit_tenancies'] });
  t.after(() => { f.release('snags'); f.release('unit_tenancies'); });
  const pending = read(f);
  await until(() => ended(f, 'sale_workflow_context') && ended(f, 'get_agent_fee_portfolio'));
  assert.ok(started(f, 'unit_sale_documents')); assert.equal(ended(f, 'snags'), false);
  assert.equal(started(f, 'rental_arrears_episodes'), false);
  f.release('unit_tenancies'); await until(() => ended(f, 'rental_import_runs'));
  assert.equal(ended(f, 'snags'), false);
  f.release('snags'); const input = await pending;
  assert.ok(input.sources.every(s => s.state === 'ready')); assert.ok(f.peak <= 9);
});

test('Rental risk and Fees start without waiting for Sales', async t => {
  const f = dashboardReadClient({ hold: ['unit_sale_attempts'] }); t.after(() => f.release('unit_sale_attempts'));
  const pending = read(f); await until(() => ended(f, 'rental_arrears_episodes') && ended(f, 'get_agent_fee_portfolio'));
  assert.equal(started(f, 'sale_workflow_context'), false); assert.equal(started(f, 'unit_sale_documents'), false);
  f.release('unit_sale_attempts'); await pending;
});

test('failed prerequisites suppress dependent reads without suppressing independent sources', async () => {
  for (const fail of ['unit_sale_attempts', 'unit_tenancies']) {
    const f = dashboardReadClient({ fail }); const input = await read(f);
    const keys = fail === 'unit_sale_attempts' ? ['sales', 'legal', 'history'] : ['rentals', 'rent_risk'];
    keys.forEach(key => assert.equal(state(input, key), 'unavailable'));
    assert.equal(state(input, 'fees'), 'ready'); assert.equal(state(input, 'snags'), 'ready');
    for (const name of fail === 'unit_sale_attempts' ? ['unit_sale_documents', 'sale_workflow_context', 'sale_actor_names'] : ['rental_arrears_episodes', 'rental_import_runs']) assert.equal(started(f, name), false);
  }
});

test('failed legal/history/rental reads and rejected promises never publish partial success or leak errors', async () => {
  for (const name of ['unit_sale_documents', 'sale_legal_emails', 'sale_exchange_deposit_receipts', 'sale_exchange_deposit_sources', 'sale_workflow_context', 'sale_actor_names', 'rental_arrears_episodes', 'rental_import_runs', 'get_agent_fee_portfolio']) {
    for (const kind of ['fail', 'reject']) {
      const f = dashboardReadClient({ [kind]: name, delay: () => 1 }); const input = await read(f);
      const key = name.startsWith('rental_') ? 'rent_risk' : name === 'get_agent_fee_portfolio' ? 'fees' : ['sale_workflow_context', 'sale_actor_names'].includes(name) ? 'history' : 'legal';
      assert.equal(state(input, key), 'unavailable', name); assert.equal(state(input, 'sales'), 'ready');
      if (key === 'legal') assert.deepEqual([input.documents, input.authorities, input.deposits, input.depositSources], [[], [], [], []]);
      if (key === 'history') assert.deepEqual(input.saleEvents, []);
      assert.ok(!JSON.stringify(dashboardResponse(input)).includes('private failure')); assert.ok(f.peak <= 9);
    }
  }
});

test('complete snapshots are deterministic across response order, roles and scopes; historical/unallocated fees survive', async () => {
  for (const role of ['admin', 'developer', 'sales_agent', 'conveyancer', 'contractor', 'developer_representative']) {
    for (const scope of ['', building.id, '10000000-0000-4000-8000-000000000002']) {
      const a = dashboardReadClient({ role, delay: (_, n) => n % 3 });
      const b = dashboardReadClient({ role, delay: (_, n) => 3 - n % 3 });
      const [before, after] = await Promise.all([read(a, scope), read(b, scope)]);
      assert.deepEqual(before, after); assert.deepEqual(dashboardResponse(before), dashboardResponse(after));
      if (role === 'admin' && !scope) { assert.equal(after.feePortfolio[0].saleAttemptId, 'historical'); assert.equal(after.feePortfolio[0].agentOrganisationId, null); }
      assert.deepEqual(a.calls.map(c => c.name).sort(), b.calls.map(c => c.name).sort());
    }
  }
});

test('pagination and 150-ID batches finish completely under the nine-read ceiling', async () => {
  const f = dashboardReadClient({ delay: () => 1 });
  f.tables.unit_sale_attempts = Array.from({ length: 301 }, (_, i) => ({ ...sale, id: `sale-${i}`, unit_id: `unit-${i}` }));
  f.tables.units = f.tables.unit_sale_attempts.map(s => ({ ...unit, id: s.unit_id }));
  f.tables.unit_tenancies = Array.from({ length: 301 }, (_, i) => ({ id: `tenancy-${i}`, unit_id: `unit-${i}`, building_id: building.id }));
  const input = await read(f); assert.equal(input.sales.length, 301); assert.equal(input.tenancies.length, 301);
  assert.equal(f.calls.filter(c => c.name === 'unit_sale_attempts').length, 2);
  assert.deepEqual(f.calls.filter(c => c.name === 'sale_workflow_context').map(c => c.args.p_sales.length), [150, 150, 1]);
  assert.equal(f.calls.filter(c => c.name === 'rental_arrears_episodes').length, 3); assert.ok(f.peak <= 9);
});

test('missing access and failed dimensions stop source reads; empty authorised scope does not fetch sources', async () => {
  const f = dashboardReadClient(); await assert.rejects(read(f, 'unavailable'), DashboardAccessError); assert.deepEqual(f.calls.map(c => c.name), ['buildings']);
  const failed = dashboardReadClient({ fail: 'units' }); await assert.rejects(read(failed)); assert.equal(started(failed, 'unit_sale_attempts'), false);
  const empty = dashboardReadClient(); empty.tables.buildings = []; const input = await read(empty);
  assert.deepEqual(empty.calls.map(c => c.name), ['buildings']); assert.equal(input.units.length, 0);
});

test('Sales register keeps its restricted reads and dependency failure rules', async () => {
  const f = dashboardReadClient({ role: 'conveyancer', fail: 'sale_legal_emails' }); const input = await read(f, '', 'sales-register');
  assert.equal(state(input, 'legal'), 'unavailable'); assert.equal(state(input, 'sales'), 'ready');
  for (const name of ['get_agent_fee_portfolio', 'sale_workflow_context', 'snags', 'unit_tenancies', 'sale_exchange_deposit_receipts']) assert.equal(started(f, name), false);
});

test('real route rejects profile or access revocation after slow data reads', async t => {
  for (const revocation of ['changingProfile', 'changingAccess']) {
    const f = dashboardReadClient({ [revocation]: true, hold: ['snags'] }); t.after(() => f.release('snags'));
    const { GET } = loadTypescriptModule('src/app/api/dashboard/route.ts', { overrides: {
      '@supabase/supabase-js': { createClient: () => f.client }, '@/lib/supabase/admin': { requiredEnv: () => 'synthetic' },
    } });
    const pending = GET(new Request('http://local/api/dashboard?building=all', { headers: { authorization: 'Bearer synthetic' } }));
    await until(() => ended(f, 'sale_workflow_context'));
    assert.equal(f.calls.filter(c => c.name === 'profiles').length, 1);
    f.release('snags'); const response = await pending;
    assert.equal(response.status, 403); assert.equal((await response.json()).items, undefined);
  }
});

test('all queued reads finish after saturation without exceeding the previous peak', async t => {
  const hold = ['snags', 'handovers', 'resident_access_requests', 'get_agent_fee_portfolio', 'unit_sale_documents', 'sale_legal_emails', 'sale_exchange_deposit_receipts', 'sale_exchange_deposit_sources', 'sale_workflow_context', 'sale_actor_names', 'rental_arrears_episodes', 'rental_import_runs'];
  const f = dashboardReadClient({ hold }); t.after(() => hold.forEach(f.release));
  const pending = read(f);
  await until(() => f.calls.filter(c => !c.ended).length === 9);
  assert.equal(f.peak, 9); assert.ok(hold.some(name => !started(f, name)), 'excess reads must queue');
  hold.forEach(f.release); const input = await pending;
  assert.equal(f.peak, 9); assert.ok(input.sources.every(s => s.state === 'ready'));
});
