import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { createLoadCoordinator, createSessionLifecycle, salesMembershipKey } = loadTypescriptModule('src/lib/portal-load-lifecycle.ts');
const { portalAccessKey } = loadTypescriptModule('src/lib/portal-access-snapshot.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const calls = [], gate = createLoadCoordinator('portal');
  let user = { id: 'A' }, snapshot = null, checks = false;
  const lifecycle = createSessionLifecycle({
    validate: async () => user,
    load: (person, event) => gate.run(person.id, event, async valid => { calls.push(event); if (valid()) snapshot = person.id; }, true),
    clear: () => { gate.invalidate(); snapshot = null; }, invalidate: () => gate.invalidate(),
    recheck: async () => { calls.push('access-check'); return checks; },
    error: error => calls.push(error.message),
  });
  return { lifecycle, calls, snapshot: () => snapshot, user: value => { user = value; }, changed: () => { checks = true; } };
}
test('getUser restoration, INITIAL_SESSION and SIGNED_IN produce one portal snapshot', async () => {
  const f = fixture(), session = { user: { id: 'A' }, access_token: 'token-A' };
  f.lifecycle.observe('SIGNED_IN', session); f.lifecycle.observe('INITIAL_SESSION', session);
  assert.deepEqual(f.calls, []);
  await f.lifecycle.restore(); assert.deepEqual(f.calls, ['session-restoration']); assert.equal(f.snapshot(), 'A');
  f.lifecycle.observe('INITIAL_SESSION', session); await tick(); assert.equal(f.calls.length, 1);
});
test('sign-in after empty restoration validates Auth and loads once; sign-out clears', async () => {
  const f = fixture(); f.user(null); f.lifecycle.observe('INITIAL_SESSION', null); await f.lifecycle.restore();
  f.user({ id: 'B' }); f.lifecycle.observe('SIGNED_IN', { user: { id: 'B' }, access_token: 'token-B' }); await tick();
  assert.equal(f.snapshot(), 'B'); assert.deepEqual(f.calls, ['auth:SIGNED_IN']);
  f.lifecycle.observe('SIGNED_OUT', null); assert.equal(f.snapshot(), null);
});
test('token refresh reloads access/data once, while unchanged focus only rechecks access', async () => {
  const f = fixture(), session = { user: { id: 'A' }, access_token: 'old' };
  f.lifecycle.observe('INITIAL_SESSION', session); await f.lifecycle.restore();
  f.lifecycle.observe('SIGNED_IN', session); await tick(); assert.deepEqual(f.calls, ['session-restoration', 'access-check']);
  f.lifecycle.observe('TOKEN_REFRESHED', { ...session, access_token: 'new' }); await tick();
  assert.equal(f.calls.at(-1), 'auth:TOKEN_REFRESHED');
  f.lifecycle.observe('TOKEN_REFRESHED', { ...session, access_token: 'new' }); await tick(); assert.equal(f.calls.length, 3);
});
test('permission change on focus or USER_UPDATED reloads authoritative profile/access', async () => {
  const f = fixture(), session = { user: { id: 'A' }, access_token: 'token' };
  f.lifecycle.observe('INITIAL_SESSION', session); await f.lifecycle.restore(); f.changed();
  f.lifecycle.observe('SIGNED_IN', session); await tick(); assert.equal(f.calls.at(-1), 'auth:SIGNED_IN');
  f.lifecycle.observe('USER_UPDATED', session); await tick(); assert.equal(f.calls.at(-1), 'auth:USER_UPDATED');
});
test('unverified replacement principal cannot inherit the previous account', async () => {
  const f = fixture(); f.lifecycle.observe('INITIAL_SESSION', { user: { id: 'A' }, access_token: 'A' }); await f.lifecycle.restore();
  f.lifecycle.observe('SIGNED_IN', { user: { id: 'unverified' }, access_token: 'other' }); await tick();
  assert.deepEqual(f.calls, ['session-restoration']);
  assert.equal(f.snapshot(), null);
});

test('late INITIAL_SESSION after explicit restoration adopts the token without a second load', async () => {
  const f = fixture(); await f.lifecycle.restore();
  f.lifecycle.observe('INITIAL_SESSION', { user: { id: 'A' }, access_token: 'late' }); await tick();
  assert.deepEqual(f.calls, ['session-restoration']);
});

test('overlapping focus access checks coalesce and cannot reload after sign-out', async () => {
  const pending = deferred(), calls = [], session = { user: { id: 'A' }, access_token: 'A' };
  const lifecycle = createSessionLifecycle({ validate: async () => session.user, load: async (_user, event) => { calls.push(event); }, clear() {}, invalidate() {}, recheck: async () => { calls.push('check'); await pending.promise; return true; }, error() {} });
  lifecycle.observe('INITIAL_SESSION', session); await lifecycle.restore();
  lifecycle.observe('SIGNED_IN', session); await tick(); lifecycle.observe('SIGNED_IN', session); await tick();
  assert.deepEqual(calls, ['session-restoration', 'check']); lifecycle.observe('SIGNED_OUT', null); pending.resolve(); await tick();
  assert.deepEqual(calls, ['session-restoration', 'check']);
});
test('overlapping identical loads coalesce; explicit Refresh supersedes and old response is discarded', async () => {
  const gate = createLoadCoordinator('portal'), old = deferred(), fresh = deferred(); let reads = 0, snapshot = null;
  const work = value => async valid => { reads++; const result = await value.promise; if (valid()) snapshot = result; };
  const a = gate.run('A', 'restore', work(old)), b = gate.run('A', 'INITIAL_SESSION', work(old));
  assert.equal(a, b); await tick(); assert.equal(reads, 1);
  const refresh = gate.run('A', 'explicit-refresh', work(fresh), true); fresh.resolve('new'); await refresh;
  old.resolve('old'); await a; assert.equal(snapshot, 'new'); assert.equal(reads, 2);
});
test('sign-out, unmount and account replacement invalidate an outstanding response', async () => {
  for (const scenario of ['sign-out', 'unmount', 'account-change']) {
    const gate = createLoadCoordinator('portal'), pending = deferred(); let published = false;
    const load = gate.run('A', scenario, async valid => { await pending.promise; if (valid()) published = true; });
    await tick(); gate.invalidate(); pending.resolve(); await load; assert.equal(published, false, scenario);
  }
});
test('old building cannot publish over a new one, including equal-size membership replacements', async () => {
  const gate = createLoadCoordinator('sales'), old = deferred(); let snapshot;
  const before = salesMembershipKey([{ id: 'A' }]), after = salesMembershipKey([{ id: 'B' }]); assert.notEqual(before, after);
  const load = gate.run(before, 'mount', async valid => { await old.promise; if (valid()) snapshot = before; });
  await gate.run(after, 'building-switch', async valid => { if (valid()) snapshot = after; }); old.resolve(); await load;
  assert.equal(snapshot, after); assert.equal(salesMembershipKey([{ id: 'B' }, { id: 'A' }]), salesMembershipKey([{ id: 'A' }, { id: 'B' }]));
});
test('disposed restoration and sign-out during getUser never resurrect data', async () => {
  for (const dispose of [false, true]) {
    const pending = deferred(); let loads = 0;
    const lifecycle = createSessionLifecycle({ validate: () => pending.promise, load: async () => { loads++; }, clear() {}, invalidate() {}, error() {} });
    const restore = lifecycle.restore();
    if (dispose) lifecycle.dispose(); else lifecycle.observe('SIGNED_OUT', null);
    pending.resolve({ id: 'A' }); await restore; assert.equal(loads, 0);
  }
});
test('failed load can retry and never marks a failed snapshot complete', async () => {
  const gate = createLoadCoordinator('sales'); let published = false;
  await assert.rejects(gate.run('scope', 'mount', async () => { throw Error('required read failed'); }), /required read/);
  await gate.run('scope', 'explicit-refresh', async valid => { if (valid()) published = true; }); assert.equal(published, true);
});
test('access signature detects revocation, deactivation, role and organisation changes with equal counts', () => {
  const person = { id: 'A', role: 'sales_agent', active: true, organisation_id: 'org' }, links = [{ building_id: 'B', organisation_id: 'org', role_on_project: 'sales_agent', active: true }];
  const key = portalAccessKey(person, [{ unit_id: 'unit' }], [{ building_id: 'B' }], links);
  for (const profile of [{ ...person, active: false }, { ...person, role: 'user' }, { ...person, organisation_id: 'other' }, null]) assert.notEqual(portalAccessKey(profile, [{ unit_id: 'unit' }], [{ building_id: 'B' }], links), key);
  assert.notEqual(portalAccessKey(person, [{ unit_id: 'replaced' }], [{ building_id: 'B' }], links), key);
  assert.notEqual(portalAccessKey(person, [{ unit_id: 'unit' }], [{ building_id: 'C' }], links), key);
  assert.notEqual(portalAccessKey(person, [{ unit_id: 'unit' }], [{ building_id: 'B' }], [{ ...links[0], active: false }]), key);
});
