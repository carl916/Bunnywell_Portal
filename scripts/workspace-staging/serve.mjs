
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import dotenv from "dotenv";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const source=process.env.WORKSPACE_CREDENTIAL_SOURCE||"C:/GitHub/Bunnywell_Portal/.env.local";
const e=dotenv.parse(fs.readFileSync(source));
const origin="https://vxkpvdtrldwwqiddoyof.supabase.co";
if(e.NEXT_PUBLIC_SUPABASE_URL!==origin||!e.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error("Credential source is not the approved staging project.");
fs.mkdirSync(path.join(root,"tmp/workspace-staging"),{recursive:true});
const env={...process.env};
for(const k of Object.keys(env))if(/SUPABASE|RESEND|SENDGRID|SMTP|TWILIO|CRON|WEBHOOK|BUILDING_WORKSPACE|COMPLETION_REVIEW|BUILDING_CONTRACTS|NODE_OPTIONS/.test(k))delete env[k];
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:e.NEXT_PUBLIC_SUPABASE_ANON_KEY,WORKSPACE_STAGING_READS:"1",WORKSPACE_READ_GUARD:"1",STAGING_WEB_VITALS:"0",SALES_PERF_LOCAL:"0",NEXT_TELEMETRY_DISABLED:"1",WORKSPACE_READ_LOG:path.join(root,"tmp/workspace-staging/reads.ndjson"),NODE_OPTIONS:"--import="+pathToFileURL(path.join(root,"scripts/workspace-staging/guard.mjs")).href});
const internal=3034,port=3033;
const child=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port",String(internal)],{cwd:root,env,stdio:"inherit",windowsHide:true});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,"http://127.0.0.1:"+port);
 if(u.pathname==="/"){res.writeHead(302,{location:"/workspace"});res.end();return;}
 const permitted=req.method==="GET"&&(u.pathname==="/workspace"||u.pathname==="/workspace/read"||u.pathname.startsWith("/_next/")||u.pathname.startsWith("/__nextjs_font/")||u.pathname.startsWith("/branding/")||u.pathname.startsWith("/brand/")||u.pathname==="/favicon.ico");
 if(!permitted){res.writeHead(403,{"content-type":"application/json"});res.end('{"error":"Read-only workspace gateway"}');return;}
 res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: "+origin+"; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:"+port+" "+origin+"; frame-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'");
 const proxy=http.request({hostname:"127.0.0.1",port:internal,path:req.url,method:"GET",headers:{...req.headers,host:"127.0.0.1:"+internal}},up=>{
  for(const [key,value] of Object.entries(up.headers))if(value&&key!=="content-security-policy")res.setHeader(key,value);
  res.writeHead(up.statusCode);up.pipe(res);
 });
 proxy.on("error",()=>{res.writeHead(503);res.end("Starting workspace. Refresh shortly.");});proxy.end();
});
server.on("upgrade",(req,socket,head)=>{
 if(!req.url.startsWith("/_next/")){socket.destroy();return;}
 socket.on("error",()=>{});const proxy=http.request({hostname:"127.0.0.1",port:internal,path:req.url,headers:req.headers});
 proxy.on("upgrade",(response,upstream,uphead)=>{upstream.on("error",()=>socket.destroy());socket.on("close",()=>upstream.destroy());socket.write("HTTP/1.1 101 Switching Protocols\r\n"+Object.entries(response.headers).map(([k,v])=>k+": "+v).join("\r\n")+"\r\n\r\n");if(uphead.length)socket.write(uphead);if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});
 proxy.on("error",()=>socket.destroy());proxy.end();
});
server.listen(port,"127.0.0.1",()=>console.log("Read-only staging review: http://127.0.0.1:"+port+"/workspace"));
server.on("error",error=>{console.error(error.message);child.kill();process.exitCode=1;});
const close=()=>{server.close();child.kill();};
process.on("SIGINT",close);process.on("SIGTERM",close);child.on("exit",()=>server.close());
