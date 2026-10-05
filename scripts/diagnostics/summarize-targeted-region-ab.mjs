import fs from 'node:fs';
const out = 'artifacts/performance/2026-10-05-targeted-region';
const samples = JSON.parse(fs.readFileSync(`${out}/samples.json`, 'utf8'));
const quantile = (values, p) => { const s = values.filter(Number.isFinite).sort((a,b) => a-b); if (!s.length) return null;
  const i = (s.length - 1) * p; return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };
const stats = values => ({ n: values.filter(Number.isFinite).length, median: quantile(values,.5), p25: quantile(values,.25), p75: quantile(values,.75), min: quantile(values,0), max: quantile(values,1) });
const core = r => !/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page|performance\/vitals/.test(r.endpoint) && r.category !== 'other-host';
const lastNetwork = s => Math.max(0, ...s.requests.filter(core).map(r => r.endMs ?? 0));
const groups = [];
for (const profile of ['desktop','mobile-throttled']) for (const action of [...new Set(samples.map(s => s.action))]) {
  const row = { profile, action };
  for (const region of ['iad1','fra1']) {
    const s = samples.filter(s => s.region === region && s.profile === profile && s.action === action), r = s.flatMap(s => s.requests);
    row[region] = { readyMs: stats(s.map(s => s.readyMs)), lastRequestEndMs: stats(s.map(lastNetwork)), settledActionCompletionMs: stats(s.map(s => Math.max(s.readyMs,lastNetwork(s)))),
      readyRequests: stats(s.map(s => s.readyRequests)), settledRequests: stats(s.map(s => s.settledRequests)),
      failures: s.reduce((n,s) => n+s.failures,0), failedActions: s.filter(s => s.status !== 'ok').length, settlementTimeouts: s.filter(s => s.timedOut).length,
      categories: Object.fromEntries([...new Set(r.map(r => r.category))].map(c => [c, r.filter(r => r.category === c).length])) };
  }
  const a = samples.filter(s => s.region === 'iad1' && s.profile === profile && s.action === action);
  const b = samples.filter(s => s.region === 'fra1' && s.profile === profile && s.action === action);
  const pairs = a.map(s => { const other = b.find(b => b.run === s.run); return other ? other.readyMs-s.readyMs : null; }).filter(v => v !== null);
  row.pairedFraMinusIadMs = stats(pairs);
  row.fraFasterPairs = pairs.filter(v => v < 0).length;
  groups.push(row);
}
const functionGroups = [];
for (const region of ['iad1','fra1']) for (const profile of ['desktop','mobile-throttled']) for (const action of [...new Set(samples.map(s => s.action))]) {
  const r = samples.filter(s => s.region===region && s.profile===profile && s.action===action).flatMap(s=>s.requests).filter(r=>r.category==='vercel-function');
  for (const endpoint of [...new Set(r.map(r=>r.endpoint))]) for (const method of [...new Set(r.filter(r=>r.endpoint===endpoint).map(r=>r.method))]) {
    const selected=r.filter(r=>r.endpoint===endpoint && r.method===method);
    const spanNames=[...new Set(selected.flatMap(r=>Object.keys(r.spans)))];
    functionGroups.push({region,profile,action,endpoint,method,n:selected.length,durationMs:stats(selected.map(r=>r.durationMs)),
      ttfbMs:stats(selected.map(r=>r.browserTiming?.responseStart-r.browserTiming?.requestStart)),
      nonRouteTtfbMs:stats(selected.map(r=>r.spans.route&&r.browserTiming ? r.browserTiming.responseStart-r.browserTiming.requestStart-r.spans.route.durationMs : null)),
      spans:Object.fromEntries(spanNames.map(span=>[span,{durationMs:stats(selected.map(r=>r.spans[span]?.durationMs)),calls:stats(selected.map(r=>r.spans[span]?.calls))}])),
      regionMatches:selected.filter(r=>r.executionRegion===(r.endpoint==='/api/sales/legal'?region:'iad1')).length,failures:selected.filter(r=>r.failed||r.status>=400).length});
  }
}
const requests=samples.flatMap(s=>s.requests.map(r=>({...r,region:s.region,profile:s.profile,run:s.run,action:s.action})));
const functionRequests=requests.filter(r=>r.category==='vercel-function');
const expected = r => r.endpoint === '/api/sales/legal' ? r.region : 'iad1';
const verification={ measuredFunctionRequests:functionRequests.length, matchingExecutionRegion:functionRequests.filter(r=>r.executionRegion===expected(r)).length,
  missingRegion:functionRequests.filter(r=>!r.executionRegion).length, mismatchedRegion:functionRequests.filter(r=>r.executionRegion&&r.executionRegion!==expected(r)).length,
  edgeRegions:[...new Set(functionRequests.map(r=>r.edgeRegion))], executionRegions:[...new Set(functionRequests.map(r=>r.executionRegion))],
  requests:functionRequests.map(({region,profile,run,action,endpoint,method,status,vercelId,edgeRegion,executionRegion,cache,serverTimingHeader})=>({region,profile,run,action,endpoint,method,status,vercelId,edgeRegion,executionRegion,cache,serverTimingHeader})) };
fs.writeFileSync(`${out}/region-verification.json`,JSON.stringify(verification,null,2));
const navigationPhases = [];
for(const region of ['iad1','fra1']) for(const profile of ['desktop','mobile-throttled']) for(const action of ['navigation.cold','navigation.repeat']) {
  const selected=samples.filter(s=>s.region===region&&s.profile===profile&&s.action===action);
  navigationPhases.push({region,profile,action,n:selected.length,
    staticLastEndMs:stats(selected.map(s=>Math.max(0,...s.requests.filter(r=>r.category==='vercel-static-document').map(r=>r.endMs??0)))),
    supabaseFirstStartMs:stats(selected.map(s=>Math.min(...s.requests.filter(r=>r.category==='browser-supabase-data').map(r=>r.offsetMs)))),
    supabaseLastEndMs:stats(selected.map(s=>Math.max(0,...s.requests.filter(r=>r.category==='browser-supabase-data'&&core(r)).map(r=>r.endMs??0)))),
    staticCacheHits:selected.flatMap(s=>s.requests).filter(r=>r.category==='vercel-static-document'&&r.cache==='HIT').length,
    staticRequestCount:selected.flatMap(s=>s.requests).filter(r=>r.category==='vercel-static-document').length});
}
fs.writeFileSync(`${out}/summary.json`,JSON.stringify({groups,functionGroups,navigationPhases,verification:{...verification,requests:undefined},sampleCount:samples.length,
  storageRequests:requests.filter(r=>r.category==='browser-supabase-storage').length,
  failures:requests.filter(r=>r.failed||r.status>=400).length},null,2));
const s = x => x===null ? '—' : (x/1000).toFixed(3);
let md = '# Controlled staging function region A/B\n\nTimes are complete browser elapsed seconds, median [p25–p75]; min–max separately. Counts include settlement.\n\n| Profile | Action | n per region | iad1 median [IQR] | fra1 median [IQR] | iad1 min–max | fra1 min–max | Paired fra1−iad1 median | Requests iad1 / fra1 |\n|---|---|---:|---:|---:|---:|---:|---:|---|\n';
for(const g of groups) { const a=g.iad1.readyMs,b=g.fra1.readyMs,ac=g.iad1.settledRequests,bc=g.fra1.settledRequests;
  md+=`| ${g.profile} | ${g.action} | ${a.n} / ${b.n} | ${s(a.median)} [${s(a.p25)}–${s(a.p75)}] | ${s(b.median)} [${s(b.p25)}–${s(b.p75)}] | ${s(a.min)}–${s(a.max)} | ${s(b.min)}–${s(b.max)} | ${s(g.pairedFraMinusIadMs.median)} | ${ac.min}–${ac.max} / ${bc.min}–${bc.max} |\n`; }
md+='\nNavigation last actual non-poll/non-telemetry request completion excludes the artificial 1.5 second quiet grace and can precede readiness when browser rendering continues. Summary derives this from raw request end offsets; the recorder’s `lastRequestEndMs` field is the maximum of readiness and last completion.\n\n| Profile | Action | iad1 last network completion median | fra1 last network completion median |\n|---|---|---:|---:|\n';
for(const g of groups.filter(g=>g.action.startsWith('navigation'))) md+=`| ${g.profile} | ${g.action} | ${s(g.iad1.lastRequestEndMs.median)} | ${s(g.fra1.lastRequestEndMs.median)} |\n`;
md+='\nFunction request timing (milliseconds, median [p25–p75]). `TTFB−route` is an infrastructure/network residual, not a pure RTT. Remote spans overlap; do not sum parent and child spans.\n\n| Region | Profile | Action | Endpoint/method | n | Browser request | route | auth | db_read | db_mutation | TTFB−route | Verified |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
const ms=x=>x?.median==null?'—':`${x.median.toFixed(1)} [${x.p25.toFixed(1)}–${x.p75.toFixed(1)}]`;
for(const g of functionGroups)md+=`| ${g.region} | ${g.profile} | ${g.action} | ${g.endpoint} ${g.method} | ${g.n} | ${ms(g.durationMs)} | ${ms(g.spans.route?.durationMs)} | ${ms(g.spans.auth?.durationMs)} | ${ms(g.spans.db_read?.durationMs)} | ${ms(g.spans.db_mutation?.durationMs)} | ${ms(g.nonRouteTtfbMs)} | ${g.regionMatches}/${g.n} |\n`;
md+=`\nSamples: ${samples.length}. HTTP/browser request failures: ${requests.filter(r=>r.failed||r.status>=400).length}. Browser-to-Supabase Storage requests: ${requests.filter(r=>r.category==='browser-supabase-storage').length}. Function region matched: ${verification.matchingExecutionRegion}/${verification.measuredFunctionRequests}.\n`;
fs.writeFileSync(`${out}/measurements.md`,md);
console.log(JSON.stringify({groups:groups.map(g=>({profile:g.profile,action:g.action,iad:g.iad1.readyMs.median,fra:g.fra1.readyMs.median,n:g.iad1.readyMs.n,paired:g.pairedFraMinusIadMs.median})),verification:{...verification,requests:undefined}},null,2));
