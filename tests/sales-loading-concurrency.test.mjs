import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { loadBuildingSalesData } = loadTypescriptModule('src/lib/sales/action-refresh.ts');
const { createLoadCoordinator } = loadTypescriptModule('src/lib/portal-load-lifecycle.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(held = {}, sale = 'A') {
  const started = [], filters = [];
  const rows = {
    building_sale_defaults: [{ building_id: 'building', reservation_fee: 2000 }],
    unit_sale_attempts: [{ id: sale, workflow_status: 'completed' }],
    unit_sale_terms: [{ sale_attempt_id: sale, contract_price: 345678 }],
    unit_sale_documents: [{ id: `doc-${sale}`, sale_attempt_id: sale }],
    unit_sale_document_versions: [{ id: `v2-${sale}`, document_id: `doc-${sale}`, version_number: 2, is_current: true }, { id: `v1-${sale}`, document_id: `doc-${sale}`, version_number: 1, is_current: false }],
  };
  function query(resource) {
    return { select() { return this; }, eq(key, value) { filters.push([resource, key, value]); return this; }, in(key, value) { filters.push([resource, key, value]); return this; }, order() { return this; }, then(resolve, reject) {
      started.push(resource);
      return (held[resource]?.promise ?? Promise.resolve({ data: rows[resource] ?? [], error: null })).then(resolve, reject);
    } };
  }
  return { rows, started, filters, from: query, rpc: query };
}

test('defaults do not block attempts/child reads, but still gate the complete snapshot', async () => {
  const defaults = deferred(), c = fixture({ building_sale_defaults: defaults });
  let published = false;
  const load = loadBuildingSalesData(c, ['unit-A'], 'building').then(value => { published = true; return value; });
  await tick();
  assert(c.started.includes('unit_sale_document_versions')); assert.equal(published, false);
  assert.deepEqual(c.filters.find(x => x[0] === 'unit_sale_attempts'), ['unit_sale_attempts', 'unit_id', ['unit-A']]);
  defaults.resolve({ data: c.rows.building_sale_defaults, error: null });
  const result = await load;
  assert.equal(result.defaults[0].reservation_fee, 2000); assert.equal(result.terms[0].contract_price, 345678);
  assert.equal(result.attempts[0].workflow_status, 'completed'); assert.equal(result.versions.length, 2);
});

test('versions start after documents, while unrelated financial reads are pending', async () => {
  const docs = deferred(), terms = deferred(), c = fixture({ unit_sale_documents: docs, unit_sale_terms: terms });
  let published = false;
  const load = loadBuildingSalesData(c, ['unit-A'], 'building').then(value => { published = true; return value; });
  await tick(); assert(!c.started.includes('unit_sale_document_versions'));
  docs.resolve({ data: c.rows.unit_sale_documents, error: null });
  await tick(); assert(c.started.includes('unit_sale_document_versions')); assert.equal(published, false);
  assert.deepEqual(c.filters.find(x => x[0] === 'unit_sale_document_versions'), ['unit_sale_document_versions', 'document_id', ['doc-A']]);
  terms.resolve({ data: c.rows.unit_sale_terms, error: null });
  assert.equal((await load).versions[0].id, 'v2-A');
});

for (const resource of ['building_sale_defaults', 'unit_sale_attempts', 'unit_sale_terms', 'unit_sale_payment_schedule', 'unit_sale_documents', 'unit_sale_document_versions', 'unit_sale_invoices', 'unit_sale_invoice_payments', 'sale_actor_names', 'sale_exchange_deposit_receipts']) {
  test(`${resource} permission/read error never publishes a complete snapshot`, async () => {
    const held = deferred(), error = { code: '42501', message: `permission denied: ${resource}` };
    const c = fixture({ [resource]: held });
    let published = false;
    const load = loadBuildingSalesData(c, ['unit-A'], 'building').then(() => { published = true; });
    held.resolve({ data: null, error });
    await assert.rejects(load, e => e === error); assert.equal(published, false);
  });
}

test('rejected transport on one concurrent branch is handled without partial publication', async () => {
  const defaults = deferred(), documents = deferred();
  const c = fixture({ building_sale_defaults: defaults, unit_sale_documents: documents });
  const load = loadBuildingSalesData(c, ['unit-A'], 'building');
  defaults.reject(new Error('offline')); documents.reject(new Error('disconnected'));
  await assert.rejects(load, /offline|disconnected/); await tick();
});

test('new building/permission scope supersedes the actual concurrent loader, including late errors', async () => {
  for (const denied of [false, true]) {
    const gate = createLoadCoordinator('sales'), held = deferred(), old = fixture({ building_sale_defaults: held }, 'A'), fresh = fixture({}, 'B');
    let snapshot = null, notice = null;
    const work = c => async valid => {
      try { const result = await loadBuildingSalesData(c, ['unit'], 'building'); if (valid()) snapshot = result; }
      catch (error) { if (valid()) notice = error; }
    };
    const pending = gate.run('old-authorised-scope', 'mount', work(old)); await tick();
    await gate.run('new-authorised-scope', 'building-switch', work(fresh));
    held.resolve({ data: denied ? null : [], error: denied ? { code: '42501', message: 'late denial' } : null });
    await pending;
    assert.equal(snapshot.attempts[0].id, 'B'); assert.equal(snapshot.terms[0].contract_price, 345678);
    assert.equal(snapshot.versions[0].id, 'v2-B'); assert.equal(notice, null);
  }
});

test('RLS-filtered empty attempts/documents issue no dependent reads; missing optional actors remains optional', async () => {
  const c = fixture(); c.rows.unit_sale_attempts = [];
  const empty = await loadBuildingSalesData(c, ['inaccessible-unit'], 'building');
  assert.deepEqual(c.started.sort(), ['building_sale_defaults', 'unit_sale_attempts']); assert.deepEqual(empty.versions, []);
  const d = fixture(); d.rows.unit_sale_documents = [];
  const actor = deferred(); actor.resolve({ data: null, error: { code: 'PGRST202', message: 'sale_actor_names is missing' } });
  const optional = fixture({ sale_actor_names: actor });
  assert.equal((await loadBuildingSalesData(optional, ['unit'], 'building')).namesUnavailable, true);
  await loadBuildingSalesData(d, ['unit'], 'building'); assert(!d.started.includes('unit_sale_document_versions'));
});
