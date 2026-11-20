"use client";
import {Check,ClipboardList,Handshake,FileCheck2,KeyRound,Coins,CheckCheck,ReceiptPoundSterling} from "lucide-react";
import type {SaleRow} from "@/lib/experiments/building-contracts/contracts";
import {go,url,saleValues,sections} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
// Original accepted SalesWorkspacePrototype mapping, independent of workflow status.
export const saleSectionIcons:Record<string,typeof ClipboardList>={reservation:ClipboardList,exchange:Handshake,completion:FileCheck2,handover:KeyRound,deposits:ReceiptPoundSterling,'agent-fees':Coins,commercial:CheckCheck};
export default function SaleNavigation({row,section,role,onNavigate,className=""}:{row:SaleRow;section:string;role:string;onNavigate:()=>void;className?:string}){
 return <nav className={`${s.saleNav} ${className}`} aria-label="Sale destinations">{[['Progression',['reservation','exchange','completion','handover']],['Financials',['deposits','agent-fees']],['Commercial',['commercial']]].map(([group,ids])=><div key={String(group)}><h2 className={s.navGroup}>{group}</h2>{sections.filter(([id])=>(ids as string[]).includes(id)&&(id!=='agent-fees'||role!=='conveyancer')).map(([id,name])=>{
  const state=row.progression?.stages[id];const Icon=saleSectionIcons[id];
  return <a className={s.saleLink} data-stage={state} key={id} aria-current={section===id?'page':undefined} href={url({...saleValues(row),section:id})} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();go({...saleValues(row),section:id});onNavigate();}}}><Icon size={19} strokeWidth={1.75} aria-hidden="true"/><span>{name}{state&&<small>{state==='complete'&&<Check size={12} aria-hidden="true"/>}{state==='complete'?'Done':state==='current'?'Current':'Upcoming'}</small>}</span></a>;
 })}</div>)}</nav>;
}
