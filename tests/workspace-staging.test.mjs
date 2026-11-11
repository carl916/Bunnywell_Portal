
import test from "node:test";
import assert from "node:assert/strict";
import {loadTypescriptModule} from "./helpers/load-typescript-module.mjs";
import {allowed} from "../scripts/workspace-staging/guard.mjs";
const config=loadTypescriptModule("src/lib/workspace/staging.ts");
const navigation=loadTypescriptModule("src/lib/workspace/navigation.ts");
const fixture=loadTypescriptModule("src/lib/experiments/building-contracts/fixtures.ts");
const {readBuildingFees}=loadTypescriptModule("src/lib/workspace/reads.ts");
const {projectWorkspace}=loadTypescriptModule("src/lib/experiments/building-contracts/projection.ts");
test("staging gate requires development, exact project and installed read guard",()=>{
 const e={NODE_ENV:"development",WORKSPACE_STAGING_READS:"1",WORKSPACE_READ_GUARD:"1",NEXT_PUBLIC_SUPABASE_URL:config.stagingOrigin};
 assert.equal(config.stagingEnabled(e),true);
 for(const change of [{NODE_ENV:"production"},{WORKSPACE_READ_GUARD:"0"},{WORKSPACE_STAGING_READS:"0"},{NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321"},{NEXT_PUBLIC_SUPABASE_URL:"https://another.supabase.co"}])assert.equal(config.stagingEnabled({...e,...change}),false);
});
test("network boundary permits reviewed reads and rejects business mutations / other projects",()=>{
 for(const table of ["units","snags","unit_sale_attempts"])assert.equal(allowed(config.stagingOrigin+"/rest/v1/"+table),true);
 for(const verb of ["POST","PATCH","DELETE","PUT"])for(const path of ["/rest/v1/snags","/storage/v1/object/snag-images/file","/functions/v1/send","/auth/v1/admin/users"])assert.equal(allowed(config.stagingOrigin+path,verb),false);
 for(const rpc of ["record_unit_sale_invoice_payment","mark_sale_opened","get_agent_fee_portfolio","send_sale_comment","expire_sale_authorities"])assert.equal(allowed(config.stagingOrigin+"/rest/v1/rpc/"+rpc,"POST"),false);
 for(const rpc of ["sale_comment_page","sale_activity_page"])assert.equal(allowed(config.stagingOrigin+"/rest/v1/rpc/"+rpc,"POST"),true);
 assert.equal(allowed("https://other.supabase.co/rest/v1/units"),false);
});
test("module boundaries preserve internal, external and operational roles",()=>{
 assert.equal(config.moduleAllowed("admin","unknown"),false);
 for(const role of ["admin","developer"])for(const module of ["dashboard","sales","snags","buildings","setup"])assert.equal(config.moduleAllowed(role,module),true);
 for(const role of ["sales_agent","conveyancer"]){assert.equal(config.moduleAllowed(role,"sales"),true);for(const m of ["snags","setup","buildings"])assert.equal(config.moduleAllowed(role,m),false);}
 for(const role of ["contractor","developer_representative"]){assert.equal(config.moduleAllowed(role,"snags"),true);for(const m of ["sales","setup","buildings"])assert.equal(config.moduleAllowed(role,m),false);}
 for(const m of ["dashboard","sales","snags","buildings","setup"])assert.equal(config.moduleAllowed("resident",m),false);
});
test("record navigation inherits only a valid origin in the same building",()=>{
 const a={view:"sale",building:"A",unit:"G11"};
 assert.equal(navigation.originValues(a,new URLSearchParams({building:"A",view:"dashboard"})).return,"dashboard");
 assert.equal(navigation.originValues(a,new URLSearchParams({building:"A",view:"sale",return:"snags"})).return,"snags");
 assert.equal(navigation.originValues(a,new URLSearchParams({building:"B",view:"dashboard"})).return,undefined);
 assert.equal(navigation.returnView(new URLSearchParams({view:"snag",return:"https://example.com"})),"snags");
 const scope=fixture.workspace("developer",fixture.id(1)).scope;
 assert.notEqual(navigation.navigationKey(scope,"worklist"),navigation.navigationKey({...scope,buildingId:fixture.id(2)},"worklist"));
 assert.notEqual(navigation.navigationKey(scope,"worklist"),navigation.navigationKey({...scope,identity:"other"},"worklist"));
});
test("fee reads begin with exact building scope; child reads are restricted to those sale and invoice IDs",async()=>{
 const f=fixture.facts("developer",fixture.id(1)),calls=[];
 const first=f.input.sales[0];f.input.invoices=[{id:fixture.id(800),sale_attempt_id:first.id,invoice_type:"sales_agent",status:"approved",fee_milestone:"exchange",gross_amount:7650,expected_payable_amount:7650,reservation_fee_deduction:0,agent_contribution_deduction:0,approved_at:"2026-11-01",created_at:"2026-11-01"}];
 const data={unit_sale_attempts:f.input.sales,unit_sale_terms:f.input.terms,unit_sale_invoices:f.input.invoices,unit_sale_invoice_payments:[]};
 const client={from(table){const call={table,filters:[]};calls.push(call);const q={select(){return q},order(){return q},range(){return q},eq(k,v){call.filters.push([k,"eq",v]);return q},is(k,v){call.filters.push([k,"is",v]);return q},in(k,v){call.filters.push([k,"in",v]);return q},then(resolve){return Promise.resolve({data:data[table],count:data[table].length,error:null}).then(resolve)}};return q},rpc(){throw Error("Global RPC must not be called")}};
 const result=await readBuildingFees(client,f.input);assert.ok(result.portfolio.length);
 assert.deepEqual(calls[0].filters,[["building_id","eq",f.building.id],["redacted_at","is",null]]);
 for(const c of calls.filter(c=>["unit_sale_terms","unit_sale_invoices"].includes(c.table)))assert.deepEqual(c.filters,[["sale_attempt_id","in",f.input.sales.map(s=>s.id)]]);
 assert.deepEqual(calls.find(c=>c.table==="unit_sale_invoice_payments").filters,[["invoice_id","in",[fixture.id(800)]]]);
});
test("historical fee obligations do not inflate current-unit stage counts or conceal other actions",()=>{
 const f=fixture.facts("developer",fixture.id(1)),old={...f.input.sales[0],id:fixture.id(9000),is_active:false,workflow_status:"fallen_through"};
 f.input.sales.push(old);f.input.terms.push({...f.input.terms[0],sale_attempt_id:old.id});
 f.input.invoices.push({id:fixture.id(9001),sale_attempt_id:old.id,invoice_type:"sales_agent",status:"approved",fee_milestone:"exchange",gross_amount:7650,expected_payable_amount:7650,approved_at:"2026-11-01",created_at:"2026-11-01"});
 const w=projectWorkspace(f.access,f.building,f.input,f.buyers,false,true);
 const historical=w.rows.find(r=>r.saleId===old.id);assert.equal(historical.historical,true);assert.ok(historical.actions.length);
 assert.equal(w.counts.units,f.input.units.length);assert.equal(Object.values(w.counts.stages).reduce((a,b)=>a+b,0),f.input.units.length);
 const idx=w.rows.findIndex(r=>r.saleId===old.id);assert.equal(w.rows[idx-1].unitId,old.unit_id);assert.ok(w.rows.some(r=>r.actions.some(a=>a.queue==="ours")&&r.actions.some(a=>a.queue==="others")));
});

test("all new route methods are unavailable in production; mutations denied in development",async()=>{
 const previous={...process.env};Object.assign(process.env,{NODE_ENV:"production",WORKSPACE_STAGING_READS:"1",WORKSPACE_READ_GUARD:"1",NEXT_PUBLIC_SUPABASE_URL:config.stagingOrigin});
 try{
  const route=loadTypescriptModule("src/app/workspace/read/route.ts",{overrides:{"@/lib/workspace/server":{}}});
  for(const kind of ["config","catalog"])assert.equal((await route.GET(new Request("http://localhost/workspace/read?kind="+kind))).status,404);
  for(const method of ["POST","PUT","PATCH","DELETE"])assert.equal((await route[method]()).status,404);
  process.env.NODE_ENV="development";
  for(const method of ["POST","PUT","PATCH","DELETE"])assert.equal((await route[method]()).status,403);
 }finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
