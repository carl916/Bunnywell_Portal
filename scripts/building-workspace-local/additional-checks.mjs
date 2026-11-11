import {chromium} from "playwright";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {sql} from "./runtime.mjs";
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const config=JSON.parse(readFileSync("local-runtime/test-access.json","utf8"));
const origin="http://127.0.0.1:3031",base=origin+"/dev/building-workspace";
const route=v=>base+"?"+new URLSearchParams(v);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
const results=[];
const check=name=>{results.push({name,passed:true});console.log("PASS "+name)};
async function heading(text){await page.getByRole("heading",{name:text,exact:true}).waitFor({timeout:15000})}
async function login(p,url=base){await p.goto(url);await p.getByLabel("Email",{exact:true}).fill(config.accounts.find(a=>a.alias==="developer").email);await p.getByLabel("Password",{exact:true}).fill(config.password);await p.getByRole("button",{name:"Sign in",exact:true}).click()}
try{
 await login(page);await heading("Choose your building");
 let captured=[],sample=null,pending=[];
 page.on("request",r=>{if(sample&&r.url().includes("/rest/"))captured.push(r.url())});
 page.on("response",r=>{if(sample&&/\/(auth|rest)\//.test(r.url())){const current=sample;pending.push((async()=>{await r.finished();const size=await r.request().sizes();current.requests++;current.bodyBytes+=size.responseBodySize;current.headerBytes+=size.responseHeadersSize})())}});
 const perf=[];
 for(let n=0;n<3;n++){sample={requests:0,bodyBytes:0,headerBytes:0};const start=performance.now();await page.goto(route({building:id(1),view:"worklist"}));await heading("Sales worklist");await Promise.all(pending);sample.usableMs=performance.now()-start;perf.push(sample);sample=null;}
 for(const address of captured){const u=new URL(address),table=u.pathname.split("/").at(-1),p=u.searchParams;if(["units","building_floors","building_organisations","unit_sale_attempts"].includes(table))assert.equal(p.get("building_id"),"eq."+id(1));if(["unit_sale_documents","unit_sale_terms","unit_sale_invoices","sale_legal_emails","sale_exchange_deposit_receipts","sale_exchange_deposit_sources","sale_further_deposit_facts"].includes(table))assert.match(p.get("sale_attempt_id"),/^in\.\(b1700000/);assert.ok(!decodeURIComponent(address).includes(id(1200)));}
 check("direct worklist load uses building filters and scoped related-sale selectors; measured three local loads");
 await page.route("**/rest/v1/unit_sale_documents?**",r=>r.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"controlled local source failure"})}));
 await page.getByRole("button",{name:"Refresh workspace",exact:true}).click();await page.getByText("Action counts are unavailable because a required source could not be loaded completely.",{exact:false}).waitFor();assert.equal(await page.locator("tbody tr").count(),4);check("incomplete legal source leaves counts unavailable rather than zero");
 await page.unroute("**/rest/v1/unit_sale_documents?**");
 await page.route("**/rest/v1/units?**",r=>r.fulfill({status:503,body:"controlled local read failure"}));
 await page.getByRole("button",{name:"Refresh workspace",exact:true}).click();await heading("Workspace unavailable");assert.equal(await page.locator("tbody tr").count(),0);check("whole workspace error removes stale rows");
 await page.unroute("**/rest/v1/units?**");
 sql("insert into public.unit_sale_attempts(id,building_id,unit_id,attempt_number,is_active,workflow_status,buyer_person_name) values('"+id(8100)+"','"+id(1)+"','"+id(100)+"',2,false,'superseded','Local Historic Buyer') on conflict(id) do nothing;");
 await page.goto(route({building:id(1),unit:id(100),sale:id(8100),view:"sale",section:"completion"}));await heading("Sale unavailable");check("same building and unit with a superseded sale attempt is not silently redirected to the active attempt");
 await page.goto(route({building:id(1),unit:id(100),sale:id(1100),view:"sale",section:"completion"}));await heading("Awaiting revised statement");
 const summary=page.locator("summary").last();await summary.focus();await page.keyboard.press("Enter");const focused=await summary.boundingBox(),identity=await page.locator("header[aria-label='Sale identity']").boundingBox();assert.ok(focused.y>=identity.y+identity.height);check("keyboard-focused document history is not obscured by the sticky unit identity");
 await page.setViewportSize({width:390,height:844});
 await page.goto(route({building:id(1),view:"worklist"}));await heading("Sales worklist");
 await page.evaluate(()=>scrollTo(0,400));await page.waitForTimeout(100);
 const priorScroll=await page.evaluate(()=>scrollY);
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading("Awaiting revised statement");
 await page.getByRole("button",{name:"Back to worklist",exact:true}).click();await heading("Sales worklist");
 await page.waitForFunction(y=>Math.abs(scrollY-y)<5,priorScroll);
 check("mobile worklist return restores its saved scroll position");
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading("Awaiting revised statement");
 await page.getByRole("button",{name:"Change building",exact:true}).waitFor({state:"visible"});check("separate mobile change-building control remains accessible");
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:"artifacts/building-workspace-stage2/completion-390.png"});
 const zoom=await browser.newContext({viewport:{width:683,height:384},deviceScaleFactor:2});const zoomPage=await zoom.newPage();await login(zoomPage,route({building:id(1),unit:id(100),sale:id(1100),view:"sale",section:"completion"}));await zoomPage.getByRole("heading",{name:"Awaiting revised statement",exact:true}).waitFor();assert.equal(await zoomPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await zoomPage.locator("header[aria-label='Sale identity']").evaluate(e=>getComputedStyle(e).position),"relative");await zoomPage.screenshot({path:"artifacts/building-workspace-stage2/completion-zoom-equivalent.png"});await zoom.close();check("200-percent zoom-equivalent viewport keeps text readable, removes sticky identity and avoids horizontal overflow (not a native browser zoom test)");
 const mail=await(await fetch("http://127.0.0.1:54324/api/v1/messages")).json();assert.equal(mail.total,0);check("local mail catcher has no generated outbound messages");
 const audit=sql("select count(*) from public.unit_open_events;").trim();assert.equal(audit,"0");check("connected navigation did not invoke legacy unit-open audit side effects");
 writeFileSync("artifacts/building-workspace-stage2/additional-checks.json",JSON.stringify({at:new Date().toISOString(),results,performance:{directWorklist:perf,note:"Three reloads against four synthetic units on a warm local development server. Body and header sizes measured via browser network API; no production scalability claim."},legacyBoundary:"No link opened or preloaded; existing sale file remains unavailable. Opening legacy routes can write unit-open audit/activity, initialise sale state or expire legal authority."},null,2));
}finally{await browser.close()}



