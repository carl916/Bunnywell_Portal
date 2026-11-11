import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
const project="bunnywell-workspace-stage2";
const docker="C:/Users/carlg/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe";
export function run(args,input){const r=spawnSync(docker,["--context","desktop-linux",...args],{input,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:5e6});if(r.status!==0)throw Error((r.stderr||r.stdout||r.error?.message||"Docker failed").slice(-2500));return r.stdout;}
export function sql(query){return run(["exec","-i","supabase_db_"+project,"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],query);}
const json=p=>JSON.parse(readFileSync(p,"utf8").replace(/^\uFEFF/,""));
export function isolation(){
 const network=JSON.parse(run(["network","inspect",project+"-internal"]))[0];
 if(!network.Internal)throw Error("Network is not internal");
 const names=run(["ps","--filter","name="+project,"--format","{{.Names}}"]).trim().split(/\s+/).filter(Boolean);
 if(!names.length)throw Error("No project containers");
 const containers=names.filter(n=>n!==project+"-ingress").map(name=>JSON.parse(run(["inspect",name]))[0]);
 for(const c of containers){
   if(Object.keys(c.NetworkSettings.Networks).some(n=>n!==network.Name))throw Error("Unexpected network on "+c.Name);
   for(const bindings of Object.values(c.NetworkSettings.Ports||{}))for(const b of bindings||[])if(b.HostIp!=="127.0.0.1")throw Error("Non-loopback binding "+c.Name+" "+b.HostIp);
 }
 // A TCP attempt to a public IP must be denied by the internal network (not just DNS failure).
 const probe=spawnSync(docker,["--context","desktop-linux","exec","supabase_db_"+project,"bash","-lc","timeout 4 bash -c 'echo > /dev/tcp/1.1.1.1/443'"],{encoding:"utf8",timeout:10000,windowsHide:true});
 if(probe.status===0)throw Error("Container outbound connection succeeded");
 const ingress=JSON.parse(run(["inspect",project+"-ingress"]))[0];
 if(!ingress.HostConfig.ReadonlyRootfs||!ingress.HostConfig.CapDrop?.includes("ALL"))throw Error("Ingress sandbox missing");
 for(const bindings of Object.values(ingress.NetworkSettings.Ports))for(const b of bindings||[])if(b.HostIp!=="127.0.0.1")throw Error("Ingress exposed beyond loopback");
 if(/^default /m.test(run(["exec",project+"-ingress","ip","route"])))throw Error("Ingress external default route is present"); const auth=containers.find(c=>c.Name.includes("auth_"));
 const env=Object.fromEntries(auth.Config.Env.map(s=>{const n=s.indexOf("=");return[s.slice(0,n),s.slice(n+1)]}));
 if(!env.GOTRUE_SMTP_HOST?.includes(project)||Object.entries(env).some(([k,v])=>k.startsWith("GOTRUE_HOOK_")&&v==="true"))throw Error("Auth delivery is not isolated");
 const report={checkedAt:new Date().toISOString(),project,internalNetwork:true,loopbackPorts:true,publicTcpBlocked:true,ingressExternalRouteRemoved:true,localSmtp:env.GOTRUE_SMTP_HOST,containers:names};
 writeFileSync("artifacts/building-workspace-stage2/isolation.json",JSON.stringify(report,null,2));
 return report;
}
if(process.argv.includes("--verify"))console.log(JSON.stringify(isolation(),null,2));
if(process.argv.includes("--replay")){
 isolation();
 const manifest=json("artifacts/building-contracts-stage1/schema-baseline.json");
 let files=manifest.migrations.map(m=>m.name);
 for(const m of manifest.migrations)if(createHash("sha256").update(readFileSync("supabase/migrations/"+m.name)).digest("hex")!==m.sha256)throw Error("Baseline changed "+m.name);
 files.sort((a,b)=>a.slice(0,8).localeCompare(b.slice(0,8))||((a[8]==="_"?0:/[a-z]/.test(a[8])?1:2)-(b[8]==="_"?0:/[a-z]/.test(b[8])?1:2))||a.localeCompare(b));
 files=files.filter(n=>n!=="20260722_sales_pipeline_core_schema.sql"); files.splice(files.indexOf("20260722_sales_deal_structure_defaults.sql"),0,"20260722_sales_pipeline_core_schema.sql"); files=files.filter(n=>n!=="20260606a_enum_values.sql");
 files.splice(files.indexOf("20260606_production_schema.sql"),0,"20260606a_enum_values.sql");
 const ledger="artifacts/building-workspace-stage2/schema-replay.json";
 const done=existsSync(ledger)?json(ledger):{project,files:[]};
 if(done.files.length&&sql("select to_regclass('public.profiles') is not null;").trim()!=="t")throw Error("Saved replay evidence does not match this database; no replay attempted."); if(!done.files.length&&sql("select count(*) from information_schema.tables where table_schema='public';").trim()!=="0")throw Error("Expected an empty public schema");
 // Local baseline prerequisite: the July sales schema permits these roles but omitted enum additions.
 
 for(const file of ["supabase/schema.sql",...files.map(n=>"supabase/migrations/"+n)]){
   if(done.files.some(f=>f.path===file))continue;
   if(file.endsWith("20260722_sales_pipeline_core_schema.sql")||file.endsWith("20260907_sale_discussions.sql"))sql("alter type public.user_role add value if not exists 'sales_agent'; alter type public.user_role add value if not exists 'conveyancer';"); console.log("Applying "+file);
   let source=readFileSync(file,"utf8");
   if(file.endsWith("20260907_sale_discussions.sql")&&sql("select to_regclass('public.sale_mention_notifications') is not null and to_regprocedure('public.sale_discussion_candidate(uuid,uuid)') is null;").trim()==="t")source=source.slice(source.indexOf("create function public.sale_discussion_candidate"));
   sql(source);
   done.files.push({path:file,sha256:createHash("sha256").update(readFileSync(file)).digest("hex"),appliedAt:new Date().toISOString()});
   writeFileSync(ledger,JSON.stringify(done,null,2));
 }
 console.log("Replayed "+done.files.length+" schema files.");
}






