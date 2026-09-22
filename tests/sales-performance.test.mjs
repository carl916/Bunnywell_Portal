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
  const result=timing.response(new Response('{}',{status:400}));assert.equal(result.status,400);
  const header=result.headers.get('server-timing');assert.match(header,/db_mutation;dur=[\d.]+/);assert.match(header,/storage_upload_end;dur=[\d.]+/);assert.doesNotMatch(header,/private|buyer|secret|project|pdf|http/);
  assert.doesNotMatch(new SalesServerTiming().response(new Response()).headers.get('server-timing'),/db_mutation/);
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
