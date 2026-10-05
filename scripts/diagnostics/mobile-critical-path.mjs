// Read-only, matched navigation measurements and sanitised Chrome timeline traces.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local', quiet: true });
const [manifestPath, roundsArg = '5', profilesArg = 'desktop,mobile-throttled'] = process.argv.slice(2);
const variants = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const prefix=process.argv.includes('--lcp-diagnostic')?'lcp-diagnostic':variants.after?'paired':'trace-baseline';
const out = 'artifacts/performance/mobile-critical-path';
fs.mkdirSync(out, { recursive: true });
const project = 'vxkpvdtrldwwqiddoyof.supabase.co';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project) throw Error('Staging required');
for (const d of Object.values(variants)) if (!/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(d.origin) || d.region !== 'iad1') throw Error('Immutable iad1 previews required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
async function read(q) { const r = await q; if (r.error) throw Error('Staging read rejected'); return r.data; }
const scope = JSON.parse(fs.readFileSync('.next/performance/staging-test-sales.json', 'utf8'));
const unit = scope.units.find(u => u.unit_number === '107');
const units = scope.units.filter(u => ['107','108','109','110'].includes(u.unit_number));
const attempts = await read(admin.from('unit_sale_attempts').select('id,unit_id,workflow_status').in('unit_id', units.map(u => u.id)).eq('is_active', true));
if (attempts.length !== 4 || attempts.some(a => a.workflow_status !== 'completed')) throw Error('Completed fixtures required');
const sale = attempts.find(a => a.unit_id === unit.id);
const emails = await read(admin.from('sale_legal_emails').select('expires_at,sent_at,expiry_recorded_at,exchanged_at,revoked_at,replaced_by').eq('sale_attempt_id', sale.id).eq('kind','authority'));
if (emails.some(e => e.sent_at && !e.expiry_recorded_at && !e.exchanged_at && !e.revoked_at && !e.replaced_by && Date.parse(e.expires_at) < Date.now()+3600000)) throw Error('Legal GET could write expiry');
const canonical = v => Array.isArray(v) ? v.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function fingerprint() {
  const a = await read(admin.from('unit_sale_attempts').select('*').in('unit_id', units.map(u => u.id)));
  const ids = a.map(r => r.id);
  return {
    attempts: hash(a), units: hash(await read(admin.from('units').select('*').in('id',units.map(u => u.id)))),
    emails: hash(await read(admin.from('sale_legal_emails').select('*').in('sale_attempt_id',ids))),
    events: hash(await read(admin.from('unit_sale_workflow_events').select('*').in('sale_attempt_id',ids))),
    documents: hash(await read(admin.from('unit_sale_documents').select('*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)').in('sale_attempt_id',ids))),
  };
}
const before = await fingerprint();
const browser = await chromium.launch({ headless: true });
let violations = 0, completed = false;
const samples = [], sessions = [], gates = [];
const save = () => fs.writeFileSync(`${out}/${prefix}-samples.json`, JSON.stringify(samples,null,2));
const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
function endpoint(r) {
  const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/')) return p.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,'fixture');
  if (p.includes('/rest/v1/')) return p.split('/').at(-1);
  if (p.includes('/auth/')) return 'auth';
  if (p.endsWith('.js')) return p;
  return r.resourceType();
}
function kind(r) {
  const p = new URL(r.url()).pathname;
  if (p === '/api/performance/vitals') return 'telemetry';
  if (/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page/.test(p)) return 'polling';
  if (p.endsWith('.js')) return 'javascript';
  if (p.includes('/rest/v1/')) return 'supabase-read';
  if (p.includes('/auth/')) return 'auth';
  return p.startsWith('/api/') ? 'function' : 'asset/document';
}
// Timeline categories exclude network headers, bodies and screenshots. Strip
// query strings/identifiers from any remaining resource and source URLs.
function sanitise(v) {
  if (typeof v === 'string') return v.replace(/https?:\/\/[^\s"<>]+/g, raw => { try { const u=new URL(raw); return u.origin+u.pathname; } catch { return '[url]'; } }).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,'fixture');
  if (Array.isArray(v)) return v.map(sanitise);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !/headers|postData|cookie|authorization|stackTrace/i.test(k)).map(([k,val]) => [k,sanitise(val)]));
  return v;
}
async function setup(label, d, profile) {
  const context = await browser.newContext({ viewport: { width:1280,height:900 } });
  await context.addInitScript(() => {
    window.portalLoadTracing = true;
    window.navigationVitals = { lcp: null, cls: 0, longTasks: [], lcpCandidates: [] };
    let start = 0, last = 0, current = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) {window.navigationVitals.lcp = e.startTime; window.navigationVitals.lcpCandidates.push({at:e.startTime,size:e.size,tag:e.element?.tagName??null,classes:typeof e.element?.className==='string'?e.element.className:null});} }).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) { if (e.startTime-last>1000 || e.startTime-start>5000) {start=e.startTime;current=0;} current+=e.value;last=e.startTime;window.navigationVitals.cls=Math.max(window.navigationVitals.cls,current); } }).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.navigationVitals.longTasks.push({start:e.startTime,duration:e.duration}); }).observe({type:'longtask',buffered:true});
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*supabase.co*',requestStage:'Request'},{urlPattern:`${d.origin}/api/sales/*`,requestStage:'Request'}]});
  const allowedRpcs = new Set(['sale_actor_names','sale_comment_unread','sale_mentions_inbox','sale_discussion_people','sale_activity_page','sale_comment_page']);
  cdp.on('Fetch.requestPaused',async e => {
    const u = new URL(e.request.url), m=e.request.method;
    let unsafe = u.hostname.endsWith('.supabase.co') && u.hostname!==project;
    if (u.pathname.startsWith('/api/sales/') && !['GET','HEAD','OPTIONS'].includes(m)) unsafe=true;
    if (u.hostname===project && u.pathname.includes('/rest/v1/') && !['GET','HEAD','OPTIONS'].includes(m)) unsafe ||= !u.pathname.includes('/rpc/') || !allowedRpcs.has(u.pathname.split('/').at(-1));
    if (u.hostname===project && u.pathname.includes('/storage/') && !['GET','HEAD','OPTIONS'].includes(m)) unsafe=true;
    if (unsafe) { violations++; console.log(JSON.stringify({blocked:true,method:m,endpoint:u.pathname.split('/').at(-1)})); await cdp.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'}); }
    else await cdp.send('Fetch.continueRequest',{requestId:e.requestId});
  });
  const projects = new Set(), errors=[];
  page.on('request',r => { const h=new URL(r.url()).hostname; if(h.endsWith('.supabase.co')) projects.add(h); });
  page.on('pageerror',e => errors.push({name:e.name}));
  console.log(JSON.stringify({setup:label,profile,step:'login'}));
  await page.goto(d.origin); await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL); await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  if(profile==='mobile-throttled') { await page.setViewportSize({width:390,height:844}); await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750}); await cdp.send('Emulation.setCPUThrottlingRate',{rate:4}); }
  const url=`${d.origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${unit.id}`;
  console.log(JSON.stringify({setup:label,profile,step:'warmup'}));
  await page.goto(url); await page.getByRole('button',{name:/^Completion\b/}).waitFor(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500);
  if(projects.size!==1 || !projects.has(project) || violations) throw Error('Environment or read-only gate failed');
  const s={label,d,profile,context,page,cdp,url,projects,errors}; sessions.push(s); return s;
}
async function measure(s,run,action,act,ready,recordTrace=false) {
  const {page,cdp}=s, rows=[], tracked=new Map(),active=new Set(),pending=[];
  let lastWork=performance.now();
  const traceEvents=[];
  const event=e => traceEvents.push(...e.value);
  if(recordTrace) { cdp.on('Tracing.dataCollected',event); await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.cpu_profiler',transferMode:'ReportEvents'}); }
  const browserStart=action.startsWith('navigation.')?0:await page.evaluate(()=>performance.now());
  const start=performance.now(), baseMetrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const begin=r => { const row={kind:kind(r),endpoint:endpoint(r),method:r.method(),offsetMs:performance.now()-start,status:null,finished:false,failed:false}; rows.push(row);tracked.set(r,row); if(!['telemetry','polling'].includes(row.kind)){active.add(r);lastWork=performance.now();} };
  const response=r => { const row=tracked.get(r.request()); if(!row)return; row.status=r.status(); const h=r.headers(); row.vercelId=h['x-vercel-id']??null;row.cache=h['x-vercel-cache']??null; if(new URL(r.url()).pathname.startsWith('/api/')){const a=row.vercelId?.split('::').filter(p=>/^[a-z]{3}\d$/.test(p))??[];row.executionRegion=a.length>1?a.at(-1):null;} };
  const finish=r => { const row=tracked.get(r);if(!row)return; row.finished=true;row.endMs=performance.now()-start; if(active.delete(r))lastWork=performance.now(); pending.push(r.sizes().then(z=>{row.responseBytes=z.responseBodySize;}).catch(()=>{})); if(row.kind==='javascript')pending.push(r.response().then(r=>r.body()).then(b=>{row.decodedBytes=b.length;row.sha256=createHash('sha256').update(b).digest('hex');row.containsJsPdf=/jsPDF|jspdf/i.test(b.toString());}).catch(()=>{})); };
  const failed=r => {const row=tracked.get(r);if(!row)return;row.failed=true;row.endMs=performance.now()-start;row.failure=r.failure()?.errorText==='net::ERR_ABORTED'?'net::ERR_ABORTED':'other';if(active.delete(r))lastWork=performance.now();};
  page.on('request',begin);page.on('response',response);page.on('requestfinished',finish);page.on('requestfailed',failed);
  let status='ok';try {await act();await ready();await page.getByRole('heading',{name:'Unit 107',exact:true}).waitFor();await frames(page);}catch{status='failed';}
  const readyMs=performance.now()-start,readyRequests=rows.length;
  const readyMetrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  while((active.size || performance.now()-lastWork<1500) && performance.now()-start<60000) await page.waitForTimeout(50);
  const quietBoundaryMs=performance.now()-start;
  const state=await page.evaluate(()=>({trace:window.portalLoadTrace??[],vitals:window.navigationVitals,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('.js')).map(e=>({path:new URL(e.name).pathname,start:e.startTime,end:e.responseEnd,encoded:e.encodedBodySize,decoded:e.decodedBodySize,transfer:e.transferSize})),navigation:performance.getEntriesByType('navigation').map(e=>({ttfb:e.responseStart,domInteractive:e.domInteractive,load:e.loadEventEnd}))}));
  state.trace=state.trace.filter(e=>e.at>=browserStart);
  state.resources=state.resources.filter(e=>e.start>=browserStart);
  state.vitals.longTasks=state.vitals.longTasks.filter(e=>e.start>=browserStart);
  page.off('request',begin);page.off('response',response);page.off('requestfinished',finish);page.off('requestfailed',failed);
  await Promise.all(pending);
  const visibleText=await page.locator('#unit-sale-progression').innerText();
  const displayedSnapshotSha256=createHash('sha256').update(visibleText).digest('hex');
  let tracePath=null;
  if(recordTrace){const end=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await end;cdp.off('Tracing.dataCollected',event);tracePath=`${s.label}-${s.profile}-${action}-${run}.trace.json.gz`;fs.writeFileSync(`${out}/${tracePath}`,gzipSync(JSON.stringify({traceEvents:sanitise(traceEvents)},null,0)));}
  const applicationFailures=rows.filter(r=>r.kind!=='telemetry' && (r.failed || r.status>=400));
  const httpErrors=rows.filter(r=>r.status>=400).length;
  const telemetryFailures=rows.filter(r=>r.kind==='telemetry'&&r.failed&&r.failure!=='net::ERR_ABORTED').length;
  const metricNames=['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'];
  const mainThread=Object.fromEntries(metricNames.map(n=>[n,Math.max(0,readyMetrics[n]-baseMetrics[n])*1000]));
  const sample={variant:s.label,profile:s.profile,run,action,status,readyMs,readyRequests,settledRequests:rows.length,lastRequestEndMs:Math.max(0,...rows.filter(r=>!['telemetry','polling'].includes(r.kind)).map(r=>r.endMs??0)),quietBoundaryMs,timedOut:active.size>0,applicationFailures:applicationFailures.length,aborted:rows.filter(r=>r.failed).map(r=>({kind:r.kind,endpoint:r.endpoint,failure:r.failure,status:r.status,collectorAcceptance:r.kind==='telemetry'?(r.status===204?'accepted':r.status===null?'unknown':'rejected'):null})),transferredJavaScript:state.resources.reduce((a,r)=>a+r.transfer,0),encodedJavaScript:state.resources.reduce((a,r)=>a+r.encoded,0),decodedJavaScript:state.resources.reduce((a,r)=>a+r.decoded,0),mainThread,...state,requests:rows,tracePath,displayedStateChecked:status==='ok',displayedUnit:107};
  Object.assign(sample,{displayedSnapshotSha256,httpErrors,telemetryFailures});
  samples.push(sample);save();console.log(JSON.stringify({variant:s.label,profile:s.profile,run,action,readyMs:Math.round(readyMs),requests:rows.length,applicationFailures:applicationFailures.length,jsBytes:sample.transferredJavaScript,mainThread}));
  if(status!=='ok'||active.size||applicationFailures.length||httpErrors||telemetryFailures||violations||s.errors.length)throw Error('Navigation application gate failed');
}
try {
  for(const profile of profilesArg.split(',')) {
    const activeSessions=[];
    for(const [label,d]of Object.entries(variants)){const s=await setup(label,d,profile);activeSessions.push(s);await s.page.goto('about:blank');}
    for(let run=1;run<=Number(roundsArg);run++) {
      const order=run%2?activeSessions:[...activeSessions].reverse();
      for(const s of order) {
        await s.page.goto(s.url);await s.page.getByRole('button',{name:/^Completion\b/}).waitFor();await s.page.getByRole('button',{name:/^Handover\b/}).click();await s.page.waitForLoadState('networkidle');await s.page.waitForTimeout(1500);
        for(const mode of ['cold','repeat']){if(mode==='cold')await s.cdp.send('Network.clearBrowserCache');await measure(s,run,`navigation.${mode}`,()=>s.page.reload(),()=>s.page.getByRole('button',{name:/^Completion\b/}).waitFor(),roundsArg==='1');}
        // A real in-app Sales entry after leaving the workspace. No sale writes.
        await s.page.getByRole('button',{name:'Snags',exact:true}).click();await s.page.waitForLoadState('networkidle');await s.page.waitForTimeout(1500);
        await measure(s,run,'sales.entry',()=>s.page.getByRole('button',{name:'Sales',exact:true}).click(),()=>s.page.getByRole('button',{name:/^Completion\b/}).waitFor(),roundsArg==='1');
        await measure(s,run,'exchange.entry',()=>s.page.getByRole('button',{name:/^Exchange\b/}).click(),()=>s.page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor());
        const functions=samples.filter(r=>r.variant===s.label&&r.profile===s.profile&&r.run===run).flatMap(r=>r.requests.filter(r=>r.executionRegion));
        if(functions.some(r=>r.executionRegion!=='iad1') || !functions.some(r=>r.endpoint==='/api/sales/legal'&&r.status===200))throw Error('Navigation route-region gate failed');
        gates.push({variant:s.label,profile,run,exchangeDisplayed:true,sampledRegions:functions.map(r=>({endpoint:r.endpoint,region:r.executionRegion,status:r.status}))});
        await s.page.goto('about:blank');
      }
    }
    for(const s of activeSessions)await s.context.close();
  }
  completed=true;
} catch(e){console.log(JSON.stringify({stopped:true,message:e.message.startsWith('Navigation')||e.message.startsWith('Environment')?e.message:'Browser step failed; sensitive details withheld'}));process.exitCode=1;}
finally {
  await browser.close();const after=await fingerprint(),unchanged=JSON.stringify(before)===JSON.stringify(after);
  fs.writeFileSync(`${out}/${prefix}-verification.json`,JSON.stringify({completed,unchanged,before,after,violations,browser:browser.version(),fixtures:[107,108,109,110],readOnly:true,profiles:profilesArg,variants,gates,sessions:sessions.map(s=>({variant:s.label,profile:s.profile,projects:[...s.projects],pageErrors:s.errors.length}))},null,2));
  if(!unchanged)throw Error('Fixture state changed');
}
