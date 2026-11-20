"use client";
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import type {Session} from '@/lib/experiments/building-integration/reader';
import {stagingRead} from '@/lib/workspace/client';
export function useSetupRead<T>(session:Session,kind:string,values:Record<string,string>={},refresh=0){
 const key=JSON.stringify(values),stamp=kind+key+refresh,[state,setState]=useState<{stamp:string;data?:T;error?:string}>({stamp:''});
 useEffect(()=>{const c=new AbortController();stagingRead<T>(session,kind,JSON.parse(key),c.signal).then(data=>{if(!c.signal.aborted)setState({stamp,data})}).catch(e=>{if(!c.signal.aborted)setState({stamp,error:e.message})});return()=>c.abort();},[session,kind,key,stamp]);
 return state.stamp===stamp?state:{stamp};
}
export function SetupForm(props:ComponentProps<'form'>){
 const dirty=useRef(false);
 useEffect(()=>{
  const leave=(event:Event)=>{if(dirty.current&&!window.confirm('Discard your unsaved Setup changes?'))event.preventDefault();};
  const unload=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue='';}};
  const saved=()=>{dirty.current=false};
  window.addEventListener('workspace-before-leave',leave);window.addEventListener('beforeunload',unload);window.addEventListener('workspace-operations-saved',saved);
  return()=>{window.removeEventListener('workspace-before-leave',leave);window.removeEventListener('beforeunload',unload);window.removeEventListener('workspace-operations-saved',saved);};
 },[]);
 return <form {...props} style={{display:"grid",gap:16,...props.style}} onChangeCapture={e=>{dirty.current=true;props.onChangeCapture?.(e)}}/>;
}
