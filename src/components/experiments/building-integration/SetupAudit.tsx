"use client";
import {useState} from 'react';
import {Pagination} from './Pagination';
import type {Session} from '@/lib/experiments/building-integration/reader';
import type {SetupContext,SetupPeople} from '@/lib/workspace/setup-types';
import type {AuditEvent} from '@/lib/audit/types';
import {getAuditSubject,formatAuditEventType,auditChangeSummary} from '@/lib/audit/format';
import {useSetupRead} from './SetupShared';
import {Notice} from './TaskWorkspace';
import s from '../sales-workspace/Workspace.module.css';
type Cursor={beforeTime:string;beforeId:string;beforeSource:string};
export default function SetupAudit({session,context,building}:{session:Session;context:SetupContext;building:string}){
 const [filters,setFilters]=useState({stream:'business',category:'',actor:'',event:'',from:'',to:'',unit:'',sale:'',snag:''}),[search,setSearch]=useState(''),[cursors,setCursors]=useState<Cursor[]>([]),[selected,setSelected]=useState<AuditEvent|null>(null);
 const filter=(key:string,value:string)=>{setFilters(v=>({...v,[key]:value}));setCursors([])};
 const {data,error}=useSetupRead<(AuditEvent&{filtered_total:number})[]>(session,'setup-audit',{...filters,search,building:filters.stream==='authentication'?'':building,to:filters.to?new Date(new Date(filters.to).valueOf()+86400000).toISOString():'',...(cursors.at(-1)||{})});
 const {data:people}=useSetupRead<SetupPeople>(session,'setup-people');
 const auditContext={profiles:people?.people||[],units:people?.units||[],buildings:context.buildings,organisations:context.organisations};
 const events=(data||[]).slice(0,50),filtered=events,total=data?.[0]?.filtered_total||0;
 return <section className={s.listCard}><h2>Audit log</h2><p>{building?'History for the selected building.':'History across accessible buildings.'} Authentication activity is system-wide.</p><div className={s.documentGrid}>
 <label className={s.field}>Audit stream<select value={filters.stream} onChange={e=>filter('stream',e.target.value)}><option value="business">Business changes</option><option value="authentication">Authentication</option><option value="views">Unit views</option></select></label>
 <label className={s.field}>Category<select value={filters.category} onChange={e=>filter('category',e.target.value)}><option value="">All</option>{['sales','rentals','users','setup','security','reports'].map(x=><option key={x}>{x}</option>)}</select></label><label className={s.field}>Search audit events<input value={search} onChange={e=>{setSearch(e.target.value);setCursors([])}}/></label>
 <label className={s.field}>User<select value={filters.actor} onChange={e=>filter('actor',e.target.value)}><option value="">All users</option>{people?.people.map(p=><option key={p.id} value={p.id}>{p.full_name||p.name||p.email}</option>)}</select></label><label className={s.field}>Event type<input value={filters.event} onChange={e=>filter('event',e.target.value)} placeholder="All events" list="audit-events"/><datalist id="audit-events">{[...new Set(events.map(e=>e.event_type))].map(t=><option key={t} value={t}/>)}</datalist></label>
 <label className={s.field}>Unit<select value={filters.unit} onChange={e=>filter('unit',e.target.value)}><option value="">All units</option>{people?.units.filter(u=>!building||u.building_id===building).map(u=><option key={u.id} value={u.id}>{!building?context.buildings.find(b=>b.id===u.building_id)?.name+' · ':''}{u.unit_number}</option>)}</select></label>
 {['from','to','sale','snag'].map(k=><label className={s.field} key={k}>{({from:'From date',to:'To date (inclusive)',sale:'Sale ID',snag:'Snag ID'} as Record<string,string>)[k]}<input type={['from','to'].includes(k)?'date':'text'} value={filters[k as keyof typeof filters]} onChange={e=>filter(k,e.target.value)}/></label>)}</div>
 {error?<Notice>{error}</Notice>:!data?<Notice>Loading audit history…</Notice>:<><div style={{overflowX:'auto'}}><table className={s.salesTable}><thead><tr><th>Date</th><th>Activity</th><th>Subject</th><th>Change</th><th>User</th></tr></thead><tbody>{filtered.map(e=>{const subject=getAuditSubject(e,auditContext);return <tr key={(e.source||'')+e.id}><td>{new Date(e.created_at).toLocaleString('en-GB')}</td><td><button className={s.button} onClick={()=>setSelected(e)}>{formatAuditEventType(e.event_type)}</button></td><td>{subject.primary}<div className={s.meta}>{subject.secondary}</div></td><td>{auditChangeSummary(e)}</td><td>{e.actor_name||people?.people.find(p=>p.id===e.created_by_user_id)?.name||'System'}</td></tr>})}</tbody></table></div>{!filtered.length&&<Notice>No matching audit events.</Notice>}<Pagination total={total} page={cursors.length+1} pageSize={50} noun="events" onPage={page=>{if(page<cursors.length+1)setCursors(v=>v.slice(0,-1));else{const last=events.at(-1);if(last)setCursors(v=>[...v,{beforeTime:last.created_at,beforeId:last.id,beforeSource:last.source||''}])}}}/></>}
 {selected&&<section className={s.card}><h3>{formatAuditEventType(selected.event_type)}</h3><p>{selected.summary}</p><p>{auditChangeSummary(selected)}</p><button className={s.button} onClick={()=>setSelected(null)}>Close event</button></section>}</section>;
}
