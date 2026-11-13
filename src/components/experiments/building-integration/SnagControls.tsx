"use client";
import {useState} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {ProductionSnag,Area,BuildingFloor,Unit} from "@/lib/data/production";
import {sortUnitsByBuildingFloorOrder} from "@/lib/units/commercial-allocation";
import {useOperationContext,useOperation,OperationError,FormFields,EvidencePicker} from "./OperationsForms";
import {Notice,go} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
type Context={editable:boolean;role:string;units:Pick<Unit,"id"|"building_id"|"unit_number"|"floor">[];floors:BuildingFloor[];areas:Area[];trades:{id:string;name:string}[];teams:{id:string;name:string;role:string}[];snag:ProductionSnag|null};
type Props={session:Session;building:string;snagId?:string;refresh?:number;onSaved:(message:string)=>void};
export function SnagControls({session,building,snagId,refresh=0,onSaved}:Props){
 const {data,error}=useOperationContext<Context>(session,{action:"snag_context",scope:{buildingId:building,snagId:snagId??null}},refresh);
 if(error)return <OperationError error={error}/>;
 if(!data)return <Notice>Loading authorised snag actions…</Notice>;
 if(!data.editable)return <Notice>Imported snag histories are read-only. Use the fictional test building for new snag journeys.</Notice>;
 return data.snag?<SnagActions key={data.snag.id+":"+data.snag.updated_at} session={session} building={building} data={data} onSaved={onSaved}/>:data.role!=="contractor"?<NewSnag session={session} building={building} data={data} onSaved={onSaved}/>:null;
}
function NewSnag({session,building,data,onSaved}:{session:Session;building:string;data:Context;onSaved:Props["onSaved"]}){
 const [open,setOpen]=useState(false),[unit,setUnit]=useState(""),[area,setArea]=useState(""),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[trade,setTrade]=useState(""),[org,setOrg]=useState(data.teams.find(t=>t.role==="main_contractor")?.id||""),[file,setFile]=useState<File|null>(null);
 const {busy,error,run}=useOperation(session,onSaved),units=sortUnitsByBuildingFloorOrder(data.units,data.floors,[{id:building}]);
 return <section className={s.card}><h2>Create a snag</h2><p>New test records use private evidence and recorded activity.</p><button className={s.button} onClick={()=>setOpen(v=>!v)} disabled={busy}>{open?"Cancel new snag":"Add developer snag"}</button>{open&&<form onSubmit={e=>{e.preventDefault();void run({action:"create_snag",scope:{buildingId:building,snagId:null},payload:{unitId:unit||null,areaId:area,title,description,tradeId:trade||null,organisationId:org||null}},"Snag created with its evidence and activity.",file).then(result=>{if(result?.id)go({view:"snag",building,snag:String(result.id)})})}}>
 <OperationError error={error}/><FormFields busy={busy}><div className={s.documentGrid}><label className={s.field}>Unit or communal location<select value={unit} onChange={e=>{setUnit(e.target.value);setArea("")}}><option value="">Communal</option>{units.map(u=><option key={u.id} value={u.id}>{u.floor} · {u.unit_number}</option>)}</select></label><label className={s.field}>Area<select required value={area} onChange={e=>setArea(e.target.value)}><option value="">Choose area</option>{data.areas.filter(a=>(a.unit_id||"")===unit).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
 <label className={s.field}>Snag title<input required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className={s.field}>Description<textarea maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <AssignmentFields data={data} org={org} trade={trade} onOrg={setOrg} onTrade={setTrade}/><EvidencePicker id="new-snag-evidence" file={file} onFile={setFile} disabled={busy}/>
 <button className={s.primary} disabled={!file||!area}>{busy?"Creating…":"Create snag"}</button></FormFields></form>}</section>;
}
function AssignmentFields({data,org,trade,onOrg,onTrade}:{data:Context;org:string;trade:string;onOrg:(v:string)=>void;onTrade:(v:string)=>void}){
 return <div className={s.documentGrid}><label className={s.field}>Responsible organisation<select value={org} onChange={e=>onOrg(e.target.value)}><option value="">Unallocated</option>{data.teams.filter(t=>["main_contractor","supporting_trade"].includes(t.role)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className={s.field}>Trade<select value={trade} onChange={e=>onTrade(e.target.value)}><option value="">Not assigned</option>{data.trades.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>;
}
function SnagActions({session,building,data,onSaved}:{session:Session;building:string;data:Context;onSaved:Props["onSaved"]}){
 const snag=data.snag!,scope={buildingId:building,snagId:snag.id},dev=data.role!=="contractor";
 const [comment,setComment]=useState(""),[file,setFile]=useState<File|null>(null),[org,setOrg]=useState(snag.assigned_to_organisation_id||""),[trade,setTrade]=useState(snag.trade_id||""),[priority,setPriority]=useState(snag.priority_code||""),[due,setDue]=useState(snag.sla_due_date?.slice(0,10)||"");
 const {busy,error,run}=useOperation(session,onSaved),status=String(snag.status);
 function transition(action:string,message:string,media=false){void run({action,scope,payload:{expected:snag.updated_at,comment}},message,media?file:null).then(result=>{if(result){setComment("");setFile(null)}})}
 return <section className={s.card}><h2>Snag actions</h2><OperationError error={error}/><FormFields busy={busy}>
 <label className={s.field}>Action comment<textarea maxLength={5000} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Explain a query, resolution or review decision."/></label>
 {status!=="closed"&&<EvidencePicker id={"snag-evidence-"+snag.id} file={file} onFile={setFile} disabled={busy}/>}
 <div className={s.actions}>
 {!["closed","resolved_by_contractor","needs_more_info"].includes(status)&&<><button className={s.primary} onClick={()=>transition("resolve_snag","Snag marked resolved for developer review.",true)}>Mark resolved{file?" with evidence":""}</button><button className={s.button} disabled={!comment.trim()} onClick={()=>transition("request_snag_info","More information requested. Activity updated.")}>Request more information</button></>}
 {dev&&status==="needs_more_info"&&<button className={s.primary} disabled={!comment.trim()} onClick={()=>transition("answer_snag_info","Information supplied. Snag returned to the contractor.")}>Supply information</button>}
 {dev&&status==="resolved_by_contractor"&&<button className={s.button} disabled={!comment.trim()} onClick={()=>transition("reject_snag","Resolution returned to the contractor.",true)}>Return to contractor</button>}
 {dev&&status!=="closed"&&<button className={s.primary} onClick={()=>transition("close_snag","Snag closed after developer review.")}>Close snag</button>}
 {file&&<button className={s.button} onClick={()=>transition("add_snag_media","Evidence added to this snag.",true)}>Add evidence</button>}
 </div>
 {dev&&status!=="closed"&&<details className={s.historyDisclosure}><summary>Allocation, priority and deadline</summary><AssignmentFields data={data} org={org} trade={trade} onOrg={setOrg} onTrade={setTrade}/>
 <div className={s.documentGrid}><label className={s.field}>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="">Not assigned</option>{["P1","P2","P3"].map(v=><option key={v}>{v}</option>)}</select></label><label className={s.field}>Due date<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
 <button className={s.button} onClick={()=>void run({action:"assign_snag",scope,payload:{expected:snag.updated_at,organisationId:org||null,tradeId:trade||null,priority:priority||null,due:due?due+"T12:00:00Z":null,comment}},"Snag allocation and deadline saved.")}>Save allocation</button></details>}
 </FormFields></section>;
}
export function SnagComposer({session,building,snagId,onSaved}:Props){
 const {data}=useOperationContext<Context>(session,{action:"snag_context",scope:{buildingId:building,snagId:snagId??null}}),[comment,setComment]=useState(""),{busy,error,run}=useOperation(session,onSaved);
 if(!data?.editable)return <div className={s.contextComposer}><p className={s.meta}>Comments on imported reference snags remain read-only.</p></div>;
 return <form className={s.contextComposer} onSubmit={e=>{e.preventDefault();void run({action:"snag_comment",scope:{buildingId:building,snagId},payload:{comment}},"Comment added.").then(r=>{if(r)setComment("")})}}><OperationError error={error}/><label className={s.field}>Comment<textarea aria-label="Snag comment" maxLength={5000} disabled={busy} value={comment} onChange={e=>setComment(e.target.value)}/></label><button className={s.primary} disabled={busy||!comment.trim()}>{busy?"Sending…":"Send comment"}</button></form>;
}