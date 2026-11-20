"use client";
import {selectSnags} from "@/lib/workspace/snag-list";
import {Pagination} from "./Pagination";
/* eslint-disable @next/next/no-img-element -- public evidence is read directly; no image proxy or transformation. */
import {SnagControls,SnagComposer} from "./SnagControls";
import {useContextPanelLayout} from "./useContextPanelLayout";
import {SnagRegisterRows} from "./SnagRegisterRows";
import {SnagRecordEvidence} from "./SnagRecordEvidence";
import snagStyles from "./Snags.module.css";


import {useEffect,useRef,useState} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {PortalSnapshot,SnagList,SnagDetail,BuildingDetail,SetupData} from "@/lib/workspace/types";
import {stagingRead} from "@/lib/workspace/client";
import {moduleAllowed} from "@/lib/workspace/staging";
import {matchesWorkTeam,isUnallocatedWork} from "@/lib/dashboard/work-classification";
import {initialDefectsReportingEndDate} from "@/lib/building-lifecycle";
import {Heading,Notice,Badge,LocalLink,label,date,go,actionValues,queueLabel} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
export function BuildingOverview({snapshot,onList}:{snapshot:PortalSnapshot;onList:()=>void}){
 const role=snapshot.scope.role,items=snapshot.overview?.items.filter(i=>i.module==="snags")||[];
 const snagReady=snapshot.overview?.sources.find(s=>s.key==="snags")?.state==="ready";
 return <><Heading title="Your building at a glance" description="Building position and routes into your team's work."/>
 <div className={s.dashboardGrid}>{moduleAllowed(role,"sales")&&<section className={s.card}><h2>Sales</h2><div className={s.stageCounts}>{Object.entries(snapshot.counts.stages).map(([stage,count])=><button key={stage} onClick={()=>go({view:"worklist",building:snapshot.building.id,stage})}>{label(stage)} <strong>{count}</strong></button>)}</div>
 {(["ours","others","unallocated"] as const).map(q=><p key={q}><LocalLink values={{view:"worklist",building:snapshot.building.id,queue:q}}>{queueLabel(q)}</LocalLink> · {snapshot.counts[q]?snapshot.counts[q]!.actions+" actions across "+snapshot.counts[q]!.sales+" sales":"Unavailable"}</p>)}
 <p className={s.meta}>A sale may appear in both teams&apos; counts. {snapshot.counts.distinctSales??"Unavailable"} distinct sales with actions. Historical fee obligations are included separately from current unit stages.</p>
 <button className={s.primary} onClick={onList}>Open sales worklist</button></section>}
 {moduleAllowed(role,"snags")&&<section className={s.card}><h2>Snags & defects</h2>{snapshot.overview?.summaries.filter(x=>["developer_snags","resident_defects"].includes(x.key)).map(x=><p key={x.key}>{x.label} · <strong>{x.value??"Unavailable"}</strong></p>)}
 {(["ours","others","unallocated"] as const).map(q=>{const selected=items.filter(i=>q==="unallocated"?isUnallocatedWork(i):matchesWorkTeam(i,q));return <p key={q}><LocalLink values={{view:"snags",building:snapshot.building.id,queue:q}}>{queueLabel(q)}</LocalLink> · {snagReady?(snapshot.overview?.queues?.[q]?.actions??selected.length)+" actions across "+(snapshot.overview?.queues?.[q]?.records??new Set(selected.map(i=>i.recordKey)).size)+" records":"Unavailable"}</p>})}
 <LocalLink className={s.primary} values={{view:"snags",building:snapshot.building.id}}>Open snags register</LocalLink></section>}</div>
 <section className={s.card}><h2>Needs attention</h2><p className={s.meta}>A small selection from the same worklist rules. Open a module for all records.</p>
 {snapshot.rows.filter(r=>r.actions.some(a=>a.queue==="ours")).slice(0,2).map(r=><LocalLink key={r.saleId} className={s.taskRow} values={actionValues(r,r.actions.find(a=>a.queue==="ours")!)}><strong>{r.unitNumber}</strong><span>{r.actions.find(a=>a.queue==="ours")?.title}</span></LocalLink>)}
 {items.filter(i=>matchesWorkTeam(i,"ours")&&i.destination?.snagId).slice(0,2).map(i=><LocalLink className={s.taskRow} key={i.id} values={{view:"snag",building:snapshot.building.id,snag:i.destination!.snagId!}}><strong>{i.reference}</strong><span>{i.action}</span></LocalLink>)}
 {!snapshot.rows.some(r=>r.actions.some(a=>a.queue==="ours"))&&!items.some(i=>matchesWorkTeam(i,"ours"))&&<p>No actions shown for your team in the available sources.</p>}</section></>;
}
function useRead<T>(session:Session,kind:string,values:Record<string,string>,refresh=0){
 const key=JSON.stringify(values),[state,set]=useState<{key:string;data?:T;error?:string}>({key:""});
 useEffect(()=>{const c=new AbortController();stagingRead<T>(session,kind,JSON.parse(key),c.signal).then(data=>{if(!c.signal.aborted)set({key,data})}).catch(e=>{if(!c.signal.aborted)set({key,error:e.message})});return()=>c.abort()},[session,kind,key,refresh]);
 return state.key===key?state:{key};
}
export function SnagsRegister({session,building,p,writable=false}:{session:Session;building:string;p:URLSearchParams;writable?:boolean}){
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState("");
 const {data,error}=useRead<SnagList>(session,"snags",{building},refresh);
 const q=p.get("q")||"",status=p.get("status")||"",source=p.get("source")||"",queue=p.get("queue")||"";
 const update=(change:Record<string,string>,replace=false)=>go({...Object.fromEntries(p),page:"1",...change},replace);
 if(error)return <><Heading title="Snags unavailable"/><Notice>{error}</Notice></>;
 if(!data)return <><Heading title="Loading snags"/><Notice>Loading this building&apos;s records only.</Notice></>;
 const filtered=selectSnags(data.rows,p);
 const pages=Math.max(1,Math.ceil(filtered.length/20)),page=Math.min(pages,Math.max(1,Math.floor(Number(p.get("page")))||1));
 return <><Heading title="Snags register" description="Developer snagging and resident defects for this building."/>{notice&&<Notice>{notice}</Notice>}{writable&&<SnagControls session={session} building={building} refresh={refresh} onSaved={m=>{setNotice(m);setRefresh(v=>v+1)}}/>}
 {!data.complete&&<Notice>Action information is incomplete. Counts are unavailable; this is not a clear worklist.</Notice>}
 <section className={s.listCard}><div className={snagStyles.filters}><label>Search this building<input aria-label="Search snags" placeholder="Unit, location or description" value={q} onChange={e=>update({q:e.target.value},true)}/></label>
 <label>Status<select aria-label="Status" value={status} onChange={e=>update({status:e.target.value})}><option value="">All statuses</option>{[...new Set(data.rows.map(r=>r.status))].sort().map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
 <label>Source<select aria-label="Source" value={source} onChange={e=>update({source:e.target.value})}><option value="">All sources</option>{[...new Set(data.rows.map(r=>r.source_type))].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
 <label>Responsibility<select aria-label="Responsibility" value={queue} onChange={e=>update({queue:e.target.value})}><option value="">All responsibilities</option>{["ours","others","unallocated"].map(v=><option key={v} value={v}>{queueLabel(v)}</option>)}</select></label><label>Sort by<select aria-label="Sort snags" value={p.get("sort")||"unit"} onChange={e=>update({sort:e.target.value})}><option value="unit">Floor and unit</option><option value="raised-asc">Raised · oldest first</option><option value="raised-desc">Raised · newest first</option></select></label></div>
 <SnagRegisterRows session={session} building={building} rows={filtered.slice((page-1)*20,page*20)} writable={writable} onSaved={m=>{setNotice(m);setRefresh(v=>v+1)}}/>
 {!filtered.length&&<div className={s.emptyList}>No snags match these filters. <button className={s.button} onClick={()=>update({q:"",queue:"",source:"",status:"",unit:""})}>Clear filters</button></div>}
 <Pagination total={filtered.length} page={page} noun="snags" onPage={page=>update({page:String(page)})}/></section></>;
}
export function SnagWorkspace({session,building,snagId,onIdentity,writable=false}:{session:Session;building:string;snagId:string;writable?:boolean;onIdentity:(v:{id:string;buildingId:string;title:string;unit:string}|null)=>void}){
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState("");
 const {data,error}=useRead<SnagDetail>(session,"snag",{building,snag:snagId},refresh);
 const [view,setView]=useState("comments"),[older,setOlder]=useState<SnagDetail["events"]>([]),[more,setMore]=useState<boolean|null>(null),[loadError,setLoadError]=useState("");
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{onIdentity(data?{id:snagId,buildingId:building,title:data.snag.title,unit:data.snag.unitLabel}:null);return()=>onIdentity(null)},[data,snagId,onIdentity,building]);
 useContextPanelLayout(panel,Boolean(data));
 if(error)return <><Heading title="Snag unavailable"/><Notice>{error}</Notice></>;
 if(!data)return <><Heading title="Loading snag"/><Notice>No previous record is displayed.</Notice></>;
 const saved=(m:string)=>{setNotice(m);setOlder([]);setMore(null);setRefresh(v=>v+1)};
 const events=[...data.events,...older],notes=events.filter(e=>e.comment),shown=view==="comments"?notes:events;
 return <div className={s.saleLayout}><div className={s.saleTask}><header className={snagStyles.recordHeader}><Heading title={data.snag.title} eyebrow="Snags / Record"/><p className={snagStyles.recordLocation}>{data.snag.unit_id?"Flat "+data.snag.unitLabel:data.snag.unitLabel} · {data.snag.areaLabel}</p><div className={snagStyles.recordMetadata}><Badge>{label(data.snag.status)}</Badge><span>Raised {date(data.snag.created_at)}</span>{data.snag.sla_due_date&&<span>Due {date(data.snag.sla_due_date)}</span>}</div></header>
 <SnagRecordEvidence session={session} building={building} data={data}/>
 {notice&&<Notice>{notice}</Notice>}{writable&&<SnagControls session={session} building={building} snagId={snagId} refresh={refresh} informationQuestion={data.informationQuestion} onSaved={saved}/>}
 </div>
 <aside className={s.contextPanel} id="sale-context-panel" ref={panel}><header className={s.contextHeader}><h2 id="sale-context-heading" tabIndex={-1}>Comments & activity</h2><p>{data.snag.unitLabel} · {data.snag.title}</p></header><div className={s.drawerTabs}>{["comments","activity"].map(v=><button key={v} aria-pressed={v===view} onClick={()=>setView(v)}>{label(v)}</button>)}</div>
 <div className={s.contextMessages} tabIndex={0} role="region" aria-label={view==="comments"?"Snag comments":"Snag activity"}>{!shown.length&&<p>No {view} in this page of history.</p>}{shown.map(e=><article className={s.comment} key={e.id}><div><strong>{e.actor_name||"Recorded actor"} · {label(e.event_type)}</strong>{view==="activity"&&<p>{e.old_value?label(e.old_value)+" → ":""}{label(e.new_value||"")}</p>}{e.comment&&<p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{e.comment}</p>}<small>{date(e.created_at)}</small></div></article>)}
 {(more??data.moreEvents)&&<button className={s.button} onClick={async()=>{try{const last=events.at(-1)!;const next=await stagingRead<SnagDetail>(session,"snag",{building,snag:snagId,before:last.created_at+"|"+last.id});setOlder(v=>[...v,...next.events]);setMore(next.moreEvents)}catch(e){setLoadError((e as Error).message)}}}>Load older history</button>}{loadError&&<Notice>{loadError}</Notice>}</div>
 {writable?<SnagComposer session={session} building={building} snagId={snagId} onSaved={saved}/>:(<div className={s.contextComposer}><label className={s.field}>Comment<textarea aria-label="Snag comment" disabled placeholder="Comments are read-only in this staging review."/></label><button className={s.button} disabled>Send comment</button></div>)}</aside></div>;
}
