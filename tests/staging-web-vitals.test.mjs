import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const model = loadTypescriptModule('src/lib/performance/web-vitals.ts');
const sample = { metric: 'INP', value: 123, rating: 'good', route: 'portal' };
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('payload allowlist discards entries, selectors, IDs, URLs and document details; routes are fixed', () => {
  for (const name of ['INP', 'LCP', 'CLS', 'TTFB']) {
    const payload = model.vitalPayload({ name, value: 1, rating: 'good', id: 'sale-secret', entries: [{ target: '#buyer' }], document: 'private.pdf' }, 'portal');
    assert.deepEqual(payload, { ...sample, metric: name, value: 1 });
  }
  assert.equal(model.vitalRoute('https://staging.bunnywell.co.uk/?sale=private#completion'), 'portal');
  assert.equal(model.vitalRoute('https://staging.bunnywell.co.uk/request-access?email=private#form'), 'request-access');
  assert.equal(model.vitalRoute('https://staging.bunnywell.co.uk/sales/private'), 'other');
  for (const record of [{ ...sample, url: '/sale/private' }, { ...sample, entries: [] }, { ...sample, value: -1 }, { ...sample, value: Infinity }, { ...sample, value: NaN }, { ...sample, value: '123' }, { ...sample, route: '/sale/private' }, { ...sample, metric: 'FCP' }, { ...sample, rating: 'unknown' }]) assert.equal(model.parseVitalPayload(record), null);
});

test('receiver logs only approved payload on staging, rejects private/oversize/cross-origin data and fails closed', async t => {
  environment(t, { STAGING_WEB_VITALS: '1', VERCEL_ENV: 'preview', SALES_PERF_LOCAL: undefined });
  const lines = [];
  t.mock.method(console, 'info', line => lines.push(line));
  const { POST } = loadTypescriptModule('src/app/api/performance/vitals/route.ts');
  const send = (body, host = 'staging.bunnywell.co.uk', headers = {}) => POST(new Request(`https://${host}/api/performance/vitals`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  assert.equal((await send(sample)).status, 204);
  assert.deepEqual(lines, [JSON.stringify(sample)]);
  for (const input of [{ ...sample, token: 'secret' }, { ...sample, entries: ['private.pdf'] }, 'invalid']) assert.equal((await send(input)).status, 400);
  assert.equal((await send(' '.repeat(513))).status, 413);
  assert.equal((await send(sample, 'staging.bunnywell.co.uk', { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await send(sample, 'staging.bunnywell.co.uk', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await send(sample, 'staging.bunnywell.co.uk', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send(sample, 'portal.bunnywell.co.uk')).status, 404);
  assert.equal((await send(sample, 'random.vercel.app')).status, 404);
  process.env.VERCEL_ENV = 'production';
  assert.equal((await send(sample)).status, 404);
  delete process.env.VERCEL_ENV;
  assert.equal((await send(sample, 'localhost')).status, 404);
  process.env.SALES_PERF_LOCAL = '1';
  assert.equal((await send(sample, 'localhost')).status, 204);
  process.env.STAGING_WEB_VITALS = '0';
  assert.equal((await send(sample, 'localhost')).status, 404);
  assert.equal(lines.length, 2);
});

test('stable client callback uses background same-origin requests without credentials/referrers or failure propagation', async t => {
  const original = globalThis.window;
  t.after(() => { globalThis.window = original; });
  globalThis.window = { location: { hostname: 'staging.bunnywell.co.uk', href: 'https://staging.bunnywell.co.uk/?sale=secret#unit' } };
  const callbacks = [], calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); throw new Error('offline'); });
  const { StagingWebVitals } = loadTypescriptModule('src/components/performance/StagingWebVitals.tsx', {
    overrides: { 'next/web-vitals': { useReportWebVitals: callback => callbacks.push(callback) } },
  });
  assert.equal(StagingWebVitals(), null); StagingWebVitals();
  assert.equal(callbacks[0], callbacks[1]);
  const metric = { name: 'INP', value: 123, rating: 'good', id: 'private', entries: [{ selector: '#private' }] };
  callbacks[0](metric); callbacks[0](metric); callbacks[0]({ ...metric, name: 'FCP' });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/performance/vitals');
  assert.deepEqual(JSON.parse(calls[0].options.body), sample);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].options.keepalive, true);
  globalThis.window.location.hostname = 'portal.bunnywell.co.uk';
  callbacks[0]({ ...metric, value: 456 });
  assert.equal(calls.length, 1);
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  assert.equal((layout.match(/<StagingWebVitals\s*\/>/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /["']use client["']/);
});
