"use client";
import {Activity,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {reader} from '@/lib/experiments/building-integration/reader';
import type {SaleRow,Scope} from '@/lib/experiments/building-contracts/contracts';
import type {SaleDetailsReader} from '@/lib/workspace/sale-details-types';
import {RecordReadinessContext} from './useRecordRead';
import {createRecordRead,createRecordReadiness} from '@/lib/workspace/record-read';
import SaleInformationPanel,{useSaleInformationDesktop} from './SaleInformationPanel';
import RecordReadStatus from './RecordReadStatus';
import {SaleTask,Discussion,Heading,LocalLink,saleValues} from './TaskWorkspace';
import s from '../sales-workspace/Workspace.module.css';
import info from './SalesInformation.module.css';
import {RecordValue} from './ProgressionRecord';
type Props={targetComment?:string;mentionIds?:string[];onMentions?:(ids:string[])=>void;api:ReturnType<typeof reader>&SaleDetailsReader;scope:Scope;row:SaleRow;section:string;task:string;refresh:number;coreWritable:boolean;readOnly:boolean;onTask:(task:string)=>void;onSaved:(message:string)=>void;draft:string;onDraft:(value:string)=>void;discussion:string;onDiscussion:(value:string)=>void;informationOpen?:boolean;onInformationClose?:()=>void;buildingName?:string};
export default function SharedSaleWorkspace(props:Props){
 const [readiness]=useState(createRecordReadiness);
 const desktop=useSaleInformationDesktop();
 return <RecordReadinessContext value={readiness}>{props.api.context?<ConnectedSaleWorkspace {...props} desktop={desktop}/>:<div className={s.saleLayout}><div className={s.saleTask}><SaleTask {...props}/></div><InformationPanel {...props} desktop={desktop}><Discussion {...props} view={props.discussion} onView={props.onDiscussion} visible={desktop===true||Boolean(props.informationOpen)} prefetchEnabled={desktop===true}/></InformationPanel></div>}</RecordReadinessContext>;
}
function InformationPanel(props:Props&{desktop:boolean|null;children:React.ReactNode}){
 return <SaleInformationPanel desktop={props.desktop} open={Boolean(props.informationOpen)} onClose={props.onInformationClose} buildingName={props.buildingName||props.row.buildingName} unitNumber={props.row.unitNumber}>{props.children}</SaleInformationPanel>;
}

// Retain one overview store while the mobile panel is closed. Opening it can
// join an in-flight read or reuse fresh data without remounting the workflow.
function useSaleOverview<T>(key:string,read:(signal:AbortSignal)=>Promise<T>,refresh:number,visible:boolean){
 const {store}=useMemo(()=>({key,store:createRecordRead<T>()}),[key]);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const readiness=useContext(RecordReadinessContext),lastRefresh=useRef(refresh);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{if(lastRefresh.current!==refresh){lastRefresh.current=refresh;store.invalidate();}},[store,refresh]);
 useEffect(()=>{
  if(!visible)return;
  void store.ensure(key,read,()=>window.dispatchEvent(new Event('workspace-access-invalid')));
 },[store,key,read,refresh,retry,visible]);
 useEffect(()=>{
  if(!visible)return;
  readiness?.set(store,state.data!==undefined);
  return()=>readiness?.remove(store);
 },[readiness,store,state.data,visible]);
 useEffect(()=>()=>store.cancel(),[store]);
 return {data:state.data,error:state.error,loading:state.loading,retry:()=>{store.invalidate();setRetry(v=>v+1);}};
}

function ConnectedSaleWorkspace(props:Props&{desktop:boolean|null}){
 const {api,scope,row,section,refresh}=props;
 const [visited,setVisited]=useState([section]);
 const [tasks,setTasks]=useState<Record<string,string>>({[section]:props.task});
 if(tasks[section]!==props.task)setTasks({...tasks,[section]:props.task});
 if(!visited.includes(section))setVisited([...visited,section]);
 const read=useCallback((signal:AbortSignal)=>api.context!(scope,row.unitId,row.saleId,signal),[api,scope,row.unitId,row.saleId]);
 const visible=props.desktop===true||Boolean(props.informationOpen);
 const context=useSaleOverview([scope.identity,scope.accessRevision,scope.role,row.buildingId,row.unitId,row.saleId].join(':'),read,refresh,visible);
 const data=context.data;
 const overview=<div className={info.overview}>
 {!data?<p role={context.error?'alert':'status'}>{context.error||'Loading sale information…'}{context.error&&<button className={s.button} onClick={context.retry}>Retry overview</button>}</p>:<>
 {[['Commercial terms',data.headline],['Buyer & solicitor',data.buyer],['Key dates',data.milestones]].map(([title,fields])=><section key={String(title)}><h3>{String(title)}</h3>{title==='Commercial terms'&&<p className={s.meta}>{data.basis}</p>}<dl className={info.overviewFields}>{(fields as [string,string][]).map(([name,value])=><div key={name}><dt>{name}</dt><dd><RecordValue value={value}/></dd></div>)}</dl>{title==='Commercial terms'&&row.saleId&&<LocalLink values={{...saleValues(row),section:'commercial'}}>View full Commercial Terms</LocalLink>}</section>)}
 <RecordReadStatus loading={context.loading} error={context.error} retry={context.retry}/>
 </>}
 </div>;
 return <div className={s.saleLayout}><div className={s.saleTask}>
 {row.saleId?visited.map(stage=><Activity key={stage} mode={stage===section?'visible':'hidden'}><SaleTask {...props} section={stage} task={stage===section?props.task:tasks[stage]||"authority"}/></Activity>):<><Heading eyebrow="Progression / Reservation" title="Reservation"/><p className={s.meta}>No reservation has been started for this unit.</p></>}
 </div><InformationPanel {...props}><Discussion targetComment={props.targetComment} mentionIds={props.mentionIds} onMentions={props.onMentions} api={api} row={row} scope={scope} refresh={refresh} readOnly={props.readOnly} draft={props.draft} onDraft={props.onDraft} view={props.discussion} onView={props.onDiscussion} attempts={data?.attempts} overview={overview} visible={visible} prefetchEnabled={props.desktop===true}/></InformationPanel></div>;
}
