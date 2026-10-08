import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { createSalesRegisterSession, RegisterAccessError } = loadTypescriptModule('src/lib/sales/register-session.ts');
const snapshot = label => ({ scope: { label }, actionsAvailable: true, rows: [{ unitId: label }] });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const oldDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  const requests = [];
  const session = createSalesRegisterSession(signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })));
  session.start(); session.show(true);
  const tick = async (ms = 0) => { t.mock.timers.tick(ms); await flush(); };
  t.after(() => { session.stop(); globalThis.document = oldDocument; });
  return { session, requests, tick, state: session.getSnapshot };
}

test('navigation uses the last successful fetch time, never sliding the 60-second window', async t => {
  const f = setup(t); await f.tick();
  const first = snapshot('first'); f.requests[0].resolve(first); await flush();
  for (let i = 0; i < 3; i++) {
    f.session.show(false); await f.tick(19_999); f.session.show(true); await f.tick();
    assert.equal(f.state().snapshot, first); assert.equal(f.requests.length, 1);
  }
  f.session.show(false); await f.tick(3); f.session.show(true); await f.tick();
  assert.equal(f.requests.length, 2); assert.equal(f.state().snapshot, first); assert.equal(f.state().refreshing, true);
  f.requests[1].resolve(snapshot('replacement')); await flush();
  assert.equal(f.state().snapshot.scope.label, 'replacement');
});

test('focus uses 15 seconds, duplicate focus events share a request, and online forces revalidation', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  await f.tick(14_999); f.session.wake(); await f.tick(); assert.equal(f.requests.length, 1);
  await f.tick(1); f.session.wake(); f.session.wake(); await f.tick();
  f.session.wake(); await f.tick(); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(snapshot('second')); await flush(); await f.tick(); assert.equal(f.requests.length, 2);
  f.session.online(); await f.tick(); assert.equal(f.requests.length, 3);
});

test('mutation bursts while away are remembered and coalesce into one request on return', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  f.session.show(false);
  for (let i = 0; i < 10; i++) f.session.invalidate();
  await f.tick(); assert.equal(f.requests.length, 1);
  f.session.show(true); await f.tick(); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(snapshot('changed')); await flush(); await f.tick(); assert.equal(f.requests.length, 2);
});

test('explicit Refresh bypasses age even while a sale file is open', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  f.session.show(false); f.session.refreshNow(); await f.tick();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(snapshot('manual')); await flush();
  f.session.show(true); await f.tick(); assert.equal(f.requests.length, 2);
});

test('an invalidated in-flight response cannot publish or clear the newer invalidation', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  f.session.invalidate(); f.session.invalidate(); await f.tick(); assert.equal(f.requests.length, 2);
  f.session.invalidate(); f.session.invalidate();
  f.requests[1].resolve(snapshot('superseded')); await flush(); await f.tick();
  assert.equal(f.state().snapshot.scope.label, 'first'); assert.equal(f.requests.length, 3);
  f.requests[2].resolve(snapshot('newest')); await flush(); await f.tick();
  assert.equal(f.state().snapshot.scope.label, 'newest'); assert.equal(f.requests.length, 3);
});

test('failed refresh retains rows and an error, and navigation retries even inside the freshness window', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  f.session.invalidate(); await f.tick(); f.requests[1].reject(new Error('Unavailable')); await flush();
  assert.equal(f.state().snapshot.scope.label, 'first'); assert.equal(f.state().error, 'Unavailable');
  await f.tick(); assert.equal(f.requests.length, 2, 'failure must not trigger a retry loop');
  f.session.show(false); f.session.show(true); await f.tick(); assert.equal(f.requests.length, 3);
  f.requests[2].reject(new RegisterAccessError('Revoked')); await flush();
  assert.equal(f.state().snapshot, null); assert.equal(f.state().revoked, true);
});

test('logout discards the snapshot and ignores a late successful request', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('private')); await flush();
  f.session.invalidate(); await f.tick(); f.session.revoke();
  assert.equal(f.requests[1].signal.aborted, true); assert.equal(f.state().snapshot, null);
  f.requests[1].resolve(snapshot('must not return')); await flush();
  assert.equal(f.state().snapshot, null); assert.equal(f.state().revoked, true);
});

test('hidden documents defer work and visibility resumes pending invalidation', async t => {
  const f = setup(t); await f.tick(); f.requests[0].resolve(snapshot('first')); await flush();
  document.visibilityState = 'hidden'; f.session.invalidate(); f.session.wake(); await f.tick();
  assert.equal(f.requests.length, 1);
  document.visibilityState = 'visible'; f.session.wake(); f.session.wake(); await f.tick();
  assert.equal(f.requests.length, 2);
});

test('cleanup aborts, cancels queued work and prevents late publication; Strict Mode can restart', async t => {
  const f = setup(t); f.session.stop(); await f.tick(); assert.equal(f.requests.length, 0);
  f.session.start(); f.session.show(true); await f.tick(); assert.equal(f.requests.length, 1);
  let notifications = 0;
  const unsubscribe = f.session.subscribe(() => notifications++);
  f.session.stop(); f.requests[0].resolve(snapshot('late')); await flush();
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.state().snapshot, null); assert.equal(notifications, 0);
  unsubscribe(); f.session.start(); f.session.show(true); await f.tick();
  f.requests[1].resolve(snapshot('new mount')); await flush(); assert.equal(notifications, 0);
});

test('timeout retains safe failure state without accepting a late response', async t => {
  const f = setup(t); await f.tick(); await f.tick(30_000);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve(snapshot('late')); await flush();
  assert.equal(f.state().snapshot, null); assert.match(f.state().error, /timed out/);
});
