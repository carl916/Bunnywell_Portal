"use client";
import {createContext,useContext,useEffect,useState,useSyncExternalStore} from 'react';
import {createRecordRead,type createRecordReadiness} from '@/lib/workspace/record-read';

export const RecordReadinessContext=createContext<ReturnType<typeof createRecordReadiness>|null>(null);

export function useRecordRead<T>(key:string,read:(signal:AbortSignal)=>Promise<T>,refresh:number){
 const [store]=useState(()=>createRecordRead<T>()),[retry,setRetry]=useState(0);
 const readiness=useContext(RecordReadinessContext);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 useEffect(()=>{
  let live=true;
  readiness?.set(store,false);
  void store.load(key,read,()=>window.dispatchEvent(new Event('workspace-access-invalid'))).then(()=>{
   if(live)readiness?.set(store,store.getSnapshot().data!==undefined);
  });
  return()=>{live=false;store.cancel();readiness?.remove(store);};
 },[store,key,read,refresh,retry,readiness]);
 const current=state.key===key?state:undefined;
 return {data:current?.data,error:current?.error||'',loading:!current||current.loading,retry:()=>setRetry(v=>v+1)};
}
