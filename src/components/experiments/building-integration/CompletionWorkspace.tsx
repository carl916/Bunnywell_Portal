"use client";
import {Activity,useCallback,useState,type ReactNode} from "react";
import ProgressionSteps,{type ProgressionStep} from "./ProgressionSteps";
import {AuthorityRecord,Milestone,RecordGrid,latestEvent,eventFields,recordTime} from "./ProgressionRecord";
import {useProgressionHistory} from "./useProgressionHistory";
import p from "./Progression.module.css";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {SaleRow,Scope} from "@/lib/experiments/building-contracts/contracts";
import {completionDocumentApproved,completionDocumentsApproved,currentCompletionVersion,completionDocumentTypes} from "@/lib/sales/completion-review";
import {canPerformSalesAction} from "@/lib/sales/permissions";
import {saleProgression} from "@/lib/workspace/sale-progression";
import {Heading,Notice,date,LocalLink,saleValues} from "./TaskWorkspace";
import SaleStepGuidance from "./SaleStepGuidance";
import CompletionDocument from "./CompletionDocument";
import CoreSales from "./CoreSales";
import ExtendedSales from "./ExtendedSales";

import {useRecordRead} from './useRecordRead';
import RecordReadStatus from './RecordReadStatus';
import s from "../sales-workspace/Workspace.module.css";
import info from './SalesInformation.module.css';

export default function CompletionWorkspace({api,scope,row,task:propsTask,onTask,onSaved,readOnly=false,refresh=0,coreWritable=false}:{api:ReturnType<typeof reader>;scope:Scope;row:SaleRow;task:string;onTask:(v:string)=>void;onSaved:(m:string)=>void;readOnly?:boolean;refresh?:number;coreWritable?:boolean}){
 const task=propsTask;
 const history=useProgressionHistory(api,scope,row,refresh),events=history.data||[];
 const [visited,setVisited]=useState([task]);
 if(!visited.includes(task))setVisited([...visited,task]);
 const key=[scope.identity,scope.accessRevision,scope.role,row.buildingId,row.unitId,row.saleId].join(':');
 const read=useCallback((signal:AbortSignal)=>api.completion(scope,row.unitId,row.saleId!,signal),[api,scope,row.unitId,row.saleId]);
 const {data,error,loading,retry}=useRecordRead(key,read,refresh),[fileError,setFileError]=useState('');
 async function view(id:string){const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;try{const r=await api.workflow.document({buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!},id);if(tab)tab.location.replace(r.url);else setFileError('Allow a new tab to view the PDF.')}catch(e){tab?.close();setFileError((e as Error).message)}}
 if(!data)return <><Heading eyebrow="Progression / Completion" title={({authority:"Authority to serve notice",notice:"Notice & due date",documents:"Documents & approval",legal:"Legal completion"} as Record<string,string>)[task]||"Completion"}/>{error?<Notice>{error} <button className={s.button} onClick={retry}>Retry</button></Notice>:<p className={s.meta} role="status">Loading completion record…</p>}</>;
 const sale=data.sale,progress=saleProgression(sale,data.documents),complete=progress.stages.completion==='complete';
 const exchanged=Boolean(sale.exchanged_at)||complete,reviewed=completionDocumentsApproved(data.documents);
 const correspondence=data.documents.find(d=>d.document_type==='completion_correspondence'),notice=currentCompletionVersion(correspondence);
 const approvedCount=completionDocumentTypes.filter(type=>completionDocumentApproved(data.documents.find(d=>d.document_type===type))).length;
 const steps:ProgressionStep[]=[['authority','Authority to serve notice'],['notice','Notice & due date'],['documents','Documents & approval'],['legal','Legal completion']].map(([id,title])=>{
  const missing=complete&&(id==='authority'?!sale.completion_authority_given_at:id==='notice'?!sale.completion_notice_issued_at:id==='documents'?!reviewed:!sale.legal_completed_at&&!sale.completed_at);
  const state=missing?'missing':progress.steps[id];
  const status=missing?'No stored record':state==='future'?'Not yet available':id==='documents'?(reviewed?'Done · ':'')+approvedCount+' of 2 current versions approved':state==='complete'?'Done':id==='authority'?'Not yet issued':id==='notice'?'Awaiting notice':'Ready to record';
  return {id,title,state,status};
 });
 const title=steps.find(step=>step.id===task)?.title||'Completion';
 const exact={buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!};
 return <><Heading eyebrow="Progression / Completion" title={title}/>
 <ProgressionSteps label="Completion steps" steps={steps} selected={task} onSelect={onTask}/>
 <RecordReadStatus compact loading={loading} error={error} retry={retry}/><RecordReadStatus compact loading={history.loading} error={history.error} retry={history.retry}/>
 {fileError&&<div role="alert"><Notice>{fileError}</Notice></div>}
 {!exchanged?<Notice>Completion becomes available after exchange. <LocalLink values={{...saleValues(row),section:'exchange'}}>Review exchange</LocalLink></Notice>:<>
 <SaleStepGuidance row={row} role={scope.role} section="completion" task={task}/>
 {visited.map(step=>{const task=step,available=progress.steps[task]!=='future',blockedLegal=task==='legal'&&!complete&&!reviewed;return <Activity key={task} mode={task===propsTask?'visible':'hidden'}>{blockedLegal?<section className={info.stepMessage} aria-label="Legal completion prerequisite"><p>Approve both completion documents before recording legal completion.</p><button className={s.primary} onClick={()=>onTask('documents')}>Review documents</button></section>:!available?<Notice>{task==='notice'?'Authority to serve notice must be recorded first.':task==='documents'?'Record the notice and completion arrangements before submitting documents.':'Record the notice and completion arrangements before legal completion.'} <button className={s.button} onClick={()=>onTask(task==='notice'?'authority':'notice')}>{task==='notice'?'Review authority':'Review notice & due date'}</button></Notice>:<>
 {task==='authority'&&sale.completion_authority_given_at&&(()=>{
  const authorities=[...(data.authorities||[])].sort((a,b)=>b.version-a.version);
  const records=authorities.map(authority=>{
   const event=events.find(e=>e.metadata?.emailId===authority.id&&['authority_notice_given','integration_correspondence_captured'].includes(e.event_type));
   return {id:authority.id,title:'Authority to serve notice · version '+authority.version,status:authority.delivery_status,fields:[['Issued / captured',recordTime(authority.issued_at)],['Recorded by',event?.actor_name],['Recipient',Array.isArray(event?.metadata?.to)?event.metadata.to.join(', '):null]] as [string,ReactNode][],subject:authority.subject,body:authority.body};
  });
  return records.length?<><AuthorityRecord record={records[0]}/>{records.length>1&&<details className={s.historyDisclosure}><summary>Earlier authority versions ({records.length-1})</summary>{records.slice(1).map(record=><AuthorityRecord key={record.id} record={record}/>)}</details>}</>:<AuthorityRecord record={{id:'recorded',title:'Authority to serve notice recorded',status:'Recorded',fields:[['Recorded',recordTime(sale.completion_authority_given_at)]]}}/>;
 })()}
 {complete&&task==='authority'&&!sale.completion_authority_given_at&&<p className={s.meta}>No stored authority record for this completed sale.</p>}
 {complete&&task==='notice'&&!sale.completion_notice_issued_at&&<p className={s.meta}>No stored notice record for this completed sale.</p>}
 {task==='notice'&&sale.completion_notice_issued_at&&<section className={p.record} aria-label="Recorded notice">
  <h2>Notice recorded</h2>
  <RecordGrid fields={[["Notice issue date",date(sale.completion_notice_issued_at)],["Valid service date",date(sale.completion_service_date)],["Completion basis",sale.completion_basis==='fixed_date'?'Fixed-date agreement':sale.completion_basis==='on_notice'?'Completion on notice':null],["Override / agreement reason",sale.completion_deadline_reason],["Contractual completion date",date(sale.contractual_completion_date)],...eventFields(latestEvent(events,'completion_arrangements_confirmed'),data.noticeRecordedBy)]}/>
  {notice?<><p className={p.meta}>{notice.file_name} · current version {notice.version_number}</p><div className={p.actions}><button className={s.button} onClick={()=>void view(notice.id)}>View current notice PDF</button></div></>:<p className={p.meta}>No current notice PDF is available.</p>}
  <p className={p.meta}>Recorded in integration; this does not confirm external delivery or legal service.</p>
  <details><summary>Notice versions</summary>{correspondence?.unit_sale_document_versions.filter(v=>!v.redacted_at).map(v=><p key={v.id}><button className={s.button} onClick={()=>void view(v.id)}>View {v.is_current?'current':'previous'} notice · version {v.version_number}</button> <span className={s.meta}>{date(v.uploaded_at)}</span></p>)}</details>
 </section>}
 {task==='documents'&&<div className={p.documents}>{(['completion_statement','draft_statement_of_account'] as const).map(type=><CompletionDocument key={row.saleId+':'+type} api={api} scope={exact} document={data.documents.find(d=>d.document_type===type)} type={type} title={type==='completion_statement'?'Completion statement':'Statement of account'} identity={row.buildingName+' / '+row.unitNumber} historical={complete} auditEvents={events} fileViewing canUpload={!readOnly&&!complete&&canPerformSalesAction(scope.role,'submit_completion_documents')} canReview={!readOnly&&!complete&&canPerformSalesAction(scope.role,'approve_completion_documents')} onSaved={onSaved}/>)}</div>}
 {task==='legal'&&complete&&<Milestone title="Sale completed">
  <RecordGrid fields={[["Actual legal completion",recordTime(sale.legal_completed_at||sale.completed_at)],["Property · current",[row.buildingName,row.unitNumber].filter(Boolean).join(' / ')],["Buyer · current",row.buyerLabel],...eventFields(latestEvent(events,'completion_recorded'),data.legalRecordedBy)]}/>
  <p className={p.meta}>Legal completion is recorded. Handover and financial reconciliation remain separate operational tasks.</p>
  <div className={p.actions}><button className={s.button} onClick={()=>onTask('documents')}>View completion documents</button><LocalLink className={s.button} values={{...saleValues(row),section:'handover'}}>Open Handover</LocalLink></div>
 </Milestone>}
 {coreWritable&&!complete&&task!=='documents'&&(task!=='authority'||!sale.completion_authority_given_at)&&<CoreSales key={row.saleId+':'+task} task={task} api={api} scope={exact} role={scope.role} section="completion" refresh={refresh} onSaved={onSaved}/>}
 {coreWritable&&!complete&&['authority','notice'].includes(task)&&<ExtendedSales task={task} api={api} scope={exact} role={scope.role} section="completion" refresh={refresh} onSaved={onSaved}/>}
 {!coreWritable&&task==='legal'&&!complete&&<Notice>Documents approved; legal completion recording is unavailable in this environment.</Notice>}
 </>}</Activity>})}
 </>}
 </>;
}
