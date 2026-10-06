import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

test('server diagnostics are opt-in, request-scoped and contain only allowlisted numeric timing data',async t=>{
  const original=process.env.SALES_PERF_DIAGNOSTICS,vercel=process.env.VERCEL_ENV;
  t.after(()=>{if(original===undefined)delete process.env.SALES_PERF_DIAGNOSTICS;else process.env.SALES_PERF_DIAGNOSTICS=original;if(vercel===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=vercel;});
  const {SalesServerTiming}=loadTypescriptModule('src/lib/sales/server-performance.ts');
  delete process.env.SALES_PERF_DIAGNOSTICS;assert.equal(new SalesServerTiming().response(new Response()).headers.get('server-timing'),null);
  process.env.SALES_PERF_DIAGNOSTICS='1';process.env.VERCEL_ENV='production';assert.equal(new SalesServerTiming().response(new Response()).headers.get('server-timing'),null);
  process.env.VERCEL_ENV='preview';
  t.mock.method(globalThis,'fetch',async()=>new Response('{}'));
  const timing=new SalesServerTiming();await timing.fetch('https://project.example/rest/v1/rpc/sales_completion_upload',{method:'POST',headers:{Authorization:'secret-token'},body:'private buyer and document.pdf'});
  await timing.fetch('https://project.example/storage/v1/object/private-file.pdf',{method:'POST'});
  await timing.fetch('https://project.example/rest/v1/rpc/sales_completion_upload_session',{method:'POST'});
  const result=timing.response(new Response('{}',{status:400}));assert.equal(result.status,400);
  const header=result.headers.get('server-timing');assert.match(header,/db_mutation;dur=[\d.]+/);assert.match(header,/db_rpc;dur=[\d.]+/);assert.match(header,/storage_upload_end;dur=[\d.]+/);assert.doesNotMatch(header,/private|buyer|secret|project|pdf|http/);
  assert.doesNotMatch(new SalesServerTiming().response(new Response()).headers.get('server-timing'),/db_mutation/);
});

test('upload server spans distinguish body reading, decoding, storage reads/writes, verification and finalisation', async t => {
  const previous = { flag: process.env.SALES_PERF_DIAGNOSTICS, env: process.env.VERCEL_ENV };
  t.after(() => { for (const [key, value] of [['SALES_PERF_DIAGNOSTICS', previous.flag], ['VERCEL_ENV', previous.env]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.SALES_PERF_DIAGNOSTICS = '1'; process.env.VERCEL_ENV = 'preview';
  t.mock.method(globalThis, 'fetch', async () => new Response('%PDF-'));
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { active: true, role: 'conveyancer' } }) }) }) }) };
  const { POST } = loadTypescriptModule('src/app/api/sales/legal/route.ts', { overrides: {
    '@/lib/supabase/admin': { createSupabaseServiceRoleClient: () => client },
    '@/lib/sales/completion-upload-server': { completionUploadAction: async (_client, _actor, _payload, timing) => {
      await timing.measure('storage_verify', () => timing.fetch('https://storage.example/storage/v1/object/private.pdf'));
      await timing.fetch('https://storage.example/storage/v1/object/copy', { method: 'POST' });
      return { completed: true };
    } },
  } });
  const response = await POST(new Request('https://staging.bunnywell.co.uk/api/sales/legal', { method: 'POST', headers: { Authorization: 'Bearer private', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'finalize_completion_upload', sale: 'private' }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completed: true });
  const header = response.headers.get('server-timing');
  for (const span of ['body_read', 'json_parse', 'storage_read', 'storage_upload', 'storage_verify', 'finalization']) assert.match(header, new RegExp(`${span};dur=[\\d.]+`));
  assert.doesNotMatch(header, /private|actor|pdf|https/);
  const invalid = await POST(new Request('https://staging.bunnywell.co.uk/api/sales/legal', { method: 'POST', headers: { Authorization: 'Bearer private' }, body: '{bad' }));
  assert.equal(invalid.status, 400); assert.match(invalid.headers.get('server-timing'), /json_parse/);
});

test('browser measurements are opt-in, bounded, omit payloads and remain off on the production domain',()=>{
  const prior={window:globalThis.window,raf:globalThis.requestAnimationFrame,flag:process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS};
  try{
    globalThis.window={location:{hostname:'staging.bunnywell.co.uk'}};globalThis.requestAnimationFrame=callback=>{callback();return 1;};
    const {beginSalesMeasurement,legalPerformanceAction}=loadTypescriptModule('src/lib/sales/performance.ts');
    delete process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS;beginSalesMeasurement('authority.issue').finish();assert.equal(performance.getEntriesByType('measure').filter(x=>x.name.startsWith('sales:')).length,0);
    process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS='1';globalThis.window.location.hostname='portal.bunnywell.co.uk';beginSalesMeasurement('authority.issue').finish();assert.equal(performance.getEntriesByType('measure').filter(x=>x.name.startsWith('sales:')).length,0);
    globalThis.window.location.hostname='localhost';for(let i=0;i<105;i++){const timing=beginSalesMeasurement('completion.documents_upload');timing.mark('request_started');timing.mark('request_started');timing.painted('pending_visible');timing.finish();}
    const entries=performance.getEntriesByType('measure').filter(x=>x.name.startsWith('sales:'));assert.equal(entries.length,400);assert.equal(legalPerformanceAction('private email buyer'),'legal.other');
    for(const entry of entries){assert.match(entry.name,/^sales:completion.documents_upload:\d+:(click|request_started|pending_visible|ui_visible)$/);assert.equal(typeof entry.duration,'number');}
    const abandoned=beginSalesMeasurement('sale.open');
    for(let i=0;i<101;i++)beginSalesMeasurement('sale.open');
    abandoned.mark('request_completed');abandoned.finish();
    const pending=performance.getEntriesByType('measure').filter(x=>x.name.startsWith('sales:'));
    assert.equal(pending.length,100);assert.ok(pending.every(x=>x.name.endsWith(':click')));
  }finally{globalThis.window=prior.window;globalThis.requestAnimationFrame=prior.raf;if(prior.flag===undefined)delete process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS;else process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS=prior.flag;performance.clearMarks();performance.clearMeasures();}
});
