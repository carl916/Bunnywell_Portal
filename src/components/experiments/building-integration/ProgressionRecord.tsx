import type {ReactNode} from 'react';
import {BadgeCheck} from 'lucide-react';
import {legalDateTime} from '@/lib/sales/legal-workflow';
import type {SaleActivity} from '@/lib/sales/discussion';
import s from './Progression.module.css';

// Legacy read projections use these strings for absent ordinary fields only.
// Never apply this normalisation to workflow statuses, warnings or input values.
const emptyFields=new Set(['—','-','Not recorded','No buyer recorded','Buyer not recorded','No buyer yet','Not appointed','Not applicable','Date not recorded','Not set','Not yet reserved','Not yet exchanged','Not yet completed','None recorded']);
export function missingValue(value:unknown){return value==null||typeof value==='string'&&(!value.trim()||emptyFields.has(value.trim()));}
export function RecordValue({value}:{value?:ReactNode}){return missingValue(value)?<span className={s.empty} data-empty-value>—</span>:<>{typeof value==='boolean'?String(value):value}</>;}
export function RecordGrid({fields}:{fields:readonly (readonly [string,ReactNode])[]}){return <dl className={s.fields}>{fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd><RecordValue value={value}/></dd></div>)}</dl>;}
export function recordTime(value?:string|null){return value&&Number.isFinite(Date.parse(value))?value.length===10?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(value)):legalDateTime(value):null;}
export function latestEvent(events:SaleActivity[],type:string){return events.filter(e=>e.event_type===type).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];}
export function eventFields(event?:SaleActivity,actor?:string|null):[string,ReactNode][]{return [['Recorded by',actor||event?.actor_name],['Record entered',recordTime(event?.created_at)]];}
export function Milestone({title,children}:{title:string;children:ReactNode}){return <section className={`${s.record} ${s.success}`} aria-label={title}><div className={s.milestoneTitle}><BadgeCheck size={32} aria-hidden="true"/><h2>{title}</h2></div>{children}</section>;}
export type AuthorityRecordData={id:string;title:string;status:string;fields:[string,ReactNode][];correspondenceFields?:[string,ReactNode][];subject?:string;body?:string};
export function authorityStatus(value:string){return value==='captured_test'||value==='captured test'?'Test capture · no external delivery':value.replaceAll('_',' ');}
export function AuthorityRecord({record}:{record:AuthorityRecordData}){return <section className={s.record} aria-label={record.title}><div className={s.recordHeader}><h2>{record.title}</h2><span className={s.meta}>{authorityStatus(record.status)}</span></div><RecordGrid fields={record.fields}/>{record.body?<details><summary>View saved authority correspondence</summary>{record.correspondenceFields&&<RecordGrid fields={record.correspondenceFields}/>} {record.subject&&<h3>{record.subject.replace(/^\[INTEGRATION TEST\]\s*/,'')}</h3>}<p className={s.body}>{record.body.replace(/^TEST CAPTURE ONLY\s*[-–]\s*no external delivery\s*/i,'')}</p></details>:<p className={s.meta}>No saved authority correspondence is available.</p>}</section>;}
