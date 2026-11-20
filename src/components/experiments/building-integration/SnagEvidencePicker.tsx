"use client";
/* eslint-disable @next/next/no-img-element -- short-lived local file previews do not use the image proxy. */
import {useEffect,useState} from "react";
import {Camera,Video,FileCheck2,X} from "lucide-react";
import s from "../sales-workspace/Workspace.module.css";
import styles from "./Snags.module.css";

export function EvidencePicker({id,file,onFile,disabled=false}:{id:string;file:File|null;onFile:(file:File|null)=>void;disabled?:boolean}){
 const [error,setError]=useState(""),[preview,setPreview]=useState<{file:File;url:string}|null>(null);
 useEffect(()=>{if(!file?.type.startsWith("image/"))return;const url=URL.createObjectURL(file);setPreview({file,url});return()=>URL.revokeObjectURL(url)},[file]);
 function choose(files:FileList|null){
  if(disabled||!files?.length)return;
  if(files.length>1){setError("Choose one attachment at a time. You can add more evidence from the saved snag.");return}
  const f=files[0];
  if(!["image/jpeg","image/png","image/webp","video/mp4","video/webm"].includes(f.type)||f.size>4*1024*1024||f.size<8){setError("Choose JPEG, PNG, WebP, MP4 or WebM evidence up to 4 MiB.");return}
  setError("");onFile(f);
 }
 const input=(suffix:string,accept:string,capture?:"environment")=><input id={id+suffix} type="file" accept={accept} capture={capture} disabled={disabled} aria-describedby={id+"-guidance"} onChange={e=>{choose(e.target.files);e.target.value=""}}/>;
 return <div className={styles.evidence} data-disabled={disabled} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files)}}>
  <div className={styles.mediaButtons}><label><Camera size={20} aria-hidden/>Add or take photo{input("-photo","image/*","environment")}</label><label><Video size={20} aria-hidden/>Video{input("-video","video/*","environment")}</label></div>
  <div className={styles.library}><label>Choose existing photo{input("-photo-library","image/jpeg,image/png,image/webp")}</label><label>Choose existing video{input("-video-library","video/mp4,video/webm")}</label></div>
  <p id={id+"-guidance"} className={styles.guidance}>JPEG, PNG, WebP, MP4 or WebM · maximum 4 MiB · one attachment at a time. You can also drop a file here.</p>
  {file&&<div className={styles.selection}>{preview?.file===file?<img src={preview.url} alt="Selected snag evidence"/>:file.type.startsWith("video/")?<Video size={28} aria-hidden/>:<FileCheck2 size={28} aria-hidden/>}<div><strong>{file.name}</strong><p className={styles.guidance}>{Math.ceil(file.size/1024)} KB · selected</p><button className={s.textButton} type="button" disabled={disabled} onClick={()=>{setError("");onFile(null)}}><X size={14} aria-hidden/> Remove selected evidence</button></div></div>}
  {error&&<p role="alert" className={styles.rowError}>{error}</p>}
 </div>;
}
