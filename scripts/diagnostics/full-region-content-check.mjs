// Additional caller-authorised content and region checks. No business writes.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {fixtures,login,verifyOrigin,hash,read} from './full-region-safety.mjs';
const targets=JSON.parse(process.env.FULL_REGION_TARGETS);Object.values(targets).forEach(verifyOrigin);
const f=await fixtures(),before=await f.fingerprints(),rows=[],access=[];let adminBuildings=[];
for(const role of ['admin','conveyancer']){const auth=await login(role);try{
 const buildings=await read(auth.client.from('buildings').select('id'));
 if(role==='admin')adminBuildings=buildings;
 const visibleUnits=[];
 for(let offset=0;;offset+=1000){const page=await read(auth.client.from('units').select('id,building_id').order('id').range(offset,offset+999));visibleUnits.push(...page);if(page.length<1000)break;}
 for(const[variant,origin]of Object.entries(targets)){
  const forbiddenPath=role==='admin'?'/api/sales/register?building=all':'/api/units/allocation';
  const denied=await fetch(origin+forbiddenPath,{headers:{authorization:`Bearer ${auth.session.access_token}`}});assert.equal(denied.status,403);
  access.push({role,variant,check:'role-denial',endpoint:forbiddenPath.split('?')[0],status:denied.status});
  if(role==='conveyancer'){
   for(const scope of ['all',f.building]){
    const r=await fetch(`${origin}/api/sales/register?building=${scope}`,{headers:{authorization:`Bearer ${auth.session.access_token}`}});assert.equal(r.status,200);const body=await r.json();
    assert.ok(body.rows.every(row=>visibleUnits.some(unit=>unit.id===row.unitId&&unit.building_id===row.buildingId)));
    if(scope!=='all')assert.ok(body.rows.every(row=>row.buildingId===scope));
    access.push({role,variant,check:'register-matches-caller-rls',scope:scope==='all'?'all':'single',rows:body.rows.length,status:r.status});
   }
   const outside=adminBuildings.find(b=>!buildings.some(visible=>visible.id===b.id));
   if(outside){const r=await fetch(`${origin}/api/sales/register?building=${outside.id}`,{headers:{authorization:`Bearer ${auth.session.access_token}`}});assert.equal(r.status,403);access.push({role,variant,check:'existing-inaccessible-building',status:r.status});}
   else access.push({role,variant,check:'existing-inaccessible-building',result:'No inaccessible building fixture for this account; nonexistent-building denial covered separately'});
  }
 }
 for(const sale of f.sales){let expected;
  for(const[variant,origin]of Object.entries(targets)){
   const r=await fetch(`${origin}/api/sales/legal?sale=${sale.id}`,{headers:{authorization:`Bearer ${auth.session.access_token}`}});assert.equal(r.status,200);
   const body=await r.json();assert.equal(body.attempt.workflow_status,'completed');const projectionHash=hash(body);
   if(expected)assert.equal(projectionHash,expected);else expected=projectionHash;
   rows.push({role,variant,fixture:sale.number,status:r.status,projectionHash,region:r.headers.get('x-vercel-id'),serverTiming:r.headers.get('server-timing')});
  }
 }
}finally{await auth.client.auth.signOut({scope:'local'});}}
const after=await f.fingerprints();assert.deepEqual(after,before);
fs.writeFileSync(process.env.FULL_REGION_CONTENT_OUTPUT??'test-results/full-region-content.json',JSON.stringify({rows,access,identicalLegalProjections:true,unchanged:true,before,after},null,2));console.log(JSON.stringify({checks:rows.length,accessChecks:access.length,identicalLegalProjections:true,unchanged:true}));
