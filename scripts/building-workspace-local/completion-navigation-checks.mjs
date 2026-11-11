import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const out="artifacts/building-workspace-stage2/completion-review";
const credentials=JSON.parse(readFileSync("local-runtime/test-access.json","utf8"));
const record=JSON.parse(readFileSync(out+"/test-record.json","utf8"));
const base="http://127.0.0.1:3031/dev/building-workspace";
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const route=v=>base+"?"+new URLSearchParams(v), b1=id(1), b2=id(2);
const tests=[],metrics=[],errors=[],requests=[],pending=[];
let phase="entry";
const browser=await chromium.launch(), context=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:"block"});
context.on("page",page=>{
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{const u=new URL(r.url());if(u.pathname.startsWith("/rest/"))requests.push({phase,path:u.pathname,query:u.search});});
 page.on("response",r=>{const at=phase,u=new URL(r.url());if(u.pathname.startsWith("/rest/")||u.pathname.startsWith("/auth/")||u.pathname==="/dev/building-workspace/completion")pending.push((async()=>{await r.finished();const size=await r.request().sizes().catch(()=>null);if(size)metrics.push({phase:at,path:u.pathname,bodyBytes:size.responseBodySize,headerBytes:size.responseHeadersSize});})());});
});
async function login(page,href=base){await page.goto(href);await page.getByLabel("Email",{exact:true}).fill(credentials.accounts.find(a=>a.alias==="developer").email);await page.getByLabel("Password",{exact:true}).fill(credentials.password);await page.getByRole("button",{name:"Sign in",exact:true}).click();}
const heading=(p,n)=>p.getByRole("heading",{name:n,exact:true}).waitFor({timeout:30000});
async function change(p,name){await p.getByRole("button",{name:"Change building",exact:true}).click();await p.getByRole("dialog").getByRole("button",{name,exact:false}).click();await heading(p,"Sales worklist");}
const pass=n=>{tests.push(n);console.log("PASS "+n);};
const page=await context.newPage();
try{
 await login(page);await heading(page,"Choose your building");
 phase="dashboard";let time=performance.now();
 await page.getByRole("button",{name:"Open Willow Court",exact:true}).click();await heading(page,"Your building at a glance");const dashboardMs=performance.now()-time;await Promise.all(pending);
 phase="worklist";time=performance.now();await page.getByRole("button",{name:"Open sales worklist",exact:true}).click();await heading(page,"Sales worklist");const worklistMs=performance.now()-time;await Promise.all(pending);phase="navigation";
 pass("Explicit building entry, connected dashboard and cached building worklist");
 const willowText=await page.locator("tbody").innerText();
 for(const buyer of ["Taylor Reed","Jordan Finch","Avery Moss"])assert.ok(willowText.includes(buyer));
 await page.getByPlaceholder("Search this building").fill("G11");await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading(page,"Awaiting revised statement");assert.match(await page.title(),/G11 · Willow Court/);
 await page.reload();await heading(page,"Awaiting revised statement");
 await page.getByRole("button",{name:"Back to worklist",exact:true}).click();await heading(page,"Sales worklist");assert.equal(await page.getByPlaceholder("Search this building").inputValue(),"G11");
 await page.goBack();await heading(page,"Awaiting revised statement");await page.goForward();await heading(page,"Sales worklist");
 pass("Direct record refresh, browser back/forward and worklist search restoration");
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading(page,"Awaiting revised statement");
 await change(page,"Orchard House");assert.equal(new URL(page.url()).searchParams.get("sale"),null);
 const orchardText=await page.locator("tbody").innerText();for(const buyer of ["Harper Stone","Morgan West","Riley Lake"])assert.ok(orchardText.includes(buyer));
 assert.doesNotMatch(orchardText,/Taylor Reed|Jordan Finch|Avery Moss/);
 await page.getByPlaceholder("Search this building").fill("301");await change(page,"Willow Court");assert.equal(await page.getByPlaceholder("Search this building").inputValue(),"G11");
 await change(page,"Orchard House");assert.equal(await page.getByPlaceholder("Search this building").inputValue(),"301");
 pass("G11/LG11/301 remain separate by building; switching opens worklists with independent filters");
 await page.getByPlaceholder("Search this building").fill("");await page.getByRole("link",{name:"G11 Harper Stone",exact:false}).click();await heading(page,"Completion arrangements");
 const second=await context.newPage();await login(second,route({view:"sale",building:b1,unit:id(100),sale:id(1100),section:"completion"}));await heading(second,"Awaiting revised statement");assert.match(await page.title(),/Orchard House/);assert.match(await second.title(),/Willow Court/);
 await second.goto(route({view:"sale",building:b2,unit:id(100),sale:id(1100),section:"completion"}));await heading(second,"Sale unavailable");
 await second.goto(base);await heading(second,"Choose your building");await second.close();
 pass("Independent authenticated tabs, exact direct links and mismatched record rejection");
 // Hold a real old-building data response, then change building before releasing it.
 await page.goto(route({view:"worklist",building:b2}));await heading(page,"Sales worklist");
 let release,arrive;let held=new Promise(r=>release=r),seen=new Promise(r=>arrive=r),done;
 let finished=new Promise(r=>done=r);
 await page.route("**/rest/v1/units?**",async r=>{if(new URL(r.request().url()).searchParams.get("building_id")==="eq."+b1){const response=await r.fetch();arrive();await held;await r.fulfill({response}).catch(()=>{});done();}else await r.continue();});
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Willow Court",exact:false}).click();await seen;await heading(page,"Loading Willow Court");await change(page,"Orchard House");release();await finished;
 assert.doesNotMatch(await page.locator("tbody").innerText(),/Taylor Reed|Jordan Finch|Avery Moss/);await page.unroute("**/rest/v1/units?**");
 pass("Late building response cannot populate a newly selected building");
 // Repeat with the newly connected discussion API and a populated prior conversation.
 held=new Promise(r=>release=r);seen=new Promise(r=>arrive=r);finished=new Promise(r=>done=r);
 await page.route("**/dev/building-workspace/completion?**",async r=>{const q=new URL(r.request().url()).searchParams;if(q.get("sale")===record.saleId&&q.get("kind")==="comments"){const response=await r.fetch();arrive();await held;await r.fulfill({response}).catch(()=>{});done();}else await r.continue();});
 await page.goto(route({view:"sale",building:record.buildingId,unit:record.unitId,sale:record.saleId,section:"completion"}));await seen;await heading(page,"Completion documents approved");
 await change(page,"Orchard House");await page.getByRole("link",{name:"G11 Harper Stone",exact:false}).click();await heading(page,"Completion arrangements");
 await expect(page.getByRole("region",{name:"Conversation messages"}).getByText("No comments yet for this sale.",{exact:true})).toBeVisible();release();await finished;
 assert.doesNotMatch(await page.locator("#sale-context-panel").innerText(),/fictional apportionment|Long conversation/);await expect(page.getByLabel("Comment",{exact:true})).toHaveValue("");
 await page.unroute("**/dev/building-workspace/completion?**");pass("Late previous-sale conversation never appears under the new identity");
 await page.goto(route({view:"sale",building:record.buildingId,unit:record.unitId,sale:record.saleId,section:"completion"}));await heading(page,"Completion documents approved");await expect(page.getByRole("region",{name:"Conversation messages"}).getByRole("article").first()).toBeVisible();
 await page.screenshot({path:out+"/completion-current-1366.png"});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+"/completion-current-390.png"});
 const initial=requests.filter(r=>["dashboard","worklist"].includes(r.phase));
 assert.ok(initial.every(r=>!r.query.includes(b2)));assert.ok(initial.filter(r=>r.path==="/rest/v1/units").every(r=>new URLSearchParams(r.query).get("building_id")==="eq."+b1));
 assert.equal(metrics.filter(m=>m.phase==="worklist").length,0);
 assert.equal(errors.length,0,errors.join("\n"));
 pass("Normal building entry remains scoped, worklist reuses the snapshot and no browser errors");
 const performanceEvidence={dashboardUsableMs:dashboardMs,worklistFromDashboardMs:worklistMs,phases:["dashboard","worklist"].map(phase=>({phase,requests:metrics.filter(m=>m.phase===phase).length,bodyBytes:metrics.filter(m=>m.phase===phase).reduce((n,m)=>n+m.bodyBytes,0),headerBytes:metrics.filter(m=>m.phase===phase).reduce((n,m)=>n+m.headerBytes,0)})),conditions:"Warm local Next development server, approved synthetic data, data/auth requests only; excludes page assets and WebSocket frames. Not a remote/production-scale benchmark."};
 writeFileSync(out+"/navigation.json",JSON.stringify({at:new Date().toISOString(),tests,performance:performanceEvidence,browserErrors:errors},null,2));console.log(JSON.stringify({passed:tests.length,performance:performanceEvidence},null,2));
} catch(e){writeFileSync(out+"/navigation-failure.json",JSON.stringify({tests,error:e.stack,errors},null,2));throw e;}finally{await browser.close();}
