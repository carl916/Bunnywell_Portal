import http from "node:http";
import net from "node:net";
import {readFileSync} from "node:fs";
const origin="http://127.0.0.1:3031";
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:3031; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function config(){const status=JSON.parse(readFileSync("local-runtime/status.json","utf8").replace(/^\uFEFF/,""));if(status?.API_URL!=="http://127.0.0.1:54321")throw Error("Local project unavailable");return{projectId:"bunnywell-workspace-stage2",appOrigin:origin,apiOrigin:status.API_URL,anonKey:status.ANON_KEY};}
const server=http.createServer((req,res)=>{
 const headers={"Content-Security-Policy":csp,"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
 if(req.headers.host!=="127.0.0.1:3031"){res.writeHead(403,headers).end("Local hostname required");return}
 const url=new URL(req.url,origin);
 if(url.pathname==="/local-config"){try{const payload=JSON.stringify(config());res.writeHead(200,{...headers,"Content-Type":"application/json"}).end(payload)}catch{res.writeHead(503,headers).end("Local project unavailable")}return}
 if(req.method!=="GET"||!(url.pathname==="/dev/building-workspace"||url.pathname.startsWith("/_next/static/")||url.pathname==="/favicon.ico")){res.writeHead(403,headers).end("Route unavailable in the read-only local workspace");return}
 const upstream=http.request({host:"127.0.0.1",port:3032,path:req.url,method:"GET",headers:{...req.headers,host:"127.0.0.1:3032"}},r=>{res.writeHead(r.statusCode,{...r.headers,...headers});r.pipe(res)});
 upstream.on("error",()=>{if(!res.headersSent)res.writeHead(503,headers).end("Local UI is starting");else res.destroy()});upstream.end();
});
server.on("upgrade",(req,socket,head)=>{
 if(req.headers.host!=="127.0.0.1:3031"||!req.url.startsWith("/_next/"))return socket.destroy();
 const upstream=net.connect(3032,"127.0.0.1",()=>{upstream.write(req.method+" "+req.url+" HTTP/1.1\r\n"+Object.entries(req.headers).map(([k,v])=>k+": "+v).join("\r\n")+"\r\n\r\n");if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket)});
 upstream.on("error",()=>socket.destroy());socket.on("error",()=>upstream.destroy());
});
server.listen(3031,"127.0.0.1",()=>console.log("Read-only local gateway: "+origin+"/dev/building-workspace"));



