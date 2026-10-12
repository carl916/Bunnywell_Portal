// Summarise safe timing evidence; overlapping read sums are never wall-clock time.
import fs from 'node:fs';
const root='test-results/dashboard-stage2';
const files=['local-before','deployed-before','local-paired','local-confirmation','deployed-paired'];
const evidence=files.map(name=>({name,...JSON.parse(fs.readFileSync(`${root}/${name}.json`))}));
const round=n=>Math.round(n*100)/100;
const stats=values=>{const x=values.filter(Number.isFinite).sort((a,b)=>a-b);return {n:x.length,median:x.length?round((x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2):null,worst:x.length?round(x.at(-1)):null};};
const phase=(s,phase)=>Number(s.serverTiming?.match(new RegExp(`(?:^|, )${phase};dur=([\\d.]+)`))?.[1]);
const end=s=>s.end??s.bodyEnd??s.headers??s.start;
const metrics=s=>{const spans=s.trace?.spans??[],data=spans.filter(x=>x.stage==='data'),stage=k=>s.trace?.stages.find(x=>x.stage===k)?.start;
 return {apiMs:s.durationMs,handlerMs:s.trace?.totalMs??phase(s,'route'),dbReadEndMs:phase(s,'db_read_end'),summedDbRoundTripMs:phase(s,'db_read'),dataPhaseMs:stage('profile.final')-stage('data'),dataReadEndMs:data.length?Math.max(...data.map(end)):NaN,deriveMs:s.trace?s.trace.totalMs-stage('derive'):NaN,salesDependencyWaitMs:spans.find(x=>x.operation==='sale_workflow_context')?.start-end(spans.find(x=>x.operation==='unit_sale_attempts')??{}),bytes:s.bytes};};
const summary={note:'Local measurements use real staging network/DB latency but do not represent Vercel API latency. n=5/10 is insufficient for a stable p95; report median and worst. First requests are observed, not proven cold starts.',groups:[]};
for(const set of evidence)for(const scope of ['all','single'])for(const variant of [...new Set(set.samples.map(s=>s.variant))]){
 const samples=set.samples.filter(s=>s.scope===scope&&s.variant===variant);if(!samples.length)continue;
 const group={set:set.name,scope,variant,n:samples.length,metrics:{},snapshotsIdentical:new Set(samples.map(s=>s.hash)).size===1,firstRequestMs:round(samples[0].durationMs)};
 for(const key of Object.keys(metrics(samples[0])))group.metrics[key]=stats(samples.map(s=>metrics(s)[key]));
 const names=[...new Set(samples.flatMap(s=>s.trace?.spans.map(x=>`${x.stage}/${x.operation}`)??[]))];
 group.operations=names.map(name=>{const [stage,operation]=name.split('/'),spans=samples.flatMap(s=>s.trace?.spans.filter(x=>x.stage===stage&&x.operation===operation)??[]);return {stage,operation,callsPerRequest:spans.length/samples.length,start:stats(spans.map(s=>s.start)),end:stats(spans.map(end)),roundTrip:stats(spans.map(s=>end(s)-s.start)),headers:stats(spans.map(s=>s.headers-s.start)),body:stats(spans.map(s=>s.bodyMs)),upstream:stats(spans.map(s=>s.upstreamMs)),bytes:stats(spans.map(s=>s.bytes))};});
 summary.groups.push(group);
}
summary.pairs=evidence.filter(e=>['local-paired','local-confirmation','deployed-paired'].includes(e.name)).flatMap(paired=>['all','single'].map(scope=>{const pairs=Array.from({length:10},(_,run)=>{const a=paired.samples.find(s=>s.scope===scope&&s.variant==='baseline'&&s.run===run),b=paired.samples.find(s=>s.scope===scope&&s.variant==='current'&&s.run===run);return {run,baselineMs:round(a.durationMs),currentMs:round(b.durationMs),savedMs:round(a.durationMs-b.durationMs),sameSnapshot:a.hash===b.hash,sameCompleteSnapshot:a.completeSnapshotHash&&b.completeSnapshotHash?a.completeSnapshotHash===b.completeSnapshotHash:null,sameCallCount:a.trace&&b.trace?a.trace.spans.length===b.trace.spans.length:null};});return {set:paired.name,scope,fasterPairs:pairs.filter(p=>p.savedMs>0).length,pairedSavingsMs:stats(pairs.map(p=>p.savedMs)),pairs};}));
fs.mkdirSync('docs/dashboard-stage2',{recursive:true});
fs.writeFileSync('docs/dashboard-stage2/measurements.json',JSON.stringify({...summary,groups:undefined,pairs:undefined}).slice(0,-1)+',\n"groups": [\n'+summary.groups.map(g=>JSON.stringify(g)).join(',\n')+'\n],\n"pairs": [\n'+summary.pairs.map(g=>JSON.stringify(g)).join(',\n')+'\n]}\n');
// Strip correlation IDs, process identity and precise wall-clock timestamps from shared traces.
for(const set of evidence){const safe={environment:set.environment,baseline:set.baseline,commit:set.commit,samples:set.samples.map(s=>({...s,trace:s.trace?{totalMs:s.trace.totalMs,region:s.trace.region,stages:s.trace.stages,spans:s.trace.spans.map(span=>Object.fromEntries(Object.entries(span).filter(([key])=>!["requestId","ray"].includes(key))))}:null}))};fs.writeFileSync(`docs/dashboard-stage2/${set.name}.json`,JSON.stringify({...safe,samples:undefined}).slice(0,-1)+',\n"samples": [\n'+safe.samples.map(sample=>JSON.stringify(sample)).join(',\n')+'\n]}\n');}
for(const g of summary.groups)console.log(JSON.stringify({set:g.set,scope:g.scope,variant:g.variant,metrics:g.metrics}));
console.log(JSON.stringify(summary.pairs.map(group=>({set:group.set,scope:group.scope,fasterPairs:group.fasterPairs,pairedSavingsMs:group.pairedSavingsMs}))));
