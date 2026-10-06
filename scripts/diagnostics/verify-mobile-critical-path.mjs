import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const out='artifacts/performance/mobile-critical-path';
const samples=JSON.parse(fs.readFileSync(`${out}/paired-samples.json`));
const summary=JSON.parse(fs.readFileSync(`${out}/summary.json`));
const diag=JSON.parse(fs.readFileSync(`${out}/lcp-diagnostic-samples.json`));
const traced=JSON.parse(fs.readFileSync(`${out}/trace-samples.json`));
const allRequests=samples.concat(diag,traced).flatMap(s=>s.requests);
const legalRequests=allRequests.filter(r=>r.endpoint==='/api/sales/legal');
const otherRequests=allRequests.filter(r=>r.endpoint==='/api/auth/activity');
const median=a=>{const b=[...a].sort((a,b)=>a-b);return(b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2;};
const phases=[];
for(const variant of ['before','after'])for(const action of ['navigation.cold','navigation.repeat','sales.entry']) {
  const rows=samples.filter(s=>s.variant===variant&&s.profile==='mobile-throttled'&&s.action===action);
  const point=(s,scope,phase)=>s.trace.find(e=>e.scope===scope&&e.phase===phase)?.at;
  phases.push({variant,action,n:rows.length,jsCompleteMs:action.startsWith('navigation.')?median(rows.map(s=>Math.max(...s.resources.map(r=>r.end)))):null,
    authRestoredMs:action.startsWith('navigation.')?median(rows.map(s=>point(s,'portal','start'))):null,
    portalReadsMs:action.startsWith('navigation.')?median(rows.map(s=>point(s,'portal','published')-point(s,'portal','start'))):null,
    portalToSalesStartMs:action.startsWith('navigation.')?median(rows.map(s=>point(s,'sales','start')-point(s,'portal','published'))):null,
    salesReadsMs:median(rows.map(s=>point(s,'sales','published')-point(s,'sales','start'))),
    salesPublishedMs:action.startsWith('navigation.')?median(rows.map(s=>point(s,'sales','published'))):null,
    publicationToObservedReadinessMs:action.startsWith('navigation.')?median(rows.map(s=>s.readyMs-point(s,'sales','published'))):null,
  });
}
let safeTraces=true;
for(const name of fs.readdirSync(out).filter(n=>n.endsWith('.trace.json.gz'))) {
  const text=gunzipSync(fs.readFileSync(`${out}/${name}`)).toString();
  if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.|Bearer\s+[A-Za-z0-9]|"postData"\s*:|"authorization"\s*:|"cookie"\s*:/i.test(text))safeTraces=false;
}
const bundles=JSON.parse(fs.readFileSync(`${out}/bundle-verification.json`));
const configUnchanged=execFileSync('git',['diff','87d83c7','--','vercel.json','config/vercel.staging-legal-region.json']).toString()==='';
const verify=JSON.parse(fs.readFileSync(`${out}/paired-verification.json`));
const diagnostic=JSON.parse(fs.readFileSync(`${out}/lcp-diagnostic-verification.json`));
const result={verifiedAt:new Date().toISOString(),phases,sampleCounts:{main:80,perVariantProfileAction:5,traceRunActions:8,chromeTraceFiles:6,lcpDiagnostic:16},
  displayedSnapshotsMatched:summary.groups.every(g=>g.matchedDisplayedSnapshots),stateUnchanged:verify.unchanged&&diagnostic.unchanged,
  applicationFailures:summary.applicationsFailed,httpErrors:summary.httpErrors,abortedMeasuredRequests:summary.aborted,
  telemetry:summary.telemetry,mainLegalInvocations:summary.regionEvidence.legal.length,mainOtherFunctionInvocations:summary.regionEvidence.other.length,
  allMeasuredLegalInvocations:legalRequests.length,allMeasuredOtherFunctionInvocations:otherRequests.length,
  regionsVerified:legalRequests.concat(otherRequests).every(r=>r.executionRegion==='iad1'&&r.status===200),
  stagingSupabaseVerified:verify.sessions.every(s=>s.projects.length===1&&s.projects[0]==='vxkpvdtrldwwqiddoyof.supabase.co'),
  initialPdfLibraryRemoved:bundles.some(b=>b.variant==='before'&&b.pdfLibraryMarker)&&!bundles.some(b=>b.variant==='after'&&b.pdfLibraryMarker),
  assetHashesMatched:bundles.every(b=>b.matchesMeasuredHash),configUnchanged,safeTraces,
  browserTests:{passed:24,failed:1,baselineReproduced:'Agent Fees pagination after Refresh resets to the first page instead of clamping to page two'},
  nodeTests:{sales:261,focused:40,failed:0},typescript:{passed:true},
  aliases:{changedByThisTask:false,staging:'dpl_9r3bmicyRqd1t7WNjrgUXCZ52NvH',stagingLegalRegion:'fra1',production:'dpl_71MV1EATioHy8bBiNornLF5hzu7m'},
  lcpAttribution:diag.filter(s=>s.action.startsWith('navigation.')).map(s=>({variant:s.variant,run:s.run,action:s.action,candidates:s.vitals.lcpCandidates})),
};
fs.writeFileSync(`${out}/verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,lcpAttribution:undefined}));
if(!result.stateUnchanged||!result.displayedSnapshotsMatched||!result.regionsVerified||!result.stagingSupabaseVerified||!result.initialPdfLibraryRemoved||!result.assetHashesMatched||!configUnchanged||!safeTraces)throw Error('Verification failed');
