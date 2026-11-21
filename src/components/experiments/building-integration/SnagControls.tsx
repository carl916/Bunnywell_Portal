"use client";
import {useId,useRef,useState} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {ProductionSnag,Area,BuildingFloor,Unit} from "@/lib/data/production";
import {sortUnitsByBuildingFloorOrder} from "@/lib/units/commercial-allocation";
import {useOperationContext,useOperation,OperationError,FormFields,EvidencePicker} from "./OperationsForms";
import {Notice} from "./TaskWorkspace";
import {permittedSnagActions} from "@/lib/workspace/snag-actions";
import {hostedStaging} from "@/lib/workspace/staging";
import styles from "./Snags.module.css";
import s from "../sales-workspace/Workspace.module.css";
export type SnagContext={editable:boolean;role:string;units:Pick<Unit,"id"|"building_id"|"unit_number"|"floor">[];floors:BuildingFloor[];areas:Area[];trades:{id:string;name:string}[];teams:{id:string;name:string;role:string}[];snag:ProductionSnag|null};
type Context=SnagContext;
type Props={session:Session;building:string;snagId?:string;refresh?:number;informationQuestion?:string|null;onSaved:(message:string)=>void};
export function SnagControls({session,building,snagId,refresh=0,informationQuestion,onSaved}:Props){
 // Creating another record must not unmount the draft when the register refreshes.
 const {data,error}=useOperationContext<Context>(session,{action:"snag_context",scope:{buildingId:building,snagId:snagId??null}},snagId?refresh:0);
 if(error)return <OperationError error={error}/>;
 if(!data)return <Notice>Loading authorised snag actions…</Notice>;
 if(!data.editable)return null;
 return data.snag?<SnagActions key={data.snag.id+":"+data.snag.updated_at} session={session} building={building} data={data} informationQuestion={informationQuestion} onSaved={onSaved}/>:data.role!=="contractor"?<NewSnag session={session} building={building} data={data} onSaved={onSaved}/>:null;
}
function NewSnag({session,building,data,onSaved}:{session:Session;building:string;data:Context;onSaved:Props["onSaved"]}){
 const [open,setOpen]=useState(false),[unit,setUnit]=useState(""),[area,setArea]=useState(""),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[trade,setTrade]=useState(""),[org,setOrg]=useState(data.teams.find(t=>t.role==="main_contractor")?.id||""),[file,setFile]=useState<File|null>(null);
 const [editingOrg,setEditingOrg]=useState(false),[draftOrg,setDraftOrg]=useState(org),titleInput=useRef<HTMLInputElement>(null);
 const {busy,error,run}=useOperation(session,onSaved),units=sortUnitsByBuildingFloorOrder(data.units,data.floors,[{id:building}]);
 function reset(){setTitle("");setDescription("");setTrade("");setFile(null);setEditingOrg(false)}
 function cancel(){if((title.trim()||description.trim()||file)&&!window.confirm("Discard this unsaved snag?"))return;reset();setOpen(false)}
 return <section className={s.card}><h2>Create a snag</h2>{!open&&<button className={s.button} onClick={()=>setOpen(true)}>Add developer snag</button>}{open&&<form className={styles.createForm} onSubmit={e=>{
 e.preventDefault();if(!file||!area||busy)return;
 const another=(e.nativeEvent as SubmitEvent).submitter?.getAttribute("value")!=="close";
 void run({action:"create_snag",scope:{buildingId:building,snagId:null},payload:{unitId:unit||null,areaId:area,title,description,tradeId:trade||null,organisationId:org||null}},another?"Snag saved. Ready to add another.":"Snag saved.",file).then(result=>{if(result?.id){reset();if(another)titleInput.current?.focus();else setOpen(false)}});
 }}>
 <OperationError error={error}/><FormFields busy={busy}><div className={s.documentGrid}><label className={s.field}>Unit or communal location<select aria-label="Unit or communal location" value={unit} onChange={e=>{setUnit(e.target.value);setArea("")}}><option value="">Communal</option>{units.map(u=><option key={u.id} value={u.id}>{u.floor} · {u.unit_number}</option>)}</select></label><label className={s.field}>Area<select aria-label="Area" required value={area} onChange={e=>setArea(e.target.value)}><option value="">Choose area</option>{data.areas.filter(a=>(a.unit_id||"")===unit).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
 <label className={s.field}>Snag title<input ref={titleInput} required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className={s.field}>Description<textarea maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <label className={s.field}>Trade<select aria-label="Trade" value={trade} onChange={e=>setTrade(e.target.value)}><option value="">Not assigned</option>{data.trades.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
 {editingOrg?<div className={styles.assignmentEdit}><label className={s.field}>Responsible organisation<select aria-label="Responsible organisation" value={draftOrg} onChange={e=>setDraftOrg(e.target.value)}><option value="">Unallocated</option>{data.teams.filter(t=>["main_contractor","supporting_trade"].includes(t.role)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" className={s.button} onClick={()=>{setOrg(draftOrg);setEditingOrg(false)}}>Apply assignment</button><button type="button" className={s.textButton} onClick={()=>setEditingOrg(false)}>Cancel assignment</button></div>:<div className={styles.assignment}><span>Assigned to: <strong>{data.teams.find(t=>t.id===org)?.name||"Unallocated"}</strong></span><button type="button" className={s.textButton} onClick={()=>{setDraftOrg(org);setEditingOrg(true)}}>Change</button></div>}
 <EvidencePicker id="new-snag-evidence" file={file} onFile={setFile} disabled={busy}/>
 <div className={styles.actions}><button className={s.primary} name="save" value="another" disabled={!file||!area||editingOrg}>{busy?"Saving…":"Save and add another"}</button><button className={s.button} name="save" value="close" disabled={!file||!area||editingOrg}>Save and close</button><button type="button" className={s.textButton} onClick={cancel}>Cancel</button></div></FormFields></form>}</section>;
}
function AssignmentFields({data,org,trade,onOrg,onTrade}:{data:Context;org:string;trade:string;onOrg:(v:string)=>void;onTrade:(v:string)=>void}){
 return <div className={s.documentGrid}><label className={s.field}>Responsible organisation<select aria-label="Responsible organisation" value={org} onChange={e=>onOrg(e.target.value)}><option value="">Unallocated</option>{data.teams.filter(t=>["main_contractor","supporting_trade"].includes(t.role)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className={s.field}>Trade<select aria-label="Trade" value={trade} onChange={e=>onTrade(e.target.value)}><option value="">Not assigned</option>{data.trades.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>;
}
function SnagActions({session,building,data,informationQuestion,onSaved}:{session:Session;building:string;data:Context;informationQuestion?:string|null;onSaved:Props["onSaved"]}){
 const snag=data.snag!,scope={buildingId:building,snagId:snag.id},dev=["admin","developer","developer_representative"].includes(data.role);
 const [selected,setSelected]=useState(""),[comment,setComment]=useState(""),[file,setFile]=useState<File|null>(null),[org,setOrg]=useState(snag.assigned_to_organisation_id||""),[trade,setTrade]=useState(snag.trade_id||""),[priority,setPriority]=useState(snag.priority_code||""),[due,setDue]=useState(snag.sla_due_date?.slice(0,10)||"");
 const {busy,error,run}=useOperation(session,onSaved),actions=permittedSnagActions(data.role,String(snag.status),data.editable),action=actions.find(a=>a.id===selected);
 function select(id:string){setSelected(id);setComment("");setFile(null);}
 return <>
 {actions.length>0&&<section className={`${s.card} ${styles.actionCard}`} aria-label="Snag actions"><h2>Snag actions</h2><div className={styles.actions}>{actions.map((a,index)=><button key={a.id} type="button" className={index===0?s.primary:s.button} disabled={busy} aria-expanded={selected===a.id} aria-controls="snag-action-form" onClick={()=>select(a.id)}>{a.label}</button>)}</div>
 {action&&<form id="snag-action-form" className={styles.actionForm} onSubmit={e=>{e.preventDefault();void run({action:action.id,scope,payload:{expected:snag.updated_at,comment}},action.success,action.media?file:null).then(result=>{if(result)select("")})}}>
 <OperationError error={error}/><FormFields busy={busy}><h3>{action.label}</h3>
 {action.id==="answer_snag_info"&&<div className={styles.informationQuestion}><strong>Information requested</strong><p>{informationQuestion||"The original question was not recorded. Review the activity for context."}</p></div>}
 <label className={s.field}>{action.comment}<textarea autoFocus required={action.requiredComment} maxLength={5000} value={comment} onChange={e=>setComment(e.target.value)}/></label>
 {action.media&&<><p className={s.meta}>{action.requiredMedia?"Attach evidence to save.":"Attach a photo or video if it helps explain this action (optional)."}</p><EvidencePicker id={"snag-evidence-"+snag.id} file={file} onFile={setFile} disabled={busy}/></>}
 <div className={styles.actions}><button className={s.primary} disabled={busy||(action.requiredComment&&!comment.trim())||(action.requiredMedia&&!file)}>{busy?"Saving…":action.id==="answer_snag_info"?"Send response":action.id==="add_snag_media"?"Save evidence":"Confirm "+action.label.toLowerCase()}</button><button type="button" className={s.button} onClick={()=>select("")}>Cancel</button></div></FormFields></form>}
 </section>}
 {dev&&<section className={s.card} aria-label="Snag allocation"><details className={styles.allocation}><summary>Allocation, priority and deadline</summary><OperationError error={!action?error:undefined}/><FormFields busy={busy}><AssignmentFields data={data} org={org} trade={trade} onOrg={setOrg} onTrade={setTrade}/>
 <div className={s.documentGrid}><label className={s.field}>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="">Not assigned</option>{["P1","P2","P3"].map(v=><option key={v}>{v}</option>)}</select></label><label className={s.field}>Due date<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
 <button type="button" className={s.button} onClick={()=>void run({action:"assign_snag",scope,payload:{expected:snag.updated_at,organisationId:org||null,tradeId:trade||null,priority:priority||null,due:due?due+"T12:00:00Z":null,comment:""}},"Snag allocation and deadline saved.")}>Save allocation</button></FormFields></details></section>}
 </>;
}
export function SnagComposer({session,building,snagId,onSaved}:Props){
 const scope={buildingId:building,snagId:snagId??null};
 const {data}=useOperationContext<Context>(session,{action:"snag_context",scope});
 const [comment,setComment]=useState("");
 const [mentions,setMentions]=useState<string[]>([]);
 const [showMentions,setShowMentions]=useState(false);
 const {busy,error,run}=useOperation(session,onSaved);
 const mentionId=useId();
 if(!data?.editable)return <div className={s.contextComposer}><p className={s.meta}>Comments are unavailable for this integration record.</p></div>;
 return <form className={s.contextComposer} onSubmit={event=>{
  event.preventDefault();
  const payload=mentions.length?{comment,mentions}:{comment};
  void run({action:"snag_comment",scope,payload},"Comment added.").then(result=>{
   if(result){setComment("");setMentions([]);setShowMentions(false);}
  });
 }}>
  <OperationError error={error}/>
  <label className={s.field}>Comment<textarea aria-label="Snag comment" maxLength={5000} disabled={busy}
    value={comment} onChange={event=>setComment(event.target.value)}/></label>
  {hostedStaging&&snagId&&<>
   <button type="button" className={s.button} aria-expanded={showMentions} aria-controls={mentionId} disabled={busy}
    onClick={()=>setShowMentions(value=>!value)}>
    Mention people{mentions.length>0&&` (${mentions.length})`}
   </button>
   <div id={mentionId} hidden={!showMentions}>
    {showMentions&&<SnagMentionPicker session={session} building={building} snagId={snagId} disabled={busy}
      selected={mentions} onChange={setMentions}/>}
   </div>
  </>}
  <button className={s.primary} disabled={busy||!comment.trim()}>{busy?"Sending…":"Send comment"}</button>
 </form>;
}

function SnagMentionPicker({session,building,snagId,disabled,selected,onChange}:{
 session:Session;building:string;snagId:string;disabled:boolean;selected:string[];onChange:(ids:string[])=>void;
}){
 const {data,error}=useOperationContext<{id:string;name:string;role:string}[]>(session,{
  action:"snag_mention_candidates",scope:{buildingId:building,snagId},
 });
 if(error)return <OperationError error={error}/>;
 if(!data)return <p role="status" className={s.meta}>Loading people with access…</p>;
 if(!data.length)return <p className={s.meta}>There are no people to mention on this snag.</p>;
 return <fieldset className={styles.mentionOptions} disabled={disabled}>
  <legend>Notify up to 10 people</legend>
  {data.map(person=><label key={person.id}>
    <input type="checkbox" checked={selected.includes(person.id)} disabled={selected.length>=10&&!selected.includes(person.id)}
     onChange={event=>onChange(event.target.checked?[...selected,person.id]:selected.filter(id=>id!==person.id))}/>
    <span>{person.name} <small>{person.role.replaceAll("_"," ")}</small></span>
  </label>)}
 </fieldset>;
}
