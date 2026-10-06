import { test, expect, type Page, type Request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { legalFixture } from "../helpers/legal-ui-fixture";

// Frontend-only deployed diagnostic. Supabase/Auth/Storage/email/workflow writes
// are intercepted by the established fixture. These are NOT backend timings.
type DiagnosticWindow = Window & {salesDiagnostic:{start:number;click:number|null;feedback:number|null;longTasks:{start:number;duration:number}[]}};
const output="artifacts/performance";
const runs=Number(process.env.SALES_PERF_RUNS ?? 5);
const samples:Record<string,unknown>[]=[];
test.afterAll(async()=>{await mkdir(output,{recursive:true});await writeFile(`${output}/frontend-samples.json`,JSON.stringify(samples,null,2));});

async function observe(page:Page) {
  await page.addInitScript(()=>{
    const state={start:0,click:null as number|null,feedback:null as number|null,longTasks:[] as {start:number;duration:number}[]};
    (window as unknown as DiagnosticWindow).salesDiagnostic=state;
    new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:"longtask",buffered:true});
    let clicked:Element|null=null;
    document.addEventListener("click",event=>{if(!state.start)return;state.click=performance.now();clicked=(event.target as Element)?.closest("button");},true);
    // Start at the input event, excluding Playwright's transfer of fixture bytes.
    document.addEventListener("change",event=>{if(state.start && event.target instanceof HTMLInputElement && event.target.type==="file")state.click=performance.now();},true);
    new MutationObserver(()=>{
      if(!state.start||state.feedback!==null)return;
      if(clicked?.hasAttribute("disabled")||clicked?.getAttribute("aria-current")==="step"||document.querySelector('[role="group"][aria-label^="Selected "]')){
        requestAnimationFrame(()=>requestAnimationFrame(()=>{if(state.feedback===null)state.feedback=performance.now();}));
      }
    }).observe(document,{subtree:true,attributes:true,childList:true});
  });
}
function category(request:Request) {
  const path=new URL(request.url()).pathname;
  if(path.startsWith("/api/sales/legal"))return "legal";
  if(path.includes("/rest/v1/"))return path.split("/").slice(-1)[0].replace(/[^a-z_]/g,"");
  if(path.includes("/auth/"))return "auth";
  if(path.includes("/storage/"))return "storage";
  if(path.endsWith(".js"))return "javascript";
  if(path.endsWith(".css"))return "css";
  return "other";
}
async function measure(page:Page,label:string,profile:string,run:number,act:()=>Promise<unknown>,ready:()=>Promise<unknown>) {
  const requests:Record<string,unknown>[]=[];const pending:Promise<void>[]=[];const starts=new Map<Request,number>();
  const begin=(request:Request)=>starts.set(request,Date.now());
  const end=(request:Request)=>{
    if(!starts.has(request))return;
    const elapsed=Date.now()-starts.get(request)!;
    pending.push((async()=>{const sizes=await request.sizes().catch(()=>null);const response=await request.response();requests.push({category:category(request),method:request.method(),status:response?.status(),durationMs:elapsed,requestBytes:sizes?.requestBodySize??null,responseBytes:sizes?.responseBodySize??null});})());
  };
  page.on("request",begin);page.on("requestfinished",end);
  const wallStart=Date.now();await page.evaluate(()=>{const d=(window as unknown as DiagnosticWindow).salesDiagnostic;d.start=performance.now();d.click=null;d.feedback=null;});
  await act();await ready();
  const browser=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const d=(window as unknown as DiagnosticWindow).salesDiagnostic;const now=performance.now();const result={totalMs:now-(d.click??d.start),feedbackMs:d.feedback===null?null:d.feedback-(d.click??d.start),longTasks:d.longTasks.filter(task=>task.start>=d.start)};d.start=0;return result;});
  page.off("request",begin);page.off("requestfinished",end);await Promise.all(pending);
  samples.push({action:label,profile,run,mode:"deployed-frontend-synthetic-backend",...browser,wallMs:Date.now()-wallStart,networkRequests:requests.length,requestBytes:requests.reduce((n,r)=>n+Number(r.requestBytes??0),0),responseBytes:requests.reduce((n,r)=>n+Number(r.responseBytes??0),0),requests});
}

for(const profile of ["desktop","mobile-throttled"]) for(let run=1;run<=runs;run++)test(`${profile} diagnostic journey ${run}`,async({page,context})=>{
  await observe(page);
  const cdp=await context.newCDPSession(page);
  if(profile==="mobile-throttled"){
    await page.setViewportSize({width:390,height:844});
    await cdp.send("Network.enable");await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8});await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  }
  const f=await legalFixture(page);
  // Trace starts after synthetic sign-in; no real account credentials or sales.
  if(run===1)await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  const stage=(name:string)=>page.getByRole("button",{name:new RegExp("^"+name+"(?: |$)")}).first();
  await measure(page,"sale.open.cold",profile,run,()=>page.reload(),()=>expect(stage("Exchange")).toBeVisible());
  await measure(page,"sale.open.repeat",profile,run,()=>page.reload(),()=>expect(stage("Exchange")).toBeVisible());
  await measure(page,"progression.stage_change",profile,run,()=>stage("Exchange").click(),()=>expect(page.getByRole("list",{name:"Exchange tasks",exact:true})).toBeVisible());
  const preview=page.getByRole("region",{name:"Final confirmation and email preview",exact:true});
  await page.getByRole("button",{name:"Review authority and email",exact:true}).scrollIntoViewIfNeeded();
  await measure(page,"authority.preview_open",profile,run,()=>page.getByRole("button",{name:"Review authority and email",exact:true}).click(),()=>expect(preview).toBeVisible());
  await preview.getByRole("button",{name:"Cancel",exact:true}).click();
  f.profile.role="sales_agent";await f.reloadStage("Exchange");
  await measure(page,"authority.request",profile,run,()=>page.getByRole("button",{name:"Request authority to exchange",exact:true}).click(),()=>expect(page.getByText("Exchange authority requested. The developer has been notified.",{exact:true})).toBeVisible());
  f.profile.role="developer";await f.reloadStage("Exchange");await page.getByRole("button",{name:"Review authority and email",exact:true}).click();await preview.getByRole("checkbox").check();
  await measure(page,"authority.issue",profile,run,()=>preview.getByRole("button",{name:"Issue authority to exchange",exact:true}).click(),()=>expect(page.getByText("Authority to exchange issued.",{exact:true})).toBeVisible());
  f.profile.role="conveyancer";await f.reloadStage("Exchange");await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10));
  await measure(page,"exchange.record",profile,run,()=>page.getByRole("button",{name:"Confirm exchange",exact:true}).click(),()=>expect(page.getByText("Exchange confirmed.",{exact:true})).toBeVisible());
  // Seed the existing notice milestone in fixture memory, never in a live sale.
  f.attempt.completion_legacy_stage="arrangements";f.attempt.contractual_completion_date="2026-09-01";await f.reloadStage("Exchange");
  await measure(page,"completion.open",profile,run,()=>stage("Completion").click(),()=>expect(page.locator("#completion-documents-step")).toBeVisible());
  const docs=page.locator("#completion-documents-step");
  for(const [count,size,label]of [[1,1024*1024,"one-1MiB"],[2,1024*1024,"two-1MiB"],[2,5*1024*1024,"two-5MiB"],[2,10*1024*1024-1024,"two-near-10MiB"]] as const){
    const buffer=Buffer.alloc(size,32);buffer.write("%PDF-1.7\n");
    const inputDirectory=path.resolve('.next/performance/synthetic-inputs');await mkdir(inputDirectory,{recursive:true});
    const files=Array.from({length:count},(_,i)=>path.join(inputDirectory,i?'synthetic-account.pdf':'synthetic-completion.pdf'));
    for(const file of files)await writeFile(file,buffer);
    await measure(page,`completion.documents_select.${label}`,profile,run,()=>docs.getByLabel("Choose completion documents",{exact:true}).setInputFiles(files),()=>expect(docs.locator('[role="group"][aria-label^="Selected "]')).toHaveCount(count));
    await measure(page,`completion.documents_upload.${label}`,profile,run,()=>docs.getByRole("button",{name:/^Upload (completion documents|replacement document)$/}).click(),()=>expect(docs.locator('[role="group"][aria-label^="Selected "]')).toHaveCount(0));
  }
  f.profile.role="developer";await f.reloadStage("Completion");
  await measure(page,"completion.documents_approve",profile,run,()=>page.getByRole("button",{name:"Approve completion documents",exact:true}).click(),()=>expect(page.getByText("Completion documents approved.",{exact:true})).toBeVisible());
  f.profile.role="conveyancer";await f.reloadStage("Completion");await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-09-01T12:00");await page.getByRole("checkbox",{name:/I confirm legal completion/}).check();
  await measure(page,"completion.record",profile,run,()=>page.getByRole("button",{name:"Confirm legal completion",exact:true}).click(),()=>expect(page.getByText("Legal completion confirmed. Handover is now available.",{exact:true})).toBeVisible());
  await mkdir(output,{recursive:true});if(run===1)await context.tracing.stop({path:`.next/performance/${profile}-raw-trace.zip`});
  // Browser context/fixture disposal is the established cleanup; no remote rows.
});
