import {chromium} from "playwright";
import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
import {sql} from "./runtime.mjs";
const credentials=JSON.parse(readFileSync("local-runtime/test-access.json","utf8"));
const base="http://127.0.0.1:3031/dev/building-workspace";
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const route=v=>base+"?"+new URLSearchParams(v);
const tests=[],metrics=[],requests=[],errors=[];let phase="setup";
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1366,height:768}});
const pending=[];
context.on("page",page=>{
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{const u=new URL(r.url());if(u.pathname.startsWith("/auth/")||u.pathname.startsWith("/rest/"))requests.push({phase,method:r.method(),url:r.url()})});
 page.on("response",r=>{const at=phase,u=new URL(r.url());if(u.pathname.startsWith("/rest/")||u.pathname.startsWith("/auth/"))pending.push((async()=>{await r.finished();const size=await r.request().sizes().catch(()=>({responseBodySize:0,responseHeadersSize:0}));metrics.push({phase:at,status:r.status(),path:u.pathname,bytes:size.responseBodySize,headers:size.responseHeadersSize})})())});
});
const page=await context.newPage();
async function signIn(page,alias,href=base){await page.goto(href);await page.getByLabel("Email",{exact:true}).fill(credentials.accounts.find(a=>a.alias===alias).email);await page.getByLabel("Password",{exact:true}).fill(credentials.password);await page.getByRole("button",{name:"Sign in",exact:true}).click()}
async function heading(page,title){await page.getByRole("heading",{name:title,exact:true}).waitFor({timeout:25000})}
const check=(name)=>{tests.push({name,passed:true});console.log("PASS "+name)};
const b1=id(1),b2=id(2),b3=id(3);
try{
 await signIn(page,"developer");await heading(page,"Choose your building");check("multi-building homepage requires explicit selection");
 phase="dashboard";const started=performance.now();await page.getByRole("button",{name:"Open Willow Court",exact:true}).click();await heading(page,"Your building at a glance");await Promise.all(pending);const dashboardMs=performance.now()-started;check("authenticated dashboard, team and distinct-sale counts");
 assert.match(await page.locator("main").innerText(),/2 actions · 2 sales/);
 assert.match(await page.locator("main").innerText(),/3 distinct sales/);
 await page.screenshot({path:"artifacts/building-workspace-stage2/dashboard-1366.png"});
 phase="worklist";const listStart=performance.now();await page.getByRole("button",{name:"Open sales worklist",exact:true}).click();await page.getByRole("table",{name:"Building sales"}).waitFor();const listMs=performance.now()-listStart; phase="navigation";
 const labels=await page.locator("tbody tr td:first-child strong").allTextContents();assert.deepEqual(labels.map(x=>x.trim()),["LG11","G2","G11","301"]);check("configured floor order then natural unit order");
 await page.getByPlaceholder("Search this building").fill("G11");
 assert.equal(await page.locator("tbody tr").count(),2); // LG11 and G11 both match substring
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading(page,"Awaiting revised statement");
 await page.getByRole("button",{name:"Activity",exact:true}).click();
 await page.getByRole("link",{name:"Exchange",exact:true}).click();await heading(page,"Exchange");
 await page.getByRole("link",{name:"Completion",exact:true}).click();await heading(page,"Awaiting revised statement");
 assert.equal(await page.getByRole("button",{name:"Activity",exact:true}).getAttribute("aria-pressed"),"true");
 check("full-page Completion and discussion view retained within the same sale");
 assert.match(await page.title(),/G11 · Willow Court/);
 await page.getByRole("button",{name:"Comments",exact:true}).click();
 await page.screenshot({path:"artifacts/building-workspace-stage2/completion-1366.png"});
 await page.getByRole("button",{name:"Back to worklist",exact:true}).click();await heading(page,"Sales worklist");assert.equal(await page.getByPlaceholder("Search this building").inputValue(),"G11");check("per-building worklist search restoration");
 await page.goBack();await heading(page,"Awaiting revised statement");await page.goForward();await heading(page,"Sales worklist");check("browser back and forward");
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading(page,"Awaiting revised statement");
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Orchard House",exact:false}).click();await heading(page,"Sales worklist");assert.equal(new URL(page.url()).searchParams.get("unit"),null);assert.match(await page.locator("tbody").innerText(),/Harper Stone/);assert.doesNotMatch(await page.locator("tbody").innerText(),/Taylor Reed/);check("switching a sale opens new building worklist without matching-number auto-open");
 await page.getByRole("link",{name:"G11 Harper Stone",exact:false}).click();await heading(page,"Completion arrangements");assert.match(await page.locator("header[aria-label='Sale identity']").innerText(),/Orchard House.*G11/s);
 await page.reload();await heading(page,"Completion arrangements");check("refresh retains specified building and exact sale");
 const tab2=await context.newPage();await signIn(tab2,"developer",route({view:"sale",building:b1,unit:id(100),sale:id(1100),section:"completion"}));await heading(tab2,"Awaiting revised statement");assert.match(await page.title(),/Orchard House/);assert.match(await tab2.title(),/Willow Court/);check("direct task link and independent browser tabs");
 await tab2.goto(route({view:"sale",building:b2,unit:id(100),sale:id(1100),section:"completion"}));await heading(tab2,"Sale unavailable");check("mismatched building/unit/sale link denied");
 await tab2.goto(base);await heading(tab2,"Choose your building");check("fresh homepage never silently reuses last building");
 // Hold a real local response from Willow; switch to Orchard before releasing it.
 await page.goto(route({view:"worklist",building:b2}));await heading(page,"Sales worklist");
 let release,seen;const held=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);
 await page.route("**/rest/v1/units?**",async route=>{
  if(new URL(route.request().url()).searchParams.get("building_id")==="eq."+b1){const response=await route.fetch();seen();await held;await route.fulfill({response}).catch(()=>{});}else await route.continue();
 });
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Willow Court",exact:false}).click();await arrived;await heading(page,"Loading Willow Court");
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Orchard House",exact:false}).click();await heading(page,"Sales worklist");release();await page.waitForTimeout(250);assert.doesNotMatch(await page.locator("tbody").innerText(),/Taylor Reed|Jordan Finch|Avery Moss/);await page.unroute("**/rest/v1/units?**");check("switch during a delayed response never publishes the previous building's records");
 // Duplicate labels remain distinct in all three examples.
 const orchard=await page.locator("tbody").innerText();for(const buyer of ["Harper Stone","Morgan West","Riley Lake"])assert.ok(orchard.includes(buyer));
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Willow Court",exact:false}).click();await heading(page,"Sales worklist");assert.equal(await page.getByPlaceholder("Search this building").inputValue(),"G11");
 await page.getByPlaceholder("Search this building").fill("");for(const buyer of ["Taylor Reed","Jordan Finch","Avery Moss"])assert.ok((await page.locator("tbody").innerText()).includes(buyer));check("G11, LG11 and 301 have separate stable records and buyers");
 await page.screenshot({path:"artifacts/building-workspace-stage2/worklist-1366.png"});
 const first=page.locator("tbody tr").filter({hasText:"Taylor Reed"});assert.ok(await first.locator("details summary").count());await first.locator("summary").click();assert.match(await first.innerText(),/Waiting on others/);check("primary action retains other outstanding actions");
 // Empty list is a real empty authorised building for an internal role.
 await page.goto(route({building:b3,view:"worklist"}));await heading(page,"Sales worklist");assert.equal(await page.locator("tbody tr").count(),0);check("empty authorised building");
 // Mobile and tablet use the same live backend, not fixture screen modes.
 await page.goto(route({building:b1,view:"worklist"}));await heading(page,"Sales worklist");await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:"artifacts/building-workspace-stage2/worklist-390.png"});assert.ok(await page.locator("td").filter({hasText:"Review statement of account"}).isVisible());assert.ok(await page.locator("header").filter({hasText:"Willow Court"}).isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);check("mobile identity, next actions and no horizontal overflow");
 await page.getByRole("link",{name:"G11 Taylor Reed",exact:false}).click();await heading(page,"Awaiting revised statement");await page.screenshot({path:"artifacts/building-workspace-stage2/completion-390.png"});
 await page.getByRole("button",{name:"Comments & activity",exact:false}).click();assert.equal(await page.evaluate(()=>document.activeElement?.id),"sale-context-heading");check("mobile discussion shortcut reaches the in-flow panel");
 await page.setViewportSize({width:1024,height:768});await page.screenshot({path:"artifacts/building-workspace-stage2/completion-tablet.png"});
 await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:"artifacts/building-workspace-stage2/completion-wide.png"});
 const task=await page.locator("[class*='saleTask']").boundingBox(),panel=await page.locator("#sale-context-panel").boundingBox();assert.ok(panel.x>=task.x+task.width);check("wide desktop panel is docked beside the task");
 await page.getByRole("button",{name:"Change building",exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement?.closest("dialog")!==null),true);await page.keyboard.press("Escape");assert.equal(await page.locator("dialog").evaluate(d=>d.open),false);check("building selector keyboard focus and Escape dismissal");
 phase="conveyancer";const legal=await context.newPage();await signIn(legal,"conveyancer",route({view:"sale",building:b1,unit:id(100),sale:id(1100),section:"completion"}));await heading(legal,"Resolve the query");assert.equal(await legal.getByRole("button",{name:"Upload revised document",exact:true}).first().isDisabled(),true);check("conveyancer role-safe Completion heading; business actions disabled");
 assert.equal(requests.filter(r=>r.phase==="conveyancer"&&/\/(unit_sale_terms|unit_sale_invoices|unit_sale_invoice_payments)\?/.test(r.url)).length,0);check("conveyancer receives no fee-table requests");
 const one=await context.newPage();await signIn(one,"agent-single");await heading(one,"Your building at a glance");assert.equal(new URL(one.url()).searchParams.get("building"),b1);check("one-building external account enters its building directly");
 await one.goto(route({building:b3,view:"worklist"}));await heading(one,"Building unavailable");check("inaccessible building denied without substitute");
 for(const alias of ["inactive","restricted"]){const denied=await context.newPage();await signIn(denied,alias);await heading(denied,"Workspace access unavailable");await denied.close();check(alias+" account denied Sales")}
 // Check underlying RLS using the same caller token, never the service role.
 const direct=await one.evaluate(async()=>{const s=JSON.parse(sessionStorage.getItem("bunnywell-stage2-auth"));const c=await(await fetch("/local-config")).json();const r=await fetch(c.apiOrigin+"/rest/v1/unit_sale_attempts?select=id&building_id=eq.b1700000-0000-4000-8000-000000000002",{headers:{apikey:c.anonKey,Authorization:"Bearer "+s.access_token}});return{status:r.status,rows:await r.json()}});
 assert.equal(direct.status,200);assert.deepEqual(direct.rows,[]);check("database RLS denies another building's sale rows for the single-building agent");
 // Revoke and restore only the approved synthetic account's explicit test access.
 sql("delete from public.user_building_access where user_id='"+id(910)+"' and building_id='"+b1+"';");
 try{await one.goto(route({building:b1,view:"worklist"}));await heading(one,"Building unavailable");check("controlled access revocation denies subsequent reads")}finally{sql("insert into public.user_building_access(user_id,building_id,role_on_building) values('"+id(910)+"','"+b1+"','sales_agent') on conflict(user_id,building_id) do nothing;")}
 assert.equal(errors.length,0);
 assert.equal(requests.filter(r=>r.url.includes("/rest/")&&r.method!=="GET").length,0);
 const initial=requests.filter(r=>r.phase==="dashboard"&&r.url.includes("/rest/"));assert.ok(initial.every(r=>!/(00000000120[0-3]|00000000020[0-3])/.test(decodeURIComponent(r.url))));check("normal building entry fetches no detailed records from another building; business reads only");
 await Promise.all(pending);
 writeFileSync("artifacts/building-workspace-stage2/journey-tests.json",JSON.stringify({at:new Date().toISOString(),tests,errors,performance:{dashboardMs,worklistFromDashboardMs:listMs,phases:["dashboard","worklist"].map(phase=>({phase,requests:metrics.filter(m=>m.phase===phase).length,transferredBodyBytes:metrics.filter(m=>m.phase===phase).reduce((n,m)=>n+m.bytes,0),transferredHeadersBytes:metrics.filter(m=>m.phase===phase).reduce((n,m)=>n+m.headers,0)})),note:"Local synthetic data, warm development server; no remote or production benchmark"},requests,metrics},null,2));
 console.log("All "+tests.length+" journey checks passed.");
}catch(e){await page.screenshot({path:"artifacts/building-workspace-stage2/journey-failure.png"}).catch(()=>{});writeFileSync("artifacts/building-workspace-stage2/journey-failure.json",JSON.stringify({tests,error:String(e),body:(await page.locator("body").innerText()).slice(0,4000),errors},null,2));throw e}
finally{await browser.close()}



