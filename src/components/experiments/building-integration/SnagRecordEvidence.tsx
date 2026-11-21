"use client";
/* eslint-disable @next/next/no-img-element -- short-lived authorised media must bypass public image caches. */
import {useEffect,useRef,useState,type ReactNode} from "react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {SnagDetail} from "@/lib/workspace/types";
import {compareSnagEvidence} from "@/lib/workspace/snag-evidence";
import {stagingRead} from "@/lib/workspace/client";
import {stagingOrigin} from "@/lib/workspace/staging";
import {label} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
import styles from "./Snags.module.css";

const safeMedia=(url:string)=>{try{return new URL(url).origin===stagingOrigin?url:""}catch{return ""}};
export function SnagRecordEvidence({session,building,data,children}:{session:Session;building:string;data:SnagDetail;children:ReactNode}){
 const photos=[...data.photos].sort(compareSnagEvidence),main=photos.find(p=>p.media_type!=="video");
 return <><section className={`${s.card} ${styles.recordEvidence}`} aria-label="Snag photo and description"><div className={main?styles.photoDescription:undefined}>
 {main&&<RecordPhoto key={main.id} session={session} building={building} snagId={data.snag.id} photo={main} main/>}
 <div className={styles.recordDetails}>
   <section className={styles.recordDescription}><h2>Description</h2><p>{data.snag.description||"No description recorded."}</p></section>
   {children}
 </div></div></section>
 {photos.some(p=>p.id!==main?.id)&&<section className={s.card}><details className={styles.additionalEvidence}><summary>Additional photos & videos ({photos.length-(main?1:0)})</summary><div className={s.documentGrid}>{photos.filter(p=>p.id!==main?.id).map(photo=><RecordPhoto key={photo.id} session={session} building={building} snagId={data.snag.id} photo={photo}/>)}</div></details></section>}
 </>;
}
function RecordPhoto({session,building,snagId,photo,main=false}:{session:Session;building:string;snagId:string;photo:SnagDetail["photos"][number];main?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null),[source,setSource]=useState(safeMedia(photo.file_url)),[failed,setFailed]=useState(false),[preview,setPreview]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{setSource(safeMedia(photo.file_url));setFailed(false)},[photo.file_url]);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(full:boolean){
  if(full)dialog.current?.showModal();setLoading(true);setError("");setPreview("");request.current?.abort();const abort=new AbortController();request.current=abort;
  try{const detail=await stagingRead<SnagDetail>(session,"snag",{building,snag:snagId},abort.signal),url=safeMedia(detail.photos.find(p=>p.id===photo.id)?.file_url||"");if(!url)throw Error("Photo unavailable. Please retry.");if(!abort.signal.aborted){setSource(url);setFailed(false);if(full)setPreview(url);}}catch(e){if(!abort.signal.aborted)setError((e as Error).message)}finally{if(!abort.signal.aborted)setLoading(false)}
 }
 return <figure className={styles.recordPhoto}>
 {photo.media_type==="video"?<button type="button" className={s.button} onClick={()=>void load(true)}>Open video</button>:failed||!source?<div className={styles.mediaError}><p>Photo could not be loaded.</p><button type="button" className={s.button} disabled={loading} onClick={()=>void load(false)}>{loading?"Loading photo…":"Retry photo"}</button>{error&&<p role="alert">{error}</p>}</div>:<button type="button" className={styles.photoOpen} aria-label={main?"Open main snag photo at full size":"Open additional snag photo at full size"} onClick={()=>void load(true)}><img src={source} alt={photo.caption||label(photo.photo_type)+" snag photograph"} loading={main?"eager":"lazy"} fetchPriority={main?"high":"auto"} onError={()=>setFailed(true)}/><span>Open full-size photo</span></button>}
 <figcaption>{label(photo.photo_type)}{photo.caption&&<> · {photo.caption}</>}</figcaption>
 <dialog ref={dialog} className={styles.preview} aria-label="Full-size snag evidence" onClose={()=>{request.current?.abort();setPreview("");setLoading(false)}}><header><strong>{label(photo.photo_type)} evidence</strong><button type="button" className={s.button} onClick={()=>dialog.current?.close()}>Close preview</button></header>{loading&&<p role="status">Loading evidence…</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>void load(true)}>Retry preview</button></p>}{preview&&(photo.media_type==="video"?<video src={preview} controls playsInline/>:<img src={preview} alt={photo.caption||"Full-size snag photograph"} onError={()=>{setPreview("");setError("Photo could not be loaded.")}}/>)}</dialog>
 </figure>;
}
