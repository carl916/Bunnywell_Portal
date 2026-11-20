"use client";
import CompletionWorkspace from "./CompletionWorkspace";
import SaleDetails from "./SaleDetails";
import ExchangeWorkspace from "./ExchangeWorkspace";
import {usePathname} from "next/navigation";
import {type ReactNode} from "react";
import {reader} from "@/lib/experiments/building-integration/reader";
import type {Action as SaleAction,SaleRow,Scope} from "@/lib/experiments/building-contracts/contracts";
export {Discussion} from "./ConnectedDiscussion";
import s from "../sales-workspace/Workspace.module.css";
import {hostedWorkspace,hostedStaging} from "@/lib/workspace/staging";
import {isSetupDestination,setupHref} from "@/lib/workspace/setup-navigation";
import {originValues} from "@/lib/workspace/navigation";
import {saleActionDestination} from "@/lib/workspace/completion-navigation";
export const path="/dev/building-workspace";
export const sections=[["reservation","Reservation"],["exchange","Exchange"],["completion","Completion"],["handover","Handover"],["deposits","Deposits"],["agent-fees","Agent Fees"],["commercial","Commercial Terms"]];
export const label=(v:string)=>v.replaceAll("_"," ").replace(/^./,x=>x.toUpperCase());
export const date=(v:string|null|undefined)=>v?new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(new Date(v)):"Not recorded";
export const queueLabel=(q:string)=>q==="ours"?"Our actions":q==="others"?"Waiting on others":"Unallocated";
export function url(v:Record<string,string>,base?:string){const staging=typeof location!=="undefined"&&location.pathname==="/workspace";return (base||(staging?"/workspace":path))+"?"+new URLSearchParams(staging?originValues(v,new URLSearchParams(location.search)):v)}
export function go(v:Record<string,string>,replace=false){if(!dispatchEvent(new Event("workspace-before-leave",{cancelable:true})))return;dispatchEvent(new Event("workspace-leaving"));const next=url(v);history[replace?"replaceState":"pushState"]({},"",next);dispatchEvent(new PopStateEvent("popstate"));}
export function saleValues(r:SaleRow):Record<string,string>{return{view:"sale",building:r.buildingId,unit:r.unitId,...(r.saleId?{sale:r.saleId}:{})}}
export function actionValues(r:SaleRow,a:SaleAction){return {...saleValues(r),...saleActionDestination(a.kind,a.destination.anchor)};}
export function LocalLink({values,children,className}:{values:Record<string,string>;children:ReactNode;className?:string}){const base=usePathname();return <a href={url(values,base)} className={className} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();go(values)}}}>{children}</a>}
export function Heading({title,description,eyebrow="Building workspace"}:{title:string;description?:string;eyebrow?:string}){return <div className={s.pageHeading}><div><p className={s.eyebrow}>{eyebrow}</p><h1 tabIndex={-1}>{title}</h1>{description&&<p>{description}</p>}</div></div>}
export function Notice({children}:{children:ReactNode}){return <div className={s.notice} role="status">{children}</div>}
export function Badge({children}:{children:ReactNode}){return <span className={s.badge}>{children}</span>}
export function Action({children}:{children:ReactNode}){return <button className={s.button} disabled title="This action is not connected yet">{children}</button>}
export function SaleTask({api,scope,row,section,task,onTask,onSaved,readOnly=false,refresh=0,coreWritable=false}:{api:ReturnType<typeof reader>;scope:Scope;row:SaleRow;section:string;task:string;onTask:(v:string)=>void;onSaved:(message:string)=>void;readOnly?:boolean;refresh?:number;coreWritable?:boolean}){
 if(section==='exchange'&&hostedWorkspace)return <ExchangeWorkspace {...{api,scope,row,task,onTask,onSaved,readOnly,refresh,coreWritable}}/>;
 if(section!=="completion"&&hostedWorkspace)return <SaleDetails api={api} scope={scope} row={row} section={section} task={task} refresh={refresh} coreWritable={coreWritable} onSaved={onSaved}/>;
 return <CompletionWorkspace api={api} scope={scope} row={row} task={task} onTask={onTask} onSaved={onSaved} readOnly={readOnly} refresh={refresh} coreWritable={coreWritable}/>;
}
