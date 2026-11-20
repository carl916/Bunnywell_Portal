"use client";
/* eslint-disable @next/next/no-img-element -- authenticated in-memory thumbnails and fresh private previews. */
import {useEffect,useRef,useState} from "react";
import {CheckCircle2,ChevronRight,LoaderCircle,Video} from "lucide-react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {SnagRow,SnagDetail} from "@/lib/workspace/types";
import {stagingRead} from "@/lib/workspace/client";
import {stagingOrigin} from "@/lib/workspace/staging";
import {canCloseSnag} from "@/lib/workspace/snag-actions";
import {queueThumbnail} from "@/lib/workspace/thumbnail-queue";
import {useOperation,useOperationContext} from "./OperationsForms";
import {Badge,LocalLink,date,label} from "./TaskWorkspace";
import {isUnallocatedWork} from "@/lib/dashboard/work-classification";
import {RecordValue} from "./ProgressionRecord";
import s from "../sales-workspace/Workspace.module.css";
import styles from "./Snags.module.css";

export function SnagRegisterRows({session,building,rows,writable,onSaved}:{session:Session;building:string;rows:SnagRow[];writable:boolean;onSaved:(message:string)=>void}){
 const {data}=useOperationContext<{editable:boolean;role:string}>(session,{action:"snag_context",scope:{buildingId:building,snagId:null}});
 return <div className={styles.registerContainer}><table className={styles.table} aria-label="Building snags"><thead><tr><th>Snag / location</th><th>Trade</th><th>Status</th><th>Raised</th><th>Evidence</th><th>Actions</th></tr></thead><tbody>{rows.map(row=><SnagRegisterRow key={row.id} session={session} building={building} row={row} closeAllowed={canCloseSnag(data?.role||"",row.status,writable&&Boolean(data?.editable))} onSaved={onSaved}/>)}</tbody></table></div>;
}
function SnagRegisterRow({session,building,row,closeAllowed,onSaved}:{session:Session;building:string;row:SnagRow;closeAllowed:boolean;onSaved:(message:string)=>void}){
 const {busy,error,run}=useOperation(session,onSaved),[closed,setClosed]=useState(false),values={view:"snag",building,snag:row.id};
 const status=<Badge>{closed?"Closed":label(row.status)}</Badge>;
 return <tr><td className={styles.rowIdentity}><LocalLink values={values}>{row.title}</LocalLink><p className={styles.location}><strong>{row.unit_id?"Flat "+row.unitLabel:row.unitLabel}</strong> · {row.areaLabel}</p>{row.description&&<p className={styles.description}>{row.description}</p>}{row.actions.length>0&&<details className={styles.nextActions}><summary>Next actions ({row.actions.length})</summary>{row.actions.map(a=><p key={a.id}><strong>{a.action}</strong><br/>{a.responsibility.label} · {isUnallocatedWork(a)?"Unallocated":a.ours?"Our actions":"Waiting on others"}{a.deadline&&<> · {date(a.deadline.at)}</>}</p>)}</details>}</td>
 <td className={styles.desktopMetadata}><RecordValue value={row.tradeLabel}/></td><td className={styles.desktopMetadata}>{status}</td><td className={styles.desktopMetadata}>{date(row.created_at)}</td>
 <td className={styles.rowEvidence}>{row.evidence?<SnagEvidence session={session} building={building} row={row}/>:<span className={styles.noEvidence}>No evidence</span>}</td>
 <td className={styles.rowActionCell}><div className={styles.rowActions}>{closeAllowed&&!closed&&<button type="button" disabled={busy} onClick={()=>void run({action:"close_snag",scope:{buildingId:building,snagId:row.id},payload:{expected:row.updated_at,comment:""}},"Snag closed after developer review.").then(result=>{if(result)setClosed(true)})}><CheckCircle2 size={15} aria-hidden/>{busy?"Closing…":"Close"}</button>}<LocalLink values={values}>Details <ChevronRight size={15} aria-hidden/></LocalLink></div>{error&&<p role="alert" className={styles.rowError}>{error}</p>}</td>
 <td className={styles.compactMetadata}>{status}<span>Trade: <RecordValue value={row.tradeLabel}/></span><span>Raised {date(row.created_at)}</span></td></tr>;
}
function SnagEvidence({session,building,row}:{session:Session;building:string;row:SnagRow}){
 const evidence=row.evidence!,button=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null);
 const [thumb,setThumb]=useState(""),[state,setState]=useState<"loading"|"ready"|"error">("loading"),[retry,setRetry]=useState(0);
 const [preview,setPreview]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false),request=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(evidence.media_type==="video")return;
  const abort=new AbortController();let visible=false,pending=false,ready=false,attempts=0,timer:ReturnType<typeof setTimeout>|undefined;
  setThumb("");setState("loading");
  async function load(){
   if(abort.signal.aborted||!visible||pending||ready)return;
   pending=true;setState("loading");attempts++;
   try{
    const data=await queueThumbnail(()=>stagingRead<{url:string}>(session,"snag-thumbnail",{building,snag:row.id,photo:evidence.id},AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])),abort.signal);
    if(!data.url?.startsWith("data:image/webp;base64,"))throw Error("Invalid thumbnail");
    if(!abort.signal.aborted){ready=true;setThumb(data.url);setState("ready");}
   }catch{
    if(!abort.signal.aborted){setState("error");if(attempts<3)timer=setTimeout(()=>void load(),attempts*1500);}
   }finally{pending=false;}
  }
  // Keep observing after failures. A visible row retries without requiring a scroll.
  const observer=typeof IntersectionObserver==="undefined"?null:new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible&&attempts<3)void load();},{rootMargin:"160px"});
  if(observer&&button.current)observer.observe(button.current);else{visible=true;void load();}
  const recover=()=>{if(visible&&!pending&&!ready){attempts=0;clearTimeout(timer);void load();}};
  window.addEventListener("online",recover);
  return()=>{observer?.disconnect();clearTimeout(timer);abort.abort();window.removeEventListener("online",recover);};
 },[session,building,row.id,evidence.id,evidence.media_type,retry]);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function open(){
  dialog.current?.showModal();setLoading(true);setPreview("");setError("");request.current?.abort();const abort=new AbortController();request.current=abort;
  try{const data=await stagingRead<SnagDetail>(session,"snag",{building,snag:row.id},abort.signal),photo=data.photos.find(p=>p.id===evidence.id);if(!photo||new URL(photo.file_url).origin!==stagingOrigin)throw Error("Evidence preview unavailable. Open Details to review this record.");if(!abort.signal.aborted)setPreview(photo.file_url)}catch(e){if(!abort.signal.aborted)setError((e as Error).message)}finally{if(!abort.signal.aborted)setLoading(false)}
 }
 return <><div className={styles.thumbnail}><button ref={button} type="button" className={styles.evidenceButton} aria-label={"Preview evidence for "+row.title} onClick={()=>void open()}>{thumb?<img src={thumb} alt={"Photo for "+row.title} width={72} height={72} onError={()=>{setThumb("");setState("error")}}/>:evidence.media_type==="video"?<Video size={22} aria-hidden/>:state==="error"?<span>Photo unavailable</span>:<LoaderCircle size={20} aria-label="Loading photo"/>}</button>{state==="error"&&evidence.media_type!=="video"&&<button type="button" className={styles.retryThumbnail} onClick={()=>setRetry(v=>v+1)} aria-label={"Retry photo for "+row.title}>Retry photo</button>}</div>
 <dialog ref={dialog} className={styles.preview} aria-label={"Evidence for "+row.title} onClose={()=>{request.current?.abort();setPreview("");setLoading(false)}}><header><strong>{row.title}</strong><button type="button" className={s.button} onClick={()=>dialog.current?.close()}>Close preview</button></header>{loading&&<p role="status">Loading evidence…</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>void open()}>Retry preview</button></p>}{preview&&(evidence.media_type==="video"?<video src={preview} controls playsInline/>:<img src={preview} alt={"Evidence for "+row.title} onError={()=>{setPreview("");setError("Photo could not be loaded.")}}/>)}</dialog></>;
}
