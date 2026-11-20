"use client";
import SaleStepGuidance from "./SaleStepGuidance";
import ExtendedSales from "./ExtendedSales";

import {canPerformSalesAction} from "@/lib/sales/permissions";
import CoreSales,{type CoreSaleContext} from "./CoreSales";
import {RecordGrid,missingValue} from "./ProgressionRecord";
import p from "./Progression.module.css";
import {useCallback,useEffect,useRef,useState} from "react";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {SaleRow,Scope} from "@/lib/experiments/building-contracts/contracts";
import type {SaleDetails as Details,SaleDetailsReader} from "@/lib/workspace/sale-details-types";
import {Heading,Notice,Badge,date,label,LocalLink,saleValues} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
import {RecordFields,SupportingInformation} from './RecordInformation';
import {useRecordRead} from './useRecordRead';
import RecordReadStatus from './RecordReadStatus';

export default function SaleDetails({api,scope,row,section,task,refresh=0,coreWritable=false,onSaved}:{api:ReturnType<typeof reader>&SaleDetailsReader;scope:Scope;row:SaleRow;section:string;task?:string;refresh?:number;coreWritable?:boolean;onSaved:(message:string)=>void}){
 const key=[scope.identity,scope.role,scope.accessRevision,row.buildingId,row.unitId,row.saleId,section].join(":"),alive=useRef(true);
 const [fileError,setFileError]=useState("");
 const read=useCallback((signal:AbortSignal)=>api.details!(scope,row.unitId,row.saleId!,section,signal),[api,scope,row.unitId,row.saleId,section]);
 const current=useRecordRead<Details>(key,read,refresh);
 const {buildingId,unitId,saleId}=row;
 const readCore=useCallback((signal:AbortSignal)=>section==='reservation'&&coreWritable?api.workflow.action({buildingId,unitId,saleId:saleId!},{action:'core_context'},signal) as Promise<CoreSaleContext>:Promise.resolve(null),[api,buildingId,unitId,saleId,section,coreWritable]);
 const core=useRecordRead(key,readCore,refresh);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 async function view(version:string){
  const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;
  try{const result=await api.workflow.document({buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!},version);if(popup)popup.location.replace(result.url);else if(alive.current)setFileError("Allow a new tab to view the document.");}
  catch(e){popup?.close();if(alive.current)setFileError((e as Error).message);}
 }
 if(current.error&&!current.data)return <><Heading title="Sale details unavailable"/><Notice>{current.error} <button className={s.button} onClick={current.retry}>Retry</button></Notice></>;
 if(!current?.data)return <><Heading eyebrow={"Progression / "+label(section)} title={label(section)}/><p className={s.meta} role="status">Loading sale record…</p></>;
 const data=current.data;
 if(section==='reservation'){
  const reservation=data.groups.find(g=>g.id==='reservation'),completed=row.progression?.stages.completion==='complete';
  const fields=data.groups.find(g=>g.id==='record')?.fields||[],field=(name:string)=>fields.find(([label])=>name===label)?.[1];
  const reservationField=(name:string)=>reservation?.fields.find(([label])=>name===label)?.[1];
  const sale=core.data?.sale,editing=coreWritable&&canPerformSalesAction(scope.role,'submit_reservation')&&sale?.workflow_status==='draft';
  const terms=data.groups.find(g=>g.title.startsWith('Current terms'));
  const approval=reservation?.fields.filter(([name,value])=>['Approved','Approved by'].includes(name)&&!missingValue(value))||[];
  return <><Heading eyebrow="Progression / Reservation" title="Reservation"/><RecordReadStatus compact loading={current.loading||core.loading} error={current.error||core.error} retry={()=>{current.retry();core.retry()}}/>
   <SaleStepGuidance row={row} role={scope.role} section="reservation"/>
   <div className={s.actions}><LocalLink className={s.button} values={{...saleValues(row),section:'commercial'}}>View commercial terms</LocalLink>{coreWritable&&!data.historical&&['admin','developer'].includes(scope.role)&&sale&&!sale.exchanged_at&&!sale.completed_at&&!sale.legal_completed_at&&(['draft','rejected','reservation_query_raised'].includes(sale.workflow_status)||Boolean(sale.reservation_approved_at&&sale.reservation_approved_by_user_id)&&['approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange'].includes(sale.workflow_status))&&<LocalLink className={s.button} values={{...saleValues(row),section:'commercial',task:'amend'}}>Amend commercial terms</LocalLink>}</div>{data.historical&&<Notice>Previous reservation · recorded information is preserved.</Notice>}
   {!editing&&<section className={p.record} aria-label="Reservation record"><div className={p.recordHeader}><h2>Reservation record</h2><Badge>{label(sale?.workflow_status||field('Status')||'Recorded')}</Badge></div>
    <RecordGrid fields={[[sale?"Buyer name · current":"Buyer · current",sale?sale.buyer_person_name:field('Buyer')],["Buyer company · current",sale?.buyer_company_name],["Buyer email · current",reservationField('Buyer email')],["Buyer phone · current",reservationField('Buyer phone')],["Buyer solicitor · current",reservationField('Buyer solicitor')],["Reservation date",field('Reservation date')]]}/>
    <RecordGrid fields={['Submitted','Submitted by','Approved','Approved by'].map(name=>[name,reservationField(name)] as const)}/>
    <p className={p.meta}>Buyer and contact details are the current saved details for this sale attempt.</p>
    {terms&&<><h3>{terms.title}</h3><RecordGrid fields={terms.fields.filter(([name])=>['Contract price','Reservation fee','Fee holder','Exchange deposit'].includes(name))}/><p className={p.meta}>Current recorded terms; not a snapshot of the original reservation.</p></>}
    {reservation?.fields.filter(([name,value])=>['Rejected','Rejection reason'].includes(name)&&!missingValue(value)).map(([name,value])=><p key={name}>{name}: {value}</p>)}
   </section>}
   {data.documents.length?data.documents.map(document=><section className={`${s.documentCard} ${p.document}`} key={document.id} aria-label="Reservation form"><div className={s.cardHeading}><h2>Reservation form</h2><Badge>{label(document.status)}</Badge></div>
    {document.query_note&&<p className={s.queryNote}>{document.query_note}</p>}
    {document.unit_sale_document_versions.filter(v=>v.is_current&&!v.redacted_at).map(v=><p key={v.id}>{v.file_name} · version {v.version_number} <button className={s.button} onClick={()=>void view(v.id)}>View reservation form</button></p>)}
    {approval.length>0&&<p className={s.meta}>{approval.map(([name,value])=>`${name} ${value}`).join(' · ')}</p>}
    <details className={s.historyDisclosure}><summary>Versions & submission details</summary>{document.unit_sale_document_versions.filter(v=>!v.redacted_at).sort((a,b)=>b.version_number-a.version_number).map(v=><p key={v.id}><button className={s.button} onClick={()=>void view(v.id)}>View {v.is_current?'current':'previous'} version {v.version_number}</button> · {date(v.uploaded_at)}</p>)}{reservation?.fields.filter(([name,value])=>['Submitted','Submitted by','Rejected','Rejection reason'].includes(name)&&value!=='Not recorded').map(([name,value])=><p className={s.meta} key={name}>{name}: {value}</p>)}</details>
   </section>):!editing&&(!coreWritable||!core.loading)&&<p className={s.meta}>{completed||data.historical?'No stored reservation form.':'No reservation form uploaded.'}</p>}
   {coreWritable&&core.data&&<><CoreSales documentPresented context={core.data} contextUnavailable={core.loading||Boolean(core.error)} api={api} scope={{buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}} role={scope.role} section="reservation" refresh={refresh} onSaved={onSaved}/><ExtendedSales api={api} scope={{buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}} role={scope.role} section="reservation" refresh={refresh} onSaved={onSaved}/></>}
   {fileError&&<Notice>{fileError}</Notice>}
  </>;
 }
 const primary=data.groups.filter(g=>g.id===section||g.id==='fall-through'||section==='reservation'&&g.id==='record'||section==='handover'&&g.id!=='record');
 const supporting=data.groups.filter(g=>!primary.includes(g));
 return <><Heading eyebrow={(section==='deposits'||section==='agent-fees'?'Financials':section==='commercial'?'Commercial':'Progression')+" / "+data.title} title={data.title}/>
  <RecordReadStatus compact={section==='agent-fees'} loading={current.loading} error={current.error} retry={current.retry}/>
  {data.historical&&<Notice>This is a historical sale attempt. Its dates, amounts and statuses are preserved.</Notice>}
  {primary.map(g=><RecordFields key={g.id} group={g} compact/>)}
  {data.commercial&&<section aria-label="Commercial model"><div className={s.cardHeading}><h2>Current commercial terms · version {data.commercial.version}</h2><Badge>{label(data.commercial.status)}</Badge></div><div className={s.commercialGrid}>{data.commercial.groups.map(group=><section className={s.card} key={group.id}><h2>{group.title}</h2><dl className={s.keyValues}>{group.fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section>)}</div>{data.commercial.notes.map(note=><p className={s.meta} key={note}>{note}</p>)}</section>}
  {coreWritable&&["reservation","exchange"].includes(section)&&<CoreSales key={'core:'+section+":"+row.saleId} api={api} scope={{buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}} role={scope.role} section={section} task={task} refresh={refresh} onSaved={onSaved}/>}
  {coreWritable&&["reservation","exchange","commercial","agent-fees","deposits"].includes(section)&&(section!=="commercial"||["admin","developer"].includes(scope.role))&&<ExtendedSales key={'extended:'+section+":"+row.saleId} api={api} scope={{buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}} role={scope.role} section={section} task={task} refresh={refresh} onSaved={onSaved}/>}

  {data.notices.filter(n=>!(coreWritable&&section==='agent-fees'&&n==='No invoices are recorded for this sale attempt.')).map(n=><Notice key={n}>{n}</Notice>)}
  {fileError&&<div role="alert"><Notice>{fileError}</Notice></div>}
  {!(coreWritable&&section==='agent-fees')&&data.documents.map(d=><section className={s.documentCard} key={d.id}><div className={s.cardHeading}><h2>{d.title||label(d.document_type)}</h2><Badge>{label(d.status)}</Badge></div>{d.query_note&&<p className={s.queryNote}>{d.query_note}</p>}
   {d.unit_sale_document_versions.filter(v=>v.is_current&&!v.redacted_at).map(v=><p key={v.id}>{v.file_name} · version {v.version_number}{['reservation_form','agent_invoice'].includes(d.document_type)&&<> <button className={s.button} onClick={()=>void view(v.id)}>View current PDF</button></>}</p>)}
   {d.approved_at&&<p className={s.meta}>Approved {date(d.approved_at)} · applies to the recorded approved version</p>}
   <details className={s.historyDisclosure}><summary>Recorded document versions</summary>{[...d.unit_sale_document_versions].filter(v=>!v.redacted_at).sort((a,b)=>b.version_number-a.version_number).map(v=><article key={v.id}><p><strong>{v.is_current?"Current":"Previous"} · version {v.version_number}</strong> · {v.file_name} · {date(v.uploaded_at)}{d.approved_version_id===v.id?" · Approved version":""}</p><button className={s.button} disabled={!["completion_statement","draft_statement_of_account","completion_correspondence","reservation_form","agent_invoice"].includes(d.document_type)} title="Open the authorised private document version" onClick={()=>void view(v.id)}>View version {v.version_number}</button></article>)}</details>
  </section>)}
  {(supporting.length>0||data.attempts.length>1)&&<SupportingInformation>{data.attempts.length>1&&<section className={s.recordInformation}><h2>Sale attempts for this unit</h2><div className={s.actions}>{[...data.attempts].sort((a,b)=>b.attempt_number-a.attempt_number).map(a=><LocalLink key={a.id} className={s.button} values={{...saleValues(row),sale:a.id,section:'reservation'}}>Attempt {a.attempt_number} · {label(a.workflow_status)}{a.is_active?' · current':' · historical'}</LocalLink>)}</div></section>}{supporting.map(g=><RecordFields key={g.id} group={g}/>)}</SupportingInformation>}
  {!coreWritable&&<Notice>Recorded details are connected. Business actions remain disabled in this integration review.</Notice>}
 </>;
}
