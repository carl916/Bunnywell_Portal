import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {isolation,sql,run} from "./runtime.mjs";
const json=p=>JSON.parse(readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const project="bunnywell-workspace-stage2",api="http://127.0.0.1:54321";
isolation();
const routes=run(["exec",project+"-ingress","ip","route"]);
if(/^default /m.test(routes))throw Error("Relay has an external default route");
if(!json("artifacts/building-workspace-stage2/browser-isolation.json").externalFetchBlocked)throw Error("Browser boundary not verified");
if(json("artifacts/building-workspace-stage2/schema-replay.json").files.length!==71)throw Error("Schema replay incomplete");
const mail=await fetch("http://127.0.0.1:54324/api/v1/messages");if(!mail.ok)throw Error("Local mail capture unavailable");
const logs=readFileSync("artifacts/building-workspace-stage2/runtime-start.log","utf8").split(/\r?\n/).flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
const status=json("local-runtime/status.json");if(status.API_URL!==api)throw Error("Unexpected environment");
const proposal=json("artifacts/building-contracts-stage1/stage2-seed-proposal.json");
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const accounts=[...proposal.accounts,{alias:"agent-single",proposedEmail:"bw-stage2-agent-single@example.invalid",identity:id(910),role:"sales_agent",organisationId:id(502),active:true,buildingIds:[id(1)]}];
const savedPath="local-runtime/test-access.json";
const credentials=existsSync(savedPath)?json(savedPath):{project,password:"LocalReview-"+randomBytes(10).toString("hex"),accounts:accounts.map(a=>({alias:a.alias,email:a.proposedEmail,id:a.identity,role:a.role}))};
writeFileSync(savedPath,JSON.stringify(credentials,null,2));
const existing=JSON.parse(sql("select coalesce(json_agg(json_build_object('id',id,'email',email)),'[]') from auth.users;").trim());
if(existing.some(u=>!accounts.some(a=>a.identity===u.id&&a.proposedEmail===u.email)))throw Error("Unexpected local accounts; refusing to alter this database");
for(const a of accounts){
 if(existing.some(u=>u.id===a.identity))continue;
 const response=await fetch(api+"/auth/v1/admin/users",{method:"POST",headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:"Bearer "+status.SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({id:a.identity,email:a.proposedEmail,password:credentials.password,email_confirm:true,user_metadata:{full_name:"Local Test "+a.alias}})});
 if(!response.ok)throw Error("Local account setup failed for "+a.alias+": "+await response.text());
}
const literal=v=>v==null?"null":typeof v==="number"||typeof v==="boolean"?String(v):"'"+(typeof v==="object"?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
function insert(table,rows){return rows.map(row=>{const keys=Object.keys(row);return "insert into public."+table+" ("+keys.join(",")+") values ("+keys.map(k=>literal(row[k])).join(",")+");"}).join("\n");}
if(sql("select count(*) from public.buildings where not (name='Forum House' and address_line_1='' and town='' and not exists(select 1 from public.units where building_id=buildings.id));").trim()!=="0")throw Error("Records already present; refusing to overwrite. Account setup is idempotent, record seed is one-shot.");
let statements=["begin;","set local request.jwt.claims = '{\"role\":\"service_role\"}';"];
statements.push("delete from public.buildings where name='Forum House' and address_line_1='' and town='' and not exists(select 1 from public.units where building_id=buildings.id);");
statements.push("set local app.sales_legal_write = 'on'; set local app.completion_package_write = 'on';"); statements.push(insert("organisations",[{id:id(501),name:"Local Developer Team",type:"developer_representative"},{id:id(502),name:"Willow Sales Team",type:"sales_agent"},{id:id(503),name:"Orchard Sales Team",type:"sales_agent"},{id:id(504),name:"Brook Legal Team",type:"conveyancer"},{id:id(505),name:"Local Contractor Team",type:"contractor"}]));
statements.push(...accounts.map(a=>"update public.profiles set role="+literal(a.role)+",organisation_id="+literal(a.organisationId)+",active="+literal(a.active)+",name="+literal("Local Test "+a.alias)+" where id="+literal(a.identity)+";"));
for(const b of proposal.buildings){
 const fact=proposal.scopedFacts.find(f=>f.building?.id===b.id||f.input?.buildingId===b.id);
 const input=fact?.proposedFacts;
 statements.push(insert("buildings",[{id:b.id,name:b.name,address_line_1:b.address,status:"active",sales_agent_organisation_id:b.id===id(1)?id(502):b.id===id(2)?id(503):null,conveyancer_organisation_id:b.id===id(3)?null:id(504)}]));
 if(!input)continue;
 let n=b.id===id(1)?7000:7100;
 statements.push(insert("building_floors",input.floors.map(f=>({...f,id:id(n++)}))));
 statements.push(insert("units",input.units.map(u=>({...u,sale_status:"for_sale"}))));
 for(const sale of input.sales){
  const final={...sale};delete final.created_at;
  statements.push(insert("unit_sale_attempts",[{...sale,workflow_status:"draft",buyer_person_name:fact.buyerLabels[sale.id],created_by_user_id:id(904),updated_by_user_id:id(904),reservation_date:sale.reservation_approved_at?"2026-10-07":null}]));
  const terms=input.terms.find(t=>t.sale_attempt_id===sale.id);
  statements.push(insert("unit_sale_terms",[{...terms,id:id(n++),status:sale.reservation_approved_at?"approved":"draft",agent_fee_percent:1.5,exchange_deposit_percent:10,completion_balance_percent:90}]));
  statements.push("update public.unit_sale_attempts set workflow_status="+literal(sale.workflow_status)+" where id="+literal(sale.id)+";");
 }
 statements.push("set local app.unit_commercial_mutation = 'on';");
 for(const u of input.units)statements.push("update public.units set sale_status="+literal(u.sale_status)+" where id="+literal(u.id)+";");
 for(const d of input.documents){
  const {unit_sale_document_versions:versions,...doc}=d;
  statements.push(insert("unit_sale_documents",[{...doc,title:{"completion_statement":"Completion statement","draft_statement_of_account":"Statement of account","completion_correspondence":"Completion correspondence"}[doc.document_type],visibility:"shared_sale_file",created_by_user_id:id(907),updated_by_user_id:id(907)}]));
  statements.push(insert("unit_sale_document_versions",versions.map(v=>({...v,document_id:d.id,version_number:1,storage_bucket:"sale-documents",storage_path:"local-metadata-only/"+v.id+".pdf",file_name:"Local-"+d.document_type+".pdf",mime_type:"application/pdf",uploaded_by_user_id:id(907)}))));
 }
 for(const source of input.depositSources){
  statements.push(insert("sale_exchange_deposit_sources",[{...source,source_kind:"legacy_locked_terms",snapshot:{terms:{contract_price:425000,exchange_deposit_percent:10}},terms_version:1}]));
  const receipt=input.deposits.find(d=>d.source_id===source.id);
  if(receipt)statements.push(insert("sale_exchange_deposit_receipts",[{...receipt,id:id(n++),revision:1,received_date:"2026-10-20",recorded_by:id(907),recorded_by_name:"Local Test conveyancer"}]));
 }
}
statements.push(insert("user_building_access",accounts.flatMap(a=>a.buildingIds.map(building_id=>({user_id:a.identity,building_id,role_on_building:a.role})))));
statements.push("notify pgrst, 'reload schema';","commit;");
sql(statements.join("\n"));
writeFileSync("artifacts/building-workspace-stage2/seed-report.json",JSON.stringify({createdAt:new Date().toISOString(),project,accounts:accounts.length,buildings:3,sales:8,syntheticOnly:true,files:"Metadata only, no stored documents",roleNote:"Existing developer/admin rules allow all buildings. Single-building tests use agent-single; developer-single is not artificially restricted.",databasePrerequisites:["Local sales_agent and conveyancer enum values omitted by the recorded bootstrap"],outbound:"Internal service network; relay default route removed; local mail capture; browser CSP"},null,2));
console.log("Local synthetic seed completed; credentials saved privately in "+savedPath);







