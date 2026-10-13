// Read-only baseline over real caller JWTs. No service key or migration apply.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { baseline, optimized, query, transaction, equality } from './sale-workflow-context-sql.mjs';

dotenv.config({path:'.env.local',quiet:true});
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(url,'https://vxkpvdtrldwwqiddoyof.supabase.co','Only staging is allowed');
const output=process.env.RPC_PERF_OUTPUT;
assert.ok(output?.startsWith('test-results/')&&!output.includes('..'),'Use an ignored test-results output');
assert.ok(!fs.existsSync(output),'Refusing to overwrite evidence');
const prepare=process.argv.includes('--prepare-sql');
const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:auth,error}=await client.auth.signInWithPassword({email:process.env.PLAYWRIGHT_ADMIN_EMAIL,password:process.env.PLAYWRIGHT_ADMIN_PASSWORD});
assert.ok(!error&&auth.session,'Staging sign-in failed');
try {
  const {data:profile,error:pe}=await client.from('profiles').select('id,role,active').eq('id',auth.user.id).single();
  assert.ok(!pe&&profile.active&&profile.role==='admin','Expected active staging reviewer');
  const {data:buildings,error:be}=await client.from('buildings').select('id');assert.ok(!be);
  const {data:sales,error:se}=await client.from('unit_sale_attempts').select('id').in('building_id',buildings.map(b=>b.id)).eq('is_active',true).is('redacted_at',null).order('id');assert.ok(!se);
  const ids=sales.map(s=>s.id);assert.ok(ids.length>0&&ids.length<=500);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if(prepare){
    // Local ignored file contains scoped IDs/claims, but no JWT, email or records.
    // Execute each statement with the existing function owner's database role.
    const plans=Object.fromEntries(Object.entries({baseline,optimized}).map(([name,sql])=>[name,transaction(auth.user.id,'explain(analyze,buffers,verbose,format json) '+query(sql,ids))]));
    const counts=Object.fromEntries(Object.entries({baseline,optimized}).map(([name,sql])=>[name,transaction(auth.user.id,query(sql,ids)+";select funcname,calls from pg_stat_xact_user_functions where schemaname='public' and funcname in ('can_access_sale_attempt','sale_event_projection') order by funcname",{countFunctions:true})]));
    fs.writeFileSync(output,JSON.stringify({plans,counts,parity:transaction(auth.user.id,equality(ids))},null,2));
    console.log(JSON.stringify({preparedReadOnlyStatements:true,saleIds:ids.length}));
  }else{
    const roundCount=Number(process.env.RPC_PERF_ROUNDS??20),dashboardCount=Number(process.env.RPC_PERF_DASHBOARD_ROUNDS??10);
    assert.ok(Number.isInteger(roundCount)&&roundCount>=10&&roundCount<=40);
    assert.ok(Number.isInteger(dashboardCount)&&dashboardCount>=0&&dashboardCount<=20);
    // Existing staging returns source-status entries in completion order. Only
    // that diagnostic list and asOf are normalised; RPC JSON stays byte-exact.
    const normalise=(v,k='')=>k==='asOf'?null:Array.isArray(v)?(k==='sources'?[...v].sort((a,b)=>a.key.localeCompare(b.key)):v).map(x=>normalise(x)):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalise(v[k],k)])):v;
    const hash=x=>createHash('sha256').update(x).digest('hex');
    const evidence={environment:'Shared staging baseline; migration NOT applied',started:new Date().toISOString(),scope:{buildingCount:buildings.length,requestedSaleIds:ids.length},rpc:[],dashboard:[]};
    const headers={authorization:'Bearer '+auth.session.access_token};
    for(let i=0;i<Math.max(roundCount,dashboardCount);i++){
      if(i<roundCount){
        const started=performance.now();
        const r=await fetch(url+'/rest/v1/rpc/sale_workflow_context',{method:'POST',headers:{...headers,apikey:anon,'content-type':'application/json'},body:JSON.stringify({p_sales:ids}),signal:AbortSignal.timeout(15000)});
        const headerAt=performance.now(),text=await r.text(),bodyAt=performance.now();
        assert.equal(r.status,200,'RPC request failed; body withheld');
        const data=JSON.parse(text),finished=performance.now();
        const sample={run:i+1,ms:finished-started,headersMs:headerAt-started,bodyMs:bodyAt-headerAt,parseMs:finished-bodyAt,upstreamMs:Number(r.headers.get('x-envoy-upstream-service-time')),contentEncoding:r.headers.get('content-encoding'),bytes:Buffer.byteLength(text),events:data.length,hash:hash(text)};
        if(evidence.rpc.length)assert.equal(sample.hash,evidence.rpc[0].hash,'STOP: baseline RPC output changed during measurement');
        evidence.rpc.push(sample);
      }
      if(i<dashboardCount){
        const started=performance.now();
        const r=await fetch('https://staging.bunnywell.co.uk/api/dashboard?building=all',{headers:{...headers,'x-bunnywell-diagnostic':'dashboard-tail'},redirect:'error',signal:AbortSignal.timeout(20000)});
        const text=await r.text(),ms=performance.now()-started;
        assert.equal(r.status,200,'Dashboard request failed; body withheld');
        const body=JSON.parse(text);
        assert.ok(body.sources.every(s=>s.state!=='unavailable'),'Incomplete dashboard source');
        const timing=r.headers.get('server-timing');
        const sample={run:i+1,ms,bytes:Buffer.byteLength(text),hash:hash(JSON.stringify(normalise(body))),serverTiming:timing,queryCount:Number(timing?.match(/db_read;dur=[^,]+;desc="(\d+) calls"/)?.[1])||null};
        if(evidence.dashboard.length)assert.equal(sample.hash,evidence.dashboard[0].hash,'STOP: baseline dashboard output changed during measurement');
        evidence.dashboard.push(sample);
      }
      fs.writeFileSync(output,JSON.stringify(evidence,null,2));
      console.log(JSON.stringify({round:i+1,rpcMs:evidence.rpc.at(-1)?.ms,dashboardMs:i<dashboardCount?evidence.dashboard.at(-1)?.ms:undefined}));
    }
    evidence.finished=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  }
}finally{await client.auth.signOut({scope:'local'});}
