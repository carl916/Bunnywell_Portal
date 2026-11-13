"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {UploadCloud,FileCheck2} from "lucide-react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import {operation,snagEvidence} from "@/lib/workspace/operations-client";
import {Notice} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
export function useOperationContext<T>(session:Session,value:Record<string,unknown>,refresh=0){
 const key=JSON.stringify(value),stamp=key+":"+refresh,[state,setState]=useState<{stamp:string;data?:T;error?:string}>({stamp:""});
 useEffect(()=>{const c=new AbortController();operation<T>(session,JSON.parse(key),c.signal).then(data=>{if(!c.signal.aborted)setState({stamp,data})}).catch(e=>{if(!c.signal.aborted)setState({stamp,error:e.message})});return()=>c.abort()},[session,key,stamp]);
 return state.stamp===stamp?state:{stamp};
}
export function useOperation(session:Session,onSaved:(message:string)=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),pending=useRef({key:"",id:""}),alive=useRef(true),inFlight=useRef(false),abort=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort()}},[]);
 async function run(value:Record<string,unknown>,message:string,file?:File|null){
  if(inFlight.current)return null;inFlight.current=true;setBusy(true);setError("");
  const key=JSON.stringify({value,file:file?{name:file.name,size:file.size,lastModified:file.lastModified}:null});
  if(key!==pending.current.key)pending.current={key,id:crypto.randomUUID()};
  abort.current=new AbortController();
  try{
   const body={...value,requestId:pending.current.id},result=file?await snagEvidence(session,body,file,abort.current.signal):await operation(session,body,abort.current.signal);
   if(alive.current){pending.current={key:"",id:""};onSaved(message);window.dispatchEvent(new Event("workspace-operations-saved"))}
   return alive.current?result:null;
  }catch(e){if(alive.current)setError((e as Error).message);return null}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 return {busy,error,run};
}
export function OperationError({error}:{error?:string}){return error?<div role="alert"><Notice>{error}</Notice></div>:null}
export function FormFields({busy,children}:{busy:boolean;children:ReactNode}){return <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>{children}</fieldset>}
export function EvidencePicker({id,file,onFile,disabled=false}:{id:string;file:File|null;onFile:(file:File|null)=>void;disabled?:boolean}){
 const [error,setError]=useState("");
 function choose(f:File|null){
  if(f&&(!["image/jpeg","image/png","image/webp","video/mp4","video/webm"].includes(f.type)||f.size>4*1024*1024||f.size<8)){setError("Choose JPEG, PNG, WebP, MP4 or WebM evidence up to 4 MiB.");return}
  setError("");onFile(f);
 }
 return <div className="my-4"><label htmlFor={id} className={"upload-target block rounded-bw-card border border-dashed border-[#9bb5a6] bg-[#f5f8f5] p-5 text-center "+(disabled?"opacity-60":"cursor-pointer")} onDragOver={e=>{if(!disabled)e.preventDefault()}} onDrop={e=>{if(!disabled){e.preventDefault();choose(e.dataTransfer.files[0]??null)}}}>
 {file?<FileCheck2 className="mx-auto" size={26} aria-hidden/>:<UploadCloud className="mx-auto" size={26} aria-hidden/>}
 <span className="mt-2 block font-bold">{file?file.name:"Choose or drop test evidence"}</span><span className="mt-1 block text-sm">{file?(file.size/1024).toFixed(0)+" KB · selected":"JPEG, PNG, WebP, MP4 or WebM · maximum 4 MiB"}</span>
 <input id={id} aria-label="Snag evidence file" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" disabled={disabled} onChange={e=>{choose(e.target.files?.[0]??null);e.target.value=""}}/></label>
 {file&&<button type="button" className={s.button} disabled={disabled} onClick={()=>choose(null)}>Remove selected evidence</button>}<OperationError error={error}/></div>;
}