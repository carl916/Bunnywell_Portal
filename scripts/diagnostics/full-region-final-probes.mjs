// Verify shared staging and its retained rollback using caller-authorised reads.
// Production is checked anonymously at an endpoint that rejects before data reads.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fixtures, login, hash } from './full-region-safety.mjs';
const environment=JSON.parse(fs.readFileSync('test-results/full-region-environment.json','utf8'));
const expected=process.env.FULL_REGION_EXPECTED_SHARED_REGION??'iad1';
assert.ok(['iad1','fra1'].includes(expected));
const f=await fixtures(),before=await f.fingerprints(),checks=[];
const targets=[{name:'shared-staging',origin:'https://staging.bunnywell.co.uk',region:expected},{name:'rollback',origin:environment.stagingRollback.url,region:'iad1'}];
for(const role of ['admin','conveyancer']){
  const auth=await login(role);
  try {
    const paths=role==='admin'?['/api/dashboard?building=all','/api/rentals/tenancies','/api/units/allocation']:[`/api/sales/register?building=${f.building}`,`/api/sales/legal?sale=${f.sales[0].id}`];
    for(const target of targets)for(const path of paths){
      const r=await fetch(target.origin+path,{headers:{authorization:`Bearer ${auth.session.access_token}`}});
      assert.equal(r.status,200);
      const body=await r.json(),region=r.headers.get('x-vercel-id');
      assert.ok(region?.includes(`::${target.region}::`));
      if(path.startsWith('/api/sales/register'))assert.equal(body.actionsAvailable,true);
      if(path.startsWith('/api/dashboard'))assert.ok(body.sources.every(s=>s.state!=='unavailable'));
      checks.push({target:target.name,role,endpoint:path.split('?')[0],status:r.status,region,projectionHash:hash({...body,asOf:null})});
    }
  }finally{await auth.client.auth.signOut({scope:'local'});}
}
for(const alias of environment.production.aliases){
  const r=await fetch(`https://${alias}/api/rentals/tenancies`);
  assert.equal(r.status,401);assert.ok(r.headers.get('x-vercel-id')?.includes('::iad1::'));
  checks.push({target:alias,endpoint:'/api/rentals/tenancies',status:r.status,region:r.headers.get('x-vercel-id'),anonymous:true});
}
const after=await f.fingerprints();assert.deepEqual(after,before);
fs.writeFileSync(process.env.FULL_REGION_PROBES_OUTPUT??'test-results/full-region-final-probes.json',JSON.stringify({at:new Date().toISOString(),expectedSharedRegion:expected,checks,before,after,unchanged:true},null,2));
console.log(JSON.stringify({checks:checks.length,expectedSharedRegion:expected,unchanged:true}));
