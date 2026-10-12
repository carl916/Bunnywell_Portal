import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { createPortalScreenLoader, portalScreenResources } = loadTypescriptModule('src/lib/portal-screen-data.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('dashboard needs no deferred data; each screen declares its dependencies', () => {
  assert.deepEqual(portalScreenResources('dashboard', 'admin'), []);
  assert.deepEqual(portalScreenResources('sales', 'developer'), ['floors', 'organisations', 'profiles']);
  assert.deepEqual(portalScreenResources('rentals', 'developer'), ['floors', 'organisations']);
  assert.ok(portalScreenResources('setup_buildings', 'admin').includes('unitTypes'));
  assert.ok(portalScreenResources('setup_people', 'admin').includes('accessRequests'));
  assert.ok(!portalScreenResources('setup_people', 'developer').includes('accessRequests'));
  for (const screen of ['snags', 'units', 'resident_home', 'resident_snags']) assert.ok(portalScreenResources(screen, 'admin').includes('snags'));
});

test('screen transitions reuse loaded resources and coalesce concurrent missing reads', async () => {
  const loader = createPortalScreenLoader(), gate = deferred(), reads = [], published = [];
  const read = async key => { reads.push(key); await gate.promise; return [{ id: key }]; };
  const publish = (key, rows) => published.push([key, rows]);
  const first = loader.ensure(portalScreenResources('sales', 'developer'), read, publish);
  const second = loader.ensure(portalScreenResources('rentals', 'developer'), read, publish);
  gate.resolve(); await Promise.all([first, second]);
  await loader.ensure(portalScreenResources('sales', 'developer'), read, publish);
  assert.deepEqual(reads.sort(), ['floors', 'organisations', 'profiles']);
  assert.equal(published.length, 3);
});

test('failed resources remain unloaded, successful siblings survive, retry reads only the failure', async () => {
  const loader = createPortalScreenLoader(), calls = [];
  await assert.rejects(loader.ensure(['floors', 'profiles'], async key => { if (key === 'profiles') throw Error('unavailable'); return []; }, () => {}), /unavailable/);
  assert.deepEqual(loader.loaded(), ['floors']);
  await loader.ensure(['floors', 'profiles'], async key => { calls.push(key); return []; }, () => {});
  assert.deepEqual(calls, ['profiles']);
});

test('logout, identity/access changes and refresh invalidate loaded and in-flight data', async () => {
  for (const reason of ['logout', 'identity', 'organisation', 'access', 'refresh', 'mutation']) {
    const loader = createPortalScreenLoader(), gate = deferred(), published = [];
    await loader.ensure(['floors'], async () => [], () => {});
    const old = loader.ensure(['profiles'], async () => { await gate.promise; return ['old principal']; }, (_, rows) => published.push(rows));
    loader.invalidate();
    assert.deepEqual(loader.loaded(), [], reason);
    await loader.ensure(['profiles'], async () => ['current principal'], (_, rows) => published.push(rows));
    gate.resolve(); await old;
    assert.deepEqual(published, [['current principal']], reason);
  }
});
