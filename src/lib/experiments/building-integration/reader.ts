import { completionClient } from "./completion-client";
import {approvedLocalEnvironment,createLocalReadTransport,assertLocalEnvironment} from "./local-environment";
import {projectWorkspace,scopeFor,type Access} from "../building-contracts/projection";
import {roles,type Building,type Scope,type Workspace} from "../building-contracts/contracts";
import type {DashboardInput,WorkSale} from "../../dashboard/types";
import {canOpenSalesPipeline,isSalesInternalRole} from "../../sales/permissions";

export type Config=typeof approvedLocalEnvironment & {anonKey:string;completionReview?:boolean;coreSales?:boolean;operations?:boolean};
export type Session={access_token:string;expires_at:number;user:{id:string}};
export type Catalog={access:Access;buildings:Building[]};
export type Document={id:string;document_type:string;title:string;status:string;query_note:string|null;approved_version_id:string|null;approved_at:string|null;unit_sale_document_versions:{id:string;version_number:number;file_name:string;is_current:boolean;uploaded_at:string;redacted_at:string|null}[]};
export type Completion={sale:WorkSale;documents:Document[];noticeRecordedBy?:string|null};
const tables=["profiles","buildings","building_floors","building_organisations","organisations","units","unit_sale_attempts","unit_sale_terms","unit_sale_documents","unit_sale_invoices","unit_sale_invoice_payments","sale_legal_emails","sale_exchange_deposit_receipts","sale_exchange_deposit_sources","sale_further_deposit_facts"];
export const sessionKey="bunnywell-stage2-auth";
export async function localConfig():Promise<Config>{
 if(location.origin!==approvedLocalEnvironment.appOrigin)throw Error("Use the approved local review address.");
 const result=await fetch("/local-config",{cache:"no-store"});
 if(!result.ok)throw Error("Local environment is unavailable.");
 const c=await result.json();assertLocalEnvironment(c);return c;
}
export async function auth(config:Config,path:"token?grant_type=password"|"user"|"logout",token?:string,body?:{email:string;password:string}){
 assertLocalEnvironment(config);
 const r=await fetch(config.apiOrigin+"/auth/v1/"+path,{method:path==="user"?"GET":"POST",headers:{apikey:config.anonKey,Authorization:"Bearer "+(token||config.anonKey),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,redirect:"error",cache:"no-store"});
 if(!r.ok)throw Error(path==="token?grant_type=password"?"Sign-in failed. Check the local test account details.":"Session unavailable. Sign in again.");
 if(r.status===204)return null;return r.json();
}
export function reader(config:Config,session:Session){
 const transport=createLocalReadTransport(config,tables.map(t=>"/rest/v1/"+t));
 async function read<T>(table:string,select:string,filters:Record<string,string>={},signal?:AbortSignal):Promise<T[]>{
  const data:T[]=[];
  for(let offset=0;offset<5000;offset+=200){
   const url=new URL("/rest/v1/"+table,config.apiOrigin);
   Object.entries({select,...filters,order:"id",offset:String(offset),limit:"200"}).forEach(([k,v])=>url.searchParams.set(k,v));
   const r=await transport(url,{headers:{apikey:config.anonKey,Authorization:"Bearer "+session.access_token,Prefer:"count=exact"},signal});
   if(!r.ok)throw Error(r.status===401?"Session expired. Sign out and sign in again.":"The "+table.replaceAll("_"," ")+" source is unavailable.");
   const page=await r.json() as T[];if(!Array.isArray(page))throw Error("Invalid source response.");
   data.push(...page);const total=Number(r.headers.get("content-range")?.split("/")[1]);
   if(Number.isFinite(total)&&total>5000)throw Error("Source exceeds the bounded read limit.");
   if(page.length<200||Number.isFinite(total)&&data.length>=total)return data;
  }
  throw Error("Source could not be loaded completely.");
 }
 async function catalog(signal?:AbortSignal):Promise<Catalog>{
  const user=await auth(config,"user",session.access_token);
  if(user.id!==session.user.id)throw Error("Session identity changed.");
  const [p]=await read<{id:string;role:string;organisation_id:string|null;active:boolean;updated_at:string}>("profiles","id,role,organisation_id,active,updated_at",{id:"eq."+user.id},signal);
  if(!p?.active||!canOpenSalesPipeline(p.role)||!(roles as readonly string[]).includes(p.role))throw Error("This account does not have access to Sales.");
  const b=await read<{id:string;name:string;address_line_1:string;town:string}>("buildings","id,name,address_line_1,town",{},signal);
  const buildings=b.map(v=>({id:v.id,name:v.name,address:[v.address_line_1,v.town].filter(Boolean).join(", ")}));
  return{access:{identity:p.id,role:p.role,organisationId:p.organisation_id,active:true,buildingIds:b.map(v=>v.id),accessRevision:JSON.stringify([p.updated_at,p.role,p.organisation_id,b.map(v=>v.id).sort()])},buildings};
 }
 const saleColumns="id,building_id,unit_id,is_active,workflow_status,sales_agent_organisation_id,conveyancer_organisation_id,reservation_submitted_at,reservation_rejected_at,reservation_rejection_reason,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at,legal_completed_at,redacted_at,authority_requested_at,completion_authority_requested_at,completion_authority_given_at,completion_arrangements_confirmed_at,completion_legacy_stage,completion_notice_issued_at,contractual_completion_date,created_at";
 async function load(scope:Scope,signal:AbortSignal):Promise<Workspace>{
  const c=await catalog(signal);const fresh=scopeFor(c.access,scope.buildingId);
  if(JSON.stringify(fresh)!==JSON.stringify(scope))throw Error("Access has changed. Reload the workspace.");
  const building=c.buildings.find(b=>b.id===scope.buildingId)!;
  const filter={building_id:"eq."+scope.buildingId};
  const [bs,units,floors,links]=await Promise.all([
   read<DashboardInput["buildings"][number]>("buildings","id,name,status,pc_date,pc_confirmed,practical_completion_date,conveyancer_organisation_id,sales_agent_organisation_id",{id:"eq."+scope.buildingId},signal),
   read<DashboardInput["units"][number]>("units","id,building_id,unit_number,floor,sale_status,rental_portfolio_status,completion_date,handover_date",filter,signal),
   read<DashboardInput["floors"][number]>("building_floors","id,building_id,name,sort_order",filter,signal),
   read<DashboardInput["buildingOrganisations"][number]>("building_organisations","id,building_id,organisation_id,role_on_project,active",filter,signal)
  ]);
  if(bs.length!==1)throw Error("Building unavailable.");
  const orgIds=[scope.organisationId,bs[0].conveyancer_organisation_id,bs[0].sales_agent_organisation_id,...links.map(l=>l.organisation_id)].filter(Boolean) as string[];
  const organisations=orgIds.length?await read<DashboardInput["organisations"][number]>("organisations","id,name",{id:"in.("+[...new Set(orgIds)].join(",")+")"},signal):[];
  const input:DashboardInput={viewer:{id:scope.identity,role:scope.role,organisation_id:scope.organisationId},buildingId:scope.buildingId,now:Date.now(),buildings:bs,units,floors,organisations,buildingOrganisations:links,sales:[],documents:[],authorities:[],saleEvents:[],deposits:[],depositSources:[],furtherDeposits:[],invoices:[],terms:[],payments:[],snags:[],handovers:[],tenancies:[],arrears:[],rentalImports:[],accessRequests:[],sources:[]};
  const sales=await read<WorkSale&{buyer_person_name:string|null;buyer_company_name:string|null}>("unit_sale_attempts",saleColumns+",buyer_person_name,buyer_company_name",{...filter,is_active:"eq.true",redacted_at:"is.null"},signal);
  input.sales=sales;input.sources.push({key:"sales",label:"Sales",state:"ready",asOf:new Date().toISOString()});
  const bySale={sale_attempt_id:"in.("+sales.map(v=>v.id).join(",")+")"};
  async function related<K extends keyof DashboardInput>(key:K,table:string,columns:string,extra:Record<string,string>={}){
   if(sales.length)(input[key] as unknown)=await read(table,columns,{...bySale,...extra},signal);
  }
  try{
   await Promise.all([
    related("documents","unit_sale_documents","id,sale_attempt_id,document_type,status,query_note,approved_version_id,approved_at,updated_at,updated_by_user_id,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current,redacted_at,uploaded_at)",{redacted_at:"is.null",superseded_at:"is.null",document_type:"in.(completion_statement,draft_statement_of_account,completion_correspondence)","unit_sale_document_versions.is_current":"eq.true","unit_sale_document_versions.redacted_at":"is.null"}),
    related("authorities","sale_legal_emails","id,sale_attempt_id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,resend_message_id"),
    related("deposits","sale_exchange_deposit_receipts","id,sale_attempt_id,source_id,expected_amount,received_amount"),
    related("depositSources","sale_exchange_deposit_sources","id,sale_attempt_id,source_kind,expected_amount"),
    related("furtherDeposits","sale_further_deposit_facts","id,sale_attempt_id,required,percent,expected_amount,received_amount,timing,months_after_exchange,exchanged_at,pc_date,deadline,terms_version")
   ]);input.sources.push({key:"legal",label:"Legal",state:"ready",asOf:new Date().toISOString()});
  }catch{if(signal.aborted)throw Error("Cancelled");input.sources.push({key:"legal",label:"Legal",state:"unavailable",asOf:null});}
  const fees=isSalesInternalRole(scope.role)||scope.role==="sales_agent";
  if(fees)try{
   await Promise.all([
    related("terms","unit_sale_terms","id,sale_attempt_id,is_current,version_number,contract_price,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate,reservation_fee,reservation_fee_holder,agent_contribution",{is_current:"eq.true"}),
    related("invoices","unit_sale_invoices","id,sale_attempt_id,invoice_type,fee_milestone,status,gross_amount,net_amount,vat_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction,approved_at,created_at,invoice_reference,invoice_date")
   ]);
   if(input.invoices.length)input.payments=await read("unit_sale_invoice_payments","id,invoice_id,amount,paid_at,voided_at",{invoice_id:"in.("+input.invoices.map(v=>v.id).join(",")+")"},signal);
   input.sources.push({key:"fees",label:"Agent fees",state:"ready",asOf:new Date().toISOString()});
  }catch{if(signal.aborted)throw Error("Cancelled");input.sources.push({key:"fees",label:"Agent fees",state:"unavailable",asOf:null});}
  else input.sources.push({key:"fees",label:"Agent fees",state:"not_permitted",asOf:null});
  const check=await catalog(signal);if(check.access.accessRevision!==scope.accessRevision)throw Error("Access changed during loading. Reload the workspace.");
  const buyers=Object.fromEntries(sales.map(s=>[s.id,s.buyer_person_name||s.buyer_company_name||"Buyer details not recorded"]));
  return projectWorkspace(c.access,building,input,buyers,false);
 }
 async function completion(scope:Scope,unitId:string,saleId:string,signal:AbortSignal):Promise<Completion>{
  const c=await catalog(signal);scopeFor(c.access,scope.buildingId);
  if(c.access.accessRevision!==scope.accessRevision)throw Error("Access changed. Reload the workspace.");
  const [sale]=await read<WorkSale>("unit_sale_attempts",saleColumns,{id:"eq."+saleId,building_id:"eq."+scope.buildingId,unit_id:"eq."+unitId,is_active:"eq.true",redacted_at:"is.null"},signal);
  if(!sale)throw Error("This building, unit and current sale attempt are unavailable.");
  const documents=await read<Document>("unit_sale_documents","id,document_type,title,status,query_note,approved_version_id,approved_at,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,version_number,file_name,is_current,uploaded_at,redacted_at)",{sale_attempt_id:"eq."+saleId,redacted_at:"is.null",superseded_at:"is.null",document_type:"in.(completion_statement,draft_statement_of_account,completion_correspondence)"},signal);
  const check=await catalog(signal);if(check.access.accessRevision!==scope.accessRevision)throw Error("Access changed during loading.");
  return{sale,documents};
 }
 return{read,catalog,load,completion,workflow:completionClient(session.access_token,config.anonKey)};
}