"use client";
import {useRef,useState} from 'react';
import type {Session} from '@/lib/experiments/building-integration/reader';
import type {SetupContext} from '@/lib/workspace/setup-types';
import {Heading,Notice,LocalLink,go} from './TaskWorkspace';
import {useSetupRead,SetupForm} from './SetupShared';
import {useOperation,OperationError,FormFields} from './OperationsForms';
import SetupBuilding from './SetupBuilding';
import {SetupFeedback,useSetupFeedback} from './SetupFeedback';
import SetupAllocation from './SetupAllocation';
import SetupPeople from './SetupPeople';
import SetupAudit from './SetupAudit';
import SetupEmailNotifications from './SetupEmailNotifications';
import s from '../sales-workspace/Workspace.module.css';
const tabs=[['buildings','Buildings'],['allocation','Unit allocation'],['audit','Audit log'],['people','Users & access'],['email-notifications','Email notifications']] as const;
export default function SetupWorkspace({session,p}:{session:Session;p:URLSearchParams}){
 const [refresh,setRefresh]=useState(0);
 const {message:notice,show:setNotice}=useSetupFeedback([p.get('tab')||'buildings',p.get('building')||'',p.get('panel')||'overview'].join(':'));
 const {data:context,error}=useSetupRead<SetupContext>(session,'setup-context',{},refresh);
 const raw=p.get('tab')||'buildings',tab=tabs.some(([t])=>t===raw)?raw:'buildings',building=p.get('building')||'';
 const saved=(message:string)=>{setNotice(message);setRefresh(v=>v+1)};
 const selected=context?.buildings.find(b=>b.id===building);
 return <div style={{display:"grid",gap:20}}><Heading title="Setup" description={tab==='email-notifications'?'Choose who receives workflow updates.':selected?selected.name+' · Building configuration and access': 'Choose a building to manage its configuration. Users and organisations are managed across the portal.'}/>
 <nav className={s.stageCounts} aria-label="Setup sections">{tabs.map(([key,title])=><LocalLink key={key} className={tab===key?s.primary:s.button} values={{view:'setup',tab:key,...(building?{building}:{})}}>{title}</LocalLink>)}</nav>
 {building&&tab==='buildings'&&<LocalLink values={{view:'setup',tab:'buildings'}}>All buildings / Add another building</LocalLink>}{!(building&&tab==='buildings')&&<SetupFeedback message={notice}/>}{error?<Notice>{error} <button className={s.button} onClick={()=>setRefresh(v=>v+1)}>Retry Setup</button></Notice>:!context?<Notice>Loading Setup reference data…</Notice>:<>
 {tab==='email-notifications'?<SetupEmailNotifications key={building} session={session}/>:building&&!selected?<Notice>This building is unavailable. Choose a building from the workspace selector.</Notice>:tab==='people'?<SetupPeople session={session} context={context} refresh={refresh} onSaved={saved}/>:tab==='audit'?<SetupAudit key={building} session={session} context={context} building={building}/>:!building?<>
 <section className={s.card}><h2>Buildings</h2><div className={s.buildingCards}>{context.buildings.map(b=><LocalLink key={b.id} className={s.buildingCard} values={{view:'setup',tab,building:b.id}}><strong>{b.name}</strong><span>{b.address_line_1}</span><span>{b.status==='archived'?'Archived':b.pc_confirmed?'PC confirmed':'Pre-PC'}</span></LocalLink>)}</div></section>
 <NewSetupBuilding session={session} onSaved={saved}/></>:tab==='allocation'?<SetupAllocation key={building} session={session} building={building} refresh={refresh} onSaved={saved}/>:<SetupBuilding notice={notice} p={p} key={building} session={session} context={context} building={building} refresh={refresh} onSaved={saved}/>}
 </>}</div>;
}
export function NewSetupBuilding({session,onSaved}:{session:Session;onSaved:(message:string)=>void}){
 const target=useRef(''),{busy,error,run}=useOperation(session,onSaved);
 return <section className={s.card}><h2>Add a building</h2><SetupForm onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(!target.current)target.current=crypto.randomUUID();void run({action:'create_building',targetId:target.current,payload:Object.fromEntries(f)},'Building created.').then(r=>{if(r)go({view:'setup',tab:'buildings',building:String((r as {id:string}).id)})})}}><OperationError error={error}/><FormFields busy={busy}><div className={s.documentGrid}>{[['name','Building name'],['address','Address'],['town','Town'],['postcode','Postcode']].map(([name,title])=><label className={s.field} key={name}>{title}<input name={name} required={name==='name'}/></label>)}</div><button className={s.primary}>{busy?'Creating…':'Create building'}</button></FormFields></SetupForm></section>;
}
