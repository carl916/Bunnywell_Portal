import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

test('read traces require all staging guards, request opt-in and an authorised successful response', async t => {
  const keys = ['DASHBOARD_READ_DIAGNOSTICS', 'SALES_PERF_DIAGNOSTICS', 'VERCEL_ENV', 'NEXT_PUBLIC_SUPABASE_URL'];
  const previous = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => previous[i] === undefined ? delete process.env[k] : process.env[k] = previous[i]));
  Object.assign(process.env, { DASHBOARD_READ_DIAGNOSTICS: '1', SALES_PERF_DIAGNOSTICS: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://vxkpvdtrldwwqiddoyof.supabase.co' });
  const { DashboardReadDiagnostics } = loadTypescriptModule('src/lib/dashboard/read-diagnostics.ts');
  const request = new Request('https://preview.example/api/dashboard', { headers: { 'x-bunnywell-diagnostic': 'dashboard-tail' } });
  const make = req => new DashboardReadDiagnostics(req ?? request, 'dashboard', fetch);
  for (const [key, value] of [['DASHBOARD_READ_DIAGNOSTICS', '0'], ['SALES_PERF_DIAGNOSTICS', '0'], ['VERCEL_ENV', 'production'], ['NEXT_PUBLIC_SUPABASE_URL', 'https://production.supabase.co']]) {
    const old = process.env[key]; process.env[key] = value;
    const trace = make(); trace.authorize('admin');
    assert.equal(trace.response(new Response()).headers.get('x-bunnywell-read-trace'), null);
    process.env[key] = old;
  }
  for (const [req, role, status] of [[new Request(request.url), 'admin', 200], [request, 'contractor', 200], [request, 'admin', 403]]) {
    const trace = make(req); trace.authorize(role);
    assert.equal(trace.response(new Response(null, { status })).headers.get('x-bunnywell-read-trace'), null);
  }
});

test('traces separate headers/body, preserve SDK consumption and record only allowlisted metadata', async t => {
  const keys = ['DASHBOARD_READ_DIAGNOSTICS', 'SALES_PERF_DIAGNOSTICS', 'VERCEL_ENV', 'NEXT_PUBLIC_SUPABASE_URL'];
  const previous = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => previous[i] === undefined ? delete process.env[k] : process.env[k] = previous[i]));
  Object.assign(process.env, { DASHBOARD_READ_DIAGNOSTICS: '1', SALES_PERF_DIAGNOSTICS: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://vxkpvdtrldwwqiddoyof.supabase.co' });
  const { DashboardReadDiagnostics } = loadTypescriptModule('src/lib/dashboard/read-diagnostics.ts');
  const secret = '[{"buyer":"private-buyer","amount":12345}]';
  let calls = 0;
  const trace = new DashboardReadDiagnostics(new Request('https://preview.example', { headers: { 'x-bunnywell-diagnostic': 'dashboard-tail' } }), 'dashboard', async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { setTimeout(() => { controller.enqueue(new TextEncoder().encode(secret)); controller.close(); }, 25); } }), { headers: { 'content-range': '250-250/251', 'x-envoy-upstream-service-time': '3', 'sb-request-id': '01a120a1-85af-7077-b80b-a5217be9b013', 'cf-ray': 'safe-ray-FRA', 'set-cookie': 'secret-cookie' } });
  });
  trace.authorize('admin'); trace.setStage('data');
  const response = await trace.fetch('https://private.example/rest/v1/units?buyer=private-buyer&offset=250', { headers: { authorization: 'secret-token', 'x-retry-count': '2' } });
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), secret); assert.equal(calls, 1);
  const output = trace.response(new Response('{}'));
  const json = gunzipSync(Buffer.from(output.headers.get('x-bunnywell-read-trace'), 'base64')).toString();
  assert.doesNotMatch(json, /private|buyer|amount|12345|secret-cookie|secret-token|https|authorization/);
  const span = JSON.parse(json).spans[0];
  assert.equal(span.operation, 'units'); assert.equal(span.retry, 2); assert.equal(span.page, 2); assert.equal(span.rows, 1); assert.equal(span.upstreamMs, 3);
  assert.ok(span.bodyEnd >= span.headers); assert.ok(span.bodyMs >= 10); assert.equal(span.bytes, Buffer.byteLength(secret));
});
