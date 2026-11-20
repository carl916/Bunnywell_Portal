"use client";
import {useEffect,useState} from 'react';
import s from '../sales-workspace/Workspace.module.css';

export function useSetupFeedback(scope:string){
 const [feedback,setFeedback]=useState({scope,message:''});
 // Hide synchronously on navigation and discard the message, so returning to a
 // previous tab cannot bring old feedback back.
 useEffect(()=>{setFeedback({scope,message:''})},[scope]);
 useEffect(()=>{
  if(!feedback.message)return;
  const timer=window.setTimeout(()=>setFeedback(current=>current===feedback?{...current,message:''}:current),5000);
  return()=>window.clearTimeout(timer);
 },[feedback]);
 return {message:feedback.scope===scope?feedback.message:'',show:(message:string)=>setFeedback({scope,message})};
}
export function SetupFeedback({message}:{message:string}){
 return message?<div className={s.notice} role="status" aria-live="polite">{message}</div>:null;
}
