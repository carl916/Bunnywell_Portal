import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] ?? 'test-results/pr46-retest';
const destination = process.argv[3];
const round = n => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
function stats(values) {
  const a = values.filter(Number.isFinite).sort((a,b)=>a-b), n = a.length;
  return n ? { n, median: round((a[Math.floor((n-1)/2)]+a[Math.ceil((n-1)/2)])/2), p95: round(a[Math.ceil(.95*n)-1]), min: round(a[0]), max: round(a.at(-1)) } : null;
}
const phase = (s,key) => { const value=s.serverTiming?.match(new RegExp(`(?:^|, )${key};dur=([\\d.]+)`))?.[1]; return value === undefined ? NaN : Number(value); };
const end = s => s?.end ?? s?.bodyEnd ?? s?.headers ?? NaN;
function metrics(s) {
  const spans = s.trace?.spans ?? [], data=spans.filter(x=>x.stage==='data'), stage=k=>s.trace?.stages.find(x=>x.stage===k)?.start;
  const events=spans.flatMap(x=>[{at:x.start,delta:1},{at:end(x),delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta);
  let active=0,peak=0; for(const e of events){active+=e.delta;peak=Math.max(peak,active);}
  return { apiMs:s.durationMs, routeMs:s.trace?.totalMs??phase(s,'route'), authMs:phase(s,'auth'), dbCalls:spans.length?spans.filter(x=>x.operation!=='auth.validate').length:Number(s.serverTiming?.match(/db_read;dur=[\d.]+;desc="(\d+) calls"/)?.[1]??NaN),
    readDependencyMs:phase(s,'db_read_end')-phase(s,'auth_end'), lastDbReadOffsetMs:phase(s,'db_read_end'), dataPhaseMs:stage('profile.final')-stage('data'), deriveMs:s.trace?s.trace.totalMs-stage('derive'):NaN,
    salesHistoryWaitMs:spans.find(x=>x.operation==='sale_workflow_context')?.start-end(spans.find(x=>x.operation==='unit_sale_attempts')), peak:spans.length?peak:NaN, bytes:s.bytes };
}
const result={p95Method:'Nearest rank ceil(0.95*n); warmups excluded; positive savings favour candidate',groups:[],pairs:[],checks:[]};
for(const file of fs.readdirSync(dir).filter(x=>/^(deployed|local|contractor|resident).*\.json$/.test(x)).sort()) {
  const set=JSON.parse(fs.readFileSync(path.join(dir,file))), samples=set.samples.filter(s=>!s.warmup);
  result.checks.push({file,role:set.role,finished:!!set.finished,checks:set.checks});
  for(const scope of [...new Set(samples.map(s=>s.scope))]) {
    for(const variant of ['baseline','current']) {
      const selected=samples.filter(s=>s.scope===scope&&s.variant===variant);
      if(!selected.length)continue;
      const group={file,role:set.role,scope,variant,metrics:{},responseHashes:[...new Set(selected.map(s=>s.hash))],completeHashes:[...new Set(selected.map(s=>s.completeSnapshotHash).filter(Boolean))]};
      for(const key of Object.keys(metrics(selected[0])))group.metrics[key]=stats(selected.map(s=>metrics(s)[key]));
      group.operations=[...new Set(selected.flatMap(s=>s.trace?.spans.map(x=>`${x.stage}/${x.operation}`)??[]))].map(name=>{
        const [stage,operation]=name.split('/'),spans=selected.flatMap(s=>s.trace?.spans.filter(x=>x.stage===stage&&x.operation===operation)??[]);
        return {stage,operation,callsPerRequest:spans.length/selected.length,start:stats(spans.map(s=>s.start)),end:stats(spans.map(end)),rtt:stats(spans.map(s=>end(s)-s.start)),upstream:stats(spans.map(s=>s.upstreamMs)),body:stats(spans.map(s=>s.bodyMs)),bytes:stats(spans.map(s=>s.bytes))};
      });
      const lastData=selected.map(s=>s.trace?.spans.filter(x=>x.stage==='data').sort((a,b)=>end(b)-end(a))[0]?.operation).filter(Boolean);
      group.lastDataOperation=Object.fromEntries([...new Set(lastData)].map(x=>[x,lastData.filter(y=>y===x).length]));
      result.groups.push(group);
    }
    const pairs=[...new Set(samples.map(s=>s.run))].map(run=>{
      const a=samples.find(s=>s.run===run&&s.scope===scope&&s.variant==='baseline'),b=samples.find(s=>s.run===run&&s.scope===scope&&s.variant==='current');
      return a&&b?{run,baselineMs:a.durationMs,candidateMs:b.durationMs,savedMs:a.durationMs-b.durationMs,savedPct:100*(a.durationMs-b.durationMs)/a.durationMs,sameResponse:a.hash===b.hash,sameComplete:a.completeSnapshotHash? a.completeSnapshotHash===b.completeSnapshotHash:null}:null;
    }).filter(Boolean);
    let seed=123456789; const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const boot=Array.from({length:5000},()=>stats(Array.from({length:pairs.length},()=>pairs[Math.floor(random()*pairs.length)].savedMs)).median).sort((a,b)=>a-b);
    result.pairs.push({file,role:set.role,scope,n:pairs.length,faster:pairs.filter(p=>p.savedMs>0).length,fasterPct:round(100*pairs.filter(p=>p.savedMs>0).length/pairs.length),savedMs:stats(pairs.map(p=>p.savedMs)),savedPct:stats(pairs.map(p=>p.savedPct)),pairedMedianBootstrap95:[boot[124],boot[4874]],allResponsesEqual:pairs.every(p=>p.sameResponse),allCompleteEqual:pairs.every(p=>p.sameComplete===null)?null:pairs.every(p=>p.sameComplete),byOrder:[0,1].map(parity=>({first:(parity+(set.orderOffset??0))%2?'current':'baseline',savings:stats(pairs.filter(p=>p.run%2===parity).map(p=>p.savedMs))})),pairs});
  }
}
const deployedFiles=['deployed-batch1.json','deployed-batch2.json'];
if(deployedFiles.every(f=>fs.existsSync(path.join(dir,f)))) {
  const sets=deployedFiles.map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
  if(sets.every(s=>s.finished)) result.pooledDeployed=['all','single'].map(scope=>{
    const samples=sets.flatMap(s=>s.samples.filter(x=>!x.warmup&&x.scope===scope));
    const groups=Object.fromEntries(['baseline','current'].map(variant=>{
      const selected=samples.filter(s=>s.variant===variant);
      return [variant,Object.fromEntries(Object.keys(metrics(selected[0])).map(k=>[k,stats(selected.map(s=>metrics(s)[k]))]))];
    }));
    const pairs=result.pairs.filter(p=>deployedFiles.includes(p.file)&&p.scope===scope).flatMap(p=>p.pairs);
    return {scope,groups,pairs:pairs.length,faster:pairs.filter(p=>p.savedMs>0).length,fasterPct:round(100*pairs.filter(p=>p.savedMs>0).length/pairs.length),pairedSavedMs:stats(pairs.map(p=>p.savedMs)),allResponsesEqual:pairs.every(p=>p.sameResponse),apiDeltaMs:round(groups.current.apiMs.median-groups.baseline.apiMs.median),apiDeltaPct:round(100*(groups.current.apiMs.median-groups.baseline.apiMs.median)/groups.baseline.apiMs.median),p95DeltaMs:round(groups.current.apiMs.p95-groups.baseline.apiMs.p95),p95DeltaPct:round(100*(groups.current.apiMs.p95-groups.baseline.apiMs.p95)/groups.baseline.apiMs.p95)};
  });
}
if(destination)fs.writeFileSync(destination,JSON.stringify(result,null,2));
for(const g of result.groups)console.log(JSON.stringify({...g,operations:undefined,responseHashes:undefined,completeHashes:undefined}));
for(const p of result.pairs)console.log(JSON.stringify({...p,pairs:undefined}));
if(result.pooledDeployed)console.log(JSON.stringify({pooledDeployed:result.pooledDeployed}));
