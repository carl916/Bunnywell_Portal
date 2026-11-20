"use client";
import {useState} from 'react';
import type {Session} from '@/lib/experiments/building-integration/reader';
import type {BuildingDetail} from '@/lib/workspace/types';
import type {SetupContext} from '@/lib/workspace/setup-types';
import {BuildingForm,Structure,Team,Defaults} from './SetupBuildingForms';
import {useSetupRead,SetupForm} from './SetupShared';
import {OperationError,FormFields,useOperation} from './OperationsForms';
import {initialDefectsReportingEndDate,closingNoticeStartDate,lifecycleLabel,derivedBuildingLifecycleStatus,lifecycleEffectSummary} from '@/lib/building-lifecycle';
import {Notice,label,go} from './TaskWorkspace';
import s from '../sales-workspace/Workspace.module.css';
import styles from './SetupBuilding.module.css';
import {SetupFeedback} from './SetupFeedback';
type Props={session:Session;context:SetupContext;building:string;refresh:number;notice:string;onSaved:(m:string)=>void};
export default function SetupBuilding({session,context,building,refresh,onSaved,p,notice}:Props&{p:URLSearchParams}){
 const {data,error}=useSetupRead<BuildingDetail>(session,'building',{building},refresh),section=p.get('panel')||'overview';
 if(error)return <Notice>{error}</Notice>;if(!data)return <Notice>Loading this building’s configuration…</Notice>;
 const tabs=[['overview','Overview'],['details','Building details'],['lifecycle','Lifecycle'],['team','Delivery team'],['defaults','Sales setup'],['contacts','Sales contacts'],['structure','Structure']];
 return <section className={s.card}><h2>{data.building.name}</h2><nav className={s.actions} aria-label="Building settings">{tabs.map(([key,title])=><button className={section===key?s.primary:s.button} key={key} aria-pressed={section===key} onClick={()=>{go({...Object.fromEntries(p),panel:key})}}>{title}</button>)}</nav>
 <div className={styles.panel}><SetupFeedback message={notice}/><div className={styles.content} key={section+':'+refresh}>{section==='overview'?<><div className={styles.overview}><section><h3>Building lifecycle</h3><p>{data.building.pc_confirmed?'PC confirmed':'PC not confirmed'} · {data.building.pc_date||'Date not set'}</p><p>Resident access requests {data.building.allow_resident_access_requests?'on':'off'}</p></section><section><h3>Building structure</h3><p>{data.floors.length} floors · {data.units.length} units · {data.areas.length} areas</p></section><section><h3>Delivery team</h3>{data.teams.filter(t=>t.active).map(t=><p key={t.id}>{label(t.role_on_project||'')} · {context.organisations.find(o=>o.id===t.organisation_id)?.name||'Organisation unavailable'}</p>)}</section></div><p>Choose a section above to review and update this building.</p></>:section==='details'?<BuildingForm session={session} data={data} onSaved={onSaved}/>:section==='lifecycle'?<Lifecycle session={session} data={data} onSaved={onSaved}/>:section==='team'?<Team session={session} data={data} context={context} onSaved={onSaved}/>:section==='defaults'?<Defaults session={session} data={data} onSaved={onSaved}/>:section==='contacts'?<Contacts session={session} data={data} context={context} onSaved={onSaved}/>:<Structure session={session} data={data} context={context} onSaved={onSaved}/>}</div></div>
 </section>;
}
type FormProps={session:Session;data:BuildingDetail;onSaved:(m:string)=>void};
function Lifecycle({session,data,onSaved}:FormProps){
 const b=data.building,[date,setDate]=useState(b.pc_date||''),[confirmed,setConfirmed]=useState(Boolean(b.pc_confirmed)),[allow,setAllow]=useState(b.allow_resident_access_requests!==false),{busy,error,run}=useOperation(session,onSaved);
 return <SetupForm onSubmit={e=>{e.preventDefault();void run({action:'save_lifecycle',targetId:b.id,payload:{buildingId:b.id,expected:b.updated_at,pcDate:date,pcConfirmed:confirmed,allowRequests:allow}},'Building lifecycle saved.')}}>
 <h3>Building lifecycle</h3><p>{lifecycleLabel(derivedBuildingLifecycleStatus({...b,pc_date:date,pc_confirmed:confirmed}))}</p><p className={s.meta}>{lifecycleEffectSummary(derivedBuildingLifecycleStatus({...b,pc_date:date,pc_confirmed:confirmed}))}</p>
 <OperationError error={error}/><FormFields busy={busy}>
 <div className={styles.lifecycleGroup}>
  <div className={styles.pcControls}>
   <label className={s.field+' '+styles.dateField}>Expected PC date<input type="date" value={date} onChange={e=>{setDate(e.target.value);if(!e.target.value)setConfirmed(false)}}/></label>
   <label className={styles.checkboxRow}><input type="checkbox" checked={confirmed} disabled={!date} onChange={e=>setConfirmed(e.target.checked)}/>PC confirmed</label>
  </div>
  <dl className={styles.calculatedDates}><div><dt>Defects reporting closes</dt><dd>{initialDefectsReportingEndDate({...b,pc_date:date,pc_confirmed:confirmed})||'Calculated when PC is confirmed'}</dd></div><div><dt>Closing notice starts</dt><dd>{closingNoticeStartDate({...b,pc_date:date,pc_confirmed:confirmed})||'Calculated when PC is confirmed'}</dd></div></dl>
 </div>
 <div className={styles.residentAccess}><label className={styles.checkboxRow}><input type="checkbox" checked={allow} aria-describedby="resident-access-help" onChange={e=>setAllow(e.target.checked)}/>Allow new resident access requests</label><p id="resident-access-help" className={s.meta}>Existing approved users can still sign in when new access requests are disabled.</p></div>
 <button className={s.primary}>{busy?'Saving…':'Save lifecycle'}</button>
 </FormFields></SetupForm>;
}
function Contacts({session,data,context,onSaved}:FormProps&{context:SetupContext}){
 const b=data.building,{busy,error,run}=useOperation(session,onSaved);
 return <SetupForm onSubmit={e=>{e.preventDefault();void run({action:'save_contacts',targetId:b.id,payload:{buildingId:b.id,expected:b.updated_at,...Object.fromEntries(new FormData(e.currentTarget))}},'Sales contacts saved.')}}><h3>Sales contacts</h3><p>Organisation shared inboxes receive sales instructions. Access remains controlled by user and delivery-team assignments.</p><OperationError error={error}/><FormFields busy={busy}><div className={styles.fieldPairs}>{[['conveyancerId','Conveyancer organisation','conveyancer',b.conveyancer_organisation_id],['agentId','Sales agent organisation','sales_agent',b.sales_agent_organisation_id]].map(([name,title,type,value])=><label key={name} className={s.field}>{title}<select name={name||''} defaultValue={value||''}><option value="">Not assigned</option>{context.organisations.filter(o=>o.type===type).map(o=><option key={o.id} value={o.id}>{o.name}{o.shared_system_email?' · '+o.shared_system_email:''}</option>)}</select></label>)}</div><label className={s.field}>Seller/SPV<input name="sellerName" defaultValue={b.seller_name||''}/></label><label className={s.field}>Agreed completion information<textarea name="completionInformation" defaultValue={b.completion_information||''}/></label><button className={s.primary}>{busy?'Saving…':'Save sales contacts'}</button></FormFields></SetupForm>;
}
