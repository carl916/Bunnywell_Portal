import {chromium} from "playwright";
import {writeFileSync} from "node:fs";
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const response=await page.goto("http://127.0.0.1:3031/local-config");
const csp=response.headers()["content-security-policy"];
const blocked=await page.evaluate(async()=>{try{await fetch("https://example.com/");return false}catch{return true}});
if(!csp?.includes("connect-src 'self' http://127.0.0.1:54321")||!blocked)throw Error("Browser outbound boundary failed");
const denied=await page.request.get("http://127.0.0.1:3031/api/sales");
if(denied.status()!==403)throw Error("Legacy API route exposed");
writeFileSync("artifacts/building-workspace-stage2/browser-isolation.json",JSON.stringify({checkedAt:new Date().toISOString(),externalFetchBlocked:blocked,legacyRoutesDenied:true,csp},null,2));
await browser.close();console.log("Browser outbound and route isolation passed.");

