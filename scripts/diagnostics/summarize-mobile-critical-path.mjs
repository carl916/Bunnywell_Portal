import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
const out='artifacts/performance/mobile-critical-path';
const samples=JSON.parse(fs.readFileSync(`${out}/paired-samples.json`));
const traceSamples=JSON.parse(fs.readFileSync(`${out}/trace-samples.json`));
const median=a=>{const s=[...a].sort((a,b)=>a-b);return(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
const stats=a=>({median:median(a),min:Math.min(...a),max:Math.max(...a),mad:median(a.map(x=>Math.abs(x-median(a))))});
const groups=[];
for(const profile of ['desktop','mobile-throttled'])for(const action of ['navigation.cold','navigation.repeat','sales.entry','exchange.entry']) {
  const b=samples.filter(s=>s.profile===profile&&s.action===action&&s.variant==='before');
  const a=samples.filter(s=>s.profile===profile&&s.action===action&&s.variant==='after');
  const metrics={};
  for(const v of ['before','after']) {
    const rows=v==='before'?b:a;
    metrics[v]={n:rows.length,readinessMs:stats(rows.map(s=>s.readyMs)),lastRequestEndMs:stats(rows.map(s=>s.lastRequestEndMs)),requestCounts:[...new Set(rows.map(s=>s.settledRequests))],
      transferredJs:stats(rows.map(s=>s.transferredJavaScript)),encodedJs:stats(rows.map(s=>s.encodedJavaScript)),decodedJs:stats(rows.map(s=>s.decodedJavaScript)),
      mainThread:Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,stats(rows.map(s=>s.mainThread[k]))])),
      longTasks:stats(rows.map(s=>s.vitals.longTasks.reduce((n,t)=>n+t.duration,0))),longTaskCount:stats(rows.map(s=>s.vitals.longTasks.length)),
      ...(action.startsWith('navigation.')?{lcpMs:stats(rows.map(s=>s.vitals.lcp)),cls:stats(rows.map(s=>s.vitals.cls)),ttfbMs:stats(rows.map(s=>s.navigation[0].ttfb))}:{}),
    };
  }
  groups.push({profile,action,...metrics,pairedReadinessDeltaMs:stats(a.map(s=>s.readyMs-b.find(t=>t.run===s.run).readyMs)),matchedDisplayedSnapshots:a.every(s=>s.displayedSnapshotSha256===b.find(t=>t.run===s.run).displayedSnapshotSha256)});
}
// Compress retained Chrome JSON; metadata stays readable and source URLs have
// already been stripped of query strings and business identifiers.
for(const name of fs.readdirSync(out).filter(n=>n.endsWith('.trace.json'))) {
  fs.writeFileSync(`${out}/${name}.gz`,gzipSync(fs.readFileSync(`${out}/${name}`)));
  fs.unlinkSync(`${out}/${name}`);
}
for(const s of traceSamples)if(s.tracePath&&!s.tracePath.endsWith('.gz'))s.tracePath+='.gz';
fs.writeFileSync(`${out}/trace-samples.json`,JSON.stringify(traceSamples,null,2));
const timeline=[];
for(const s of traceSamples.filter(s=>s.tracePath)) {
  const events=JSON.parse(gunzipSync(fs.readFileSync(`${out}/${s.tracePath}`))).traceEvents;
  const threads=events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>`${e.pid}/${e.tid}`);
  const main=events.filter(e=>e.ph==='X'&&e.dur&&threads.includes(`${e.pid}/${e.tid}`));
  const union=es=>{const spans=es.map(e=>[e.ts,e.ts+e.dur]).sort((a,b)=>a[0]-b[0]);let total=0,end=0;for(const [a,b]of spans){if(b>end){total+=b-Math.max(a,end);end=b;}}return total/1000;};
  const totals={};for(const e of main)totals[e.name]=(totals[e.name]??0)+e.dur/1000;
  timeline.push({variant:s.variant,profile:s.profile,action:s.action,tracePath:s.tracePath,
    // Categories overlap; use union within each category, never add categories.
    compileMs:union(main.filter(e=>/compile|parse/i.test(e.name))),
    scriptMs:union(main.filter(e=>/EvaluateScript|FunctionCall|RunMicrotasks/.test(e.name))),
    renderingMs:union(main.filter(e=>/Layout|UpdateLayoutTree|Paint|PrePaint/.test(e.name))),
    largestSpans:main.filter(e=>!/RunTask/.test(e.name)).sort((a,b)=>b.dur-a.dur).slice(0,5).map(e=>({name:e.name,durationMs:e.dur/1000})),
  });
}
const requests=samples.flatMap(s=>s.requests);
const summary={groups,timeline,totalSamples:samples.length,traceSamples:traceSamples.length,
  applicationsFailed:samples.reduce((n,s)=>n+s.applicationFailures,0),httpErrors:samples.reduce((n,s)=>n+s.httpErrors,0),timeouts:samples.filter(s=>s.timedOut).length,
  aborted:samples.flatMap(s=>s.aborted),telemetry:{requests:requests.filter(r=>r.kind==='telemetry').length,accepted204:requests.filter(r=>r.kind==='telemetry'&&r.status===204).length,unknown:requests.filter(r=>r.kind==='telemetry'&&r.status===null).length},
  regionEvidence:{legal:requests.filter(r=>r.endpoint==='/api/sales/legal').map(r=>({status:r.status,executionRegion:r.executionRegion,vercelId:r.vercelId})),other:requests.filter(r=>r.endpoint==='/api/auth/activity').map(r=>({status:r.status,executionRegion:r.executionRegion,vercelId:r.vercelId}))},
};
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify({groups:groups.map(g=>({profile:g.profile,action:g.action,before:g.before.readinessMs,after:g.after.readinessMs,paired:g.pairedReadinessDeltaMs,displayedMatch:g.matchedDisplayedSnapshots,script:[g.before.mainThread.ScriptDuration.median,g.after.mainThread.ScriptDuration.median],task:[g.before.mainThread.TaskDuration.median,g.after.mainThread.TaskDuration.median],lcp:[g.before.lcpMs?.median,g.after.lcpMs?.median]})),timeline,totalSamples:summary.totalSamples,applicationFailures:summary.applicationsFailed,aborted:summary.aborted.length,legalInvocations:summary.regionEvidence.legal.length,otherInvocations:summary.regionEvidence.other.length}));
if(groups.some(g=>g.before.n!==5||g.after.n!==5||!g.matchedDisplayedSnapshots)||summary.applicationsFailed||summary.httpErrors||summary.timeouts||summary.regionEvidence.legal.some(r=>r.status!==200||r.executionRegion!=='iad1')||summary.regionEvidence.other.some(r=>r.status!==200||r.executionRegion!=='iad1'))throw Error('Evidence verification failed');
