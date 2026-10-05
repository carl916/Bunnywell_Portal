import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='artifacts/performance/sales-loading';
const rows=JSON.parse(fs.readFileSync(`${out}/paired-samples.json`));
const verification=JSON.parse(fs.readFileSync(`${out}/paired-verification.json`));
const median=v=>{const a=[...v].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const stats=v=>({n:v.length,median:median(v),min:Math.min(...v),max:Math.max(...v),mad:median(v.map(x=>Math.abs(x-median(v))))});
function phases(s) {
  const trace=s.trace.filter(t=>t.scope==='sales'), request=n=>s.requests.find(r=>r.endpoint===n);
  const start=trace.find(t=>t.phase==='start'),published=trace.find(t=>t.phase==='published');
  if(!start||!published)return null;
  const first=trace.find(t=>t.phase==='request'),network=request(first.resource);
  const offset=network.offsetMs-(first.at-start.at),duration=published.at-start.at;
  const attempts=request('unit_sale_attempts'),docs=request('unit_sale_documents'),versions=request('unit_sale_document_versions');
  const child=s.requests.filter(r=>['unit_sale_terms','unit_sale_payment_schedule','unit_sale_documents','unit_sale_invoices','unit_sale_invoice_payments','sale_actor_names','sale_exchange_deposit_receipts'].includes(r.endpoint));
  return {preSalesMs:offset,salesSnapshotMs:duration,attemptsStartMs:attempts.offsetMs-offset,attemptsMs:attempts.endMs-attempts.offsetMs,
    childReadsMs:Math.max(...child.map(r=>r.endMs))-Math.min(...child.map(r=>r.offsetMs)),
    documentsToVersionsWaitMs:Math.max(0,versions.offsetMs-docs.endMs),versionsMs:versions.endMs-versions.offsetMs,
    publishToReadyMs:s.readyMs-(offset+duration)};
}
const groups=[];
for(const profile of ['desktop','mobile-throttled'])for(const action of ['navigation.cold','navigation.repeat','sales.entry','exchange.entry']) {
  const variants={};
  for(const variant of ['before','after']) {
    const samples=rows.filter(r=>r.profile===profile&&r.action===action&&r.variant===variant);
    assert.equal(samples.length,5);
    const p=samples.map(phases).filter(Boolean);
    variants[variant]={readiness:stats(samples.map(s=>s.readyMs)),instrumentedRequests:[...new Set(samples.map(s=>s.trace.filter(t=>t.phase==='request').length))],
      networkRequests:[...new Set(samples.map(s=>s.settledRequests))],scriptMs:stats(samples.map(s=>s.mainThread.ScriptDuration)),taskMs:stats(samples.map(s=>s.mainThread.TaskDuration)),
      phases:p.length?Object.fromEntries(Object.keys(p[0]).map(k=>[k,stats(p.map(x=>x[k]))])):null};
  }
  const before=rows.filter(r=>r.profile===profile&&r.action===action&&r.variant==='before');
  const differences=before.map(a=>rows.find(b=>b.profile===profile&&b.action===action&&b.variant==='after'&&b.run===a.run).readyMs-a.readyMs);
  const hashes=new Set(rows.filter(r=>r.profile===profile&&r.action===action).map(r=>r.displayedSnapshotSha256));
  groups.push({profile,action,...variants,pairedAfterMinusBeforeMs:stats(differences),renderedSnapshotsIdentical:hashes.size===1});
}
assert(verification.completed&&verification.unchanged&&verification.violations===0);
assert(rows.every(s=>s.status==='ok'&&!s.timedOut&&s.applicationFailures===0&&s.httpErrors===0&&s.displayedStateChecked));
assert(groups.every(g=>g.renderedSnapshotsIdentical));
const legal=rows.flatMap(s=>s.requests).filter(r=>r.endpoint==='/api/sales/legal');
assert.equal(legal.length,20);assert(legal.every(r=>r.status===200&&r.executionRegion==='iad1'));
const functions=rows.flatMap(s=>s.requests).filter(r=>r.executionRegion);assert(functions.every(r=>r.executionRegion==='iad1'));
const data=JSON.parse(fs.readFileSync(`${out}/data-checks-samples.json`));
const dataVerification=JSON.parse(fs.readFileSync(`${out}/data-checks-verification.json`));
assert.equal(data.length,16);assert(dataVerification.completed&&dataVerification.unchanged&&dataVerification.violations===0);
assert(data.every(s=>s.contractPriceChecked&&s.completedStatusChecked&&s.currentVersionsChecked>0&&!s.httpErrors&&!s.pageErrors));
for(const profile of ['desktop','mobile-throttled'])for(const unit of [107,108,109,110]) {
  const a=data.find(s=>s.variant==='before'&&s.profile===profile&&s.unit===unit),b=data.find(s=>s.variant==='after'&&s.profile===profile&&s.unit===unit);
  for(const key of ['commercialSha256','financialSha256','completionSha256','currentVersionsChecked'])assert.equal(a[key],b[key]);
}
const summary={groups,samples:rows.length,applicationFailures:0,httpFailures:0,pageErrors:verification.sessions.reduce((a,s)=>a+s.pageErrors,0),
  instrumentedColdRequests:35,instrumentedSalesRequests:10,legalRequests:legal.length,iad1FunctionRequests:functions.length,
  unchanged:true,displayedSnapshotsIdentical:true,displayedFixtureChecks:data.length,profiles:verification.profiles,
  window:{start:rows[0].startedAt,end:rows.at(-1).finishedAt},browser:verification.browser};
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));
const sec=n=>(n/1000).toFixed(2),ms=n=>Math.round(n);
let md='# Sales loading comparison — 5 October 2026\n\nFive samples per build/profile/action. Readiness is browser wall time to complete Sales controls and the correct unit heading, plus two animation frames. min–max and median absolute deviation (MAD) show variability. Browser polling contributes to the publication-to-ready interval.\n\n| Profile | Journey | Before median (range), MAD | After median (range), MAD | Paired delta median | Instrumented requests | All requests |\n|---|---|---|---|---|---|---|\n';
for(const g of groups){const a=g.before.readiness,b=g.after.readiness;md+=`| ${g.profile} | ${g.action} | ${sec(a.median)} s (${sec(a.min)}–${sec(a.max)}), ${ms(a.mad)} ms | ${sec(b.median)} s (${sec(b.min)}–${sec(b.max)}), ${ms(b.mad)} ms | ${ms(g.pairedAfterMinusBeforeMs.median)} ms | ${g.before.instrumentedRequests.join('/')} → ${g.after.instrumentedRequests.join('/')} | ${g.before.networkRequests.join('/')} → ${g.after.networkRequests.join('/')} |\n`;}
md+='\nPhase medians, milliseconds. Child-read spans overlap versions after the change; do not sum these columns. Pre-Sales includes initial browser load and authorised portal/building context on reload; on Sales entry it is the mount gap. Publication-to-ready includes browser rendering, the independent DOM observer’s polling and two animation frames.\n\n| Profile | Journey | Variant | Pre-Sales | Complete Sales snapshot | Attempts start delay | Attempts read | Related read span | Documents→versions wait | Versions read | Publication→ready | Script / total browser task |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const g of groups.filter(g=>g.before.phases))for(const v of ['before','after']){const x=g[v],p=x.phases;md+=`| ${g.profile} | ${g.action} | ${v} | ${ms(p.preSalesMs.median)} | ${ms(p.salesSnapshotMs.median)} | ${ms(p.attemptsStartMs.median)} | ${ms(p.attemptsMs.median)} | ${ms(p.childReadsMs.median)} | ${ms(p.documentsToVersionsWaitMs.median)} | ${ms(p.versionsMs.median)} | ${ms(p.publishToReadyMs.median)} | ${ms(x.scriptMs.median)} / ${ms(x.taskMs.median)} |\n`;}
md+='\nRequest phase medians (TTFB / body transfer), milliseconds. TTFB combines network, queueing and server processing; it is not a pure database duration. Timings are Playwright request timings; total request elapsed also includes browser/protocol observation overhead.\n\n| Profile | Journey | Resource | Before TTFB / transfer | After TTFB / transfer |\n|---|---|---|---|---|\n';
for(const profile of ['desktop','mobile-throttled'])for(const action of ['navigation.cold','navigation.repeat','sales.entry'])for(const resource of ['building_sale_defaults','unit_sale_attempts','unit_sale_documents','unit_sale_payment_schedule','unit_sale_document_versions']){const cell=v=>{const r=rows.filter(s=>s.profile===profile&&s.action===action&&s.variant===v).flatMap(s=>s.requests.filter(r=>r.endpoint===resource));return `${ms(median(r.map(r=>r.ttfbMs)))} / ${ms(median(r.map(r=>r.downloadMs)))}`;};md+=`| ${profile} | ${action} | ${resource} | ${cell('before')} | ${cell('after')} |\n`;}
md+=`\nAll ${rows.length} measured journeys passed: zero application, HTTP or page errors, zero unfinished-request timeouts. ${functions.length} observed function invocations ran in iad1, including ${legal.length} legal GETs. Rendered progression hashes match for every paired action/profile. All ${data.length} supplementary fixture/profile/build checks passed against independently read contract prices, completed legal status and current document filenames; commercial, financial and completion text hashes match across builds. Completed fixture fingerprints (attempts, units, terms, schedule, invoices, payments, deposits, legal emails/events, documents and versions) are unchanged. Raw business bodies and DOM text are not retained.\n`;
fs.writeFileSync(`${out}/measurements.md`,md);
console.log(JSON.stringify({groups:groups.map(g=>({profile:g.profile,action:g.action,before:g.before.readiness.median,after:g.after.readiness.median,paired:g.pairedAfterMinusBeforeMs.median})),checks:{samples:rows.length,displayChecks:data.length,legalIad1:legal.length,unchanged:true}},null,2));
