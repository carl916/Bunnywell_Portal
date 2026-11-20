"use client";
import {Activity,useCallback,useState} from 'react';
import type {reader} from '@/lib/experiments/building-integration/reader';
import type {SaleRow,Scope} from '@/lib/experiments/building-contracts/contracts';
import type {SaleDetailsReader,SaleDetails} from '@/lib/workspace/sale-details-types';
import {canPerformSalesAction} from '@/lib/sales/permissions';
import {exchangeTask} from '@/lib/workspace/completion-navigation';
import CoreSales,{type CoreSaleContext} from './CoreSales';
import ExtendedSales from './ExtendedSales';
import {Heading,Notice,LocalLink,saleValues} from './TaskWorkspace';
import ProgressionSteps from './ProgressionSteps';
import {AuthorityRecord,Milestone,RecordGrid,latestEvent,eventFields,recordTime,missingValue,type AuthorityRecordData} from './ProgressionRecord';
import {useProgressionHistory} from './useProgressionHistory';
import {useRecordRead} from './useRecordRead';
import RecordReadStatus from './RecordReadStatus';
import SaleStepGuidance from './SaleStepGuidance';
import s from '../sales-workspace/Workspace.module.css';
import p from './Progression.module.css';

export default function ExchangeWorkspace({api,scope,row,task:chosen,onTask,onSaved,refresh=0,coreWritable=false,readOnly=false}:{api:ReturnType<typeof reader>&SaleDetailsReader;scope:Scope;row:SaleRow;task:string;onTask:(v:string)=>void;onSaved:(m:string)=>void;refresh?:number;coreWritable?:boolean;readOnly?:boolean}){
 const task=exchangeTask(chosen),[visited,setVisited]=useState([task]);
 if(!visited.includes(task))setVisited([...visited,task]);
 const {buildingId,unitId,saleId}=row,exact={buildingId,unitId,saleId:saleId!};
 const key=[scope.identity,scope.role,scope.accessRevision,buildingId,unitId,saleId].join(':');
 const read=useCallback((signal:AbortSignal)=>api.details!(scope,unitId,saleId!,'exchange',signal),[api,scope,unitId,saleId]);
 const details=useRecordRead<SaleDetails>(key,read,refresh);
 const readCore=useCallback((signal:AbortSignal)=>coreWritable?api.workflow.action({buildingId,unitId,saleId:saleId!},{action:'core_context'},signal) as Promise<CoreSaleContext>:Promise.resolve(null),[api,buildingId,unitId,saleId,coreWritable]);
 const core=useRecordRead(key,readCore,refresh),history=useProgressionHistory(api,scope,row,refresh);
 const events=history.data||[],data=details.data;
 if(!data)return <><Heading eyebrow="Progression / Exchange" title="Exchange"/><RecordReadStatus initial loading={details.loading} error={details.error} retry={details.retry}/></>;
 const fields=data.groups.find(g=>g.id==='exchange')?.fields||[],field=(name:string)=>fields.find(([label])=>name===label)?.[1];
 const sale=core.data?.sale,requested=sale?.authority_requested_at||(!missingValue(field('Authority requested'))?field('Authority requested'):null);
 const exchanged=Boolean(sale?.exchanged_at)||row.progression?.stages.exchange==='complete';
 const request=latestEvent(events,'authority_requested'),exchange=latestEvent(events,'exchange_recorded');
 const authorityGroups=data.groups.filter(g=>g.title.startsWith('authority ·'));
 const authorityRecords:AuthorityRecordData[]=authorityGroups.map(group=>{
  const get=(name:string)=>group.fields.find(([label])=>label===name)?.[1];
  const saved=data.authorities?.find(a=>a.id===group.id);
  const event=events.find(e=>e.metadata?.emailId===group.id&&['authority_issued','authority_reissued','integration_correspondence_captured'].includes(e.event_type));
  return {id:group.id,title:'Authority to exchange · '+group.title.replace('authority · ',''),status:get('Recorded delivery status')||'Recorded',fields:[['Issued / captured',get('Issued')],['Recorded by',event?.actor_name],['Recipient',get('To')],['Valid until',get('Expires')],['Revoked',get('Revoked')],['Replaced',get('Replaced')]],correspondenceFields:[['Copied to',get('CC')],['Recorded sent date',get('Historical sent date')]],subject:saved?.subject,body:saved?.body};
 });
 const currentAuthority=authorityRecords[0],latest=core.data?.emails.filter(e=>e.kind==='authority').sort((a,b)=>b.version-a.version)[0];
 const authorityState=latest?.revoked_at?'Revoked':latest?.replaced_by?'Replaced':latest?.expires_at&&Date.parse(latest.expires_at)<=Date.parse(core.data!.asOf)?'Expired':currentAuthority?.status==='captured test'||currentAuthority?.status==='captured_test'?'Test captured':Boolean(latest?.sent_at)||['sent','delivered','delivery_delayed','opened','clicked'].includes(currentAuthority?.status||'')?'Issued':currentAuthority?'Recorded':'Not yet issued';
 const authorityDone=Boolean(currentAuthority)&&['Test captured','Issued'].includes(authorityState);
 const readyToRecord=latest?Boolean(!latest.revoked_at&&!latest.replaced_by&&latest.expires_at&&Date.parse(latest.expires_at)>Date.parse(core.data!.asOf)&&(latest.sent_at||latest.delivery_status==='captured_test')):row.progression?.next==='Record exchange';
 const future=row.progression?.stages.exchange==='future',closed=readOnly||data.historical||row.progression?.stages.completion==='complete';
 const activeAuthority=authorityRecords.find(a=>a.id===exchange?.metadata?.emailId)||currentAuthority;
 const titles={request:'Request authority',authority:'Authority to exchange',record:exchanged?'Contracts exchanged':'Record exchange'};
 return <><Heading eyebrow="Progression / Exchange" title={titles[task]}/>
  <ProgressionSteps label="Exchange steps" selected={task} onSelect={onTask} steps={[
   {id:'request',title:'Request authority — optional',status:requested?'Requested':'Optional · not requested',state:requested?'complete':'optional'},
   {id:'authority',title:'Authority to exchange',status:authorityState,state:authorityDone?'complete':future?'future':'current'},
   {id:'record',title:'Record exchange',status:exchanged?'Done':readyToRecord?'Ready to record':'Awaiting authority',state:exchanged?'complete':readyToRecord?'current':'future'}
  ]}/>
  <RecordReadStatus compact loading={details.loading||core.loading} error={details.error||core.error} retry={()=>{details.retry();core.retry()}}/>
  <RecordReadStatus compact loading={history.loading} error={history.error} retry={history.retry}/>
  <SaleStepGuidance row={row} role={scope.role} section="exchange" task={task}/>
  {future&&<Notice>Approve the reservation before progressing to exchange. <LocalLink values={{...saleValues(row),section:'reservation'}}>Review reservation</LocalLink></Notice>}
  {visited.map(step=><Activity key={step} mode={task===step?'visible':'hidden'}>
   {step==='request'&&<section className={p.record} aria-label="Authority request record"><h2>{requested?'Authority requested':'Optional authority request'}</h2><p className={p.meta}>A developer can issue authority directly. A request does not authorise exchange.</p>{requested?<><RecordGrid fields={[["Requested",recordTime(sale?.authority_requested_at)||requested],["Requested by",request?.actor_name]]}/>{request?.summary&&<p className={p.meta}>{request.summary}</p>}</>:<p>No authority request is recorded.</p>}</section>}
   {step==='authority'&&(currentAuthority?<><AuthorityRecord record={currentAuthority}/>{authorityRecords.length>1&&<details className={s.historyDisclosure}><summary>Earlier authority versions ({authorityRecords.length-1})</summary>{authorityRecords.slice(1).map(record=><AuthorityRecord key={record.id} record={record}/>)}</details>}</>:null)}
   {step==='record'&&(exchanged?<><Milestone title="Contracts exchanged"><RecordGrid fields={[["Actual exchange date",field('Exchange date')],...eventFields(exchange,field('Recorded by'))]}/><div className={p.actions}><LocalLink className={s.button} values={{...saleValues(row),section:'deposits'}}>View deposit record</LocalLink></div></Milestone>{activeAuthority&&<AuthorityRecord record={activeAuthority}/>}</>:<section className={p.record}><h2>Record the actual exchange</h2><p className={p.meta}>The conveyancer records when contracts exchanged. Issued authority alone does not mean contracts have exchanged.</p>{!canPerformSalesAction(scope.role,'record_exchange')&&<p className={p.meta}>Waiting for the conveyancer to record exchange.</p>}</section>)}
   {coreWritable&&!closed&&!future&&!exchanged&&core.data&&<CoreSales task={step} authorityStatus={authorityState} context={core.data} contextUnavailable={core.loading||Boolean(core.error)} api={api} scope={exact} role={scope.role} section="exchange" refresh={refresh} onSaved={onSaved}/>}
   {coreWritable&&!closed&&!exchanged&&step==='authority'&&<ExtendedSales api={api} scope={exact} role={scope.role} section="exchange" refresh={refresh} onSaved={onSaved}/>}
  </Activity>)}
 </>;
}
