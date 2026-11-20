import {activityActors} from './activity-actors';
import {commercialSummary} from "./commercial-summary";
import {timingDescription,type FurtherDepositTiming} from "@/lib/sales/further-deposit";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import {canViewDeveloperCommercials,isSalesInternalRole} from "@/lib/sales/permissions";
import type {Document} from "@/lib/experiments/building-integration/reader";
import {ReadError,type Viewer} from "./server";
import {rows} from "./reads";
import {moduleAllowed} from "./staging";
import type {SaleDetails} from "./sale-details-types";

type RecordRow = Record<string,unknown>;
const titles:Record<string,string>={reservation:"Reservation",exchange:"Exchange",deposits:"Deposits","agent-fees":"Agent Fees",commercial:"Commercial Terms",handover:"Handover"};
const text=(v:unknown)=>v===null||v===undefined||v===""?"Not recorded":String(v).replaceAll("_"," ");
const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(v)):"Not recorded";
const money=(v:unknown)=>typeof v==="number"?new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(v):"Not recorded";
const percent=(v:unknown)=>typeof v==="number"?v+"%":"Not recorded";

// Each request is tied to an exact building/unit/attempt and uses the caller's
// JWT. Formatting is a projection only; historical amounts and states stay intact.
export async function saleDetails(v:Viewer,p:URLSearchParams):Promise<SaleDetails>{
 const building=p.get("building")||"",unit=p.get("unit")||"",sale=p.get("sale")||"",section=p.get("section")||"";
 if(!moduleAllowed(v.profile.role,"sales"))throw new ReadError("Sales unavailable for this role.");
 if(![building,unit,sale].every(validId)||!titles[section])throw new ReadError("Invalid sale scope.",400);
 const fees=isSalesInternalRole(v.profile.role)||v.profile.role==="sales_agent";
 if(section==="agent-fees"&&!fees)throw new ReadError("Agent fees are unavailable for this role.");
 const [[b],[a]]=await Promise.all([
  rows<{id:string}>(v.client,"buildings","id",q=>q.eq("id",building)),
  rows<RecordRow>(v.client,"unit_sale_attempts","id,is_active,attempt_number,workflow_status,buyer_person_name,buyer_company_name,buyer_email,buyer_phone,buyer_solicitor_name,reservation_date,reservation_submitted_at,reservation_submitted_by_name,reservation_approved_at,reservation_approved_by_name,reservation_rejected_at,reservation_rejection_reason,commercial_approved_at,authority_requested_at,exchanged_at,completed_at,legal_completed_at,fallen_through_at,fall_through_reason",q=>q.eq("id",sale).eq("unit_id",unit).eq("building_id",building).is("redacted_at",null))
 ]);
 if(!b||!a)throw new ReadError("This exact building, unit and sale are unavailable.");
 const result:SaleDetails={title:titles[section],historical:a.is_active===false,groups:[],notices:[],documents:[],attempts:[]};
 const add=(id:string,title:string,fields:[string,string][])=>result.groups.push({id,title,fields});
 add("record","Recorded sale",[["Attempt",text(a.attempt_number)],["Status",text(a.workflow_status)],["Buyer",text(a.buyer_person_name||a.buyer_company_name)],["Reservation date",date(a.reservation_date)]]);
 if(a.workflow_status==="completed"&&!a.legal_completed_at)result.notices.push("This legacy sale is recorded as completed, but a legal completion timestamp was not recorded. No new legal confirmation has been created.");
 if(a.fallen_through_at)add("fall-through","Fall-through record",[["Date",date(a.fallen_through_at)],["Reason",text(a.fall_through_reason)]]);
 if(section==="reservation")result.attempts=await rows<SaleDetails["attempts"][number]>(v.client,"unit_sale_attempts","id,attempt_number,workflow_status,is_active",q=>q.eq("building_id",building).eq("unit_id",unit).is("redacted_at",null));
 if(section==="reservation")add("reservation","Reservation record",[["Buyer email",text(a.buyer_email)],["Buyer phone",text(a.buyer_phone)],["Buyer solicitor",text(a.buyer_solicitor_name)],["Submitted",date(a.reservation_submitted_at)],["Submitted by",text(a.reservation_submitted_by_name)],["Approved",date(a.reservation_approved_at)],["Approved by",text(a.reservation_approved_by_name)],["Rejected",date(a.reservation_rejected_at)],["Rejection reason",text(a.reservation_rejection_reason)]]);
 if(["reservation","commercial","deposits"].includes(section)){
  const fullCommercialView=section==='commercial'&&v.profile.role==='conveyancer';
  const internal=canViewDeveloperCommercials(v.profile.role)||fullCommercialView;
  const terms=await rows<RecordRow>(v.client,"unit_sale_terms","id,version_number,is_current,status,contract_price,reservation_fee,reservation_fee_holder,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,second_deposit_months_after_exchange,further_deposit_timing,completion_balance_percent,approved_at"+(internal?",developer_contribution,solicitor_fee,commercial_summary,parking_value":"")+(fees||fullCommercialView?",agent_fee_percent,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate,agent_contribution":""),q=>{const scoped=q.eq("sale_attempt_id",sale);return internal||v.profile.role==="sales_agent"||section==="commercial"?scoped:scoped.eq("status","approved")});
  terms.sort((x,y)=>Number(y.version_number)-Number(x.version_number));
  if(!terms.length)result.notices.push(section==="commercial"?"No commercial terms have been recorded for this authorised sale.":"No terms are available for this sale and your role.");
  if(section==="commercial"){const current=terms.find(t=>t.is_current);if(current)result.commercial=commercialSummary(current,v.profile.role);}
  for(const t of terms){
   if(section==="commercial"&&t.is_current)continue;
   const fields:[string,string][]=[["Status",text(t.status)],["Contract price",money(t.contract_price)],["Reservation fee",money(t.reservation_fee)],["Fee holder",text(t.reservation_fee_holder)],["Exchange deposit",percent(t.exchange_deposit_percent)],["Further deposit",t.second_deposit_enabled===false?"Not required":t.second_deposit_enabled===true?percent(t.second_deposit_percent):"Not recorded"],["Further deposit timing",t.second_deposit_enabled===false?"Not required":timingDescription(t.further_deposit_timing as FurtherDepositTiming|null,t.second_deposit_months_after_exchange as number|null)],["Months after exchange",text(t.second_deposit_months_after_exchange)],["Completion balance",percent(t.completion_balance_percent)],["Approved",date(t.approved_at)]];
   if(internal&&section==="commercial")fields.push(["Developer contribution",money(t.developer_contribution)],["Agent contribution",money(t.agent_contribution)],["Solicitor fee",money(t.solicitor_fee)],["Commercial summary",text(t.commercial_summary)]);
   add(String(t.id),(t.is_current?"Current terms":"Previous terms")+" · version "+t.version_number,fields);
  }
  if(section==="deposits"){
   const schedule=terms.length?await rows<RecordRow>(v.client,"unit_sale_payment_schedule","id,sale_terms_id,sequence_no,label,expected_amount,status,due_event",q=>q.eq("sale_attempt_id",sale).in("sale_terms_id",terms.map(t=>String(t.id)))):[];
   for(const r of schedule.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no)))add(String(r.id),text(r.label),[["Terms version",text(terms.find(t=>t.id===r.sale_terms_id)?.version_number)],["Expected amount",money(r.expected_amount)],["Due",text(r.due_event)],["Recorded status",text(r.status)]]);
  }
 }
 if(section==="exchange"){
  add("exchange","Exchange record",[["Commercial approval",date(a.commercial_approved_at)],["Authority requested",date(a.authority_requested_at)],["Exchange date",date(a.exchanged_at)]]);
  const [authorities,audit]=await Promise.all([
   rows<RecordRow>(v.client,"sale_legal_emails","id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,subject,body,to_recipients,cc_recipients",q=>q.eq("sale_attempt_id",sale).eq("kind","authority")),
   a.exchanged_at?v.client.rpc('sale_activity_page',{p_sale:sale}):Promise.resolve({data:null,error:null})
  ]);
  const resolved=Array.isArray(audit.data)?await activityActors(v.client,audit.data):[];
  const event=resolved.length?resolved.find((event:RecordRow)=>event.event_type==='exchange_recorded'&&event.actor_name):undefined;
  if(event)result.groups.find(g=>g.id==='exchange')!.fields.push(['Recorded by',String(event.actor_name)]);
  result.authorities=authorities.map(r=>({id:String(r.id),subject:String(r.subject||''),body:String(r.body||'')}));
  for(const r of authorities.sort((x,y)=>Number(y.version)-Number(x.version)))add(String(r.id),text(r.kind)+" · version "+r.version,[["Issued",date(r.issued_at)],["Expires",date(r.expires_at)],["Revoked",date(r.revoked_at)],["Replaced",r.replaced_by?"Yes":"No"],["Recorded delivery status",text(r.delivery_status)],["Historical sent date",date(r.sent_at)],['To',Array.isArray(r.to_recipients)?r.to_recipients.join(', '):'Not recorded'],['CC',Array.isArray(r.cc_recipients)&&r.cc_recipients.length?r.cc_recipients.join(', '):'None recorded']]);
  result.notices.push("Delivery entries are historical records. No email is sent or replayed from this workspace.");
 }
 if(section==="deposits"){
  const [sources,receipts]=await Promise.all([
   rows<RecordRow>(v.client,"sale_exchange_deposit_sources","id,source_kind,expected_amount,terms_version,captured_at",q=>q.eq("sale_attempt_id",sale)),
   rows<RecordRow>(v.client,"sale_exchange_deposit_receipts","id,revision,supersedes_id,expected_amount,received_amount,received_date,recorded_by_name,recorded_at,correction_reason",q=>q.eq("sale_attempt_id",sale))
  ]);
  for(const r of sources)add(String(r.id),"Exchange deposit source",[["Source",text(r.source_kind)],["Expected",money(r.expected_amount)],["Terms version",text(r.terms_version)],["Captured",date(r.captured_at)]]);
  for(const r of receipts.sort((x,y)=>Number(y.revision)-Number(x.revision)))add(String(r.id),"Deposit receipt · revision "+r.revision,[["Expected",money(r.expected_amount)],["Received",money(r.received_amount)],["Received date",date(r.received_date)],["Recorded by",text(r.recorded_by_name)],["Recorded",date(r.recorded_at)],["Correction reason",text(r.correction_reason)]]);
  if(!receipts.length)result.notices.push("No exchange-deposit receipt is recorded. Missing receipts do not represent a zero receipt.");
 }
 if(section==="agent-fees"){
  const [invoices,payments]=await Promise.all([
   rows<RecordRow>(v.client,"unit_sale_invoices","id,invoice_type,fee_milestone,invoice_reference,invoice_date,net_amount,vat_amount,gross_amount,expected_payable_amount,status,approved_at,query_note",q=>q.eq("sale_attempt_id",sale)),
   rows<RecordRow>(v.client,"unit_sale_invoice_payments","id,invoice_id,payment_source,payer_type,amount,paid_at,recorded_by_name,voided_at,void_reason",q=>q.eq("sale_attempt_id",sale))
  ]);
  if(!invoices.length)result.notices.push("No invoices are recorded for this sale attempt.");
  for(const r of invoices)add(String(r.id),text(r.invoice_type)+" · "+text(r.invoice_reference),[["Milestone",text(r.fee_milestone)],["Date",date(r.invoice_date)],["Net",money(r.net_amount)],["VAT",money(r.vat_amount)],["Gross",money(r.gross_amount)],["Expected payable",money(r.expected_payable_amount)],["Status",text(r.status)],["Approved",date(r.approved_at)],["Query",text(r.query_note)]]);
  for(const r of payments)add(String(r.id),r.voided_at?"Voided payment":"Recorded payment",[["Invoice",text(invoices.find(i=>i.id===r.invoice_id)?.invoice_reference)],["Amount",money(r.amount)],["Paid",date(r.paid_at)],["Source",text(r.payment_source)],["Payer",text(r.payer_type)],["Recorded by",text(r.recorded_by_name)],["Voided",date(r.voided_at)],["Void reason",text(r.void_reason)]]);
 }
 if(section==="handover"){
  const handovers=await rows<RecordRow>(v.client,"handovers","id,handover_date,handover_datetime,recipient_name,recipient_capacity,number_of_keys,declaration_accepted,notes",q=>q.eq("unit_id",unit));
  result.notices.push("Handover records belong to the unit and may relate to an earlier sale. They do not change this sale's recorded completion status.");
  if(!handovers.length)result.notices.push("No handover records are available for this unit and your role.");
  for(const r of handovers)add(String(r.id),"Unit handover record",[["Date",date(r.handover_datetime||r.handover_date)],["Recipient",text(r.recipient_name)],["Capacity",text(r.recipient_capacity)],["Keys",text(r.number_of_keys)],["Declaration accepted",r.declaration_accepted===true?"Yes":r.declaration_accepted===false?"No":"Not recorded"],["Notes",text(r.notes)]]);
 }
 const types=section==="reservation"?["reservation_form"]:section==="agent-fees"?["agent_invoice"]:section==="commercial"?["statement_of_account"]:[];
 if(types.length)result.documents=await rows<Document>(v.client,"unit_sale_documents","id,document_type,title,status,query_note,approved_version_id,approved_at,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,version_number,file_name,is_current,uploaded_at,redacted_at)",q=>q.eq("sale_attempt_id",sale).is("redacted_at",null).in("document_type",types));
 return result;
}
