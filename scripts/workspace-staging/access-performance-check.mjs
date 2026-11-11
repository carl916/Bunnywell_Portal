
import fs from "node:fs";import dotenv from "dotenv";import assert from "node:assert/strict";import {chromium} from "@playwright/test";
const env=dotenv.parse(fs.readFileSync("C:/GitHub/Bunnywell_Portal/.env.local")),root="http://127.0.0.1:3033",origin=env.NEXT_PUBLIC_SUPABASE_URL;
const auth=JSON.parse(fs.readFileSync("tmp/workspace-staging/test-auth.json")),headers={authorization:"Bearer "+auth.access_token};
const api=async(kind,values={})=>{const r=await fetch(root+"/workspace/read?"+new URLSearchParams({kind,...values}),{headers});return{status:r.status,data:await r.json()}};
const c=(await api("catalog")).data,forum=c.buildings.find(b=>b.name==="Forum House"),other=c.buildings.find(b=>b.name==="Trinity Point");
const before=fs.readFileSync("tmp/workspace-staging/reads.ndjson","utf8").trim().split("\n").length,at=Date.now();
const w=(await api("workspace",{building:forum.id})).data;
const backendMs=Date.now()-at;
await new Promise(r=>setTimeout(r,100));
const log=fs.readFileSync("tmp/workspace-staging/reads.ndjson","utf8").trim().split("\n").slice(before).map(JSON.parse);
for(const table of ["units","unit_sale_attempts","snags","building_floors"]){const calls=log.filter(r=>r.path==="/rest/v1/"+table);assert.ok(calls.every(r=>r.filters.building_id?.includes(forum.id)));}
assert.equal(log.some(r=>r.path.includes("get_agent_fee_portfolio")),false);
const scopedSalesResponse=await fetch(origin+"/rest/v1/unit_sale_attempts?select=id&building_id=eq."+forum.id+"&redacted_at=is.null",{headers:{...headers,apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY}});assert.equal(scopedSalesResponse.status,200);const saleIds=new Set((await scopedSalesResponse.json()).map(r=>r.id));for(const r of log.filter(r=>["unit_sale_documents","unit_sale_terms","unit_sale_invoices","sale_legal_emails"].some(t=>r.path==="/rest/v1/"+t))){assert.ok(r.filters.sale_attempt_id);for(const id of r.filters.sale_attempt_id.slice(4,-1).split(","))assert.ok(saleIds.has(id));}
const metrics={dashboardApiMs:backendMs,backendRequests:log.length,backendResponseBodyBytes:log.reduce((n,r)=>n+r.bytes,0),browserProjectionBytes:Buffer.byteLength(JSON.stringify(w)),crossBuildingDetailRequests:0,globalFeeRpcCalls:0};
const w2=(await api("workspace",{building:other.id})).data;
const overlap=w.rows.filter(r=>w2.rows.some(o=>o.unitNumber===r.unitNumber));
for(const a of overlap){const b=w2.rows.find(r=>r.unitNumber===a.unitNumber);assert.notEqual(a.unitId,b.unitId);if(a.saleId&&b.saleId)assert.notEqual(a.saleId,b.saleId);}
console.log("live duplicate labels in selected sales worklists",overlap.map(r=>r.unitNumber).join(",")||"None. Duplicate-unit navigation remains covered by fixture tests.");
const roleChecks=[];
for(const role of ["CONTRACTOR","RESIDENT"]){
 const email=env["PLAYWRIGHT_"+role+"_EMAIL"],password=env["PLAYWRIGHT_"+role+"_PASSWORD"];if(!email||!password){roleChecks.push({role,status:"credentials unavailable"});continue;}
 const r=await fetch(origin+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,"content-type":"application/json"},body:JSON.stringify({email,password})});
 if(!r.ok){roleChecks.push({role,status:"sign-in rejected",http:r.status});continue;}
 const token=(await r.json()).access_token;const get=async(kind)=>{const r=await fetch(root+"/workspace/read?"+new URLSearchParams({kind,building:forum.id}),{headers:{authorization:"Bearer "+token}});const data=await r.json();return{status:r.status,data}};
 const cat=await get("catalog");if(role==="RESIDENT")assert.equal(cat.status,403);
 else {assert.equal(cat.status,200);const setup=await get("setup");assert.equal(setup.status,403);const completion=await get("completion");assert.equal(completion.status,403);}
 if(role==="CONTRACTOR"&&cat.data.buildings?.length){const b=cat.data.buildings[0].id;const r=await fetch(root+"/workspace/read?"+new URLSearchParams({kind:"workspace",building:b}),{headers:{authorization:"Bearer "+token}});assert.equal(r.status,200);const d=await r.json();assert.equal(d.rows.length,0);assert.ok(d.overview.items.every(i=>i.module==="snags"));const sn=await fetch(root+"/workspace/read?"+new URLSearchParams({kind:"snags",building:b}),{headers:{authorization:"Bearer "+token}});assert.equal(sn.status,200);}
 roleChecks.push({role,catalog:cat.status,status:"permission boundaries passed"});
}
for(const method of ["POST","PUT","PATCH","DELETE"]){const r=await fetch(root+"/workspace/read",{method,headers});assert.equal(r.status,403);}
const unauth=await fetch(root+"/workspace/read?kind=catalog");assert.equal(unauth.status,401);
const unknown=await api("workspace",{building:"00000000-0000-4000-8000-000000000000"});assert.equal(unknown.status,403);
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1366,height:768}});await page.addInitScript(a=>sessionStorage.setItem("bunnywell-staging-workspace-auth",JSON.stringify(a)),auth);
const docsRow=w.rows.find(r=>r.saleId&&r.stage==="exchanged");const record={view:"sale",building:forum.id,unit:docsRow.unitId,sale:docsRow.saleId,section:"completion"};
await page.goto(root+"/workspace?"+new URLSearchParams(record));await page.getByRole("heading",{name:"Completion at a glance"}).waitFor();
await page.getByRole("button",{name:"Comments & activity",exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement?.id),"sale-context-heading");await page.keyboard.press("Tab");assert.equal(await page.getByRole("button",{name:"Comments",exact:true}).evaluate(e=>document.activeElement===e),true);
await page.getByRole("button",{name:"Change building",exact:true}).click();assert.equal(await page.getByRole("dialog").evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").isVisible(),false);
await page.screenshot({path:"tmp/workspace-staging/completion-exchanged-laptop.png"});
await page.setViewportSize({width:683,height:384});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole("button",{name:"Comments & activity",exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement?.id),"sale-context-heading");await page.screenshot({path:"tmp/workspace-staging/zoom-200-equivalent.png"});await browser.close();
const detail=(await api("completion",{building:forum.id,unit:docsRow.unitId,sale:docsRow.saleId})).data;
console.log("representative Completion",docsRow.unitNumber,"document records",detail.documents?.length);
console.log("performance",metrics);console.log("role checks",roleChecks);
fs.writeFileSync("tmp/workspace-staging/access-performance-report.json",JSON.stringify({metrics,roleChecks,duplicateLabels:overlap.map(r=>r.unitNumber),keyboard:"discussion shortcut, tab focus, modal focus and Escape passed",zoom:"683x384 reflow equivalent to 200% on 1366x768; native browser zoom not exercised",mutations:"HTTP mutation methods denied; no business writes performed",completionDocumentRecords:detail.documents?.length},null,2));
