"use client";
import {useEffect,useState} from "react";
import {ChevronLeft,ChevronRight} from "lucide-react";
import type {Session} from "@/lib/experiments/building-integration/reader";
import type {SnagList} from "@/lib/workspace/types";
import {stagingRead} from "@/lib/workspace/client";
import {snagListContext,snagNeighbours} from "@/lib/workspace/snag-list";
import {go} from "./TaskWorkspace";
import styles from "./Snags.module.css";
export function SnagNavigation({session,building,p}:{session:Session;building:string;p:URLSearchParams}){
 const context=snagListContext(p,building),key=context?new URLSearchParams(context).toString():"",id=p.get("snag")||"";
 const [state,setState]=useState<{key:string;previous:string|null;next:string|null;message?:string}>();
 const [revision,setRevision]=useState(0);
 useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener("workspace-operations-saved",refresh);window.addEventListener("focus",refresh);return()=>{window.removeEventListener("workspace-operations-saved",refresh);window.removeEventListener("focus",refresh)}},[]);
 const requestKey=key+":"+id+":"+revision;
 useEffect(()=>{
  if(!key)return;const abort=new AbortController();
  stagingRead<SnagList>(session,"snags",{building},abort.signal).then(data=>{
   if(abort.signal.aborted)return;
   if(data.buildingId!==building||(!data.complete&&new URLSearchParams(key).get("queue")))throw Error("List unavailable");
   const neighbours=snagNeighbours(data.rows,new URLSearchParams(key),id);
   setState({key:requestKey,...neighbours,message:neighbours.matched?undefined:"This snag is no longer in the filtered list."});
  }).catch(()=>{if(!abort.signal.aborted)setState({key:requestKey,previous:null,next:null,message:"List navigation is unavailable. Return to snags to refresh the list."})});
  return()=>abort.abort();
 },[session,building,key,id,requestKey]);
 if(!key||state?.key!==requestKey)return null;
 return <nav className={styles.recordNavigation} aria-label="Filtered snag navigation">{([[state.previous,"Previous snag",ChevronLeft],[state.next,"Next snag",ChevronRight]] as const).map(([target,label,Icon])=>target&&<button type="button" key={label} className={styles.chevron} aria-label={label} title={label} onClick={()=>go({view:"snag",building,snag:target,return:"snags",snagList:key})}><Icon size={18} aria-hidden="true"/></button>)}{state.message&&<span role="status" className={styles.navigationMessage}>{state.message}</span>}</nav>;
}
