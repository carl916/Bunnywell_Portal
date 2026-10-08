import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const snapshot = { scope: { identity: 'user:conveyancer:org', buildingId: 'building' }, actionsAvailable: true, rows: [{ unitId: 'private' }] };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let authSession = { user: { id: 'user' }, access_token: 'synthetic' };
  let observer, session, unsubscribed = false, fetches = 0;
  let response = { ok: true, status: 200, json: async () => snapshot };
  const effects = [], cleanups = [];
  const { useSalesRegister: renderRegisterHook } = loadTypescriptModule('src/components/portal/sales/useSalesRegister.ts', { overrides: {
    react: {
      useState: init => [session = init(), () => {}],
      useRef: value => ({ current: value }),
      useEffect: effect => effects.push(effect),
      useSyncExternalStore: (_subscribe, read) => read(),
    },
    '@/lib/supabase/client': { createSupabaseBrowserClient: () => ({ auth: {
      getSession: async () => ({ data: { session: authSession } }),
      onAuthStateChange: fn => { observer = fn; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    } }) },
  } });
  globalThis.fetch = async () => { fetches++; return response; };
  renderRegisterHook('user:conveyancer:org', 'building', true, 'initial');
  effects.forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
  const cleanup = () => { cleanups.splice(0).forEach(fn => fn()); };
  t.after(() => { cleanup(); Object.assign(globalThis, saved); });
  return {
    session, state: () => session.getSnapshot(),
    tick: async () => { t.mock.timers.tick(0); await flush(); },
    auth: (event, value) => { authSession = value; observer(event, value); },
    respond: value => { response = value; }, cleanup,
    unsubscribed: () => unsubscribed, fetches: () => fetches,
  };
}

for (const event of ['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED']) test(`${event} for a missing or different identity immediately clears cached data`, async t => {
  const f = setup(t); await f.tick(); assert.equal(f.state().snapshot.rows[0].unitId, 'private');
  f.session.show(false);
  f.auth(event, event === 'SIGNED_OUT' ? null : { user: { id: 'other-user' }, access_token: 'other' });
  assert.equal(f.state().snapshot, null); assert.equal(f.state().revoked, true);
  f.session.show(true); await f.tick(); assert.equal(f.fetches(), 1, 'identity mismatch must not request using the old scope');
});

for (const status of [401, 403]) test(`${status} clears data before parsing an invalid body`, async t => {
  const f = setup(t); await f.tick();
  f.respond({ ok: false, status, json: async () => { throw new Error('non-JSON response'); } });
  f.session.refreshNow(); await f.tick();
  assert.equal(f.state().snapshot, null); assert.equal(f.state().revoked, true); assert.match(f.state().error, /access unavailable/);
});

test('a response from another identity or building is never published', async t => {
  const f = setup(t); await f.tick();
  for (const scope of [{ ...snapshot.scope, identity: 'other' }, { ...snapshot.scope, buildingId: 'other' }]) {
    f.respond({ ok: true, status: 200, json: async () => ({ ...snapshot, scope }) });
    f.session.refreshNow(); await f.tick();
    assert.equal(f.state().snapshot, null); assert.equal(f.state().revoked, true);
  }
});

test('same-user token refresh retains data and cleanup unsubscribes every refresh event', async t => {
  const f = setup(t); await f.tick();
  f.auth('TOKEN_REFRESHED', { user: { id: 'user' }, access_token: 'new-token' });
  assert.equal(f.state().snapshot, snapshot);
  f.cleanup(); assert.equal(f.unsubscribed(), true);
  for (const event of ['focus', 'online', 'sale-activity-changed', 'portal-work-changed']) window.dispatchEvent(new Event(event));
  document.dispatchEvent(new Event('visibilitychange')); await f.tick();
  assert.equal(f.fetches(), 1);
});
