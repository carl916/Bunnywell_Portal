import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, isolation } from "./runtime.mjs";
const out = "artifacts/building-workspace-stage2/completion-review";
const record = JSON.parse(readFileSync(out + "/test-record.json", "utf8"));
const credentials = JSON.parse(readFileSync("local-runtime/test-access.json", "utf8"));
const base = "http://127.0.0.1:3031", endpoint = "/dev/building-workspace/completion";
const route = (r=record,section="completion") => base+"/dev/building-workspace?"+new URLSearchParams({building:r.buildingId,unit:r.unitId,sale:r.saleId,view:"sale",section});
const checks=[],browser=await chromium.launch(),errors=[];
let conveyancerId;
async function login(alias,viewport={width:1366,height:768}) {
 const c=await browser.newContext({viewport,serviceWorkers:"block"}),p=await c.newPage();
 p.on("pageerror",e=>errors.push(e.message));
 await p.goto(route());await p.getByLabel("Email",{exact:true}).fill(credentials.accounts.find(a=>a.alias===alias).email);await p.getByLabel("Password",{exact:true}).fill(credentials.password);await p.getByRole("button",{name:"Sign in",exact:true}).click();await p.getByRole("heading",{name:"Completion at a glance",exact:true}).waitFor({timeout:30000});return p;
}
async function post(p,action,extra={},scope=record){
 return p.evaluate(async({endpoint,action,extra,scope})=>{const token=JSON.parse(sessionStorage.getItem("bunnywell-stage2-auth")).access_token;const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action,scope,...extra})});return{status:r.status,data:await r.json()};},{endpoint,action,extra,scope});
}
async function get(p,values={},scope=record){
 return p.evaluate(async({endpoint,values,scope})=>{const token=JSON.parse(sessionStorage.getItem("bunnywell-stage2-auth")).access_token;const q=new URLSearchParams({building:scope.buildingId,unit:scope.unitId,sale:scope.saleId,...values});const r=await fetch(endpoint+"?"+q,{headers:{Authorization:"Bearer "+token}});return{status:r.status,data:await r.json()};},{endpoint,values,scope});
}
try {
 const dev=await login("developer"),con=await login("conveyancer");
 const version=sql("select v.id from unit_sale_documents d join unit_sale_document_versions v on v.document_id=d.id and v.is_current where d.sale_attempt_id='"+record.saleId+"' and d.document_type='completion_statement';").trim();
 const metadata={type:"completion_statement",expectedVersionId:version,name:"Synthetic.pdf",size:64,mime:"application/pdf"};
 for(const action of ["send","retry_email","confirm_completion","confirm_exchange","record_payment","confirm_notice","cancel_notice_authority"])assert.equal((await post(dev,action)).status,403);
 checks.push("All unrelated business actions rejected by the local action allowlist");
 assert.equal((await post(dev,"prepare_completion_upload",{requestId:randomUUID(),files:[metadata]})).status,400);
 assert.equal((await post(con,"prepare_completion_upload",{requestId:randomUUID(),files:[metadata]})).status,400);
 assert.equal((await post(con,"prepare_completion_upload",{requestId:randomUUID(),files:[{...metadata,size:10485761}]})).status,400);
 checks.push("Developer upload, approved replacement and oversized PDF preparation denied");
 const wrong={...record,buildingId:"b1700000-0000-4000-8000-000000000002"};
 assert.equal((await post(con,"comment",{body:"Must not be saved",clientId:randomUUID()},wrong)).status,400);
 assert.equal((await get(dev,{kind:"comments"},wrong)).status,400);
 assert.equal((await get(dev,{kind:"document",version:"b1700000-0000-4000-8000-000000009999"})).status,400);
 checks.push("Mismatched building/unit/sale and foreign document references denied");
 const duplicate=randomUUID();
 const first=await post(con,"comment",{body:"Idempotent synthetic comment",clientId:duplicate});
 const again=await post(con,"comment",{body:"Idempotent synthetic comment",clientId:duplicate});
 assert.equal(first.status,200);assert.equal(again.data.id,first.data.id);
 assert.equal((await post(con,"comment",{body:"Different retry must not overwrite",clientId:duplicate})).status,400);
 checks.push("Comment retries deduplicate; changed payload cannot overwrite the earlier comment");
 conveyancerId=credentials.accounts.find(a=>a.alias==="conveyancer").id;
 sql("update profiles set active=false where id='"+conveyancerId+"';");
 try {
  assert.equal((await get(con,{kind:"comments"})).status,400);
  assert.equal((await get(con,{kind:"document",version})).status,400);
  assert.equal((await post(con,"comment",{body:"Revoked account must fail",clientId:randomUUID()})).status,400);
 } finally {sql("update profiles set active=true where id='"+conveyancerId+"';");conveyancerId=null;}
 checks.push("Account revocation blocks new reads, document links and comments; access restored after test");
 const before=JSON.parse(sql("select json_build_object('comments',(select count(*) from sale_comments where sale_attempt_id='"+record.saleId+"'),'receipts',(select count(*) from sale_comment_receipts),'mentions',(select count(*) from sale_mention_notifications),'opens',(select count(*) from unit_open_events));"));
 // Build a long conversation only through the authorised existing comment RPC adapter.
 for(let i=1;i<=(before.comments<54?54:0);i++)assert.equal((await post(dev,"comment",{body:"Synthetic long conversation message "+i,clientId:randomUUID()})).status,200);
 await con.reload();
 const messages=con.getByRole("region",{name:"Conversation messages"});
 await expect(con.getByRole("button",{name:"Load newer comments",exact:true})).toBeVisible();
 await con.getByRole("button",{name:"Load newer comments",exact:true}).click();
 await expect(messages.getByText("Synthetic long conversation message 54",{exact:true})).toBeAttached();
 await con.getByLabel("Comment",{exact:true}).fill("Long conversation end is reachable.");
 await con.getByRole("button",{name:"Send comment",exact:true}).click();
 await expect(messages.getByText("Long conversation end is reachable.",{exact:true})).toBeAttached();
 checks.push("Long conversation paginates and composer submits at its end without read-receipt writes");
 await con.getByLabel("Comment",{exact:true}).fill("Draft belongs only to this sale.");
 await con.getByRole("link",{name:"Exchange",exact:true}).click();
 await expect(con.getByLabel("Comment",{exact:true})).toHaveValue("Draft belongs only to this sale.");
 await con.getByRole("button",{name:"Activity",exact:true}).click();
 await con.getByRole("link",{name:"Completion",exact:true}).click();
 await expect(con.getByRole("button",{name:"Activity",exact:true})).toHaveAttribute("aria-pressed","true");
 await con.getByRole("button",{name:"Comments",exact:true}).click();
 const other=con.getByLabel("Units in this building");
 await other.selectOption("b1700000-0000-4000-8000-000000000100");
 await expect(con.getByLabel("Comment",{exact:true})).toHaveValue("");
 await expect(con.getByRole("region",{name:"Conversation messages"}).getByText("Long conversation end is reachable.",{exact:true})).toHaveCount(0);
 await other.selectOption(record.unitId);
 await expect(con.getByLabel("Comment",{exact:true})).toHaveValue("Draft belongs only to this sale.");
 checks.push("Same-sale section navigation preserves tab/draft; other records never display that conversation or draft");
 // Responsive geometry and keyboard checks on the accepted layout.
 for(const [name,width,height]of [["mobile",390,844],["tablet",1024,768],["wide",1920,1080],["zoom-equivalent",683,384]]){
  await con.setViewportSize({width,height});await con.goto(route());await con.getByRole("heading",{name:"Completion at a glance",exact:true}).waitFor();
  assert.equal(await con.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await con.getByRole("button",{name:"Comments & activity",exact:true}).click();
  await expect(con.locator("#sale-context-heading")).toBeFocused();
  await con.getByLabel("Comment",{exact:true}).focus();
  const boxes=await con.evaluate(()=>{const t=document.querySelector('#sale-context-panel textarea').getBoundingClientRect(),h=document.querySelector('header[aria-label="Sale identity"]').getBoundingClientRect(),p=document.querySelector('#sale-context-panel').getBoundingClientRect(),main=document.querySelector('[class*="saleTask"]').getBoundingClientRect();return{inputTop:t.top,inputBottom:t.bottom,headerBottom:h.bottom,panelLeft:p.left,taskRight:main.right}});
  assert.ok(boxes.inputTop>=Math.max(0,boxes.headerBottom)-2,name+" focused composer hidden under identity");
  if(width>=1200)assert.ok(boxes.panelLeft>=boxes.taskRight-2,"Discussion overlays task");
  await con.screenshot({path:out+"/comments-"+name+".png",fullPage:false});
 }
 checks.push("390x844, tablet, wide desktop and 200%-equivalent layouts retain readable task and reachable composer without overlap");
 const after=JSON.parse(sql("select json_build_object('receipts',(select count(*) from sale_comment_receipts),'mentions',(select count(*) from sale_mention_notifications),'opens',(select count(*) from unit_open_events));"));
 assert.equal(after.receipts,before.receipts);assert.equal(after.mentions,before.mentions);assert.equal(after.opens,before.opens);
 const inbox=await fetch("http://127.0.0.1:54324/api/v1/messages").then(r=>r.json());
 assert.equal(inbox.total??inbox.messages?.length??0,0);
 checks.push("No read receipts, mentions, unit-open writes or outbound/captured emails from the review journey");
 const isolated=isolation();assert.ok(isolated.publicTcpBlocked);
 assert.equal(errors.length,0,errors.join("\n"));
 writeFileSync(out+"/additional.json",JSON.stringify({at:new Date().toISOString(),checks,browserErrors:errors,isolation:isolated},null,2));
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(e){writeFileSync(out+"/additional-failure.json",JSON.stringify({checks,error:e.stack||String(e),errors},null,2));console.error(JSON.stringify({checks,error:String(e),errors},null,2));process.exitCode=1;}
finally{if(conveyancerId)sql("update profiles set active=true where id='"+conveyancerId+"';");await browser.close();}
