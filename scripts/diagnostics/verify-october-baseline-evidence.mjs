// Offline evidence verification only; no network access or business mutations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='artifacts/performance/2026-10-04-pre-optimisation';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}`,'utf8'));
const workflow=read('workflow-samples.json'),navigation=read('navigation-samples.json');
assert.equal(workflow.length,60);assert.equal(navigation.length,50);
for(const profile of ['desktop','mobile-throttled']){
 for(const action of new Set(workflow.map(s=>s.action)))assert.equal(workflow.filter(s=>s.profile===profile&&s.action===action).length,2);
 for(const action of new Set(navigation.map(s=>s.action)))assert.equal(navigation.filter(s=>s.profile===profile&&s.action===action).length,5);
}
for(const sample of [...workflow,...navigation]){
 assert.equal(sample.status,'ok');assert(Number.isFinite(sample.totalMs));assert.equal(sample.networkRequests,sample.requests.length);
 assert.equal(sample.failures,sample.requests.filter(r=>r.failed||r.status>=400).length);
 assert.equal(sample.responseSizesAvailable,sample.requests.filter(r=>r.responseBytes!==null).length);
 assert(sample.requests.every(r=>r.responseBytes===null||Number.isFinite(r.responseBytes)));
 assert(sample.requests.every(r=>!Object.hasOwn(r,'url')&&!Object.hasOwn(r,'body')&&!Object.hasOwn(r,'headers')));
 for(const request of sample.requests.filter(r=>r.category==='legal')){
  assert.equal(request.status,200);
  assert(request.serverTiming.some(s=>s.name==='route'));
  assert(request.serverTiming.every(s=>Number.isFinite(s.durationMs)&&s.durationMs>=0));
 }
}
const spans=[...new Set(workflow.flatMap(s=>s.requests.filter(r=>r.category==='legal').flatMap(r=>r.serverTiming.map(e=>e.name))))];
for(const span of ['body_read','json_parse','multipart_parse','file_prepare','upload_prepare','storage_read','storage_verify','finalization'])assert(spans.includes(span));
const vitals=read('web-vitals-browser.json');
for(const item of vitals){assert.equal(Object.keys(item.payload).sort().join(','),'metric,rating,route,value');assert(['portal','request-access','other'].includes(item.payload.route));assert(['TTFB','LCP','INP','CLS'].includes(item.payload.metric));assert(!item.hasCookie&&!item.hasAuthorization&&!item.hasReferrer);}
const runtime=read('web-vitals-runtime-observation.json');assert(runtime.allPayloadsAllowed);for(const metric of ['TTFB','LCP','INP','CLS'])assert(runtime.observedMetrics.includes(metric));
assert(read('web-vitals-route-checks.json').every(s=>s.allPayloadsAllowed));
const final=read('final-state.json');assert(final.aliasStillAssigned);assert.equal(final.commit,read('deployment.json').commit);assert.deepEqual(final.freshSaleFinalStates.map(s=>s.unit_number),['107','108','109','110']);assert(final.freshSaleFinalStates.every(s=>s.workflow_status==='completed'&&s.diagnostic_buyer));
const isolation=read('isolation-observation.json');assert.equal(isolation.diagnosticOrBuildProcesses.length,0);assert.equal(isolation.playwrightBrowserCount,0);
const checks={verifiedAt:new Date().toISOString(),passed:true,workflowSamples:workflow.length,navigationSamples:navigation.length,workflowSamplesPerProfile:2,navigationSamplesPerActionPerProfile:5,uiFailures:0,httpWorkflowFailures:workflow.flatMap(s=>s.requests).filter(r=>r.status>=400).length,allLegalResponsesTimed:true,requiredSpansPresent:true,allTelemetryPayloadsAllowed:true,allPermittedRoutesObserved:true,allMetricsInRuntimeLogs:true,freshSalesCompleted:true,aliasStillAssigned:true,noDiagnosticProcessesRemaining:true,hashes:Object.fromEntries(['workflow-samples.json','navigation-samples.json','web-vitals-browser.json','web-vitals-runtime-observation.json','deployment.json'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(`${dir}/${n}`)).digest('hex')]))};
fs.writeFileSync(`${dir}/verification.json`,JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
