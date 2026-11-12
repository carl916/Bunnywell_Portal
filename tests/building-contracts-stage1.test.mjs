import test from "node:test";
import assert from "node:assert/strict";
import {loadTypescriptModule} from "./helpers/load-typescript-module.mjs";
const fixture=loadTypescriptModule("src/lib/experiments/building-contracts/fixtures.ts");
const projection=loadTypescriptModule("src/lib/experiments/building-contracts/projection.ts");
const contracts=loadTypescriptModule("src/lib/experiments/building-contracts/contracts.ts");
const navigation=loadTypescriptModule("src/lib/experiments/building-contracts/navigation.ts");
const {createWorkspaceSession}=loadTypescriptModule("src/lib/experiments/building-contracts/session.ts");
const {canPerformSalesAction}=loadTypescriptModule("src/lib/sales/permissions.ts");
const A=fixture.id(1),B=fixture.id(2);
const project=f=>projection.projectWorkspace(f.access,f.building,f.input,f.buyers);
const scope=alias=>fixture.workspace(alias,A).scope;
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test("catalogue contains authorised building metadata only; no operational records",()=>{
 const c=fixture.catalog("developer");
 assert.deepEqual(c.buildings.map(b=>b.id),[A,B]);assert.equal(c.buildings.some(b=>b.id===fixture.id(3)),false);
 for(const b of c.buildings)assert.deepEqual(Object.keys(b).sort(),["address","id","name"]);
 assert.equal(fixture.catalog("developer-single").buildings.length,1);
 assert.doesNotMatch(JSON.stringify(c),/Taylor|saleId|unitNumber|7650/);
});
for(const alias of ["restricted","inactive","unknown"])test("access denied for "+alias,()=>assert.throws(()=>fixture.catalog(alias)));
test("building access is explicit; unknown/all/inaccessible IDs never fall back",()=>{
 for(const id of ["","all",fixture.id(3),"G11",fixture.id(999)])assert.throws(()=>fixture.workspace("developer",id));
 assert.throws(()=>fixture.workspace("developer-single",B));
});
for(const alias of ["developer","admin","agent","conveyancer"])test("explicit role-safe projection for "+alias,()=>{
 const w=fixture.workspace(alias,A);assert.equal(contracts.assertWorkspace(w,w.scope),w);
 assert.doesNotMatch(JSON.stringify(w),/updated_by_user_id|contract_price|net_proceeds|saleEvents|actor_name|payments|access_token/);
 if(alias==="conveyancer"){assert.ok(w.rows.every(r=>!r.actions.some(a=>a.kind.startsWith("fee_"))));assert.doesNotMatch(JSON.stringify(w),/expectedInvoiceGross|7650/);}
 assert.ok(w.rows.flatMap(r=>r.actions).every(a=>a.businessEnabled===false));
});
test("scoped facts reject other-building and identity contamination",()=>{
 for(const mutate of [f=>f.input.units[0].building_id=B,f=>f.input.sales[0].building_id=B,f=>f.input.viewer.id="wrong",f=>f.input.documents[0].sale_attempt_id=fixture.id(9999),f=>f.input.terms[0].sale_attempt_id=fixture.id(9999),f=>f.input.payments.push({invoice_id:fixture.id(9999)}),f=>f.input.floors[0].building_id=B]){
   const f=fixture.facts("developer",A);mutate(f);assert.throws(()=>project(f));
 }
});
test("G11 has one our action and two waiting actions on exactly one sale",()=>{
 const row=fixture.workspace("developer",A).rows.find(r=>r.unitNumber==="G11");const c=projection.summarise([row],true);
 assert.equal(row.actions.length,3);assert.deepEqual(c.ours,{actions:1,sales:1});assert.deepEqual(c.others,{actions:2,sales:1});assert.equal(c.distinctSales,1);
 assert.equal(c.stages.exchanged,1);assert.equal(row.actions[0].kind,"review_draft_statement_of_account");
 assert.equal(row.actions.find(a=>a.kind==="fee_exchange_not_submitted").existingCapability,true);
});
test("grouped destination does not collapse two current document reviews",()=>{
 const f=fixture.facts("developer",A);f.input.documents[0].status="uploaded";f.input.documents[0].query_note=null;
 const r=project(f).rows.find(r=>r.unitNumber==="G11");assert.equal(r.actions.filter(a=>a.countingUnit==="document").length,2);
 assert.equal(projection.summarise([r],true).ours.actions,2);
});
test("drafts and completion-date observations do not inflate action counts",()=>{
 const w=fixture.workspace("developer",A);assert.equal(w.rows.find(r=>r.unitNumber==="301").actions.length,0);
 assert.ok(w.rows.every(r=>r.actions.every(a=>a.kind!=="completion_date")));
});
test("two people in one team have the same responsibilities; same-role other org does not",()=>{
 const own=a=>fixture.workspace(a,A).rows.flatMap(r=>r.actions).filter(a=>a.queue==="ours").map(a=>a.id);
 assert.deepEqual(own("agent"),own("agent-colleague"));assert.equal(own("agent-other").length,0);
});
test("building appointments override legacy attempt attribution; editor is never assignee",()=>{
 const f=fixture.facts("agent",A),before=project(f).rows.flatMap(r=>r.actions).map(a=>[a.id,a.party,a.queue]);
 f.input.sales.forEach(s=>{s.sales_agent_organisation_id=fixture.id(503);s.conveyancer_organisation_id=fixture.id(999);});
 f.input.documents.forEach(d=>d.updated_by_user_id=fixture.id(905));
 assert.deepEqual(project(f).rows.flatMap(r=>r.actions).map(a=>[a.id,a.party,a.queue]),before);
});
test("unallocated appointment is separate from waiting; unknown appointment read disables counts",()=>{
 const f=fixture.facts("developer",A);f.input.buildings[0].sales_agent_organisation_id=null;
 const w=project(f);assert.equal(w.counts.unallocated.actions,2);assert.ok(w.rows.flatMap(r=>r.actions).filter(a=>a.party.kind==="sales_agent").every(a=>a.queue==="unallocated"));
 delete f.input.buildings[0].sales_agent_organisation_id;
 assert.equal(project(f).counts.complete,false);assert.equal(project(f).counts.others,null);
});
test("partial required source is unavailable, never an empty successful workload",()=>{
 const w=fixture.workspace("developer",A,"incomplete");assert.equal(w.rows.length,4);assert.equal(w.counts.ours,null);assert.ok(w.rows.every(r=>r.actions.length===0&&r.warning));
 const empty=fixture.workspace("developer",A,"empty");assert.equal(empty.counts.units,0);assert.deepEqual(empty.counts.ours,{actions:0,sales:0});
});
test("waiting views preserve existing role-level on-behalf permission without enabling actions",()=>{
 const w=fixture.workspace("developer",A);
 for(const [unit,heading,permission]of [["301","Awaiting reservation submission","submit_reservation"],["G2","Awaiting agent invoice","submit_agent_invoice"]]){
  const p=w.rows.find(r=>r.unitNumber===unit).preview;assert.equal(p.heading,heading);assert.equal(p.mode,"waiting");
  assert.equal(p.onBehalf.existingRoleAllows,canPerformSalesAction("developer",permission));assert.equal(p.onBehalf.enabled,false);
 }
 assert.equal(fixture.workspace("conveyancer",A).rows.find(r=>r.unitNumber==="301").preview.onBehalf,null);
});
test("duplicate units resolve stable building, unit and sale attempt IDs",()=>{
 for(const label of ["G11","LG11","301"]){const a=fixture.workspace("developer",A),b=fixture.workspace("developer",B),ar=a.rows.find(r=>r.unitNumber===label),br=b.rows.find(r=>r.unitNumber===label);
  assert.notEqual(ar.unitId,br.unitId);assert.notEqual(ar.saleId,br.saleId);assert.notEqual(ar.buyerLabel,br.buyerLabel);
  assert.equal(contracts.resolveSale(a,ar.unitId,ar.saleId).buyerLabel,ar.buyerLabel);
  assert.throws(()=>contracts.resolveSale(b,ar.unitId,ar.saleId));assert.throws(()=>contracts.resolveSale(a,ar.unitId,br.saleId));
 }
});
test("configured floor order precedes natural numeric order",()=>assert.deepEqual(fixture.workspace("developer",A).rows.map(r=>r.unitNumber),["LG11","G2","G11","301"]));
test("ambiguous active attempts require reconciliation, not guessed detail links",()=>{
 const f=fixture.facts("developer",A);f.input.sales.push({...f.input.sales[0],id:fixture.id(8888)});
 const w=project(f),r=w.rows.find(r=>r.unitNumber==="G11");assert.equal(w.counts.complete,false);assert.equal(w.counts.ours,null);assert.equal(r.saleId,null);assert.match(r.warning,/Multiple active/);assert.equal(r.actions.length,0);
});
test("response validation rejects building, role, version and financial leakage",()=>{
 const w=fixture.workspace("developer",A);
 for(const mutate of [x=>x.scope.buildingId=B,x=>x.contract="bad",x=>x.rows[0].buildingId=B,x=>x.rows[0].actions[0].destination.saleId="wrong",x=>x.rows[0].actions[0].businessEnabled=true]){
  const x=structuredClone(w);mutate(x);assert.throws(()=>contracts.assertWorkspace(x,w.scope));
 }
 const c=fixture.workspace("conveyancer",A);c.rows[0].preview.expectedInvoiceGross=7650;assert.throws(()=>contracts.assertWorkspace(c,c.scope));
});
test("late A success cannot publish into B even if transport ignores abort",async()=>{
 const calls=[];const s=createWorkspaceSession((scope,signal)=>{const d=defer();calls.push({...d,scope,signal});return d.promise;});
 const a=fixture.workspace("developer",A),b=fixture.workspace("developer",B);
 const pa=s.select(a.scope);const pb=s.select(b.scope);assert.equal(calls[0].signal.aborted,true);assert.equal(s.getSnapshot().snapshot,null);
 calls[1].resolve(b);await pb;calls[0].resolve(a);await pa;assert.equal(s.getSnapshot().snapshot.building.id,B);
});
test("late A error cannot clear B spinner or replace B data",async()=>{
 const a=fixture.workspace("developer",A),b=fixture.workspace("developer",B),calls=[];
 const s=createWorkspaceSession(()=>{const d=defer();calls.push(d);return d.promise;});
 const pa=s.select(a.scope),pb=s.select(b.scope);calls[0].reject(new Error("A failed"));await pa;
 assert.equal(s.getSnapshot().loading,true);assert.equal(s.getSnapshot().error,"");calls[1].resolve(b);await pb;assert.equal(s.getSnapshot().snapshot.building.id,B);
});
test("A to B to A rejects the first A generation",async()=>{
 const a=fixture.workspace("developer",A),b=fixture.workspace("developer",B),calls=[];
 const s=createWorkspaceSession(()=>{const d=defer();calls.push(d);return d.promise;});
 const first=s.select(a.scope),second=s.select(b.scope),third=s.select(a.scope);
 calls[0].resolve(a);await first;assert.equal(s.getSnapshot().snapshot,null);
 calls[2].resolve({...a,asOf:"new-generation"});await third;calls[1].resolve(b);await second;assert.equal(s.getSnapshot().snapshot.asOf,"new-generation");
});
test("access revision and logout invalidate in-flight responses",async()=>{
 const a=fixture.workspace("developer",A),calls=[];
 const s=createWorkspaceSession(()=>{const d=defer();calls.push(d);return d.promise;});
 const p=s.select(a.scope);s.clear();calls[0].resolve(a);await p;assert.equal(s.getSnapshot().snapshot,null);
 const q=s.select({...a.scope,accessRevision:"revoked"});calls[1].resolve(a);await q;assert.match(s.getSnapshot().error,/scope/);
});
test("dashboard to list reuses same snapshot; changed scope clears synchronously",async()=>{
 const a=fixture.workspace("developer",A);let requests=0;
 const s=createWorkspaceSession(async()=>{requests++;return a;});await s.select(a.scope);await s.select(a.scope);assert.equal(requests,1);
 s.clear();assert.equal(s.getSnapshot().snapshot,null);
});
test("return state is isolated by building, role, access revision and tab",()=>{
 const map=new Map(),tab={getItem:k=>map.get(k)??null};const a=scope("developer"),b={...a,buildingId:B};
 map.set(navigation.returnKey(a),JSON.stringify({search:"G11",stage:"exchanged",queue:"others",page:2,scroll:400}));
 assert.equal(navigation.readReturn(tab,a).search,"G11");assert.equal(navigation.readReturn(tab,b).search,"");
 assert.equal(navigation.readReturn({getItem:()=>null},a).search,"");
 assert.equal(navigation.readReturn(tab,{...a,accessRevision:"new"}).search,"");
});
test("legacy handoff is disabled unless exact local synthetic project and origin are approved",()=>{
 const w=fixture.workspace("developer",A),r=w.rows.find(r=>r.unitNumber==="G11");
 const env={approved:true,projectId:"bunnywell-workspace-stage2",appOrigin:"http://127.0.0.1:3031",syntheticOnly:true,exactAttemptHandlingVerified:true},runtime={projectId:env.projectId,appOrigin:env.appOrigin};
 assert.equal(navigation.existingSaleUrl(w,r.unitId,r.saleId,null,runtime),null);
 assert.equal(navigation.existingSaleUrl(w,r.unitId,r.saleId,{...env,exactAttemptHandlingVerified:false},runtime),null);
 assert.equal(navigation.existingSaleUrl(w,r.unitId,r.saleId,env,{...runtime,projectId:"production"}),null);
 assert.equal(navigation.existingSaleUrl(w,r.unitId,r.saleId,env,{...runtime,appOrigin:"https://live.example"}),null);
 const url=new URL(navigation.existingSaleUrl(w,r.unitId,r.saleId,env,runtime));assert.equal(url.origin,env.appOrigin);
 assert.equal(url.searchParams.get("building"),A);assert.equal(url.searchParams.get("salesUnitId"),r.unitId);assert.equal(url.searchParams.get("workSale"),r.saleId);
 assert.throws(()=>navigation.existingSaleUrl(w,r.unitId,fixture.id(9999),env,runtime));
});

test("queried completion actions reflect the viewing team and preserve deadline facts",()=>{
 const developer=fixture.workspace("developer",A),conveyancer=fixture.workspace("conveyancer",A);
 const get=w=>w.rows.find(r=>r.unitNumber==="G11").actions.find(a=>a.kind==="replace_completion_statement");
 assert.equal(get(developer).title,"Awaiting revised completion statement");
 assert.equal(get(conveyancer).queue,"ours");assert.equal(get(conveyancer).title,"Replace queried completion statement");assert.equal(conveyancer.rows.find(r=>r.unitNumber==="G11").preview.heading,"Resolve the query");assert.equal(developer.rows.find(r=>r.unitNumber==="G11").preview.heading,"Review statement of account");
 assert.deepEqual(get(conveyancer).deadline,get(developer).deadline);
});

test("local fixture route rejects production, missing scope and inaccessible records",async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,BUILDING_CONTRACTS_OFFLINE:process.env.BUILDING_CONTRACTS_OFFLINE,STAGING_WEB_VITALS:process.env.STAGING_WEB_VITALS};
 const route=loadTypescriptModule("src/app/dev/building-workspace-contracts/fixtures/route.ts",{overrides:{"next/server":{NextResponse:{json:(value,options={})=>new Response(JSON.stringify(value),options)}}}});
 const request=query=>new Request("http://127.0.0.1:3031/dev/building-workspace-contracts/fixtures?"+query);
 try{
  process.env.NODE_ENV="production";process.env.BUILDING_CONTRACTS_OFFLINE="1";process.env.STAGING_WEB_VITALS="0";
  assert.equal((await route.GET(request("kind=catalog"))).status,404);
  process.env.NODE_ENV="development";
  for(const query of ["kind=workspace","kind=workspace&building=all","kind=workspace&building="+fixture.id(3),"kind=catalog&viewer=inactive"])
   assert.equal((await route.GET(request(query))).status,403);
  assert.equal((await route.GET(request("kind=catalog&project=production"))).status,400);
  assert.equal((await route.GET(request("kind=catalog"))).status,200);
  process.env.BUILDING_CONTRACTS_OFFLINE="0";assert.equal((await route.GET(request("kind=catalog"))).status,404);
  assert.deepEqual(Object.keys(route).filter(k=>["POST","PATCH","DELETE","PUT"].includes(k)),[]);
 }finally{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test("all fixture projections execute without invoking any network transport",()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error("Unexpected network transport");};
 try{for(const role of ["developer","admin","agent","agent-colleague","agent-other","conveyancer"])for(const building of [A,B])assert.equal(fixture.workspace(role,building).scope.buildingId,building);}
 finally{globalThis.fetch=original;}
});


test("write refresh retains only the identical scope and clears on denial",async()=>{
 const a=fixture.workspace("developer",A),b=fixture.workspace("developer",B),calls=[];
 const s=createWorkspaceSession(()=>{const d=defer();calls.push(d);return d.promise;});
 let p=s.select(a.scope);calls[0].resolve(a);await p;
 p=s.select(a.scope,true,true);assert.equal(s.getSnapshot().snapshot,a);assert.equal(s.getSnapshot().loading,true);calls[1].resolve({...a,asOf:"refreshed"});await p;
 p=s.select({...a.scope,accessRevision:"revoked"},true,true);assert.equal(s.getSnapshot().snapshot,null);calls[2].reject(Error("Access denied"));await p;assert.equal(s.getSnapshot().snapshot,null);
 p=s.select(a.scope);calls[3].resolve(a);await p;p=s.select(b.scope,true,true);assert.equal(s.getSnapshot().snapshot,null);calls[4].resolve(b);await p;
 p=s.select(b.scope,true,true);calls[5].reject(Error("Access denied"));await p;assert.equal(s.getSnapshot().snapshot,null);
});
