import { test as baseTest, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync,writeFileSync } from "node:fs";
const out="artifacts/building-contracts-stage1",path="/dev/building-workspace-contracts";
const id=(n:number)=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const A=id(1),B=id(2),base="http://127.0.0.1:3031";
const url=(building=A,extra="")=>path+"?building="+building+"&view=sales"+extra;
// Fresh browser per case avoids the local runner's repeat-context webpack hydration stall.
// Evidence is captured explicitly below; no retry conceals an application failure.
const test=baseTest.extend({context:async({},runContext)=>{
 const browser=await chromium.launch();const context=await browser.newContext({baseURL:base,viewport:{width:1366,height:768},serviceWorkers:"block"});
 try{await runContext(context);}finally{await browser.close();}
}});
const ready=(page:Page,b=A)=>expect(page.getByTestId("workspace-ready")).toHaveAttribute("data-building",b,{timeout:15000});
let requests:string[],unexpected:string[],errors:string[];
async function guard(context:BrowserContext) {
 await context.route("**/*",async route=>{
   const req=route.request(),u=new URL(req.url());requests.push(req.method()+" "+u.pathname+u.search);
   if(u.origin!==base||!((u.pathname.startsWith("/_next/")||u.pathname.startsWith("/__nextjs_font/"))||u.pathname===path||u.pathname===path+"/fixtures"||u.pathname==="/favicon.ico"||u.pathname==="/__nextjs_original-stack-frames")){unexpected.push(req.url());await route.abort();return;}
   await route.continue();
 });
 context.on("page",p=>p.on("pageerror",e=>errors.push(e.stack??e.message)));
}
test.beforeEach(async({context,page})=>{requests=[];unexpected=[];errors=[];await guard(context);page.on("pageerror",e=>errors.push(e.stack??e.message));});
test.afterEach(async({},info)=>{
 mkdirSync(out,{recursive:true});writeFileSync(out+"/"+info.title.replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-network.json",JSON.stringify({requests,unexpected,errors},null,2));
 expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test("explicit entry keyboard journey and single-building account",async({page})=>{
 await page.goto(path);await page.getByRole("button",{name:/Willow Court.*Open building/}).focus();await page.keyboard.press("Enter");
 await ready(page);await expect(page.getByRole("heading",{name:"Your building at a glance"})).toBeVisible();
 await page.getByRole("button",{name:"Open sales worklist",exact:true}).click();await expect(page.getByRole("heading",{name:"Sales worklist",exact:true})).toBeVisible();
 await page.goto(path);await expect(page.getByRole("heading",{name:"Choose your building"})).toBeVisible();
 await page.goto(path+"?viewer=developer-single");await ready(page);await expect(page).toHaveURL(/building=/);
});
test("mobile mixed actions retain all titles owners and waiting context",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(url());await ready(page);
 await page.getByRole("textbox",{name:"Search this building"}).fill("G11");
 const row=page.locator("tr[data-unit-id='"+id(100)+"']");await expect(row.getByText("Review statement of account",{exact:true})).toBeVisible();
 await expect(row.getByText("Awaiting revised completion statement",{exact:true})).toBeVisible();await expect(row.getByText("Awaiting exchange agent invoice",{exact:true})).toBeVisible();
 await expect(row.getByText("Willow Sales Team",{exact:true})).toBeVisible();await expect(row.getByText("Brook Legal Team",{exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Responsibility",exact:true}).selectOption("ours");await expect(row).toBeVisible();
 await page.getByRole("combobox",{name:"Responsibility",exact:true}).selectOption("others");await expect(row.getByText("Review statement of account",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:out+"/worklist-390.png",fullPage:true,style:"nextjs-portal{display:none}"});
});
test("developer waiting views are read-only and preserve disabled on-behalf option",async({page})=>{
 for(const [unit,sale,heading,button]of [[id(103),id(1103),"Awaiting agent invoice","Submit invoice on behalf of agent"],[id(102),id(1102),"Awaiting reservation submission","Submit reservation on behalf of agent"]]){
   await page.goto(url(A,"&unit="+unit+"&sale="+sale));await ready(page);
   const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:heading,exact:true})).toBeVisible();
   await expect(dialog.locator("input,textarea,form")).toHaveCount(0);await dialog.getByText("Existing authorised option",{exact:true}).click();await expect(dialog.getByRole("button",{name:button,exact:true})).toBeDisabled();
   await expect(dialog.getByRole("button",{name:/Open existing sale file/})).toBeDisabled();await expect(dialog.locator("a")).toHaveCount(0);
   await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
 }
});
test("all six duplicate records direct links and refresh preserve exact identity",async({page})=>{
 for(const [b,offset,buyers] of [[A,100,["Taylor Reed","Jordan Finch","Avery Moss"]],[B,200,["Harper Stone","Morgan West","Riley Lake"]]] as const){
  for(let i=0;i<3;i++){
   await page.goto(url(b,"&unit="+id(offset+i)+"&sale="+id(offset+1000+i)));await ready(page,b);
   await expect(page.getByRole("dialog").getByText(buyers[i],{exact:true})).toBeVisible();
   await expect(page).toHaveTitle(new RegExp((b===A?"Willow Court":"Orchard House")+" · "+["G11","LG11","301"][i]));
   await page.reload();await ready(page,b);await expect(page.getByRole("dialog").getByText(buyers[i],{exact:true})).toBeVisible();
  }
 }
 await page.goto(url(B,"&unit="+id(100)+"&sale="+id(1100)));await expect(page.getByRole("heading",{name:"Workspace unavailable"})).toBeVisible();await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("building switch never substitutes same label and restores separate filters",async({page})=>{
 await page.goto(url());await ready(page);await page.getByRole("textbox",{name:"Search this building"}).fill("G11");
 await page.getByRole("combobox",{name:"Responsibility",exact:true}).selectOption("others");
 await page.getByRole("button",{name:"Open G11, Taylor Reed",exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:"Change building",exact:true}).click();
 await page.getByRole("dialog",{name:"Change building",exact:true}).getByRole("button",{name:/Orchard House/}).click();await ready(page,B);
 await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page).not.toHaveURL(/unit=/);await expect(page.getByRole("textbox",{name:"Search this building"})).toHaveValue("");
 await page.getByRole("textbox",{name:"Search this building"}).fill("301");
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:/Willow Court/}).click();await ready(page);
 await expect(page.getByRole("textbox",{name:"Search this building"})).toHaveValue("G11");await expect(page.getByRole("combobox",{name:"Responsibility",exact:true})).toHaveValue("others");
});
test("browser history restores selection and list page and scroll",async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.goto(url());await ready(page);
 await page.getByRole("button",{name:"Next page",exact:true}).click();await expect(page.getByText("Page 2 of 2",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Open 301, Avery Moss",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await page.goBack();
 await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByText("Page 2 of 2",{exact:true})).toBeVisible();await page.goForward();await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Previous page",exact:true}).click();await page.evaluate(()=>window.scrollTo(0,250));await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(150);
 const before=await page.evaluate(()=>scrollY);await page.getByRole("button",{name:"Open G11, Taylor Reed",exact:true}).click();await page.keyboard.press("Escape");await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(100);
 expect(Math.abs((await page.evaluate(()=>scrollY))-before)).toBeLessThan(450);
});
test("two tabs retain independent building searches and return state",async({context,page})=>{
 await page.goto(url());await ready(page);await page.getByRole("textbox",{name:"Search this building"}).fill("G11");
 const second=await context.newPage();await second.goto(url(B));await ready(second,B);await second.getByRole("textbox",{name:"Search this building"}).fill("301");
 await expect(page.getByTestId("building-identity")).toContainText("Willow Court");await expect(page.getByRole("textbox",{name:"Search this building"})).toHaveValue("G11");
 await second.reload();await ready(second,B);await expect(second.getByRole("textbox",{name:"Search this building"})).toHaveValue("301");
 await page.reload();await ready(page);await expect(page.getByRole("textbox",{name:"Search this building"})).toHaveValue("G11");
 await second.close();
});
test("switching during held request never paints old records under new building",async({page})=>{
 let release:()=>void=()=>{};let pending=false;
 await page.route("**/fixtures?**",async route=>{
   const p=new URL(route.request().url()).searchParams;
   if(p.get("kind")==="workspace"&&p.get("building")===A){
    const response=await route.fetch();pending=true;await new Promise<void>(resolve=>release=resolve);
    await route.fulfill({response}).catch(()=>{});return;
   }await route.fallback();
 });
 await page.goto(url());await expect.poll(()=>pending).toBe(true);
 await page.evaluate(()=>{(window as unknown as {mixed:string[]}).mixed=[];new MutationObserver(()=>{const identity=document.querySelector('[data-testid="building-identity"]')?.textContent??"";const rows=document.querySelector("main")?.textContent??"";if(identity.includes("Orchard House")&&/Taylor Reed|Jordan Finch|Avery Moss/.test(rows))(window as unknown as {mixed:string[]}).mixed.push(rows);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
 await page.getByRole("button",{name:"Change building",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:/Orchard House/}).click();await ready(page,B);release();
 await expect(page.getByRole("button",{name:"Open G11, Harper Stone",exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {mixed:string[]}).mixed)).toEqual([]);
});
test("empty failed unavailable incomplete loads and inaccessible account stay scoped",async({page})=>{
 await page.goto(url(A,"&data=empty"));await ready(page);await expect(page.getByRole("heading",{name:"No sales to show"})).toBeVisible();
 for(const mode of ["error","unavailable"]){await page.goto(url(A,"&data="+mode));await expect(page.getByRole("heading",{name:"Workspace unavailable"})).toBeVisible();await expect(page.locator("tbody")).toHaveCount(0);await expect(page.getByTestId("building-identity")).toContainText("Willow Court");}
 await page.goto(url(A,"&data=incomplete"));await ready(page);await expect(page.getByText("Actions unavailable: required data is incomplete.",{exact:true}).first()).toBeVisible();
 await page.goto(url(id(3)));await expect(page.getByRole("heading",{name:"Workspace unavailable"})).toBeVisible();
 await page.goto(url(A,"&viewer=restricted"));await expect(page.getByRole("status")).toContainText("Account unavailable");
});
test("role-safe dashboard counts and keyboard drawer focus at desktop and tablet",async({page})=>{
 for(const viewport of [{width:1366,height:768},{width:820,height:1180}]){
  await page.setViewportSize(viewport);await page.goto(path+"?building="+A);await ready(page);
  await expect(page.getByTestId("count-ours")).toContainText("2 actions across 2 sales");
  await expect(page.getByTestId("count-others")).toContainText("4 actions across 2 sales");
  await expect(page.getByTestId("distinct-count")).toContainText("3 distinct");
  await page.getByRole("button",{name:"Open sales worklist",exact:true}).click();
  const target=page.getByRole("button",{name:"Open LG11, Jordan Finch",exact:true});await target.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Close drawer",exact:true})).toBeFocused();await page.keyboard.press("Escape");await expect(target).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:out+"/worklist-1366.png",style:"nextjs-portal{display:none}"});
});
test("performance evidence local request counts bytes and time to usable surfaces",async({browser})=>{
 test.setTimeout(180000);
 const samples:{surface:string;viewport:string;iteration:number;usableMs:number;allRequestAttemptsToUsable:number;allTransferredBytesToUsable:number;completedFixtureRequests:number;fixtureJsonBytes:number;workspaceJsonBytes:number;otherBuildingDetailedRecords:number}[]=[];
 for(const surface of ["dashboard","sales"])for(const width of [1366,390])for(let iteration=0;iteration<3;iteration++){
  const context=await browser.newContext({viewport:{width,height:width===390?844:768},serviceWorkers:"block"});await guard(context);const page=await context.newPage();
  const cdp=await context.newCDPSession(page);await cdp.send("Network.enable");let bytes=0,attempts=0;
  cdp.on("Network.requestWillBeSent",()=>attempts++);cdp.on("Network.loadingFinished",e=>bytes+=e.encodedDataLength);
  const payloads:{kind:string;bytes:number;body:string}[]=[];
  page.on("response",async response=>{if(response.url().includes("/fixtures?")){const body=await response.text().catch(()=>"");if(body)payloads.push({kind:new URL(response.url()).searchParams.get("kind")!,bytes:Buffer.byteLength(body),body});}});
  await page.goto(path+"?building="+A+"&view="+surface);await ready(page);
  if(surface==="sales")await expect(page.getByRole("button",{name:"Open LG11, Jordan Finch",exact:true})).toBeVisible();else await expect(page.getByTestId("count-ours")).toBeVisible();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const usable=await page.evaluate(()=>performance.now());const transferred=bytes;
  await expect.poll(()=>payloads.filter(p=>p.kind==="workspace").length).toBe(1);
  expect(payloads.filter(p=>p.kind==="catalog").length).toBe(1);
  const data=payloads.find(p=>p.kind==="workspace")!;
  expect(data.body).not.toMatch(/Harper Stone|Morgan West|Riley Lake/);expect(JSON.parse(data.body).rows.every((r:{buildingId:string})=>r.buildingId===A)).toBe(true);
  const before=payloads.length;
  if(surface==="dashboard"){await page.getByRole("button",{name:"Open sales worklist",exact:true}).click();await expect(page.getByRole("heading",{name:"Sales worklist",exact:true})).toBeVisible();expect(payloads.length).toBe(before);}
  samples.push({surface,viewport:width===390?"390x844":"1366x768",iteration,usableMs:Math.round(usable),allRequestAttemptsToUsable:attempts,allTransferredBytesToUsable:transferred,
    completedFixtureRequests:payloads.length,fixtureJsonBytes:payloads.reduce((n,p)=>n+p.bytes,0),workspaceJsonBytes:data.bytes,otherBuildingDetailedRecords:0});
  await context.close();
 }
 const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 writeFileSync(out+"/performance.json",JSON.stringify({mode:"Local offline fixtures; warm Turbopack dev server, fresh browser contexts; no network/CPU throttling. Not a backend or production SLA.",samples,
  summary:["dashboard","sales"].map(surface=>({surface,medianUsableMs:median(samples.filter(s=>s.surface===surface).map(s=>s.usableMs)),maxUsableMs:Math.max(...samples.filter(s=>s.surface===surface).map(s=>s.usableMs)),
   medianTransferredBytes:median(samples.filter(s=>s.surface===surface).map(s=>s.allTransferredBytesToUsable)),completedFixtureRequests:2,otherBuildingDetailedRecords:0}))},null,2));
});
