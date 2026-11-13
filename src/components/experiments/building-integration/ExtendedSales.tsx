"use client";
import {useEffect,useRef,useState} from "react";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {ExchangeDepositReceipt} from "@/components/portal/sales/ExchangeDepositReceipt";
import {FurtherDepositCard,type DepositsContext} from "@/components/portal/sales/SaleDeposits";
import {FurtherDepositTimingFields} from "@/components/portal/sales/FurtherDepositTimingFields";
import type {FurtherDepositTiming} from "@/lib/sales/further-deposit";
import {PdfUploadBox} from "@/components/portal/sales/PdfUploadBox";
import {Notice,label,go} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
type Api=ReturnType<typeof reader>;
type Fields=Record<string,unknown>;
type Sale={id:string;is_active:boolean;workflow_status:string;exchanged_at:string|null;legal_completed_at:string|null;completion_arrangements_confirmed_at:string|null;completion_notice_issued_at:string|null;contractual_completion_date:string|null};
type Invoice={id:string;document_id:string;fee_milestone:string;invoice_reference:string;gross_amount:number;expected_gross_amount:number;reservation_fee_deduction:number;agent_contribution_deduction:number;expected_payable_amount:number;status:string;query_note:string|null};
type Version={id:string;is_current:boolean;redacted_at:string|null;file_name:string;version_number:number};
type Doc={id:string;status:string;query_note:string|null;unit_sale_document_versions:Version[]};
type Payment={id:string;invoice_id:string;amount:number;payer_type:string;paid_at:string;voided_at:string|null;void_reason:string|null;recorded_by_name:string};
type Context={termsRevision:string;enrolled:boolean;deposits?:DepositsContext;sale?:Sale;terms:Fields|null;defaults?:Fields|null;invoices?:Invoice[];payments?:Payment[];documents?:Doc[];emails?:{id:string;kind:string;version:number;revoked_at:string|null;replaced_by:string|null}[]};
type Run=(body:Fields,message:string)=>Promise<boolean>;
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(new Date());
const money=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(n);
export default function ExtendedSales({api,scope,role,section,refresh,onSaved}:{api:Api;scope:RecordScope;role:string;section:string;refresh:number;onSaved:(m:string)=>void}){
 const [data,setData]=useState<Context>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now);
 const alive=useRef(true),pending=useRef({key:"",id:""}),inFlight=useRef(false);
 const {buildingId,unitId,saleId}=scope;
 useEffect(()=>{alive.current=true;const timer=setInterval(()=>setNow(Date.now()),30000);return()=>{alive.current=false;clearInterval(timer)}},[]);
 useEffect(()=>{const c=new AbortController();api.workflow.action({buildingId,unitId,saleId},{action:"extended_sales_context",section},c.signal).then(d=>{if(!c.signal.aborted){setData(d as Context);setError("")}}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[api,buildingId,unitId,saleId,section,refresh]);
 const run:Run=async(body,message)=>{
  if(inFlight.current)return false;inFlight.current=true;setBusy(true);setError("");
  const {action,requestId,...payload}=body,key=JSON.stringify(body);
  if(pending.current.key!==key)pending.current={key,id:typeof requestId==="string"?requestId:crypto.randomUUID()};
  try{
   const result=await api.workflow.action(scope,{action,requestId:pending.current.id,payload});
   if(alive.current){pending.current={key:"",id:""};onSaved(message);
    if(action==="return_for_sale")go({view:"sale",building:buildingId,unit:unitId,sale:(result as {saleAttemptId:string}).saleAttemptId,section:"reservation"});
   }return true;
  }catch(e){if(alive.current)setError((e as Error).message);return false}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 };
 if(!data)return <section className={s.card}><h2>Sales controls</h2>{error?<div role="alert"><Notice>{error}</Notice></div>:<p>Loading authorised controls…</p>}</section>;
 const dev=["admin","developer"].includes(role),active=data.sale?.is_active!==false;
 return <>{error&&<div role="alert"><Notice>{error}</Notice></div>}
 {!data.enrolled?<Notice>Imported reference records remain read-only for these operations. Use a designated fictional test journey.</Notice>:<>
 {section==="deposits"&&data.deposits&&<section className={s.card}><h2>Deposit receipts</h2><p>Record actual test receipts against the retained sale terms. Corrections retain their history.</p>
 <ExchangeDepositReceipt deposit={data.deposits.exchange} exchanged={data.deposits.exchanged} editable={data.deposits.canRecord&&data.deposits.active} busy={busy} run={run}/>
 <FurtherDepositCard context={data.deposits} now={now} busy={busy} run={run}/></section>}
 {section==="commercial"&&dev&&data.sale&&<CommercialForm key={data.termsRevision} data={data} busy={busy} run={run}/>}
 {section==="agent-fees"&&active&&(["admin","developer","sales_agent"].includes(role))&&(["exchange","completion"] as const).map(milestone=><InvoiceCard key={milestone} api={api} scope={scope} data={data} milestone={milestone} dev={dev} busy={busy} run={run} onSaved={onSaved}/>)}
 {["reservation","exchange","completion"].includes(section)&&data.sale&&active&&<Corrections data={data} section={section} dev={dev} conveyancer={role==="conveyancer"} busy={busy} run={run}/>}
 </>}</>;
}
const commercialFields=[
 ["contractPrice","Agreed sale price (£)","contract_price"],["listPriceAtOffer","List price (£)","list_price_at_offer"],
 ["reservationFee","Reservation fee (£)","reservation_fee"],["developerContribution","Developer contribution","developer_contribution_value"],
 ["agentContribution","Agent contribution","agent_contribution_value"],["parkingValue","Parking value (£)","parking_value"],
 ["parkingContributionValue","Parking contribution (£)","parking_contribution_value"],["solicitorFee","Solicitor fee (£)","solicitor_fee"],
 ["agentFeePercent","Total agent fee (%)","agent_fee_percent"],["exchangeAgentFeePercent","Agent fee at exchange (%)","exchange_agent_fee_percent"],
 ["completionAgentFeePercent","Agent fee at completion (%)","completion_agent_fee_percent"],["exchangeDepositPercent","Exchange deposit (%)","exchange_deposit_percent"]
] as const;
function CommercialForm({data,busy,run}:{data:Context;busy:boolean;run:Run}){
 const t=data.terms||{},d=data.defaults||{};
 const initial:Fields={reservation_fee:d.reservation_fee,agent_fee_percent:d.default_agent_fee_percent,exchange_agent_fee_percent:d.default_exchange_agent_fee_percent,completion_agent_fee_percent:d.default_completion_agent_fee_percent,solicitor_fee:d.default_sales_solicitor_fee,exchange_deposit_percent:d.exchange_deposit_percent??10};
 const [form,setForm]=useState<Record<string,string>>(()=>Object.fromEntries(commercialFields.map(([key,,db])=>[key,String(t[db]??initial[db]??0)])));
 const [holder,setHolder]=useState(String(t.reservation_fee_holder??d.reservation_fee_holder_default??"sales_agent"));
 const [devType,setDevType]=useState(String(t.developer_contribution_value_type??"amount")),[agentType,setAgentType]=useState(String(t.agent_contribution_value_type??"amount"));
 const [second,setSecond]=useState(Boolean(t.second_deposit_enabled??d.second_deposit_enabled)),[percent,setPercent]=useState(String(t.second_deposit_percent??d.second_deposit_percent??0));
 const [months,setMonths]=useState(String(t.second_deposit_months_after_exchange??d.second_deposit_months_after_exchange??0)),[timing,setTiming]=useState<FurtherDepositTiming>((t.further_deposit_timing??d.further_deposit_timing??{basis:"after_exchange"}) as FurtherDepositTiming);
 const [parking,setParking]=useState(String(t.parking_location_details??"")),[conditions,setConditions]=useState((Array.isArray(t.additional_special_conditions)?t.additional_special_conditions:[]).join("\n")),[summary,setSummary]=useState(String(t.commercial_summary??""));
 if(!data.sale||data.sale.exchanged_at||!["draft","rejected","reservation_query_raised"].includes(data.sale.workflow_status))return <Notice>Commercial terms are locked at this stage. Their recorded versions are shown below.</Notice>;
 return <section className={s.card}><h2>Edit commercial terms</h2><form onSubmit={e=>{e.preventDefault();void run({action:"save_commercial",termsId:t.id??null,termsRevision:data.termsRevision,commercial:{...form,reservationFeeHolder:holder,developerContributionValueType:devType,agentContributionValueType:agentType,secondDepositEnabled:second,secondDepositPercent:percent,secondDepositMonthsAfterExchange:months,furtherDepositTiming:timing,parkingLocationDetails:parking,additionalSpecialConditions:conditions.split("\n").map(x=>x.trim()).filter(Boolean),commercialSummary:summary}},"Commercial terms saved. The payment schedule and worklist have refreshed.")}}>
 <fieldset disabled={busy} style={{border:0,padding:0}}><div className={s.documentGrid}>{commercialFields.map(([key,title])=><label className={s.field} key={key}>{title}<input type="number" min="0" step="0.01" required value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}
 <label className={s.field}>Reservation fee holder<select value={holder} onChange={e=>setHolder(e.target.value)}>{["sales_agent","developer","conveyancer","other"].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
 {[[devType,setDevType,"Developer contribution basis"],[agentType,setAgentType,"Agent contribution basis"]].map(([value,set,title])=><label className={s.field} key={String(title)}>{String(title)}<select value={value as string} onChange={e=>(set as (v:string)=>void)(e.target.value)}><option value="amount">Amount (£)</option><option value="percent">Percent (%)</option></select></label>)}</div>
 <label className={s.field}><span><input type="checkbox" checked={second} onChange={e=>setSecond(e.target.checked)}/> Further deposit required</span></label>
 {second&&<><label className={s.field}>Further deposit (%)<input type="number" min="0" max="100" step="0.01" required value={percent} onChange={e=>setPercent(e.target.value)}/></label><FurtherDepositTimingFields value={timing} months={months} onChange={setTiming} onMonths={setMonths}/></>}
 <label className={s.field}>Parking location<input value={parking} onChange={e=>setParking(e.target.value)}/></label>
 <label className={s.field}>Special conditions (one per line)<textarea value={conditions} onChange={e=>setConditions(e.target.value)}/></label>
 <label className={s.field}>Commercial notes<textarea value={summary} onChange={e=>setSummary(e.target.value)}/></label>
 <button className={s.primary}>{busy?"Saving…":"Save commercial terms"}</button></fieldset></form></section>;
}
function InvoiceCard({api,scope,data,milestone,dev,busy,run,onSaved}:{api:Api;scope:RecordScope;data:Context;milestone:"exchange"|"completion";dev:boolean;busy:boolean;run:Run;onSaved:(m:string)=>void}){
 const invoice=data.invoices?.find(i=>i.fee_milestone===milestone),doc=data.documents?.find(d=>d.id===invoice?.document_id),version=doc?.unit_sale_document_versions.find(v=>v.is_current&&!v.redacted_at);
 const [file,setFile]=useState<File|null>(null),[reference,setReference]=useState(""),[date,setDate]=useState(today),[gross,setGross]=useState(""),[reason,setReason]=useState(""),[amount,setAmount]=useState(""),[payer,setPayer]=useState("solicitor"),[paymentDate,setPaymentDate]=useState(today),[note,setNote]=useState(""),[sending,setSending]=useState(false),[error,setError]=useState("");
 const pending=useRef({key:"",id:""}),abort=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort()}},[]);
 const payments=(data.payments||[]).filter(p=>p.invoice_id===invoice?.id),paid=payments.filter(p=>!p.voided_at).reduce((n,p)=>n+Number(p.amount),0);
 const eligible=milestone==="completion"?Boolean(data.sale?.exchanged_at):["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange","exchanged","completion_pending","completed"].includes(data.sale?.workflow_status||"");
 const canUpload=eligible&&(!invoice||invoice.status==="query_raised")&&Number(data.terms?.[milestone+"_agent_fee_percent"])>0;
 async function upload(){
  if(!file||sending)return;
  if(file.type!=="application/pdf"||file.size>2*1024*1024||file.size<5){setError("Choose a PDF up to 2 MiB.");return}
  setSending(true);setError("");abort.current=new AbortController();
  const metadata={type:"agent_invoice",expectedVersionId:version?.id??null,name:file.name,size:file.size,mime:file.type,milestone,reference,date,gross:Number(gross),termsId:String(data.terms?.id),termsRevision:data.termsRevision};
  const key=JSON.stringify({...metadata,lastModified:file.lastModified});if(pending.current.key!==key)pending.current={key,id:crypto.randomUUID()};
  try{await api.workflow.upload(scope,pending.current.id,file,metadata,()=>{},abort.current.signal,new Map());if(alive.current){setFile(null);pending.current={key:"",id:""};onSaved(label(milestone)+" agent invoice uploaded.")}}catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setSending(false)}
 }
 async function view(id:string){
  const tab=window.open("about:blank","_blank");if(tab)tab.opener=null;
  try{const r=await api.workflow.document(scope,id);if(tab)tab.location.replace(r.url);else setError("Allow a new tab to view the invoice.")}catch(e){tab?.close();setError((e as Error).message)}
 }
 return <section className={s.card}><h2>{label(milestone)} agent invoice</h2>{error&&<div role="alert"><Notice>{error}</Notice></div>}
 {!eligible?<p>Available after {milestone==="completion"?"exchange":"reservation approval"}.</p>:!Number(data.terms?.[milestone+"_agent_fee_percent"])?<p>No agent fee configured for this milestone.</p>:<>
 {invoice&&<><p><strong>{invoice.invoice_reference}</strong> · {label(invoice.status)} · invoice total {money(invoice.gross_amount)}</p><p>Expected invoice {money(invoice.expected_gross_amount)} · Reservation fee held {money(invoice.reservation_fee_deduction)} · Agent contribution {money(invoice.agent_contribution_deduction)}</p><p>Expected cash payable {money(invoice.expected_payable_amount)} · Recorded payments {money(paid)} · Outstanding {money(Math.max(0,invoice.expected_payable_amount-paid))}</p>{doc?.query_note&&<Notice>{doc.query_note}</Notice>}
 {doc?.unit_sale_document_versions.filter(v=>!v.redacted_at).map(v=><button className={s.button} key={v.id} onClick={()=>void view(v.id)}>View {v.is_current?"current":"previous"} invoice · version {v.version_number}</button>)}</>}
 {canUpload&&<form onSubmit={e=>{e.preventDefault();void upload()}}><fieldset disabled={busy||sending} style={{border:0,padding:0}}>
 <div className={s.documentGrid}><label className={s.field}>Invoice reference<input required maxLength={160} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className={s.field}>Invoice date<input type="date" required max={today()} value={date} onChange={e=>setDate(e.target.value)}/></label><label className={s.field}>Invoice total including VAT (£)<input required type="number" min="0.01" step="0.01" value={gross} onChange={e=>setGross(e.target.value)}/></label></div>
 <PdfUploadBox id={"invoice-"+milestone} label={label(milestone)+" agent invoice PDF"} file={file} onFile={f=>{setFile(f);pending.current={key:"",id:""}}} onClear={()=>setFile(null)} helperText="PDF only, maximum 2 MiB" disabled={busy||sending}/>
 <button className={s.primary} disabled={!file}>{sending?"Uploading…":invoice?"Upload revised invoice":"Upload invoice"}</button></fieldset></form>}
 {dev&&invoice?.status==="uploaded"&&version&&<><label className={s.field}>Invoice query<textarea value={reason} maxLength={5000} onChange={e=>setReason(e.target.value)}/></label><div className={s.actions}><button className={s.primary} disabled={busy||sending} onClick={()=>void run({action:"approve_agent_invoice",milestone,versionId:version.id},"Invoice approved.")}>Approve invoice</button><button className={s.button} disabled={busy||sending||!reason.trim()} onClick={()=>void run({action:"query_agent_invoice",milestone,versionId:version.id,reason},"Invoice queried. A revised PDF is required.")}>Query invoice</button></div></>}
 {dev&&invoice&&["approved","part_paid","paid","reconciled"].includes(invoice.status)&&<details><summary>Record a payment</summary><form onSubmit={e=>{e.preventDefault();void run({action:"record_agent_payment",invoiceId:invoice.id,payer,amount:Number(amount),date:paymentDate,note},"Agent fee payment recorded.").then(ok=>{if(ok){setAmount("");setNote("")}})}}><fieldset disabled={busy} style={{border:0,padding:0}}><label className={s.field}>Payer<select value={payer} onChange={e=>setPayer(e.target.value)}>{["solicitor","developer","other"].map(p=><option key={p} value={p}>{label(p)}</option>)}</select></label><label className={s.field}>Payment amount (£)<input type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className={s.field}>Payment date<input type="date" required max={today()} value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label><label className={s.field}>Payment note<input value={note} onChange={e=>setNote(e.target.value)}/></label><button className={s.primary}>Record payment</button></fieldset></form></details>}
 {payments.map(p=><PaymentRow key={p.id} payment={p} dev={dev} busy={busy} run={run}/>)}
 </>}</section>;
}
function PaymentRow({payment:p,dev,busy,run}:{payment:Payment;dev:boolean;busy:boolean;run:Run}){
 const [reason,setReason]=useState("");
 return <article className={s.documentCard}><p>{money(p.amount)} · {label(p.payer_type)} · {p.paid_at?.slice(0,10)} · {p.voided_at?"Voided":"Recorded"}</p><p className={s.meta}>{p.recorded_by_name}{p.void_reason?" · "+p.void_reason:""}</p>{dev&&!p.voided_at&&<details><summary>Correct this payment</summary><p>Void the incorrect payment, then record its replacement. The original stays in history.</p><label className={s.field}>Reason for voiding<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className={s.button} disabled={busy||!reason.trim()} onClick={()=>void run({action:"void_agent_payment",paymentId:p.id,reason},"Payment voided. Its history is retained.")}>Void payment</button></details>}</article>;
}
function Corrections({data,section,dev,conveyancer,busy,run}:{data:Context;section:string;dev:boolean;conveyancer:boolean;busy:boolean;run:Run}){
 const a=data.sale!,[reason,setReason]=useState(""),[notice,setNotice]=useState(a.completion_notice_issued_at?.slice(0,10)||""),[due,setDue]=useState(a.contractual_completion_date?.slice(0,10)||""),[confirmed,setConfirmed]=useState(false);
 if(a.legal_completed_at)return null;
 const kind=section==="exchange"?"authority":"notice_authority",email=data.emails?.filter(e=>e.kind===kind&&!e.revoked_at&&!e.replaced_by).sort((x,y)=>y.version-x.version)[0];
 const cancel=dev&&email&&(section==="exchange"?!a.exchanged_at:section==="completion"&&!a.completion_arrangements_confirmed_at);
 const fall=dev&&section==="reservation"&&!a.exchanged_at,dates=conveyancer&&section==="completion"&&a.completion_arrangements_confirmed_at;
 if(!cancel&&!fall&&!dates)return null;
 return <section className={s.card}><details><summary>Corrections and exceptions</summary>
 {(cancel||fall)&&<label className={s.field}>Reason<textarea required maxLength={5000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
 {cancel&&<button className={s.button} disabled={busy||!reason.trim()} onClick={()=>void run({action:section==="exchange"?"revoke_authority":"cancel_notice_authority",emailId:email.id,reason},"Authority withdrawn. Its history is retained.")}>Withdraw {section==="exchange"?"exchange":"notice"} authority</button>}
 {fall&&<><p>Returning the unit for sale ends this test reservation, redacts its buyer contact details and creates a new sale attempt. Previous events are retained.</p><label className={s.field}><span><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> End this reservation and return the unit for sale.</span></label><button className={s.button} disabled={busy||!confirmed||!reason.trim()} onClick={()=>void run({action:"return_for_sale",reason},"Unit returned for sale. A new test attempt is ready.")}>Return unit for sale</button></>}
 {dates&&<form onSubmit={e=>{e.preventDefault();void run({action:"correct_completion_dates",noticeDate:notice,date:due,previousNoticeDate:a.completion_notice_issued_at,previousDate:a.contractual_completion_date},"Notice dates corrected. Previous dates are retained in Activity.")}}><label className={s.field}>Correct notice issue date<input type="date" required value={notice} onChange={e=>setNotice(e.target.value)}/></label><label className={s.field}>Correct contractual completion date<input type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label><button className={s.button} disabled={busy}>Save corrected dates</button></form>}
 </details></section>;
}
