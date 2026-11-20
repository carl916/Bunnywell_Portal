"use client";
import NoticeDateFields from './NoticeDateFields';
import {defaultNoticeTerms,noticeValidation,type NoticeInput,type NoticeTerms} from '@/lib/sales/notice-contract';
import {useCallback,useEffect,useRef,useState} from "react";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {ExchangeDepositReceipt} from "@/components/portal/sales/ExchangeDepositReceipt";
import {FurtherDepositCard,type DepositsContext} from "@/components/portal/sales/SaleDeposits";
import {FurtherDepositTimingFields} from "@/components/portal/sales/FurtherDepositTimingFields";
import type {FurtherDepositTiming} from "@/lib/sales/further-deposit";
import {PdfUploadBox} from "@/components/portal/sales/PdfUploadBox";
import {GbpInput} from '@/components/portal/sales/GbpInput';
import {invoiceFinancialSummary,type ExpectedInvoice,type InvoiceFinancials} from '@/lib/sales/agent-invoice-summary';
import InvoiceFinancialSummary from './InvoiceFinancialSummary';
import f from './AgentFees.module.css';
import corrections from './Corrections.module.css';
import {Notice,label,Badge} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
import {useRecordRead} from './useRecordRead';
import RecordReadStatus from './RecordReadStatus';
type Api=ReturnType<typeof reader>;
type Fields=Record<string,unknown>;
type Sale={completion_service_date?:string|null;completion_basis?:'on_notice'|'fixed_date'|null;id:string;is_active:boolean;workflow_status:string;reservation_approved_at:string|null;reservation_approved_by_user_id:string|null;exchanged_at:string|null;completed_at:string|null;legal_completed_at:string|null;completion_arrangements_confirmed_at:string|null;completion_notice_issued_at:string|null;contractual_completion_date:string|null};
type Invoice=InvoiceFinancials&{id:string;document_id:string;fee_milestone:string;invoice_reference:string;status:string;query_note:string|null};
type Version={id:string;is_current:boolean;redacted_at:string|null;file_name:string;version_number:number};
type Doc={id:string;status:string;query_note:string|null;unit_sale_document_versions:Version[]};
type Payment={id:string;invoice_id:string;amount:number;payer_type:string;payment_source?:string;paid_at:string;voided_at:string|null;void_reason:string|null;recorded_by_name:string};
type Context={noticeTerms?:NoticeTerms;termsRevision:string;enrolled:boolean;expectedInvoices?:Record<'exchange'|'completion',ExpectedInvoice|null>;deposits?:DepositsContext;sale?:Sale;terms:Fields|null;defaults?:Fields|null;invoices?:Invoice[];payments?:Payment[];documents?:Doc[];emails?:{id:string;kind:string;version:number;revoked_at:string|null;replaced_by:string|null}[]};
type Run=(body:Fields,message:string)=>Promise<boolean>;
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(new Date());
const money=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(n);
export default function ExtendedSales({api,scope,role,section,task,refresh,onSaved}:{api:Api;scope:RecordScope;role:string;section:string;task?:string;refresh:number;onSaved:(m:string)=>void}){
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now);
 const alive=useRef(true),pending=useRef({key:"",id:""}),inFlight=useRef(false);
 const {buildingId,unitId,saleId}=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{if(section!=='deposits')return;const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[section]);
 const read=useCallback((signal:AbortSignal)=>api.workflow.action({buildingId,unitId,saleId},{action:'extended_sales_context',section},signal) as Promise<Context>,[api,buildingId,unitId,saleId,section]);
 const record=useRecordRead([buildingId,unitId,saleId,role,section].join(':'),read,refresh),data=record.data;
 const run:Run=async(body,message)=>{
  if(inFlight.current||record.loading||record.error)return false;inFlight.current=true;setBusy(true);setError("");
  const {action,requestId,...payload}=body,key=JSON.stringify(body);
  if(pending.current.key!==key)pending.current={key,id:typeof requestId==="string"?requestId:crypto.randomUUID()};
  try{
   await api.workflow.action(scope,{action,requestId:pending.current.id,payload});
   if(alive.current){pending.current={key:"",id:""};onSaved(message);

   }return true;
  }catch(e){if(alive.current)setError((e as Error).message);return false}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 };
 if(!data)return <>{(error||record.error)&&<div role="alert"><Notice>{error||record.error} <button className={s.button} onClick={record.retry}>Retry</button></Notice></div>}</>;
 const dev=["admin","developer"].includes(role),active=data.sale?.is_active!==false;
 return <><RecordReadStatus compact={section==='agent-fees'} loading={record.loading} error={record.error} retry={record.retry}/>{error&&<div role="alert"><Notice>{error}</Notice></div>}
 {!data.enrolled&&<Notice>{section==="deposits"?"This integration sale is read-only. Its deposit position remains visible; receipt entry is available on enabled sales.":"This record is not enabled for integration changes."}</Notice>}
 {section==="deposits"&&data.deposits&&<section className={s.card}><h2>Deposit receipts</h2><p>{data.enrolled?"The appointed conveyancer can record actual test receipts beside the expected, received and outstanding amounts. Corrections retain their history.":"Recorded deposit position · reference only"}</p>
 {data.enrolled&&data.deposits.active&&data.deposits.receiptRestriction&&<Notice>{data.deposits.receiptRestriction}</Notice>}
 <ExchangeDepositReceipt deposit={data.deposits.exchange} exchanged={data.deposits.exchanged} editable={data.enrolled&&data.deposits.canRecord&&data.deposits.active} busy={busy} run={run}/>
 <FurtherDepositCard context={{...data.deposits,canRecord:data.enrolled&&data.deposits.canRecord,canAmendDeadline:data.enrolled&&data.deposits.canAmendDeadline}} now={now} busy={busy} run={run}/></section>}
 {section==="commercial"&&data.enrolled&&dev&&data.sale&&<CommercialForm key={data.termsRevision} data={data} busy={busy||record.loading||Boolean(record.error)} run={run} initiallyOpen={task==='amend'}/>}
 {section==="agent-fees"&&(["admin","developer","sales_agent"].includes(role))&&(["exchange","completion"] as const).map(milestone=><InvoiceCard key={milestone} api={api} scope={scope} data={data} milestone={milestone} dev={dev} busy={busy||record.loading||Boolean(record.error)} run={run} onSaved={onSaved}/>)}
 {data.enrolled&&["reservation","exchange","completion"].includes(section)&&data.sale&&active&&<Corrections key={saleId+':'+section} data={data} section={section} task={task} dev={dev} conveyancer={role==="conveyancer"} busy={busy||record.loading||Boolean(record.error)} run={run}/>}
 </>;
}
const commercialFields=[
 ["contractPrice","Agreed sale price (£)","contract_price"],["listPriceAtOffer","List price (£)","list_price_at_offer"],
 ["reservationFee","Reservation fee (£)","reservation_fee"],["developerContribution","Developer contribution","developer_contribution_value"],
 ["agentContribution","Agent contribution","agent_contribution_value"],["parkingValue","Parking value (£)","parking_value"],
 ["parkingContributionValue","Parking contribution (£)","parking_contribution_value"],["solicitorFee","Solicitor fee (£)","solicitor_fee"],
 ["agentFeePercent","Total agent fee (%)","agent_fee_percent"],["exchangeAgentFeePercent","Agent fee at exchange (%)","exchange_agent_fee_percent"],
 ["completionAgentFeePercent","Agent fee at completion (%)","completion_agent_fee_percent"],["exchangeDepositPercent","Exchange deposit (%)","exchange_deposit_percent"]
] as const;
function CommercialForm({data,busy,run,initiallyOpen}:{data:Context;busy:boolean;run:Run;initiallyOpen:boolean}){
 const t=data.terms||{},d=data.defaults||{};
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const initial:Fields={reservation_fee:d.reservation_fee,agent_fee_percent:d.default_agent_fee_percent,exchange_agent_fee_percent:d.default_exchange_agent_fee_percent,completion_agent_fee_percent:d.default_completion_agent_fee_percent,solicitor_fee:d.default_sales_solicitor_fee,exchange_deposit_percent:d.exchange_deposit_percent??10};
 const [form,setForm]=useState<Record<string,string>>(()=>Object.fromEntries(commercialFields.map(([key,,db])=>[key,String(t[db]??initial[db]??0)])));
 const [holder,setHolder]=useState(String(t.reservation_fee_holder??d.reservation_fee_holder_default??"sales_agent"));
 const [devType,setDevType]=useState(String(t.developer_contribution_value_type??"amount")),[agentType,setAgentType]=useState(String(t.agent_contribution_value_type??"amount"));
 const [second,setSecond]=useState(Boolean(t.second_deposit_enabled??d.second_deposit_enabled)),[percent,setPercent]=useState(String(t.second_deposit_percent??d.second_deposit_percent??0));
 const [months,setMonths]=useState(String(t.second_deposit_months_after_exchange??d.second_deposit_months_after_exchange??0)),[timing,setTiming]=useState<FurtherDepositTiming>((t.further_deposit_timing??d.further_deposit_timing??{basis:"after_exchange"}) as FurtherDepositTiming);
 const [parking,setParking]=useState(String(t.parking_location_details??"")),[conditions,setConditions]=useState((Array.isArray(t.additional_special_conditions)?t.additional_special_conditions:[]).join("\n")),[summary,setSummary]=useState(String(t.commercial_summary??""));
 const sale=data.sale,approved=Boolean(sale?.reservation_approved_at&&sale.reservation_approved_by_user_id&&['approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange'].includes(sale.workflow_status));
 if(!sale||!sale.is_active||sale.exchanged_at||sale.completed_at||sale.legal_completed_at||(!approved&&!['draft','rejected','reservation_query_raised'].includes(sale.workflow_status)))return <Notice>Commercial terms are locked at this stage. Their recorded versions are shown below.</Notice>;
 if(data.emails?.some(e=>e.kind==='authority'&&!e.revoked_at&&!e.replaced_by))return <Notice>These terms have been used for an authority to exchange. Withdraw that authority on the Exchange page before amending the terms. A fresh authority will then be required.</Notice>;
 return <section className={s.card}><details open={initiallyOpen}><summary>Amend commercial terms</summary><form onSubmit={e=>{e.preventDefault();void run({action:"save_commercial",reason,confirmed,termsId:t.id??null,termsRevision:data.termsRevision,commercial:{...form,reservationFeeHolder:holder,developerContributionValueType:devType,agentContributionValueType:agentType,secondDepositEnabled:second,secondDepositPercent:percent,secondDepositMonthsAfterExchange:months,furtherDepositTiming:timing,parkingLocationDetails:parking,additionalSpecialConditions:conditions.split("\n").map(x=>x.trim()).filter(Boolean),commercialSummary:summary}},approved?"Commercial terms amended. The previous version and amendment reason have been recorded.":"Commercial terms saved. The payment schedule and worklist have refreshed.")}}>
 <fieldset disabled={busy} className={s.commercialEditor}>
 {[
  ['Pricing and contributions',['contractPrice','listPriceAtOffer','parkingValue','parkingContributionValue','developerContribution','solicitorFee']],
  ['Agent commission',['agentFeePercent','exchangeAgentFeePercent','completionAgentFeePercent','agentContribution']],
  ['Buyer payment terms',['reservationFee','exchangeDepositPercent']]
 ].map(([title,keys])=><section className={s.formSection} key={String(title)}><h3>{title}</h3><div className={s.formGrid}>{commercialFields.filter(([key])=>(keys as string[]).includes(key)).map(([key,title])=><label className={s.field} key={key}>{title}{key.endsWith("Percent")||key==='developerContribution'&&devType==='percent'||key==='agentContribution'&&agentType==='percent'?<input type="number" min="0" step="0.01" required value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>:<GbpInput min={0} required value={form[key]} onChange={value=>setForm(f=>({...f,[key]:value}))}/>}</label>)}
 {title==='Pricing and contributions'&&<label className={s.field}>Developer contribution basis<select value={devType} onChange={e=>setDevType(e.target.value)}><option value="amount">Amount (£)</option><option value="percent">Percent (%)</option></select></label>}
 {title==='Agent commission'&&<label className={s.field}>Agent contribution basis<select value={agentType} onChange={e=>setAgentType(e.target.value)}><option value="amount">Amount (£)</option><option value="percent">Percent (%)</option></select></label>}
 {title==='Buyer payment terms'&&<><label className={s.field}>Reservation fee holder<select value={holder} onChange={e=>setHolder(e.target.value)}>{['sales_agent','developer','conveyancer','other'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label><label className={s.checkboxField}><input type="checkbox" checked={second} onChange={e=>setSecond(e.target.checked)}/> Further deposit required</label>{second&&<label className={s.field}>Further deposit (%)<input type="number" min="0" max="100" step="0.01" required value={percent} onChange={e=>setPercent(e.target.value)}/></label>}</>}
 </div>{title==='Buyer payment terms'&&second&&<div className={s.timingFields}><FurtherDepositTimingFields value={timing} months={months} onChange={setTiming} onMonths={setMonths}/></div>}</section>)}
 <section className={s.formSection}><h3>Additional conditions</h3><div className={s.formGrid}>
 <label className={s.field}>Parking allocation<input value={parking} onChange={e=>setParking(e.target.value)}/></label>
 <label className={s.field}>Special conditions (one per line)<textarea value={conditions} onChange={e=>setConditions(e.target.value)}/></label>
 <label className={s.field}>Commercial notes<textarea value={summary} onChange={e=>setSummary(e.target.value)}/></label>
 </div></section>
 {approved&&<section className={`${s.formSection} ${corrections.body}`}><h3>Record amendment</h3><p className={s.meta}>The previous terms and reservation documents will be preserved. Any future authority will use these amended terms.</p><label className={s.field}>Reason for amendment<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><label className={s.checkboxField}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I authorise this amendment to the approved reservation terms.</label></section>}
 <button className={s.primary} disabled={busy||approved&&(!reason.trim()||!confirmed)}>{busy?"Saving…":approved?"Save amendment":"Save commercial terms"}</button></fieldset></form></details></section>;
}
function InvoiceCard({api,scope,data,milestone,dev,busy,run,onSaved}:{api:Api;scope:RecordScope;data:Context;milestone:"exchange"|"completion";dev:boolean;busy:boolean;run:Run;onSaved:(m:string)=>void}){
 const invoice=data.invoices?.find(i=>i.fee_milestone===milestone),doc=data.documents?.find(d=>d.id===invoice?.document_id),version=doc?.unit_sale_document_versions.find(v=>v.is_current&&!v.redacted_at);
 const [file,setFile]=useState<File|null>(null),[reference,setReference]=useState(""),[date,setDate]=useState(today),[gross,setGross]=useState(""),[reason,setReason]=useState(""),[amount,setAmount]=useState(""),[payer,setPayer]=useState("solicitor"),[paymentDate,setPaymentDate]=useState(today),[note,setNote]=useState(""),[sending,setSending]=useState(false),[error,setError]=useState("");
 const pending=useRef({key:"",id:""}),abort=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort()}},[]);
 const payments=(data.payments||[]).filter(p=>p.invoice_id===invoice?.id);
 const expected=data.expectedInvoices?.[milestone],financial=invoiceFinancialSummary(expected,invoice,payments);
 const writable=data.enrolled&&data.sale?.is_active!==false;
 const [paymentOpen,setPaymentOpen]=useState(false);
 const canRecord=dev&&writable&&invoice&&['approved','part_paid','paid','reconciled'].includes(invoice.status)&&financial.position!==null&&financial.position.outstandingBalance>0;
 const eligible=milestone==="completion"?Boolean(data.sale?.exchanged_at):["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange","exchanged","completion_pending","completed"].includes(data.sale?.workflow_status||"");
 const canUpload=writable&&eligible&&(!invoice||invoice.status==="query_raised")&&Number(data.terms?.[milestone+"_agent_fee_percent"])>0;
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
 return <section className={f.invoice} aria-label={label(milestone)+' agent invoice'}>
 <header className={f.header}><div><h2>{label(milestone)} agent invoice</h2>{invoice&&<p className={f.reference}>Invoice reference: <strong>{invoice.invoice_reference}</strong></p>}</div><Badge>{invoice?(invoice.status==='uploaded'?'Awaiting review':label(invoice.status)):'Not uploaded'}</Badge></header>
 {error&&<div role="alert"><Notice>{error}</Notice></div>}
 <InvoiceFinancialSummary expected={expected} invoice={invoice} payments={payments} milestone={milestone}/>
 {!eligible&&<p className={f.readonly}>Invoice upload is available after {milestone==='completion'?'exchange':'reservation approval'}.</p>}
 {eligible&&Number(data.terms?.[milestone+'_agent_fee_percent'])===0&&<p className={f.readonly}>No agent fee configured for this milestone.</p>}
 {(doc?.query_note||invoice?.query_note)&&<Notice>{doc?.query_note||invoice?.query_note}</Notice>}
 {version&&<div className={f.actions}><button type="button" className={s.button} onClick={()=>void view(version.id)}>View current invoice PDF</button>{doc&&doc.unit_sale_document_versions.filter(v=>!v.is_current&&!v.redacted_at).length>0&&<details><summary>Previous versions</summary>{doc.unit_sale_document_versions.filter(v=>!v.is_current&&!v.redacted_at).map(v=><button type="button" className={s.button} key={v.id} onClick={()=>void view(v.id)}>View invoice · version {v.version_number}</button>)}</details>}</div>}
 {canUpload&&<form className={f.form} onSubmit={e=>{e.preventDefault();void upload()}}><fieldset disabled={busy||sending}>
 <div className={f.fields+' '+f.invoiceFields}><label className={s.field}>Invoice reference<input required maxLength={160} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className={s.field}>Invoice date<input type="date" required max={today()} value={date} onChange={e=>setDate(e.target.value)}/></label><label className={s.field}>Invoice total including VAT<GbpInput required min={0.01} value={gross} onChange={setGross}/></label></div>
 <PdfUploadBox id={'invoice-'+milestone} label={label(milestone)+' agent invoice PDF'} file={file} onFile={next=>{setFile(next);pending.current={key:'',id:''}}} onClear={()=>setFile(null)} helperText="PDF only, maximum 2 MiB" disabled={busy||sending}/>
 <div className={f.actions}><button className={s.primary} disabled={!file}>{sending?'Uploading…':invoice?'Upload revised invoice':'Upload invoice'}</button></div></fieldset></form>}
 {dev&&writable&&invoice?.status==='uploaded'&&version&&<div className={f.review}><label className={s.field}>Invoice query<textarea value={reason} maxLength={5000} onChange={e=>setReason(e.target.value)}/></label><div className={f.actions}><button className={s.primary} disabled={busy||sending} onClick={()=>void run({action:'approve_agent_invoice',milestone,versionId:version.id},'Invoice approved.')}>Approve invoice</button><button className={s.button} disabled={busy||sending||!reason.trim()} onClick={()=>void run({action:'query_agent_invoice',milestone,versionId:version.id,reason},'Invoice queried. A revised PDF is required.')}>Query invoice</button></div></div>}
 {canRecord&&<div className={f.payment}><div className={f.actions}><button type="button" className={s.primary} aria-expanded={paymentOpen} aria-controls={'payment-'+milestone} disabled={busy||sending} onClick={()=>setPaymentOpen(open=>!open)}>{paymentOpen?'Cancel payment':'Record payment'}</button></div>
 {paymentOpen&&<form id={'payment-'+milestone} className={f.form} onSubmit={e=>{e.preventDefault();void run({action:'record_agent_payment',invoiceId:invoice.id,payer,amount:Number(amount),date:paymentDate,note},'Agent fee payment recorded.').then(ok=>{if(ok){setAmount('');setNote('');setPaymentOpen(false)}})}}><fieldset disabled={busy}><div className={f.fields}>
 <label className={s.field}>Payer<select value={payer} onChange={e=>setPayer(e.target.value)}>{['solicitor','developer','other'].map(p=><option key={p} value={p}>{label(p)}</option>)}</select></label>
 <label className={s.field}>Payment amount<GbpInput min={0.01} max={financial.position!.outstandingBalance} required value={amount} onChange={setAmount}/></label>
 <label className={s.field}>Payment date<input type="date" required max={today()} value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label><label className={s.field}>Payment note<input value={note} onChange={e=>setNote(e.target.value)}/></label></div>
 <div className={f.actions}><button className={s.primary} disabled={busy||!amount||Number(amount)<=0||Number(amount)>financial.position!.outstandingBalance}>{busy?'Saving…':'Save payment'}</button></div></fieldset></form>}</div>}
 {invoice&&financial.position?.outstandingBalance===0&&['approved','part_paid','paid','reconciled'].includes(invoice.status)&&<p className={f.readonly}>No outstanding payment.</p>}
 {payments.length>0&&<details className={f.history}><summary>Payment history · {payments.length} {payments.length===1?'record':'records'}</summary><div>{payments.map(p=><PaymentRow key={p.id} payment={p} dev={dev&&writable} busy={busy} run={run}/>)}</div></details>}
 </section>;
}

function PaymentRow({payment:p,dev,busy,run}:{payment:Payment;dev:boolean;busy:boolean;run:Run}){
 const [reason,setReason]=useState("");
 return <article className={f.paymentRow}><p>{money(p.amount)} · {label(p.payer_type)} · {p.paid_at?.slice(0,10)} · {p.voided_at?"Voided":"Recorded"}</p><p className={s.meta}>{p.recorded_by_name}{p.void_reason?" · "+p.void_reason:""}</p>{dev&&!p.voided_at&&<details><summary>Correct this payment</summary><p>Void the incorrect payment, then record its replacement. The original stays in history.</p><label className={s.field}>Reason for voiding<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className={s.button} disabled={busy||!reason.trim()} onClick={()=>void run({action:"void_agent_payment",paymentId:p.id,reason},"Payment voided. Its history is retained.")}>Void payment</button></details>}</article>;
}
function Corrections({data,section,task,dev,conveyancer,busy,run}:{data:Context;section:string;task?:string;dev:boolean;conveyancer:boolean;busy:boolean;run:Run}){
 const a=data.sale!,[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [noticeInput,setNoticeInput]=useState<NoticeInput>({noticeDate:a.completion_notice_issued_at?.slice(0,10)||'',serviceDate:a.completion_service_date||'',dueDate:a.contractual_completion_date?.slice(0,10)||'',basis:a.completion_basis||'on_notice',reason:'',serviceConfirmed:false});
 if(a.completed_at||a.legal_completed_at||a.workflow_status==="completed")return null;
 const kind=section==="exchange"?"authority":"notice_authority",email=data.emails?.filter(e=>e.kind===kind&&!e.revoked_at&&!e.replaced_by).sort((x,y)=>y.version-x.version)[0];
 const cancel=dev&&email&&(section==="exchange"?!a.exchanged_at:section==="completion"&&task==="authority"&&!a.completion_arrangements_confirmed_at);
 const fall=dev&&section==="reservation"&&Boolean(a.reservation_approved_at&&a.reservation_approved_by_user_id)&&["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange"].includes(a.workflow_status)&&!a.exchanged_at,dates=conveyancer&&section==="completion"&&task==="notice"&&a.completion_arrangements_confirmed_at;
 if(!cancel&&!fall&&!dates)return null;
 return <section className={s.card}><details className={corrections.disclosure}><summary>Corrections and exceptions</summary><div className={corrections.body}>
 {(cancel||fall)&&<label className={s.field}>Reason<textarea required maxLength={5000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
 {cancel&&<button className={s.button} disabled={busy||!reason.trim()} onClick={()=>void run({action:section==="exchange"?"revoke_authority":"cancel_notice_authority",emailId:email.id,reason},"Authority withdrawn. Its history is retained.")}>Withdraw {section==="exchange"?"exchange":"notice"} authority</button>}
 {fall&&<><p>Returning the unit for sale ends the current sale attempt, redacts its buyer contact details and creates a new sale attempt. Previous events are retained.</p><label className={corrections.confirmation}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>End this reservation and return the unit for sale.</span></label><button className={s.button} disabled={busy||!confirmed||!reason.trim()} onClick={()=>{if(window.confirm("Return this unit for sale? The current sale attempt will be ended and a new sale attempt created. Buyer contact details and active documents will be redacted; audit history will be retained."))void run({action:"return_for_sale",reason,confirmed:true},"Unit returned for sale. A new sale attempt is ready.")}}>{busy?"Returning unit…":"Return unit for sale"}</button></>}
 {dates&&<form onSubmit={e=>{e.preventDefault();void run({action:'correct_completion_dates',...noticeInput,date:noticeInput.dueDate,previousNoticeDate:a.completion_notice_issued_at,previousDate:a.contractual_completion_date},'Notice dates corrected. Previous dates and reason are retained in Activity.')}}><NoticeDateFields value={noticeInput} onChange={setNoticeInput} terms={data.noticeTerms||defaultNoticeTerms} disabled={busy}/><button className={s.button} disabled={busy||!noticeInput.reason.trim()||Boolean(noticeValidation(noticeInput,data.noticeTerms||defaultNoticeTerms))}>Save corrected dates</button></form>}
 </div></details></section>;
}
