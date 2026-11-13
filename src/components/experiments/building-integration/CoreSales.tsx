"use client";
import {useEffect,useRef,useState} from "react";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {PdfUploadBox} from "@/components/portal/sales/PdfUploadBox";
import {canPerformSalesAction} from "@/lib/sales/permissions";
import {Notice,date} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
type Version={id:string;is_current:boolean;redacted_at:string|null;file_name:string};
type Document={id:string;document_type:string;status:string;approved_version_id:string|null;unit_sale_document_versions:Version[]};
type Sale={id:string;is_active:boolean;workflow_status:string;updated_at:string;buyer_person_name:string|null;buyer_company_name:string|null;buyer_email:string|null;buyer_phone:string|null;buyer_solicitor_name:string|null;reservation_date:string|null;reservation_terms_checked:boolean;exchanged_at:string|null;legal_completed_at:string|null;authority_requested_at:string|null;completion_authority_requested_at:string|null;completion_authority_given_at:string|null;completion_arrangements_confirmed_at:string|null};
type Context={asOf:string;sale:Sale;documents:Document[];emails:{id:string;kind:string;version:number;delivery_status:string;sent_at:string|null;expires_at:string|null;revoked_at:string|null;replaced_by:string|null}[]};
type Preview={kind:string;date:string|null;token:string;email:{body:string;subject:string};snapshot:unknown};
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(new Date());
const fields=[["buyerPersonName","Buyer name","buyer_person_name"],["buyerCompanyName","Buyer company (optional)","buyer_company_name"],["buyerEmail","Buyer email","buyer_email"],["buyerPhone","Buyer phone","buyer_phone"],["buyerSolicitorName","Buyer solicitor","buyer_solicitor_name"],["reservationDate","Reservation date","reservation_date"]] as const;
function AuthorityCapture({kind,busy,preview,confirmed,onConfirmed,onPreview,onCapture,onCancel}:{kind:string;busy:boolean;preview:Preview|null;confirmed:boolean;onConfirmed:(v:boolean)=>void;onPreview:()=>void;onCapture:()=>void;onCancel:()=>void}){
 return <><Notice>Test capture only. Available for designated fictional integration journeys. No email is sent.</Notice><button className={s.primary} disabled={busy} onClick={onPreview}>Review {kind==="authority"?"exchange authority":"authority to serve notice"}</button>{preview?.kind===kind&&<div className={s.notice}><h3>{preview.email.subject}</h3><pre style={{whiteSpace:"pre-wrap",font:"inherit",maxHeight:360,overflow:"auto"}}>{preview.email.body}</pre><label className={s.field}><span><input type="checkbox" checked={confirmed} onChange={e=>onConfirmed(e.target.checked)}/> I reviewed this test authority and its terms.</span></label><div className={s.actions}><button className={s.primary} disabled={busy||!confirmed} onClick={onCapture}>Capture test authority</button><button className={s.button} disabled={busy} onClick={onCancel}>Cancel preview</button></div></div>}</>;
}

export default function CoreSales({api,scope,role,section,refresh,onSaved}:{api:ReturnType<typeof reader>;scope:RecordScope;role:string;section:string;refresh:number;onSaved:(m:string)=>void}){
 const [data,setData]=useState<Context>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[form,setForm]=useState<Record<string,string>>({}),[checked,setChecked]=useState(false),[reason,setReason]=useState(""),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[exchangeDate,setExchangeDate]=useState(today),[noticeDate,setNoticeDate]=useState(today),[dueDate,setDueDate]=useState(today),[legalTime,setLegalTime]=useState(""),[confirmed,setConfirmed]=useState(false);
 const {buildingId,unitId,saleId}=scope;
 const dirty=useRef(false),alive=useRef(true),pending=useRef({key:"",id:""}),uploadId=useRef(""),uploadAbort=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;uploadAbort.current?.abort()}},[]);
 useEffect(()=>{const c=new AbortController();api.workflow.action({buildingId,unitId,saleId},{action:"core_context"},c.signal).then(value=>{if(c.signal.aborted)return;const next=value as Context;setData(next);if(!dirty.current){setForm(Object.fromEntries(fields.map(([key,,db])=>[key,String(next.sale[db]||"")])));setChecked(next.sale.reservation_terms_checked);}setError("")}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[api,buildingId,unitId,saleId,refresh]); // Scope fields identify the record; the object itself is recreated by the parent.
 async function run(action:string,value:Record<string,unknown>={},message="Sale saved. Worklists refreshed."){
  if(busy)return;setBusy(true);setError("");
  const key=JSON.stringify({action,...value});if(pending.current.key!==key)pending.current={key,id:crypto.randomUUID()};
  try{const result=await api.workflow.action(scope,{action,requestId:pending.current.id,...value});if(!alive.current)return;if(action==="preview_capture"){setPreview(result as Preview);setConfirmed(false)}else{if(action==="save_reservation_draft"||action==="save_reservation")dirty.current=false;pending.current={key:"",id:""};setPreview(null);setReason("");setConfirmed(false);onSaved(message)}}
  catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
 }
 function selectFile(next:File|null){if(next&&(next.type!=="application/pdf"||!next.name.toLowerCase().endsWith(".pdf")||next.size>2*1024*1024||next.size<5)){setError("Choose a PDF up to 2 MiB.");return;}setError("");setFile(next);uploadId.current=crypto.randomUUID();}
 const document=(type:string)=>data?.documents.find(d=>d.document_type===type);
 const version=(type:string)=>document(type)?.unit_sale_document_versions.find(v=>v.is_current&&!v.redacted_at);
 async function upload(type:string){
  if(!file||busy)return;setBusy(true);setError("");uploadAbort.current=new AbortController();
  try{const metadata={type,name:file.name,size:file.size,mime:file.type,expectedVersionId:version(type)?.id||null,noticeDate,dueDate};await api.workflow.upload(scope,uploadId.current,file,metadata,()=>{},uploadAbort.current.signal,new Map());if(alive.current){setFile(null);onSaved(type==="reservation_form"?"Reservation PDF saved.":"Notice and completion arrangements saved.")}}
  catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
 }
 async function view(id:string){const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;try{const result=await api.workflow.document(scope,id);if(popup)popup.location.replace(result.url);else setError("Allow a new tab to view the PDF.")}catch(e){popup?.close();if(alive.current)setError((e as Error).message)}}
 const errorBox=error&&<div role="alert"><Notice>{error}</Notice></div>;
 if(!data)return <section className={s.card}><h2>Sales actions</h2>{errorBox||<p>Loading authorised actions…</p>}</section>;
 const a=data.sale,active=a.is_active&&!a.legal_completed_at&&a.workflow_status!=="completed";
 if(!active)return null;
 const editing=["draft","rejected","reservation_query_raised"].includes(a.workflow_status)&&!a.exchanged_at,reviewing=["awaiting_approval","reservation_submitted"].includes(a.workflow_status);
 const formCurrent=version("reservation_form"),notice=version("completion_correspondence");
 const approved=data.documents.filter(d=>["completion_statement","draft_statement_of_account"].includes(d.document_type)&&d.status==="approved"&&d.unit_sale_document_versions.some(v=>v.id===d.approved_version_id&&v.is_current&&!v.redacted_at)).length===2;
 const authority=data.emails.filter(e=>e.kind==="authority").sort((x,y)=>y.version-x.version)[0];
 const authorityReady=authority&&!authority.revoked_at&&!authority.replaced_by&&authority.expires_at&&new Date(authority.expires_at).getTime()>new Date(data.asOf).getTime()&&(authority.sent_at||authority.delivery_status==="captured_test");

 return <section className={s.card} aria-label="Connected Sales actions"><h2>{section==="reservation"?"Reservation actions":section==="exchange"?"Exchange actions":"Completion actions"}</h2>{errorBox}
 {section==="reservation"&&editing&&canPerformSalesAction(role,"submit_reservation")&&<>
  <div className={s.documentGrid}>{fields.map(([key,title])=><label className={s.field} key={key}>{title}<input type={key==="reservationDate"?"date":key==="buyerEmail"?"email":"text"} maxLength={5000} value={form[key]||""} disabled={busy} onChange={e=>{dirty.current=true;setForm(v=>({...v,[key]:e.target.value}))}}/></label>)}</div>
  <label className={s.field}><span><input type="checkbox" disabled={busy} checked={checked} onChange={e=>{dirty.current=true;setChecked(e.target.checked)}}/> I checked the recorded commercial terms for this reservation.</span></label>
  <PdfUploadBox id={"reservation-"+scope.saleId} label="Reservation form PDF" file={file} disabled={busy} onFile={selectFile} onClear={()=>selectFile(null)} helperText="PDF only, maximum 2 MiB" emptyPrompt={formCurrent?"Choose a revised reservation PDF":"Choose the reservation PDF"}/>
  {file&&<button className={s.button} disabled={busy} onClick={()=>void upload("reservation_form")}>{busy?"Saving PDF…":"Save reservation PDF"}</button>}
  {formCurrent&&<p className={s.meta}>Current PDF: {formCurrent.file_name}</p>}
  <div className={s.actions}><button className={s.button} disabled={busy} onClick={()=>void run("save_reservation_draft",{expected:a.updated_at,payload:{...form,reservationTermsChecked:checked}})}>Save draft</button><button className={s.primary} disabled={busy||!formCurrent||!checked} onClick={()=>void run("save_reservation",{expected:a.updated_at,payload:{...form,reservationTermsChecked:checked,versionId:formCurrent?.id}})}>Submit reservation</button></div>
 </>}
 {section==="reservation"&&reviewing&&canPerformSalesAction(role,"approve_reservation")&&<>
  <p>Review the buyer details, recorded terms and current reservation PDF before deciding.</p>
  {formCurrent&&<button className={s.button} onClick={()=>void view(formCurrent.id)}>View reservation PDF</button>}
  <label className={s.field}>Review reason (required for query or rejection)<textarea value={reason} disabled={busy} maxLength={5000} onChange={e=>setReason(e.target.value)}/></label>
  <div className={s.actions}>{[["approve_reservation","Approve reservation"],["query_reservation","Query reservation"],["reject_reservation","Reject reservation"]].map(([action,title])=><button className={action==="approve_reservation"?s.primary:s.button} key={action} disabled={busy||!formCurrent||(action!=="approve_reservation"&&!reason.trim())} onClick={()=>void run(action,{expected:a.updated_at,payload:{versionId:formCurrent?.id,reason}})}>{title}</button>)}</div>
 </>}
 {section==="exchange"&&!a.exchanged_at&&<>
  {editing&&<Notice>Submit and approve the reservation before reviewing exchange authority.</Notice>}
  {canPerformSalesAction(role,"request_exchange_approval")&&<button className={s.button} disabled={busy||!["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange"].includes(a.workflow_status)} onClick={()=>void run("request_authority")}>Request exchange authority</button>}
  {canPerformSalesAction(role,"approve_exchange")&&["approved","reservation_approved","awaiting_commercial_approval","ready_for_exchange"].includes(a.workflow_status)&&<AuthorityCapture kind="authority" busy={busy} preview={preview} confirmed={confirmed} onConfirmed={setConfirmed} onPreview={()=>void run("preview_capture",{kind:"authority"})} onCapture={()=>void run("capture_authority",{preview},"Test authority captured. No external delivery.")} onCancel={()=>setPreview(null)}/>}
  {authority&&<p>Latest authority: {authority.delivery_status==="captured_test"?"Test captured · no external delivery":authority.delivery_status} · expiry {date(authority.expires_at)}</p>}
  {canPerformSalesAction(role,"record_exchange")&&<><label className={s.field}>Actual exchange date<input type="date" value={exchangeDate} disabled={busy} onChange={e=>setExchangeDate(e.target.value)}/></label><button className={s.primary} disabled={busy||!authorityReady||!exchangeDate} onClick={()=>void run("confirm_exchange",{date:exchangeDate},"Exchange recorded. Worklists refreshed.")}>Confirm exchange</button></>}
 </>}
 {section==="completion"&&a.exchanged_at&&<>
  {!a.completion_authority_given_at&&<>{canPerformSalesAction(role,"request_exchange_approval")&&<button className={s.button} disabled={busy} onClick={()=>void run("request_notice_authority")}>Request authority to serve notice</button>}{canPerformSalesAction(role,"approve_exchange")&&<AuthorityCapture kind="notice_authority" busy={busy} preview={preview} confirmed={confirmed} onConfirmed={setConfirmed} onPreview={()=>void run("preview_capture",{kind:"notice_authority"})} onCapture={()=>void run("capture_authority",{preview},"Test authority captured. No external delivery.")} onCancel={()=>setPreview(null)}/>}</>}
  {a.completion_authority_given_at&&canPerformSalesAction(role,"confirm_completion_arrangements")&&<>
   <div className={s.documentGrid}><label className={s.field}>Notice issue date<input type="date" value={noticeDate} disabled={busy} onChange={e=>setNoticeDate(e.target.value)}/></label><label className={s.field}>Contractual completion date<input type="date" value={dueDate} disabled={busy} onChange={e=>setDueDate(e.target.value)}/></label></div>
   <PdfUploadBox id={"notice-"+scope.saleId} label="Notice PDF" file={file} disabled={busy} onFile={selectFile} onClear={()=>selectFile(null)} helperText="PDF only, maximum 2 MiB"/>
   <button className={s.primary} disabled={busy||!file||!noticeDate||!dueDate} onClick={()=>void upload("completion_correspondence")}>{a.completion_arrangements_confirmed_at?"Replace notice PDF":"Confirm notice and arrangements"}</button>
  </>}
  {notice&&<button className={s.button} onClick={()=>void view(notice.id)}>View notice PDF</button>}
  {canPerformSalesAction(role,"record_completion")&&<><label className={s.field}>Actual legal completion date and time<input type="datetime-local" value={legalTime} disabled={busy||!approved} onChange={e=>setLegalTime(e.target.value)}/></label><label className={s.field}><span><input type="checkbox" checked={confirmed} disabled={busy||!approved} onChange={e=>setConfirmed(e.target.checked)}/> Confirm legal completion for this sale.</span></label><button className={s.primary} disabled={busy||!approved||!confirmed||!legalTime} onClick={()=>void run("confirm_completion",{dateTime:new Date(legalTime).toISOString()},"Legal completion recorded. Worklists refreshed.")}>Record legal completion</button><p className={s.meta}>Both current documents must be approved. Handover finalisation is separate and remains unavailable.</p></>}
 </>}
 {section==="reservation"&&!editing&&!reviewing&&<p>The reservation is {a.workflow_status.replaceAll("_"," ")}. Continue through Exchange when ready.</p>}
 {section==="exchange"&&a.exchanged_at&&<p>Exchange recorded {date(a.exchanged_at)}. Continue to Completion arrangements.</p>}
 </section>;
}