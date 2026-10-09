// Authorised read-only probes, content/security checks and paired API timings.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {fixtures,login,verifyOrigin,hash} from './full-region-safety.mjs';
const targets=JSON.parse(process.env.FULL_REGION_TARGETS);Object.values(targets).forEach(verifyOrigin);
const focus=process.env.FULL_REGION_API_FOCUS;
assert.ok(!focus||focus==='dashboard-single','Unknown API focus');
const f=await fixtures(),before=await f.fingerprints(),samples=[],checks=[];
for(const role of focus?['admin']:['admin','conveyancer']){
 const auth=await login(role),headers={authorization:`Bearer ${auth.session.access_token}`};
 try{
  const paths=focus?[`/api/dashboard?building=${f.building}`]:role==='admin'?['/api/dashboard?building=all',`/api/dashboard?building=${f.building}`,'/api/rentals/tenancies','/api/rentals/rent-risk','/api/units/allocation']:['/api/sales/register?building=all',`/api/sales/register?building=${f.building}`];
  const expected=new Map();
  for(let run=0;run<8;run++){
   const order=Object.entries(targets);if(run%2)order.reverse();
   for(const [variant,origin]of order)for(const path of paths){
    const start=performance.now(),r=await fetch(origin+path,{headers}),text=await r.text(),durationMs=performance.now()-start;
    assert.equal(r.status,200,`${role} ${path.split('?')[0]} returned ${r.status}`);const data=JSON.parse(text);
    const projection=hash({...data,asOf:null}),region=r.headers.get('x-vercel-id');assert.ok(region?.includes(variant==='a'?'::iad1::':'::fra1::'));
    if(path.startsWith('/api/sales/register')){assert.equal(data.actionsAvailable,true);if(expected.has(path))assert.equal(projection,expected.get(path));else expected.set(path,projection);}
    samples.push({role,run,variant,endpoint:path.split('?')[0],scope:path.startsWith('/api/units/allocation')?'default':path.includes('=all')?'all':path.includes('?')?'single':'default',durationMs,bytes:Buffer.byteLength(text),status:r.status,region,serverTiming:r.headers.get('server-timing'),projectionHash:projection,sourceStates:data.sources?.map(s=>({key:s.key,state:s.state}))});
   }
  }
  for(const [variant,origin]of Object.entries(targets)){
   for(const [name,path,withAuth,expectedStatus]of [
    ['unsigned-register','/api/sales/register?building=all',false,401],
    ['unsigned-dashboard','/api/dashboard?building=all',false,401],
    ...(role==='conveyancer'?[
     ['forbidden-building','/api/sales/register?building=00000000-0000-4000-8000-000000000000',true,403],
     ['forbidden-rentals','/api/rentals/tenancies',true,403],
    ]:[]),
   ]){const r=await fetch(origin+path,withAuth?{headers}:{});assert.equal(r.status,expectedStatus);checks.push({role,variant,name,status:r.status,region:r.headers.get('x-vercel-id')});}
  }
 }finally{await auth.client.auth.signOut({scope:'local'});}
}
const after=await f.fingerprints();assert.deepEqual(after,before);
fs.writeFileSync(process.env.FULL_REGION_API_OUTPUT??'test-results/full-region-api.json',JSON.stringify({purpose:focus?'Investigate the single-building dashboard database-read outlier':'Paired API diagnostics',samples,checks,before,after,unchanged:true},null,2));
console.log(JSON.stringify({samples:samples.length,checks:checks.length,stateUnchanged:true}));
