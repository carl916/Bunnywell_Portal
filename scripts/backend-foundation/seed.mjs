import {buildSeedRecords} from "./seed-records.mjs";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {isolation,sql,run} from "./runtime.mjs";
const json=p=>JSON.parse(readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const project="bunnywell-backend-foundation",api="http://127.0.0.1:55321";
isolation();
const routes=run(["exec",project+"-ingress","ip","route"]);
if(/^default /m.test(routes))throw Error("Relay has an external default route");
const mail=await fetch("http://127.0.0.1:55324/api/v1/messages");if(!mail.ok)throw Error("Local mail capture unavailable");
const status=json("backend-local/status.json");if(status.API_URL!==api)throw Error("Unexpected environment");
const proposal=json("artifacts/building-contracts-stage1/stage2-seed-proposal.json");
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const accounts=[...proposal.accounts,{alias:"agent-single",proposedEmail:"bw-stage2-agent-single@example.invalid",identity:id(910),role:"sales_agent",organisationId:id(502),active:true,buildingIds:[id(1)]}];
const savedPath="backend-local/test-access.json";
const credentials=existsSync(savedPath)?json(savedPath):{project,password:"LocalReview-"+randomBytes(10).toString("hex"),accounts:accounts.map(a=>({alias:a.alias,email:a.proposedEmail,id:a.identity,role:a.role}))};
writeFileSync(savedPath,JSON.stringify(credentials,null,2));
const existing=JSON.parse(sql("select coalesce(json_agg(json_build_object('id',id,'email',email)),'[]') from auth.users;").trim());
if(existing.some(u=>!accounts.some(a=>a.identity===u.id&&a.proposedEmail===u.email)))throw Error("Unexpected local accounts; refusing to alter this database");
for(const a of accounts){
 if(existing.some(u=>u.id===a.identity))continue;
 const response=await fetch(api+"/auth/v1/admin/users",{method:"POST",headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:"Bearer "+status.SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({id:a.identity,email:a.proposedEmail,password:credentials.password,email_confirm:true,user_metadata:{full_name:"Local Test "+a.alias}})});
 if(!response.ok)throw Error("Local account setup failed for "+a.alias+": "+await response.text());
}
if(sql("select count(*) from public.buildings where not (name='Forum House' and address_line_1='' and town='' and not exists(select 1 from public.units where building_id=buildings.id));").trim()!=="0")throw Error("Records already present; refusing to overwrite. Account setup is idempotent, record seed is one-shot.");
const statements=buildSeedRecords(proposal,accounts);
sql(statements);
writeFileSync("tmp/backend-foundation/seed-report.json",JSON.stringify({createdAt:new Date().toISOString(),project,accounts:accounts.length,buildings:3,sales:8,syntheticOnly:true,files:"Metadata only, no stored documents",roleNote:"Existing developer/admin rules allow all buildings. Single-building tests use agent-single; developer-single is not artificially restricted.",databasePrerequisites:["Local sales_agent and conveyancer enum values omitted by the recorded bootstrap"],outbound:"Internal service network; relay default route removed; local mail capture; API/DB test harness pinned to loopback"},null,2));
console.log("Local synthetic seed completed; credentials saved privately in "+savedPath);







