"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
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
   if(alive.current){pending.current={key:"",id:""};const feedback=result as {message?:string}|null;onSaved((value.action==="save_team"||value.action==="remove_team")&&typeof feedback?.message==="string"?feedback.message:message);window.dispatchEvent(new Event("workspace-operations-saved"))}
   return alive.current?result:null;
  }catch(e){if(alive.current)setError((e as Error).message);return null}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 return {busy,error,run};
}
export function OperationError({error}:{error?:string}){return error?<div role="alert" className={`${s.notice} ${s.errorNotice}`}>{error}</div>:null}
export function FormFields({busy,children}:{busy:boolean;children:ReactNode}){return <fieldset className={s.formFields} disabled={busy} style={{border:0,padding:0,minWidth:0}}>{children}</fieldset>}
export {EvidencePicker} from "./SnagEvidencePicker";
