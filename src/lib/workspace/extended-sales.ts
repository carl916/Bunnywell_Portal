import {createHash} from "node:crypto";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {termsSnapshotFromDefaults,type ReservationPayload} from "@/lib/sales/reservation-terms";
import {buildPaymentScheduleRows} from "@/lib/sales/deal-structure";
import {expectedMilestoneInvoice,milestoneInvoiceAmounts} from "@/lib/sales/agent-invoice-summary";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {completion,check,ReadError,type Viewer} from "./server";
import {rows,readBuildingNoticeTerms} from "./reads";
import {coreSalesEnabled} from "./staging";
import {coreCommandFetch} from "./core-fetch";
export const saleOperations=["save_commercial","return_for_sale","approve_agent_invoice","query_agent_invoice","record_agent_payment","void_agent_payment","revoke_authority","cancel_notice_authority","confirm_exchange_deposit","correct_exchange_deposit_date","record_further_receipt","correct_further_receipt","void_further_receipt","confirm_further_deadline","correct_completion_dates"];
export const extendedSalesActions=new Set(["extended_sales_context",...saleOperations]);
type Fields=Record<string,unknown>;
const termsRevision=(terms:unknown)=>createHash("sha256").update(JSON.stringify(terms)).digest("hex");
export function saleService(v:Viewer,scope:RecordScope){
 const client=createSupabaseServiceRoleClient(coreCommandFetch(scope,v.profile.id),v.profile.id);
 return {client,async rpc(name:string,args:Fields={}){
  const r=await client.rpc(name,{p_sale:scope.saleId,p_actor:v.profile.id,...args});
  if(r.error)throw new ReadError(r.error.message,400);return r.data;
 }};
}
function fields(value:unknown):Fields {
 if(!value||typeof value!=="object"||Array.isArray(value))throw new ReadError("Invalid Sales fields.",400);
 return value as Fields;
}
const internal=(role:string)=>["admin","developer"].includes(role);
export async function invoiceInputs(v:Viewer,scope:RecordScope,p:Fields){
 if(!["admin","developer","sales_agent"].includes(v.profile.role))throw new ReadError("Agent invoice upload denied.");
 if(!["exchange","completion"].includes(String(p.milestone))||typeof p.reference!=="string"||!p.reference.trim()||p.reference.length>160||typeof p.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Number(p.gross))||Number(p.gross)<=0)throw new ReadError("Enter an invoice reference, date and positive total.",400);
 const {rpc}=saleService(v,scope),inputs=await rpc("workspace_reservation_inputs",{p_building:scope.buildingId,p_unit:scope.unitId});
 const t=inputs.terms;
 if(!t||t.id!==p.termsId||termsRevision(t)!==p.termsRevision)throw new ReadError("Commercial terms changed. Reload the invoice before uploading.",409);
 return {expectedTerms:t,invoiceValues:milestoneInvoiceAmounts(t,p.milestone as 'exchange'|'completion')};
}
export async function extendedSalesCommand(v:Viewer,p:Fields,scope:RecordScope){
 if(!coreSalesEnabled())throw new ReadError("Sales operations are unavailable.",404);
 await check(v);
 const {rpc}=saleService(v,scope),bounds={p_building:scope.buildingId,p_unit:scope.unitId};
 const action=String(p.action);
 if(action==="extended_sales_context"){
  const current=await completion(v,scope);
  const section=String(p.section);
  if(!["deposits","agent-fees","commercial","reservation","exchange","completion"].includes(section))throw new ReadError("Sales section unavailable.",400);
  if(["agent-fees","commercial"].includes(section)&&!["admin","developer","sales_agent"].includes(v.profile.role))throw new ReadError("Commercial details unavailable for this role.");
  const test=await rpc("workspace_sale_test_context",bounds);
  if(section==="deposits"){
   const deposits=await rpc("sales_deposit_context");
   const [building]=await rows<{conveyancer_organisation_id:string|null}>(v.client,'buildings','conveyancer_organisation_id',q=>q.eq('id',scope.buildingId));
   const [appointed]=building?.conveyancer_organisation_id?await rows<{name:string}>(v.client,'organisations','name',q=>q.eq('id',building.conveyancer_organisation_id!)):[];
   return {...test,deposits:{...deposits,receiptRestriction:!deposits.canRecord?(building?.conveyancer_organisation_id?'Receipt entry requires a conveyancer from '+(appointed?.name||'the building’s appointed organisation')+'. Your current account has read-only access to these receipts.':'No conveyancing organisation is appointed to this building. Ask the developer to review its Sales contacts.'):null,exchange:{...deposits.exchange,due_date:current.sale.exchanged_at}}};
  }
  const [sale]=await rows<Fields>(v.client,"unit_sale_attempts","id,is_active,workflow_status,reservation_approved_at,reservation_approved_by_user_id,exchanged_at,completed_at,legal_completed_at,completion_arrangements_confirmed_at,completion_notice_issued_at,completion_service_date,completion_basis,completion_deadline_reason,contractual_completion_date,updated_at",q=>q.eq("id",scope.saleId));
  if(["reservation","exchange","completion"].includes(section)){
   const emails=await rows<Fields>(v.client,"sale_legal_emails","id,kind,version,delivery_status,revoked_at,replaced_by",q=>q.eq("sale_attempt_id",scope.saleId));
   const defaults=await readBuildingNoticeTerms(v.client,scope.buildingId);
   return {...test,sale,emails,noticeTerms:{workingDays:defaults?.notice_working_days??10,serviceProvision:defaults?.notice_service_provision||''}};
  }
  const inputs=await rpc("workspace_reservation_inputs",bounds);
  if(section==="commercial"){
   if(!internal(v.profile.role))throw new ReadError("Developer commercial review required.");
   const emails=await rows<Fields>(v.client,"sale_legal_emails","id,kind,version,revoked_at,replaced_by",q=>q.eq("sale_attempt_id",scope.saleId));
   return {...test,sale,emails,terms:inputs.terms,termsRevision:termsRevision(inputs.terms),defaults:inputs.defaults};
  }
  const [invoices,payments,documents]=await Promise.all([
   rows<Fields>(v.client,"unit_sale_invoices","id,document_id,fee_milestone,invoice_reference,invoice_date,gross_amount,expected_gross_amount,reservation_fee_deduction,agent_contribution_deduction,expected_payable_amount,status,query_note",q=>q.eq("sale_attempt_id",scope.saleId)),
   rows<Fields>(v.client,"unit_sale_invoice_payments","id,invoice_id,payer_type,payment_source,amount,paid_at,voided_at,void_reason,recorded_by_name",q=>q.eq("sale_attempt_id",scope.saleId)),
   rows<Fields>(v.client,"unit_sale_documents","id,status,query_note,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current,redacted_at,file_name,version_number)",q=>q.eq("sale_attempt_id",scope.saleId).eq("document_type","agent_invoice").is("redacted_at",null))
  ]);
  const t=inputs.terms;
  return {...test,sale,invoices,payments,documents,expectedInvoices:{exchange:expectedMilestoneInvoice(t,'exchange'),completion:expectedMilestoneInvoice(t,'completion')},termsRevision:termsRevision(t),terms:t?{id:t.id,exchange_agent_fee_percent:t.exchange_agent_fee_percent??t.agent_fee_percent,completion_agent_fee_percent:t.completion_agent_fee_percent}:null};
 }
 if(!saleOperations.includes(action)||!validId(String(p.requestId)))throw new ReadError("A Sales operation and submission reference are required.",400);
 const payload=fields(p.payload??{});
 // Calculations and current database snapshots are never accepted from the browser.
 const clean:Fields={};
 const allowed=["sourceId","date","time","dateTime","noticeDate","previousNoticeDate","previousDate","serviceDate","basis","serviceConfirmed","previousReceiptId","previousDeadlineId","amount","note","reason","confirmed","acknowledgeExcess","expectedReceivedAmount","emailId","invoiceId","paymentId","payer","milestone","versionId"];
 for(const key of allowed)if(payload[key]!==undefined)clean[key]=payload[key];
 if(action==="save_commercial"){clean.commercial=payload.commercial;clean.termsId=payload.termsId??null;clean.termsRevision=payload.termsRevision;}
 const receipt=await rpc("workspace_sale_receipt",{...bounds,p_request:p.requestId,p_action:action,p_payload:clean});
 if(receipt)return receipt.result;
 const current=await completion(v,scope);
 if(action==="save_commercial"){
  if(!internal(v.profile.role))throw new ReadError("Developer commercial review required.");
  const inputs=await rpc("workspace_reservation_inputs",bounds);
  if((inputs.terms?.id??null)!==(payload.termsId??null)||termsRevision(inputs.terms)!==payload.termsRevision)throw new ReadError("Commercial terms changed. Reload before saving.",409);
  const commercial=fields(payload.commercial);
  const permitted=["listPriceAtOffer","contractPrice","parkingValue","developerContribution","developerContributionValueType","agentContribution","agentContributionValueType","parkingContributionValue","parkingLocationDetails","additionalSpecialConditions","reservationFee","reservationFeeHolder","agentFeePercent","exchangeAgentFeePercent","completionAgentFeePercent","solicitorFee","exchangeDepositPercent","secondDepositEnabled","secondDepositPercent","secondDepositMonthsAfterExchange","furtherDepositTiming","commercialSummary"];
  if(Object.keys(commercial).some(k=>!permitted.includes(k)))throw new ReadError("Unknown commercial field.",400);
  const terms=termsSnapshotFromDefaults({currentTerms:inputs.terms,defaults:inputs.defaults,payload:commercial as ReservationPayload,usePayloadCommercials:true});
  if(!terms.contract_price||terms.contract_price<=0)throw new ReadError("Enter a positive sale price.",400);
  const schedule=buildPaymentScheduleRows({contractPrice:terms.contract_price,exchangeDepositPercent:terms.exchange_deposit_percent,secondDepositEnabled:terms.second_deposit_enabled,secondDepositPercent:terms.second_deposit_percent,secondDepositMonthsAfterExchange:terms.second_deposit_months_after_exchange,furtherDepositTiming:terms.further_deposit_timing});
  Object.assign(clean,{commercial,termsId:payload.termsId??null,calculatedTerms:terms,schedule,expectedTerms:inputs.terms,expectedDefaults:inputs.defaults});
 }
 if(!current.sale.is_active)throw new ReadError("Historical Sales records remain read-only.");
 return rpc("workspace_sale_operation",{...bounds,p_request:p.requestId,p_action:action,p_payload:clean});
}
