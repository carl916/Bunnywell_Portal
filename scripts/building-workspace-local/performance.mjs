import {chromium} from "playwright";
import {readFileSync,writeFileSync} from "node:fs";
const access=JSON.parse(readFileSync("local-runtime/test-access.json","utf8"));
const browser=await chromium.launch({headless:true}),context=await browser.newContext();
const login=await context.newPage();await login.goto("http://127.0.0.1:3031/dev/building-workspace");
await login.getByLabel("Email",{exact:true}).fill(access.accounts.find(a=>a.alias==="developer").email);await login.getByLabel("Password",{exact:true}).fill(access.password);await login.getByRole("button",{name:"Sign in",exact:true}).click();await login.getByRole("heading",{name:"Choose your building",exact:true}).waitFor();
const session=await login.evaluate(()=>sessionStorage.getItem("bunnywell-stage2-auth"));await login.close();
const fresh=await browser.newContext({viewport:{width:1366,height:768}});
await fresh.addInitScript(session=>sessionStorage.setItem("bunnywell-stage2-auth",session),session);
const page=await fresh.newPage();const results=[],pending=[];
page.on("response",r=>pending.push((async()=>{await r.finished();const size=await r.request().sizes().catch(()=>null);if(size)results.push({group:/\/(rest|auth)\//.test(r.url())?"data/auth":"page/assets",status:r.status(),bodyBytes:size.responseBodySize,headerBytes:size.responseHeadersSize})})()));
const start=performance.now();await page.goto("http://127.0.0.1:3031/dev/building-workspace?view=worklist&building=b1700000-0000-4000-8000-000000000001");await page.getByRole("heading",{name:"Sales worklist",exact:true}).waitFor();const usableMs=performance.now()-start;await Promise.all(pending);
const groups=["data/auth","page/assets"].map(group=>({group,requests:results.filter(r=>r.group===group).length,bodyBytes:results.filter(r=>r.group===group).reduce((n,r)=>n+r.bodyBytes,0),headerBytes:results.filter(r=>r.group===group).reduce((n,r)=>n+r.headerBytes,0)}));
const report={at:new Date().toISOString(),usableMs,groups,totalRequests:results.length,totalTransferredBytes:results.reduce((n,r)=>n+r.bodyBytes+r.headerBytes,0),conditions:"Fresh browser cache, valid session obtained by normal local sign-in, warm Next development server, four synthetic units. Includes document and frontend assets; excludes WebSocket frames. Not a production-bundle or scale benchmark."};
writeFileSync("artifacts/building-workspace-stage2/cold-page-performance.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();

