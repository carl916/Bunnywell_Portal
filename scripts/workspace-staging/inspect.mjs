
import fs from "node:fs";
import dotenv from "dotenv";
import {chromium} from "@playwright/test";
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});
const errors=[];page.setDefaultTimeout(15000);page.on("request",r=>{if(r.url().includes("/auth/")||r.url().includes("/workspace/read"))console.log("request",r.method(),r.url().split("?")[0]);});page.on("pageerror",e=>errors.push(e.message));
await page.goto("http://127.0.0.1:3033/workspace");await page.getByRole("button",{name:"Sign in",exact:true}).waitFor({state:"visible"});
const env=dotenv.parse(fs.readFileSync("C:/GitHub/Bunnywell_Portal/.env.local"));if(env.NEXT_PUBLIC_SUPABASE_URL!=="https://vxkpvdtrldwwqiddoyof.supabase.co")throw Error("Unexpected project");const a={email:env.PLAYWRIGHT_ADMIN_EMAIL,password:env.PLAYWRIGHT_ADMIN_PASSWORD};await page.getByLabel("Email",{exact:true}).fill(a.email);await page.getByLabel("Password",{exact:true}).fill(a.password);
console.log("before click",await page.getByRole("button",{name:"Sign in",exact:true}).isEnabled());await page.getByRole("button",{name:"Sign in",exact:true}).click();console.log("clicked");
await page.getByRole("heading",{name:"Choose your building"}).waitFor({timeout:20000}).catch(async e=>{console.log((await page.locator("main").innerText()).slice(0,1200));throw e;});
const auth=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("bunnywell-staging-workspace-auth")));
fs.writeFileSync("tmp/workspace-staging/test-auth.json",JSON.stringify(auth));
const c=await page.request.get("http://127.0.0.1:3033/workspace/read?kind=catalog",{headers:{authorization:"Bearer "+auth.access_token}});const cat=await c.json();
fs.writeFileSync("tmp/workspace-staging/test-catalog.json",JSON.stringify(cat));
console.log("catalog",c.status(),cat.buildings?.map(b=>b.name));
for(const kind of ["workspace","snags","building"]){
 const b=cat.buildings.find(b=>b.name==="Forum House")||cat.buildings[0];
 const start=Date.now();const r=await page.request.get("http://127.0.0.1:3033/workspace/read?"+new URLSearchParams({kind,building:b.id}),{headers:{authorization:"Bearer "+auth.access_token},timeout:60000});
 const data=await r.json();fs.writeFileSync("tmp/workspace-staging/"+kind+".json",JSON.stringify(data));console.log(kind,r.status(),Date.now()-start,"ms",data.error||JSON.stringify({rows:data.rows?.length,sources:data.sources,unitCount:data.units?.length,counts:data.counts}));
}
for(const tab of ["people","organisations","trades","types","audit"]){const r=await page.request.get("http://127.0.0.1:3033/workspace/read?kind=setup&tab="+tab,{headers:{authorization:"Bearer "+auth.access_token}});const d=await r.json();console.log("setup",tab,r.status(),d.error||d.rows?.length);}
console.log("browser errors",errors);await browser.close();
