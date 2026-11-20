"use client";
import {GbpInput} from "@/components/portal/sales/GbpInput";
import {useRef,useState} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {BuildingDetail} from "@/lib/workspace/types";
import type {FurtherDepositTiming} from "@/lib/sales/further-deposit";
import {FurtherDepositTimingFields} from "@/components/portal/sales/FurtherDepositTimingFields";
import {useOperationContext,useOperation,OperationError,FormFields} from "./OperationsForms";
import type {SetupContext} from "@/lib/workspace/setup-types";
import {SetupForm} from "./SetupShared";
import {Notice,label,LocalLink} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
import styles from "./SetupBuilding.module.css";
type Props={session:Session;data:BuildingDetail;onSaved:(m:string)=>void};
export function BuildingForm({session,data,onSaved}:Props){
 const b=data.building,[form,setForm]=useState({name:b.name,address:b.address_line_1||"",town:b.town||"",postcode:b.postcode||"",notes:b.notes||"",pcDate:b.pc_date||"",pcConfirmed:b.pc_confirmed||false,}),{busy,error,run}=useOperation(session,onSaved);
 return <SetupForm onSubmit={e=>{e.preventDefault();void run({action:"save_building",targetId:b.id,payload:{...form,expected:b.updated_at}},"Building details saved.")}}><OperationError error={error}/><FormFields busy={busy}><div className={styles.fieldPairs}>{[["name","Building name"],["address","Address"],["town","Town"],["postcode","Postcode"]].map(([k,title])=><label className={s.field} key={k}>{title}<input required={k==="name"} type={k==="pcDate"?"date":"text"} value={String(form[k as keyof typeof form])} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/></label>)}</div>
 <label className={s.field}>Notes<textarea value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></label>
 <button className={s.primary}>{busy?"Saving…":"Save building details"}</button></FormFields></SetupForm>;
}
export function Structure({session,data,context,onSaved}:Props&{context:SetupContext}){
 const [kind,setKind]=useState("floor"),[selected,setSelected]=useState(""),{busy,error,run}=useOperation(session,onSaved),floors=[...data.floors].sort((a,b)=>a.sort_order-b.sort_order),records=kind==="floor"?floors:kind==="unit"?data.units:data.areas;
 const chosen=records.find(r=>r.id===selected);
 function reorder(index:number,direction:number){
  const ids=floors.map(f=>f.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];
  void run({action:"reorder_floors",targetId:data.building.id,payload:{buildingId:data.building.id,ids,expected:Object.fromEntries(floors.map(f=>[f.id,f.updated_at]))}},"Configured floor order saved.");
 }
 return <><p>Set up floors before units and areas. Unit lists follow this configured floor order.</p><OperationError error={error}/>
 <div className={s.actions}>{["floor","unit","area"].map(k=><button className={s.button} key={k} aria-pressed={kind===k} onClick={()=>{if(window.dispatchEvent(new Event("workspace-before-leave",{cancelable:true}))){setKind(k);setSelected("")}}}>{label(k)}s</button>)}</div>
 <label className={s.field+" "+styles.structurePicker}>Select {kind}<select value={chosen?.id||""} onChange={e=>{if(window.dispatchEvent(new Event("workspace-before-leave",{cancelable:true})))setSelected(e.target.value)}}><option value="">Create new {kind}</option>{records.map(r=><option key={r.id} value={r.id}>{"unit_number" in r?r.unit_number:r.name}</option>)}</select></label>
 <StructureForm key={kind+":"+(chosen?.id||"new")+":"+(chosen?.updated_at||"")} session={session} data={data} context={context} kind={kind} record={chosen as unknown as Record<string,unknown>|undefined} onSaved={onSaved}/>
 {kind==="floor"&&floors.length>0&&<details className={s.historyDisclosure} open><summary>Floor ordering</summary>{floors.map((f,i)=><div className={s.taskRow} key={f.id}><strong>{f.name}</strong><div className={s.actions}><button className={s.button} aria-label={"Move "+f.name+" up"} disabled={busy||i===0} onClick={()=>reorder(i,-1)}>Up</button><button className={s.button} aria-label={"Move "+f.name+" down"} disabled={busy||i===floors.length-1} onClick={()=>reorder(i,1)}>Down</button></div></div>)}</details>}</>;
}
function StructureForm({session,data,context,kind,record,onSaved}:Props&{context:SetupContext;kind:string;record?:Record<string,unknown>}){
 const [name,setName]=useState(String(record?.name||record?.unit_number||"")),[floor,setFloor]=useState(String(record?.floor||"")),[order,setOrder]=useState(String(record?.sort_order??data.floors.length)),[unit,setUnit]=useState(String(record?.unit_id||"")),[type,setType]=useState(String(record?.area_type||"communal_area")),[typeId,setTypeId]=useState(String(record?.unit_type_id||"")),[size,setSize]=useState(String(record?.size_sqm||"")),[parking,setParking]=useState(((record?.parking_bays||[]) as number[]).join(", "));
 const target=useRef(String(record?.id||"")),{busy,error,run}=useOperation(session,onSaved);
 const base={buildingId:data.building.id,expected:record?.updated_at};
 async function save(){if(!target.current)target.current=crypto.randomUUID();const payload=kind==="floor"?{...base,name,sortOrder:Number(order)}:kind==="unit"?{...base,number:name,floor,typeId:typeId||null,size:size||null,parking:parking.trim()?parking.split(",").map(v=>Number(v.trim())):[]}:{...base,name,type,unitId:unit||null,floor,sortOrder:Number(order)};const saved=await run({action:"save_"+kind,targetId:target.current,payload},label(kind)+" saved.");if(saved&&!record){target.current="";setName("");setOrder(v=>String(Number(v)+1))}}
 return <><OperationError error={error}/><SetupForm className={styles.structureForm} onSubmit={e=>{e.preventDefault();void save()}}><FormFields busy={busy}>
 <label className={s.field}>{kind==="unit"?"Unit number":label(kind)+" name"}<input required value={name} onChange={e=>setName(e.target.value)}/></label>
 {kind!=="floor"&&<label className={s.field}>Floor<select value={floor} required={kind==="unit"||!unit} onChange={e=>setFloor(e.target.value)}><option value="">Choose floor</option>{[...data.floors].sort((a,b)=>a.sort_order-b.sort_order).map(f=><option key={f.id} value={f.name}>{f.name}</option>)}</select></label>}
 {kind==="unit"&&<><label className={s.field}>Unit type<select value={typeId} onChange={e=>setTypeId(e.target.value)}><option value="">Not specified</option>{context.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className={s.field}>Size (m²)<input type="number" min="0" step="0.01" value={size} onChange={e=>setSize(e.target.value)}/></label><label className={s.field}>Parking bays<input value={parking} placeholder="12, 13" pattern="[0-9, ]*" onChange={e=>setParking(e.target.value)}/></label><p className={s.meta}>New units start unreleased. Use Unit allocation to release them for sale or add them to the rental portfolio.</p><LocalLink values={{view:"worklist",building:data.building.id}}>Open this building’s Sales worklist</LocalLink></>}
 {kind==="area"&&<><label className={s.field}>Area type<select value={type} onChange={e=>{setType(e.target.value);if(e.target.value!=="unit_room")setUnit("")}}>{["communal_area","unit_room","private_amenity"].map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label><label className={s.field}>Unit<select value={unit} required={type==="unit_room"} onChange={e=>{setUnit(e.target.value);setFloor(data.units.find(u=>u.id===e.target.value)?.floor||"")}}><option value="">Communal</option>{data.units.map(u=><option key={u.id} value={u.id}>{u.floor} · {u.unit_number}</option>)}</select></label></>}
 {kind!=="unit"&&<label className={s.field}>Sort order<input type="number" step="1" value={order} onChange={e=>setOrder(e.target.value)}/></label>}
 <button className={s.primary}>{busy?"Saving…":record?"Save "+kind:"Create "+kind}</button>
 </FormFields></SetupForm>{record&&kind!=="unit"&&<details className={s.historyDisclosure}><summary>Remove unused {kind}</summary><p>Only empty floors or areas without snag history can be removed.</p><button className={s.button} disabled={busy} onClick={()=>void run({action:"delete_"+kind,targetId:record.id,payload:base},label(kind)+" removed.")}>Remove {kind}</button></details>}</>;
}
export function Team({session,data,context,onSaved}:Props&{context:SetupContext}){
 const [role,setRole]=useState("main_contractor"),[org,setOrg]=useState(""),[trade,setTrade]=useState(""),target=useRef(""),{busy,error,run}=useOperation(session,onSaved);
 const active=data.teams.filter(t=>t.active),holder=active.find(t=>t.role_on_project===role);
 const organisationName=(id:string)=>context.organisations.find(o=>o.id===id)?.name||'Organisation unavailable';
 function save(){
  if(!target.current)target.current=crypto.randomUUID();
  void run({action:"save_team",targetId:target.current,payload:{buildingId:data.building.id,role,organisationId:org,tradeType:trade,
   ...(role==='main_contractor'||role==='developer_representative'?{expectedHolderId:holder?.id||null,expectedHolderUpdatedAt:holder?.updated_at||null}:{})}},"Building team assignment saved.")
   .then(result=>{if(result)target.current=""});
 }
 return <><SetupForm onSubmit={e=>{e.preventDefault();save()}}>
 <OperationError error={error}/>{error&&<button type="button" className={s.button} onClick={()=>onSaved('')}>Reload current team</button>}
 <FormFields busy={busy}><div className={styles.fieldPairs}>
 <label className={s.field}>Project role<select value={role} onChange={e=>{setRole(e.target.value);setOrg("");setTrade("")}}>{["main_contractor","developer_representative","supporting_trade"].map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label>
 <label className={s.field}>Organisation<select required value={org} onChange={e=>setOrg(e.target.value)}><option value="">Choose organisation</option>{context.organisations.filter(o=>o.type===(role==="main_contractor"?"contractor":role)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
 {role==="supporting_trade"&&<label className={s.field}>Trade description<input value={trade} onChange={e=>setTrade(e.target.value)}/></label>}
 <p className={s.meta}>Saving a main contractor or developer representative replaces the current holder. Previous assignments stay in history.</p>
 <button className={s.primary} disabled={!org}>{busy?'Saving…':'Save team assignment'}</button></FormFields></SetupForm>
 <section className={styles.teamList} aria-label="Current delivery team"><h3>Current delivery team</h3>
 {active.length===0?<p>No delivery-team assignments yet.</p>:active.map(t=><div className={styles.teamRow} key={t.id}>
 <span className={styles.teamRole}>{label(t.role_on_project||'')}</span><strong>{organisationName(t.organisation_id)}</strong>
 <button type="button" className={s.button} disabled={busy} aria-label={'Remove '+organisationName(t.organisation_id)+' as '+label(t.role_on_project||'').toLowerCase()} onClick={()=>void run({action:"remove_team",targetId:t.id,payload:{buildingId:data.building.id,expected:t.updated_at}},"Team assignment removed.")}>Remove</button></div>)}
 </section></>;
}
export function Defaults({session,data,onSaved}:Props){
 const d=data.defaults||{},[form,setForm]=useState({noticeWorkingDays:String(d.notice_working_days??10),noticeServiceProvision:String(d.notice_service_provision??""),buildCost:String(d.build_cost??0),agentFeePercent:String(d.default_agent_fee_percent??0),exchangeAgentFeePercent:String(d.default_exchange_agent_fee_percent??0),completionAgentFeePercent:String(d.default_completion_agent_fee_percent??0),reservationFee:String(d.reservation_fee??0),reservationFeeHolder:String(d.reservation_fee_holder_default??"sales_agent"),exchangeDepositPercent:String(d.exchange_deposit_percent??10),secondDepositEnabled:Boolean(d.second_deposit_enabled),secondDepositPercent:String(d.second_deposit_percent??0),months:String(d.second_deposit_months_after_exchange??0)}),[timing,setTiming]=useState<FurtherDepositTiming>((d.further_deposit_timing??{basis:"after_exchange"}) as FurtherDepositTiming),{busy,error,run}=useOperation(session,onSaved);
 return <SetupForm onSubmit={e=>{e.preventDefault();void run({action:"save_defaults",targetId:data.building.id,payload:{buildingId:data.building.id,revision:data.defaultsRevision,form:{...form,timing}}},"Building Sales defaults saved. Blank unreserved units inherit the updated defaults; reservation drafts and deposit overrides are retained.")}}><OperationError error={error}/><FormFields busy={busy}>
 <div className={styles.fieldPairs}>{[["buildCost","Build cost (£)"],["agentFeePercent","Total agent fee (%)"],["exchangeAgentFeePercent","Agent fee at exchange (%)"],["completionAgentFeePercent","Agent fee at completion (%)"],["reservationFee","Reservation fee (£)"],["exchangeDepositPercent","Exchange deposit (%)"]].map(([k,title])=><label className={s.field} key={k} style={k==="exchangeDepositPercent"?{gridColumn:1}:undefined}>{title}{["buildCost","reservationFee"].includes(k)?<GbpInput min={0} required value={String(form[k as keyof typeof form])} onChange={value=>setForm(v=>({...v,[k]:value}))}/>:<input type="number" min="0" step="0.01" required value={String(form[k as keyof typeof form])} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/>}</label>)}
 <label className={s.field+" "+styles.feeHolder}>Reservation fee holder<select value={form.reservationFeeHolder} onChange={e=>setForm(v=>({...v,reservationFeeHolder:e.target.value}))}>{["sales_agent","developer","conveyancer","other"].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label></div>
 <label className={styles.checkboxRow}><input type="checkbox" checked={form.secondDepositEnabled} onChange={e=>setForm(v=>({...v,secondDepositEnabled:e.target.checked}))}/> Further deposit required</label>
 {form.secondDepositEnabled&&<div className={styles.depositFields}><label className={s.field}>Further deposit (%)<input type="number" min="0" max="100" step="0.01" required value={form.secondDepositPercent} onChange={e=>setForm(v=>({...v,secondDepositPercent:e.target.value}))}/></label><FurtherDepositTimingFields value={timing} months={form.months} onChange={setTiming} onMonths={months=>setForm(v=>({...v,months}))} pcDate={data.building.pc_date}/></div>}
 <div className={styles.fieldPairs}><label className={s.field}>Completion notice period (working days)<input type="number" min="1" max="90" step="1" required value={form.noticeWorkingDays} onChange={e=>setForm(v=>({...v,noticeWorkingDays:e.target.value}))}/></label><label className={s.field}>Contractual service / deemed-service provisions<textarea maxLength={2000} value={form.noticeServiceProvision} onChange={e=>setForm(v=>({...v,noticeServiceProvision:e.target.value}))}/></label></div>
 <div className={styles.formActions}><button className={s.primary}>{busy?"Saving…":"Save sales defaults"}</button></div></FormFields></SetupForm>;
}
