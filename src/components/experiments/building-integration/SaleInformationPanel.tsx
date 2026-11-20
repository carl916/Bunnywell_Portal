"use client";

import {useLayoutEffect,useRef,useSyncExternalStore,type ReactNode} from "react";
import {X} from "lucide-react";
import styles from "./SaleInformationPanel.module.css";

const desktopQuery="(min-width: 1024px)";
const subscribe=(notify:()=>void)=>{
 const query=window.matchMedia(desktopQuery);
 query.addEventListener("change",notify);
 return()=>query.removeEventListener("change",notify);
};
const snapshot=()=>window.matchMedia(desktopQuery).matches;
const serverSnapshot=()=>null;

// Unknown during server rendering: never eagerly load an invisible mobile panel.
export function useSaleInformationDesktop(){
 return useSyncExternalStore(subscribe,snapshot,serverSnapshot);
}

export default function SaleInformationPanel({children,desktop,open,onClose,buildingName,unitNumber}:{
 children:ReactNode;desktop:boolean|null;open:boolean;onClose?:()=>void;buildingName:string;unitNumber:string;
}){
 const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),heading=useRef<HTMLDivElement>(null);
 const close=useRef(onClose);
 useLayoutEffect(()=>{close.current=onClose;},[onClose]);
 useLayoutEffect(()=>{
  const element=dialog.current;
  if(!element||desktop===null)return;
  if(desktop){
   // A non-modal desktop wrapper never takes focus from the workflow.
   element.setAttribute("open","");
   return()=>element.removeAttribute("open");
  }
  if(!open)return;
  const invoker=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const root=document.documentElement,body=document.body;
  const position={left:window.scrollX,top:window.scrollY};
  const previous={rootOverflow:root.style.overflow,bodyOverflow:body.style.overflow,scrollBehavior:root.style.scrollBehavior};
  root.style.overflow="hidden";
  body.style.overflow="hidden";
  element.showModal();
  closeButton.current?.focus({preventScroll:true});
  element.scrollTop=0;
  return()=>{
   if(element.open)element.close();
   root.style.overflow=previous.rootOverflow;
   body.style.overflow=previous.bodyOverflow;
   root.style.scrollBehavior="auto";
   window.scrollTo(position);
   if(invoker?.isConnected)invoker.focus({preventScroll:true});
   root.style.scrollBehavior=previous.scrollBehavior;
  };
 },[desktop,open]);
 useLayoutEffect(()=>{
  if(desktop!==false||!open||!heading.current||!dialog.current)return;
  const element=heading.current,panel=dialog.current;
  const measure=()=>panel.style.setProperty("--sale-information-heading-height",`${element.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(measure);
  observer.observe(element);measure();
  return()=>observer.disconnect();
 },[desktop,open]);

 return <dialog ref={dialog} id="sale-information-dialog" className={styles.panel}
  role={desktop?"presentation":undefined} aria-modal={desktop===false?true:undefined}
  aria-labelledby={desktop?undefined:"mobile-sale-information-title"}
  onCancel={event=>{event.preventDefault();close.current?.();}}>
  <div ref={heading} className={styles.heading}>
   <div><h2 id="mobile-sale-information-title">Sale information</h2><p>{buildingName} / {unitNumber}</p></div>
   <button ref={closeButton} type="button" aria-label="Close sale information" onClick={()=>close.current?.()}><X size={22} aria-hidden="true"/></button>
  </div>
  {children}
 </dialog>;
}
