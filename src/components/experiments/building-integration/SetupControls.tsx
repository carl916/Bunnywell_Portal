"use client";
import {useRef,useState} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import {useOperationContext,useOperation,OperationError,FormFields} from "./OperationsForms";
import {Notice,label,go} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
export type SetupRecord={id:string;name?:string;full_name?:string;email?:string;type?:string;role?:string;organisation_id?:string;buildingIds?:string[];updated_at?:string;active?:boolean;[key:string]:unknown};
export type SetupContext={entities:{kind:string;id:string}[];buildings:SetupRecord[];organisations:SetupRecord[];people:SetupRecord[];trades:SetupRecord[];types:SetupRecord[]};
export const orgTypes=["developer_representative","contractor","supporting_trade","sales_agent","conveyancer","letting_agent","managing_agent"];
export function NewBuilding({session,onSaved}:{session:Session;onSaved:(m:string)=>void}){
 const [open,setOpen]=useState(false),[name,setName]=useState(""),[address,setAddress]=useState(""),[town,setTown]=useState(""),[postcode,setPostcode]=useState(""),[fictional,setFictional]=useState(false),target=useRef("");
 const {busy,error,run}=useOperation(session,onSaved);
 return <section className={s.card}><button className={s.button} onClick={()=>setOpen(v=>!v)}>{open?"Cancel":"Add fictional test building"}</button>{open&&<form onSubmit={e=>{e.preventDefault();if(!target.current)target.current=crypto.randomUUID();void run({action:"create_building",targetId:target.current,payload:{name,address,town,postcode,fictional}},"Test building created.").then(r=>{if(r?.id)go({view:"building-settings",building:String(r.id)})})}}><h2>New test building</h2><OperationError error={error}/><FormFields busy={busy}>
 <div className={s.documentGrid}>{[[name,setName,"Building name"],[address,setAddress,"Address"],[town,setTown,"Town"],[postcode,setPostcode,"Postcode"]].map(([v,set,title])=><label key={String(title)} className={s.field}>{String(title)}<input required={title==="Building name"} maxLength={240} value={v as string} onChange={e=>(set as (v:string)=>void)(e.target.value)}/></label>)}</div>
 <label className={s.field}><span><input required type="checkbox" checked={fictional} onChange={e=>setFictional(e.target.checked)}/> This building and its future test records are fictional.</span></label><button className={s.primary} disabled={!fictional}>{busy?"Creating…":"Create test building"}</button></FormFields></form>}</section>;
}
export function SetupControls({session,tab,refresh,onSaved}:{session:Session;tab:string;refresh:number;onSaved:(m:string)=>void}){
 const {data,error}=useOperationContext<SetupContext>(session,{action:"setup_context"},refresh),[selected,setSelected]=useState("");
 if(tab==="audit")return null;
 if(error)return <OperationError error={error}/>;
 if(!data)return <Notice>Loading test administration controls…</Notice>;
 const records=tab==="people"?data.people:tab==="organisations"?data.organisations:tab==="trades"?data.trades:data.types,record=records.find(r=>r.id===selected);
 return <section className={s.card}><h2>{record?"Edit test record":"Create test record"}</h2><p>Administration here is limited to fictional test records. Invitations and external messages remain blocked.</p>
 <label className={s.field}>Select test record<select value={record?.id||""} onChange={e=>setSelected(e.target.value)}><option value="">Create new</option>{records.map(r=><option key={r.id} value={r.id}>{r.full_name||r.name||r.email}</option>)}</select></label>
 <SetupForm key={tab+":"+(record?.id||"new")+":"+(record?.updated_at||"")} session={session} tab={tab} record={record} context={data} onSaved={onSaved}/></section>;
}
function SetupForm({session,tab,record,context,onSaved}:{session:Session;tab:string;record?:SetupRecord;context:SetupContext;onSaved:(m:string)=>void}){
 const [name,setName]=useState(String(record?.full_name||record?.name||"")),[email,setEmail]=useState(String(record?.email||"")),[password,setPassword]=useState(""),[role,setRole]=useState(record?.role||"contractor"),[org,setOrg]=useState(record?.organisation_id||""),[buildings,setBuildings]=useState<string[]>(record?.buildingIds||[]),[type,setType]=useState(record?.type||"contractor"),[contact,setContact]=useState(String(record?.main_contact_name||"")),[phone,setPhone]=useState(String(record?.phone||"")),[description,setDescription]=useState(String(record?.description||"")),[order,setOrder]=useState(String(record?.sort_order||0)),[active,setActive]=useState(record?.active!==false),[fictional,setFictional]=useState(false);
 const target=useRef(record?.id||""),{busy,error,run}=useOperation(session,onSaved);
 const people=tab==="people",organisation=tab==="organisations",trade=tab==="trades";
 async function save(){
  if(!target.current)target.current=crypto.randomUUID();
  const action=people?(record?"save_person":"create_test_user"):organisation?(record?"save_organisation":"create_organisation"):trade?(record?"save_trade":"create_trade"):(record?"save_type":"create_type");
  const payload=people?{name,email,password:record?undefined:password,role,organisationId:org,buildingIds:buildings,expected:record?.updated_at,fictional}:organisation?{name,email,type,contact,phone,expected:record?.updated_at,fictional}:trade?{name,sortOrder:Number(order),active,expected:record?.updated_at,fictional}:{name,description,expected:record?.updated_at,fictional};
  const r=await run({action,targetId:target.current,payload},people?"Test person and building access saved. No invitation sent.":"Test record saved.");if(r){setPassword("");if(!record)target.current=""}
 }
 return <><OperationError error={error}/><form onSubmit={e=>{e.preventDefault();void save()}}><FormFields busy={busy}>
 <label className={s.field}>{people?"Fictional full name":"Name"}<input required maxLength={240} value={name} onChange={e=>setName(e.target.value)}/></label>
 {(people||organisation)&&<label className={s.field}>Test email (example.invalid)<input type="email" required={people} readOnly={people&&Boolean(record)} value={email} onChange={e=>setEmail(e.target.value)} placeholder="test-person@example.invalid"/></label>}
 {people&&<><div className={s.documentGrid}><label className={s.field}>Role<select value={role} onChange={e=>{setRole(e.target.value);setOrg("")}}>{["contractor","developer_representative","sales_agent","conveyancer"].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label><label className={s.field}>Test organisation<select required value={org} onChange={e=>setOrg(e.target.value)}><option value="">Choose organisation</option>{context.organisations.filter(o=>o.type===role||(role==="contractor"&&o.type==="supporting_trade")).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
 <fieldset className={s.notice}><legend>Assigned test buildings</legend>{context.buildings.map(b=><label className={s.field} key={b.id}><span><input type="checkbox" checked={buildings.includes(b.id)} onChange={e=>setBuildings(v=>e.target.checked?[...v,b.id]:v.filter(id=>id!==b.id))}/> {b.name}</span></label>)}{!context.buildings.length&&<p>Create a test building under Buildings first.</p>}</fieldset>
 {!record&&<><label className={s.field}>Initial test password<input type="password" autoComplete="new-password" required minLength={14} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><p className={s.meta}>Use this address and password for ordinary application sign-in. No email will be sent.</p></>}</>}
 {organisation&&<><label className={s.field}>Organisation type<select value={type} onChange={e=>setType(e.target.value)}>{orgTypes.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label><label className={s.field}>Fictional contact name<input value={contact} onChange={e=>setContact(e.target.value)}/></label><label className={s.field}>Test phone<input value={phone} onChange={e=>setPhone(e.target.value)}/></label></>}
 {trade&&<><label className={s.field}>Sort order<input type="number" step="1" value={order} onChange={e=>setOrder(e.target.value)}/></label><label className={s.field}><span><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Active trade</span></label></>}
 {tab==="types"&&<label className={s.field}>Description<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label>}
 {!record&&<label className={s.field}><span><input type="checkbox" required checked={fictional} onChange={e=>setFictional(e.target.checked)}/> These are fictional test details.</span></label>}
 <button className={s.primary} disabled={(!record&&!fictional)||(people&&(!org||!buildings.length))}>{busy?"Saving…":record?"Save test record":"Create test record"}</button>
 </FormFields></form>
 {people&&record&&<div className={s.actions}><button className={s.button} disabled={busy} onClick={()=>void run({action:"set_person_status",targetId:record.id,payload:{active:record.active===false,expected:record.updated_at}},record.active===false?"Test account reactivated.":"Test account deactivated.")}>{record.active===false?"Reactivate test account":"Deactivate test account"}</button></div>}</>;
}
