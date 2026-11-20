// Read-only HAR analysis and authenticated endpoint sampling. Never save tokens or bodies.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';

const dir='artifacts/staging-region-performance-20261118';
fs.mkdirSync(dir,{recursive:true});
const paths=['C:/Users/carlg/Downloads/3131026 1513 staging.bunnywell.co.uk.har','C:/Users/carlg/Downloads/3bunnywell-portal-integration-pbqsdevoe-carl-gilbert-s-projects.vercel.app.har'];
const median=values=>{const a=values.slice().sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const allowed=new Set(['snags','snag_context','worklist','record','sale-details','core_context','extended_sales_context','sale-context','activity','comments','completion']);
const recordings=paths.map(path=>JSON.parse(fs.readFileSync(path,'utf8')).log.entries);
function describe(e){const u=new URL(e.request.url);let body;try{body=JSON.parse(e.request.postData?.text||'null')}catch{}return {u,body,kind:u.searchParams.get('kind')||body?.action};}
const summaries=recordings.map((entries,i)=>{
 const groups={};let canceled=0;
 for(const e of entries){const {u,kind}=describe(e);if(!u.pathname.startsWith('/workspace/')||!allowed.has(kind))continue;if(e.response.status!==200){canceled++;continue;}(groups[kind]??=[]).push(e);}
 return {environment:i?'integration':'staging',excludedNon200:canceled,groups:Object.fromEntries(Object.entries(groups).map(([kind,a])=>[kind,{n:a.length,medianMs:median(a.map(e=>e.time)),waitMs:median(a.map(e=>e.timings.wait)),receiveMs:median(a.map(e=>e.timings.receive)),regions:[...new Set(a.map(e=>e.response.headers.find(h=>h.name.toLowerCase()==='x-vercel-id')?.value.split('::').slice(0,-1).join('::')))]}]))};
});
fs.writeFileSync(dir+'/har-summary.json',JSON.stringify(summaries,null,2));
if(!process.argv.includes('--sample')){console.log(JSON.stringify(summaries,null,2));process.exit(0);}
const origin=process.argv.find(a=>a.startsWith('--origin='))?.slice(9)||'https://staging.bunnywell.co.uk';
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'before';
const expectedRegion=process.argv.find(a=>a.startsWith('--expect-region='))?.slice(16);
assert(/^[a-z0-9-]+$/.test(label));
assert(origin==='https://staging.bunnywell.co.uk'||/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin));
const config=await (await fetch(origin+'/workspace/read?kind=config')).json();assert.equal(config.projectId,'vxkpvdtrldwwqiddoyof');
const env=dotenv.config({path:'.env.local',quiet:true}).parsed;
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'https://vxkpvdtrldwwqiddoyof.supabase.co');
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await client.auth.signInWithPassword({email:env.PLAYWRIGHT_ADMIN_EMAIL,password:env.PLAYWRIGHT_ADMIN_PASSWORD});assert.ifError(login.error);
const requests=new Map();for(const e of recordings[0]){const d=describe(e);if(e.response.status===200&&d.u.pathname.startsWith('/workspace/')&&allowed.has(d.kind)&&!requests.has(d.kind))requests.set(d.kind,{...d,method:e.request.method});}
const samples=[];
for(let round=0;round<4;round++)for(const [kind,{u,body,method}] of requests){
 assert(method==='GET'||['snag_context','core_context','extended_sales_context'].includes(kind));
 const started=performance.now(),r=await fetch(origin+u.pathname+u.search,{method,headers:{Authorization:'Bearer '+login.data.session.access_token,'Content-Type':'application/json',Origin:origin},...(method==='POST'?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)}),headersMs=performance.now()-started;
 const data=await r.json();assert.equal(r.status,200,kind+' failed');
 if(expectedRegion)assert.equal(r.headers.get('x-vercel-id')?.split('::').slice(0,-1).at(-1),expectedRegion,kind+' executed in the wrong region');
 samples.push({round,kind,status:r.status,headersMs,totalMs:performance.now()-started,vercelId:r.headers.get('x-vercel-id'),...(kind==='snags'?{rowCount:data.rows?.length}:{} )});
}
const groups=Object.fromEntries([...requests.keys()].map(kind=>{const a=samples.filter(s=>s.kind===kind&&s.round>0);return[kind,{n:a.length,headersMs:median(a.map(s=>s.headersMs)),totalMs:median(a.map(s=>s.totalMs))}]}));
fs.writeFileSync(dir+'/'+label+'.json',JSON.stringify({origin,warmupRounds:1,samples,groups},null,2));console.log(JSON.stringify({label,groups},null,2));
