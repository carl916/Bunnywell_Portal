import fs from 'node:fs';
const dir='artifacts/performance/2026-10-04-pre-optimisation';
const read=name=>JSON.parse(fs.readFileSync(`${dir}/${name}`,'utf8'));
const workflow=read('workflow-samples.json'),navigation=read('navigation-samples.json');
const oldWorkflow=JSON.parse(fs.readFileSync('artifacts/performance/staging-samples.json','utf8'));
const oldNavigation=JSON.parse(fs.readFileSync('artifacts/performance/navigation-samples.json','utf8'));
const median=a=>{a=[...a].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const range=a=>a.length?`${Math.min(...a)}${Math.min(...a)!==Math.max(...a)?`–${Math.max(...a)}`:''}`:'—';
const seconds=n=>n===null?'—':`${(n/1000).toFixed(2)} s`;
const actions=[
 ['sale.open.in_app','Open another sale',true],['sale_file.navigation.cold','Cold page → sale controls',true],['sale_file.navigation.repeat','Repeat page → sale controls',true],['progression.stage_change','Enter Exchange',true],
 ['authority.preview_open','Authority preview'],['authority.request','Request authority'],['authority.issue','Issue authority'],['exchange.record','Record exchange'],['completion.open','Exchange → Completion',true],
 ['completion.documents_upload.one-1MiB','Upload one 1 MiB PDF'],['completion.documents_upload.two-1MiB','Upload two 1 MiB PDFs'],['completion.documents_upload.two-5MiB','Upload two 5 MiB PDFs'],['completion.documents_upload.two-near-10MiB','Upload two near-10 MiB PDFs'],['completion.documents_approve','Approve documents'],['completion.record','Record completion']
];
const profiles=['desktop','mobile-throttled'];
const table=[];
for(const [action,label,nav] of actions){
 const datasets=nav?[navigation,oldNavigation]:[workflow,oldWorkflow];
 const values=profiles.map(profile=>{const current=datasets[0].filter(s=>s.action===action&&s.profile===profile),previous=datasets[1].filter(s=>s.action===action&&s.profile===profile);return {profile,n:current.length,originalN:previous.length,medianMs:median(current.map(s=>s.totalMs)),originalMedianMs:median(previous.map(s=>s.totalMs)),maxMs:Math.max(...current.map(s=>s.totalMs)),requests:range(current.map(s=>s.networkRequests)),finishedNonVitalRequests:range(current.map(s=>s.requests.filter(r=>r.finished&&r.category!=='vitals').length)),originalRequests:range(previous.map(s=>s.networkRequests)),workflowFailures:current.filter(s=>s.status!=='ok').length,httpFailures:current.reduce((n,s)=>n+s.requests.filter(r=>r.status>=400).length,0),browserFailures:current.reduce((n,s)=>n+s.requests.filter(r=>r.failed).length,0),vitalBrowserFailures:current.reduce((n,s)=>n+s.requests.filter(r=>r.failed&&r.category==='vitals').length,0),medianResponseBytes:median(current.map(s=>s.responseBytes)),responseBytesKnown:range(current.map(s=>s.responseSizesAvailable)),statuses:[...new Set(current.flatMap(s=>s.requests.filter(r=>r.category==='legal'&&r.method==='POST').map(r=>r.status)))],originalStatuses:[...new Set(previous.flatMap(s=>s.requests.filter(r=>r.category==='legal'&&r.method==='POST').map(r=>r.status)))]};});
 table.push({action,label,values});
}
fs.writeFileSync(`${dir}/comparison.json`,JSON.stringify(table,null,2));
const spans=[];
for(const profile of profiles)for(const action of [...new Set(workflow.map(s=>s.action))]){
 const rows=workflow.filter(s=>s.profile===profile&&s.action===action).flatMap(s=>s.requests.filter(r=>r.category==='legal').map(r=>({...r,operation:r.method==='GET'?'context':r.serverTiming.some(e=>e.name==='upload_prepare')?'prepare':r.serverTiming.some(e=>e.name==='finalization')?'finalize':'mutation'})));
 for(const operation of [...new Set(rows.map(r=>r.operation))])for(const name of [...new Set(rows.filter(r=>r.operation===operation).flatMap(r=>r.serverTiming.map(e=>e.name)))]){
  const entries=rows.filter(r=>r.operation===operation).flatMap(r=>r.serverTiming.filter(e=>e.name===name));
  spans.push({action,profile,operation,span:name,n:entries.length,medianMs:median(entries.map(e=>e.durationMs)),maxMs:Math.max(...entries.map(e=>e.durationMs)),calls:entries.some(e=>e.calls)?range(entries.map(e=>e.calls??0)):null});
 }
}
fs.writeFileSync(`${dir}/server-timing-summary.json`,JSON.stringify(spans,null,2));
const lines=['# Detailed baseline measurements','','Request counts include every request initiated in the action window. “Finished non-vitals” uses the September recorder’s count convention, excluding the newly introduced telemetry. Response bytes are compressed response-body bytes when Playwright can obtain them; incomplete/failed requests have null sizes. Browser failures can include navigation-cancelled requests; HTTP failures and UI outcomes are separate.','','| Action | Profile | n | Median / max | Initiated / finished non-vitals | Browser failures / vitals subset | HTTP failures | Median response KiB |','|---|---|---:|---:|---:|---:|---:|---:|'];
for(const [action] of [...new Map([...navigation,...workflow].map(s=>[s.action,s])).entries()])for(const profile of profiles){const dataset=action.startsWith('sale_file.')||action==='sale.open.in_app'||action==='progression.stage_change'||action==='completion.open'?navigation:workflow;const rows=dataset.filter(s=>s.action===action&&s.profile===profile);if(!rows.length)continue;const req=rows.flatMap(s=>s.requests);lines.push(`| ${action} | ${profile} | ${rows.length} | ${seconds(median(rows.map(s=>s.totalMs)))} / ${seconds(Math.max(...rows.map(s=>s.totalMs)))} | ${range(rows.map(s=>s.networkRequests))} / ${range(rows.map(s=>s.requests.filter(r=>r.finished&&r.category!=='vitals').length))} | ${req.filter(r=>r.failed).length} / ${req.filter(r=>r.failed&&r.category==='vitals').length} | ${req.filter(r=>r.status>=400).length} | ${(median(rows.map(s=>s.responseBytes))/1024).toFixed(1)} |`);}
lines.push('','## Server phases','','Medians of each phase are independent. Parent and child phases overlap; do not sum them. `_end` spans are route-entry offsets, and remain in raw JSON.','','| Action | Profile | API operation | Span | n | Median / max ms | Calls |','|---|---|---|---|---:|---:|---:|');
for(const s of spans.filter(s=>!s.span.endsWith('_end')))lines.push(`| ${s.action} | ${s.profile} | ${s.operation} | ${s.span} | ${s.n} | ${s.medianMs.toFixed(2)} / ${s.maxMs.toFixed(2)} | ${s.calls??'—'} |`);
fs.writeFileSync(`${dir}/measurements.md`,lines.join('\n')+'\n');
const comparison=['| Action | 22 Sep median D / M | 4 Oct median D / M | 4 Oct requests D / M | Outcome |','|---|---:|---:|---:|---|'];
for(const row of table){const [d,m]=row.values;comparison.push(`| ${row.label} | ${seconds(d.originalMedianMs)} / ${seconds(m.originalMedianMs)} | ${seconds(d.medianMs)} / ${seconds(m.medianMs)} | ${d.requests} / ${m.requests} | ${d.workflowFailures+m.workflowFailures===0?'Success':'Failure'}${row.action.includes('two-5MiB')||row.action.includes('two-near-10MiB')?'; 22 Sep HTTP 413':''} |`);}
fs.writeFileSync(`${dir}/comparison-table.md`,comparison.join('\n')+'\n');
const vitals=read('web-vitals-browser.json');
const vitalSummary={kind:'initial controlled observations, not a field baseline',total: vitals.length,accepted204:vitals.filter(v=>v.status===204).length,noResponseObserved:vitals.filter(v=>v.status===null).length,routes:[...new Set(vitals.map(v=>v.payload.route))],metrics:[...new Set(vitals.map(v=>v.payload.metric))],unexpectedKeys:vitals.filter(v=>Object.keys(v.payload).sort().join(',')!=='metric,rating,route,value').length,sensitiveRequestHeaders:vitals.filter(v=>v.hasCookie||v.hasAuthorization||v.hasReferrer).length,bodyByteRange:range(vitals.map(v=>v.bytes)),byProfile:profiles.map(profile=>({profile,metrics:['TTFB','LCP','INP','CLS'].map(metric=>{const values=vitals.filter(v=>v.profile===profile&&v.payload.metric===metric&&v.status===204).map(v=>v.payload.value);return {metric,n:values.length,median:median(values)};})}))};
fs.writeFileSync(`${dir}/web-vitals-summary.json`,JSON.stringify(vitalSummary,null,2));
const deployment=read('deployment.json');
const all=[...workflow,...navigation];
const windowStart=all.map(s=>s.startedAt).sort()[0];
const windowEnd=new Date(Math.max(...all.map(s=>Date.parse(s.startedAt)+s.wallMs))).toISOString();
const report=`# Pre-optimisation staging baseline — 4 October 2026

Captured on deployed commit \`${deployment.commit}\`, deployment \`${deployment.deploymentId}\` ([deployment](${deployment.deploymentUrl})), through [staging.bunnywell.co.uk](https://staging.bunnywell.co.uk/). Vercel reports region \`iad1\`; the browser verified the staging Supabase project. This is the baseline after prompt 8, before further optimisation. No application code, index, permission, environment flag or deployment was changed in this task.

Read alongside the [22 September report](sales-performance-assessment.md). All four new sale journeys succeeded, including both larger upload cases that previously failed with HTTP 413. These builds also differ in the intervening completion/upload functionality; this comparison does not isolate the cost of prompt 8 or demonstrate an optimisation effect.

## Conditions and samples

- Desktop: headless Chromium ${deployment.browserVersion}, 1280 × 900, ordinary connection.
- Throttled mobile: same Chromium, 390 × 844, CPU slowdown 4×, latency 150 ms, download 200,000 bytes/s (1.6 Mbps), upload 93,750 bytes/s (0.75 Mbps). These match the September settings; they are emulated profiles on this Windows computer.
- Workflow: **n=2 desktop / n=2 mobile**, fresh empty authorised Forum House drafts 107–110, prepared using the normal reservation API. The September workflow had n=3 / n=2. Only four unused drafts remained in the documented authorised 102–110 scope, so no fifth sale was reset or taken outside that scope. Completed diagnostic sales 102–106 were excluded from mutations. The four new test sales remain completed; do not rerun mutations on them.
- Read-only navigation: **n=5 / n=5** on newly completed test sale 107, switching from sale 110's Reservation stage. Sale 110 had already been prepared, so its Reservation stage was explicitly selected before the measured switch. Workflow navigation is supplementary and kept separate.
- Run window: ${windowStart} to ${windowEnd} (UTC). One browser diagnostic process ran at a time: first desktop workflow, navigation, then remaining desktop/mobile workflows. No builds, frontend suites, database plans/advisors or log queries ran alongside measured journeys. Normal desktop applications remained open; the staging service was not reserved against ordinary traffic.
- Cold navigation clears the Chromium cache just before reload; repeat retains it. This does not force a Vercel function cold start. Synthetic PDFs are exactly 1 MiB, 5 MiB or 10 MiB minus 1 KiB each, matching September. Files are selected from disk before upload timing begins.

## Short comparison

Desktop / mobile are shown in that order. Times are medians; counts are ranges of requests initiated during each action. Detailed [measurements](../${dir}/measurements.md) also show the September-compatible count of finished non-vitals requests, slowest times, browser/HTTP failures and response bytes.

${comparison.join('\n')}

There were **${workflow.filter(s=>s.status!=='ok').length} workflow failures** and **${workflow.flatMap(s=>s.requests).filter(r=>r.status>=400).length} HTTP errors during measured workflows**. Reload windows contain browser request failures and unfinished reads/telemetry; those are retained, rather than counted as successful requests or hidden. A 204 received before the browser reports a request failure is still evidence of receiver acceptance. The new request count convention includes such requests, whereas September counted completed requests only. Telemetry and overlapping restore/poll requests are identified separately in raw rows. Response sizes are compressed body bytes where available, with nulls for missing sizes; totals are not a complete byte census when requests remain unfinished.

Workflow timing starts at the captured button click and ends at the success notification/selected-file reset plus two animation frames. Upload timing waits for finalisation and final success, not the prepare response. Navigation ends at visible sale controls, using wall time from reload initiation; September used time since the replacement document's time origin. This small boundary difference, fresh fixture data, browser revision and the September report's concurrent diagnostics limit fine-grained comparisons. Background restore reads can still overlap the next action, as in the original journeys.

## Server timing and Web Vitals

Raw request rows retain the complete \`Server-Timing\` header and parsed durations, call counts and completion offsets. [Phase summaries](../${dir}/server-timing-summary.json) distinguish context GETs, ordinary mutations, upload preparation and finalisation. Observed new spans include \`body_read\`, \`json_parse\`, \`multipart_parse\`, \`file_prepare\`, \`upload_prepare\`, \`storage_read\`, \`storage_verify\` and \`finalization\`, alongside \`route\`, auth, database, Storage write/cleanup and email spans where those phases execute. Parent verification/finalisation spans overlap child spans: do not add them. Direct PDF transfer enters Storage, not Next.js, so its duration belongs to browser Storage requests, not an invented server inbound-transfer phase.

Browser evidence contains **${vitalSummary.total} allowlisted payloads**, with **${vitalSummary.accepted204} observed 204 responses**, ${vitalSummary.noResponseObserved} without an observed response, and bodies of ${vitalSummary.bodyByteRange} bytes. All bodies use only \`metric\`, \`value\`, \`rating\`, \`route\`; observed metrics are ${vitalSummary.metrics.join(', ')}. Query/hash checks emitted only \`portal\`, \`request-access\`, and \`other\`. A bounded runtime query returned 100 log entries, all with permitted payloads and all four metrics; it includes repeated connector rows, so that count is not distinct navigations. Browser unloads often prevent observing the collector response; runtime logs still show received INP/CLS records. Null browser status is not proof of lost delivery. Route-label checks and runtime confirmation are saved in the [telemetry evidence](../${dir}/web-vitals-runtime-observation.json). No cookies, authorisation or referrer headers were observed on collector requests. Local evidence metadata (profile/time) is outside the transmitted four-field payload; initial login records labelled admin/agent/conveyancer are unthrottled setup observations.

**Web Vitals are an initial observation, not a reliable field baseline.** These are controlled browser samples plus a limited runtime-log observation. There is insufficient identifiable real traffic to establish field distributions, and the collector intentionally has no device/session/metric IDs, so callbacks cannot be deduplicated into exact navigations. No field p75 or standard CLS comparison with September is claimed: the original report had neither field INP nor valid standard CLS. Page metrics also do not measure legal-action readiness or upload completion.

Raw [workflow samples](../${dir}/workflow-samples.json), [navigation samples](../${dir}/navigation-samples.json), [browser vitals](../${dir}/web-vitals-browser.json), [deployment identity](../${dir}/deployment.json) and [evidence README](../${dir}/README.md) are retained beside the original evidence. No real-account trace, screenshot, DOM dump, request/response business body, signed URL, credential or PDF content is saved.
`;
fs.writeFileSync('docs/sales-performance-baseline-2026-10-04.md',report);
console.log(JSON.stringify({workflowSamples:workflow.length,navigationSamples:navigation.length,workflowFailures:workflow.filter(s=>s.status!=='ok').length,httpFailures:workflow.flatMap(s=>s.requests).filter(r=>r.status>=400).length}));
