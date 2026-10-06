import fs from 'node:fs';
export const out='artifacts/performance/2026-10-04-action-refresh-release';
fs.mkdirSync(out,{recursive:true});
const vitals=fs.existsSync(`${out}/web-vitals-browser.json`)?JSON.parse(fs.readFileSync(`${out}/web-vitals-browser.json`,'utf8')):[];
export function observe(){
  window.salesDiagnostic={start:0,click:null,feedback:null,longTasks:[]};
  const d=window.salesDiagnostic;
  for(const type of ['click','change'])document.addEventListener(type,()=>{if(d.start&&d.click===null)d.click=performance.now();},true);
  new PerformanceObserver(list=>{for(const e of list.getEntries())d.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
}
export function attachVitals(page,profile){
  page.on('request',r=>{
    if(new URL(r.url()).pathname!=='/api/performance/vitals')return;
    const body=r.postDataJSON(),keys=Object.keys(body).sort();
    const valid=JSON.stringify(keys)===JSON.stringify(['metric','rating','route','value'])&&['INP','LCP','CLS','TTFB'].includes(body.metric)&&['portal','request-access','other'].includes(body.route)&&['good','needs-improvement','poor'].includes(body.rating)&&Number.isFinite(body.value);
    if(!valid)throw Error('Unexpected telemetry payload; nothing sensitive persisted.');
    const headers=r.headers();
    const item={observedAt:new Date().toISOString(),profile:page.baselineProfile??profile,payload:body,bytes:Buffer.byteLength(r.postData()),hasCookie:!!headers.cookie,hasAuthorization:!!headers.authorization,hasReferrer:!!headers.referer,status:null};
    vitals.push(item);fs.writeFileSync(`${out}/web-vitals-browser.json`,JSON.stringify(vitals,null,2));
    r.response().then(response=>{item.status=response?.status()??null;fs.writeFileSync(`${out}/web-vitals-browser.json`,JSON.stringify(vitals,null,2));});
  });
}
function category(r){const p=new URL(r.url()).pathname;if(p==='/api/sales/legal')return 'legal';if(p==='/api/performance/vitals')return 'vitals';if(p.includes('/storage/'))return 'storage';if(p.includes('/rest/v1/'))return p.split('/').at(-1).replace(/[^a-z_]/g,'');if(p.includes('/auth/'))return 'auth';if(p.endsWith('.js'))return 'javascript';return 'other';}
function timing(header){return (header||'').split(',').filter(Boolean).map(entry=>{const name=entry.trim().split(';')[0];const dur=/;dur=([\d.]+)/.exec(entry);const calls=/desc="(\d+) calls"/.exec(entry);return {name,durationMs:dur?Number(dur[1]):null,...(calls?{calls:Number(calls[1])}:{})};});}
export function recorder(samples,output){return async function measure(page,action,run,profile,act,ready){
  const starts=new Map(),records=new Map(),pending=[]; let finalizationAt=null; const measurementStart=Date.now();
  const begin=r=>{starts.set(r,Date.now());records.set(r,{category:category(r),method:r.method(),startedOffsetMs:Date.now()-measurementStart,status:null,finished:false,failed:false,responseBytes:null,requestBytes:null,serverTiming:[]});};
  const response=r=>{if(new URL(r.url()).pathname==='/api/sales/legal' && r.request().method()==='POST' && r.request().postDataJSON()?.action==='finalize_completion_upload') finalizationAt=Date.now();const record=records.get(r.request());if(record){record.responseOffsetMs=Date.now()-measurementStart;record.status=r.status();record.serverTimingHeader=r.headers()['server-timing']??null;record.serverTiming=timing(record.serverTimingHeader);}};
  const end=r=>{const record=records.get(r);if(!record)return;record.finished=true;record.durationMs=Date.now()-starts.get(r);pending.push(r.sizes().then(size=>{record.responseBytes=size.responseBodySize;record.requestBytes=size.requestBodySize;}).catch(()=>{}));};
  const failed=r=>{const record=records.get(r);if(record){record.failed=true;record.failureReason=['net::ERR_ABORTED','net::ERR_FAILED'].includes(r.failure()?.errorText)?r.failure().errorText:'other';record.durationMs=Date.now()-starts.get(r);}};
  page.on('request',begin);page.on('response',response);page.on('requestfinished',end);page.on('requestfailed',failed);
  await page.evaluate(()=>{Object.assign(window.salesDiagnostic,{start:performance.now(),click:null});});
  const startedAt=new Date().toISOString(),wallStart=Date.now();let status='ok';
  try{await act();await ready();}catch{status='failed';}
  const browserResult=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=window.salesDiagnostic;const result={interactionMs:d.click===null?null:performance.now()-d.click,longTasks:d.longTasks.filter(t=>t.start>=d.start)};d.start=0;return result;});
  const wallMs=Date.now()-wallStart;
  page.off('request',begin);page.off('response',response);page.off('requestfinished',end);page.off('requestfailed',failed);await Promise.all(pending);
  const requests=[...records.values()];
  const sample={action,run,profile,startedAt,status,postFinalizationRefreshMs:finalizationAt===null?null:wallStart+wallMs-finalizationAt,totalMs:browserResult.interactionMs??wallMs,wallMs,longTasks:browserResult.longTasks,networkRequests:requests.length,finishedRequests:requests.filter(r=>r.finished).length,unfinishedRequests:requests.filter(r=>!r.finished&&!r.failed).length,failures:requests.filter(r=>r.failed||r.status>=400).length,responseBytes:requests.reduce((n,r)=>n+(r.responseBytes??0),0),responseSizesAvailable:requests.filter(r=>r.responseBytes!==null).length,requests};
  samples.push(sample);fs.writeFileSync(output,JSON.stringify(samples,null,2));
  console.log(JSON.stringify({action,run,profile,status,ms:Math.round(sample.totalMs),requests:sample.networkRequests,failures:sample.failures}));
  if(status==='failed')throw Error(`Diagnostic step failed: ${action}`);
};}

