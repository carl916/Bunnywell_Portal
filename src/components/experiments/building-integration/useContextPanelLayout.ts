"use client";
import {useEffect,type RefObject} from "react";

// A content-sized sidebar may scroll internally, but must leave room for the
// shared header and footer instead of stretching the document past the viewport.
export function useContextPanelLayout(panel:RefObject<HTMLElement|null>,ready=true){
 useEffect(()=>{
  if(!ready)return;
  const desktop=window.matchMedia("(min-width:1024px)");
  const container=panel.current?.parentElement?.tagName==='DIALOG'?panel.current.parentElement.parentElement:panel.current?.parentElement;
  let frame=0;
  const update=()=>{
   const element=panel.current,identity=document.querySelector("header[aria-label='Sale identity']"),footer=document.querySelector("#workspace-main>footer");
   if(!desktop.matches||!element||!identity)return;
   const top=getComputedStyle(identity).position==="sticky"?identity.getBoundingClientRect().height+16:16;
   element.style.setProperty("--context-top",top+"px");
   element.style.setProperty("--context-height",Math.max(0,innerHeight-Math.max(top,container?.getBoundingClientRect().top||0)-(footer?.getBoundingClientRect().height||0)-16)+"px");
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)};
  const observer=new ResizeObserver(schedule);
  if(container)observer.observe(container);
  window.addEventListener("resize",schedule);window.addEventListener("scroll",schedule,{passive:true});schedule();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("resize",schedule);window.removeEventListener("scroll",schedule)};
 },[panel,ready]);
}
