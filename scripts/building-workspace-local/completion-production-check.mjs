import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","0"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"production",BUILDING_WORKSPACE_LOCAL:"1",BUILDING_CONTRACTS_OFFLINE:"1",BUILDING_COMPLETION_LOCAL:"1",BUNNYWELL_LOCAL_EGRESS_GUARD:"1",STAGING_WEB_VITALS:"0",SALES_PERF_LOCAL:"0",NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:"--import="+pathToFileURL(resolve("scripts/building-workspace-local/network-guard.mjs")).href}});
let log="";child.stdout.on("data",v=>log+=v);child.stderr.on("data",v=>log+=v);
try{
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(Error("Production test server did not start"));},30000);const poll=setInterval(()=>{const match=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match&&log.includes("Ready")){clearInterval(poll);clearTimeout(timer);resolve(match[0]);}},100);child.once("exit",code=>{clearInterval(poll);clearTimeout(timer);reject(Error("Production test server exited: "+code));});});
 const results=[];
 for(const [path,method] of [["/dev/building-workspace","GET"],["/dev/building-workspace-contracts","GET"],["/dev/sales-workspace","GET"],["/dev/building-workspace/completion","GET"],["/dev/building-workspace/completion","POST"]]){
  const r=await fetch(base+path,{method,redirect:"manual"});results.push({path,method,status:r.status});assert.equal(r.status,404);
 }
 writeFileSync("artifacts/building-workspace-stage2/completion-review/production.json",JSON.stringify({at:new Date().toISOString(),allLocalFlagsEnabled:true,results},null,2));console.log(JSON.stringify(results));
}finally{child.kill();}