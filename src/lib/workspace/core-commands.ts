import {renderLegalEmailContent} from "@/lib/sales/legal-email";
import {createHmac,timingSafeEqual} from "node:crypto";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {termsSnapshotFromDefaults} from "@/lib/sales/reservation-terms";
import {buildPaymentScheduleRows} from "@/lib/sales/deal-structure";
import {renderLegalEmail,type LegalSnapshot} from "@/lib/sales/legal-workflow";
import {canPerformSalesAction} from "@/lib/sales/permissions";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {completion,check,ReadError,type Viewer} from "./server";
import {rows} from "./reads";
import {coreSalesEnabled} from "./staging";
import {coreCommandFetch} from "./core-fetch";
export const coreActions=new Set(["core_context","save_reservation_draft","save_reservation","approve_reservation","query_reservation","reject_reservation","request_authority","preview_capture","capture_authority","confirm_exchange","request_notice_authority","confirm_completion"]);
const signature=(data:unknown)=>createHmac("sha256",process.env.SUPABASE_SERVICE_ROLE_KEY!).update(JSON.stringify(data)).digest("hex");
export async function coreCommand(v:Viewer,p:Record<string,unknown>,scope:RecordScope){
 if(!coreSalesEnabled())throw new ReadError("Core Sales writes are unavailable.",404);
 const current=await completion(v,scope);await check(v);
 const client=createSupabaseServiceRoleClient(coreCommandFetch(scope,v.profile.id),v.profile.id);
 async function rpc(name:string,args:Record<string,unknown>){const r=await client.rpc(name,{p_sale:scope.saleId,p_actor:v.profile.id,...args});if(r.error)throw new ReadError(r.error.message,400);return r.data;}
 if(p.action==="core_context"){
  const [sale]=await rows<Record<string,unknown>>(v.client,"unit_sale_attempts","id,is_active,workflow_status,updated_at,buyer_person_name,buyer_company_name,buyer_email,buyer_phone,buyer_solicitor_name,reservation_date,reservation_terms_checked,exchanged_at,legal_completed_at,authority_requested_at,completion_authority_requested_at,completion_authority_given_at,completion_arrangements_confirmed_at",q=>q.eq("id",scope.saleId).eq("building_id",scope.buildingId).eq("unit_id",scope.unitId).is("redacted_at",null));
  const documents=await rows<Record<string,unknown>>(v.client,"unit_sale_documents","id,document_type,status,approved_version_id,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current,redacted_at,file_name)",q=>q.eq("sale_attempt_id",scope.saleId).is("redacted_at",null).is("superseded_at",null).in("document_type",["reservation_form","completion_correspondence","completion_statement","draft_statement_of_account"]));
  const emails=await rows<Record<string,unknown>>(v.client,"sale_legal_emails","id,kind,version,delivery_status,sent_at,expires_at,revoked_at,replaced_by",q=>q.eq("sale_attempt_id",scope.saleId));
  return {asOf:new Date().toISOString(),sale,documents,emails};
 }
 const action=String(p.action);
 if(action.includes("reservation")){
  const permission=["save_reservation","save_reservation_draft"].includes(action)?"submit_reservation":"approve_reservation";
  if(!canPerformSalesAction(v.profile.role,permission))throw new ReadError("This role cannot perform this reservation operation.");
  if(!validId(String(p.requestId))||typeof p.expected!=="string"||!Number.isFinite(Date.parse(p.expected)))throw new ReadError("Reload the reservation before saving.",400);
  const payload=(p.payload??{}) as Record<string,unknown>;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new ReadError("Invalid reservation fields.",400);
  const clean:Record<string,unknown>={};
  for(const key of ["buyerPersonName","buyerCompanyName","buyerEmail","buyerPhone","buyerSolicitorName","reservationDate","reason","versionId"]){if(payload[key]!==undefined){if(typeof payload[key]!=="string"||payload[key].length>5000)throw new ReadError("Invalid reservation field.",400);clean[key]=payload[key].trim();}}
  if(payload.reservationTermsChecked!==undefined)clean.reservationTermsChecked=payload.reservationTermsChecked===true;
  let commercial={};
  if(action==="save_reservation"){
   const inputs=await rpc("workspace_reservation_inputs",{p_building:scope.buildingId,p_unit:scope.unitId});
   const terms=termsSnapshotFromDefaults({currentTerms:inputs.terms,defaults:inputs.defaults,usePayloadCommercials:false});
   const schedule=buildPaymentScheduleRows({contractPrice:terms.contract_price,exchangeDepositPercent:terms.exchange_deposit_percent,secondDepositEnabled:terms.second_deposit_enabled,secondDepositPercent:terms.second_deposit_percent,secondDepositMonthsAfterExchange:terms.second_deposit_months_after_exchange,furtherDepositTiming:terms.further_deposit_timing});
   commercial={p_expected_terms:inputs.terms,p_expected_defaults:inputs.defaults,p_terms:terms,p_schedule:schedule};
  }
  return rpc("workspace_reservation_command",{p_building:scope.buildingId,p_unit:scope.unitId,p_request:p.requestId,p_action:action,p_expected:p.expected,p_payload:clean,...commercial});
 }
 if(action==="preview_capture"||action==="capture_authority"){
  if(!canPerformSalesAction(v.profile.role,"approve_exchange"))throw new ReadError("Only developer reviewers can issue authority.");
  if(action==="preview_capture"){
   const kind=p.kind;if(kind!=="authority"&&kind!=="notice_authority")throw new ReadError("Choose an authority type.",400);
   if(kind==="authority"&&(current.sale.exchanged_at||current.sale.legal_completed_at||!["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange"].includes(current.sale.workflow_status)))throw new ReadError("Approve the reservation before reviewing exchange authority.",400);
   if(kind==="notice_authority"&&(!current.sale.exchanged_at||current.sale.legal_completed_at))throw new ReadError("An exchanged sale awaiting Completion is required.",400);
   const date=kind==="authority"?String(p.date||new Date(Date.now()+48*3600000).toISOString()):null;
   const snapshot=await rpc("sales_legal_snapshot",{}) as LegalSnapshot;
   const reviewUrl="https://bunnywell-portal-integration-carl-gilbert-s-projects.vercel.app/workspace?"+new URLSearchParams({view:"sale",building:scope.buildingId,unit:scope.unitId,sale:scope.saleId,section:kind==="authority"?"exchange":"completion"});
   const rendered={...renderLegalEmail(snapshot,kind,date||""),...renderLegalEmailContent(snapshot,kind,date||"",reviewUrl)};
   const preview={kind,date,snapshot,email:{...rendered,subject:"[INTEGRATION TEST] "+rendered.subject,body:"TEST CAPTURE ONLY - no external delivery\n\n"+rendered.body,html:"<p>TEST CAPTURE ONLY - no external delivery</p>"+rendered.html,from:"Integration Test <no-send@example.invalid>"}};
   return {...preview,token:signature(preview)};
  }
  if(!validId(String(p.requestId))||!p.preview||typeof p.preview!=="object")throw new ReadError("Review a fresh authority preview.",400);
  const {token,...preview}=p.preview as Record<string,unknown>;
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token,"hex"),Buffer.from(signature(preview),"hex")))throw new ReadError("Authority preview changed. Review it again.",400);
  return rpc("workspace_capture_legal_email",{p_request:p.requestId,p_kind:preview.kind,p_snapshot:preview.snapshot,p_email:preview.email,p_date:preview.date});
 }
 const permission=action==="request_authority"||action==="request_notice_authority"?"request_exchange_approval":action==="confirm_exchange"?"record_exchange":"record_completion";
 if(!canPerformSalesAction(v.profile.role,permission))throw new ReadError("This role cannot perform this legal operation.");
 const payload=action==="confirm_exchange"?{date:p.date}:action==="confirm_completion"?{dateTime:p.dateTime}:{};
 return rpc("sales_legal_action",{p_action:action,p_payload:payload});
}
