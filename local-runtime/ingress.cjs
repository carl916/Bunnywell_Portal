// Fixed TCP ingress only. No URL forwarding, CONNECT support, remote destinations or credentials.
// Data services stay solely on the internal Docker network.
const net=require("node:net");
const targets={54322:["supabase_db_bunnywell-workspace-stage2",5432],54321:["supabase_kong_bunnywell-workspace-stage2",8000],54324:["supabase_inbucket_bunnywell-workspace-stage2",8025]};
for(const [port,[host,targetPort]] of Object.entries(targets))net.createServer(socket=>{
 const target=net.connect({host,port:targetPort});
 socket.pipe(target).pipe(socket);
 socket.on("error",()=>target.destroy());target.on("error",()=>socket.destroy());
 socket.on("close",()=>target.destroy());target.on("close",()=>socket.destroy());
}).listen(Number(port),"0.0.0.0");

