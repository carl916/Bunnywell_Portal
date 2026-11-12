"use client";
import CoreSales from "./CoreSales";
import {useEffect,useRef,useState} from "react";
import type {reader} from "@/lib/experiments/building-integration/reader";
import type {SaleRow,Scope} from "@/lib/experiments/building-contracts/contracts";
import type {SaleDetails as Details,SaleDetailsReader} from "@/lib/workspace/sale-details-types";
import {Heading,Notice,Badge,date,label,LocalLink,saleValues} from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";

export default function SaleDetails({api,scope,row,section,refresh=0,coreWritable=false,onSaved}:{api:ReturnType<typeof reader>&SaleDetailsReader;scope:Scope;row:SaleRow;section:string;refresh?:number;coreWritable?:boolean;onSaved:(message:string)=>void}){
 const key=[scope.accessRevision,row.buildingId,row.unitId,row.saleId,section].join(":"),alive=useRef(true);
 const [state,setState]=useState<{key:string;data?:Details;error?:string}>(),[fileError,setFileError]=useState("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{const c=new AbortController();api.details?.(scope,row.unitId,row.saleId!,section,c.signal).then(data=>{if(!c.signal.aborted)setState({key,data})}).catch(e=>{if(!c.signal.aborted)setState({key,error:e.message})});return()=>c.abort()},[api,scope,row.unitId,row.saleId,section,key,refresh]);
 const current=state?.key===key?state:undefined;
 async function view(version:string){
  const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;
  try{const result=await api.workflow.document({buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!},version);if(popup)popup.location.replace(result.url);else if(alive.current)setFileError("Allow a new tab to view the document.");}
  catch(e){popup?.close();if(alive.current)setFileError((e as Error).message);}
 }
 if(current?.error)return <><Heading title="Sale details unavailable"/><Notice>{current.error}</Notice></>;
 if(!current?.data)return <><Heading title="Loading sale details"/><Notice>Loading this exact building, unit and sale attempt...</Notice></>;
 const data=current.data;
 return <><Heading eyebrow={"Progression / "+data.title} title={data.title} description={row.buildingName+" / "+row.unitNumber+" · recorded sale details"}/>
  {coreWritable&&["reservation","exchange"].includes(section)&&<CoreSales key={section+":"+row.saleId} api={api} scope={{buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}} role={scope.role} section={section} refresh={refresh} onSaved={onSaved}/>}
  {data.historical&&<Notice>This is a historical sale attempt. Its dates, amounts and statuses are preserved.</Notice>}
  {data.attempts.length>1&&<section className={s.card}><h2>Sale attempts for this unit</h2><div className={s.actions}>{[...data.attempts].sort((a,b)=>b.attempt_number-a.attempt_number).map(a=><LocalLink key={a.id} className={s.button} values={{...saleValues(row),sale:a.id,section:"reservation"}}>Attempt {a.attempt_number} · {label(a.workflow_status)}{a.is_active?" · current":" · historical"}</LocalLink>)}</div></section>}
  {data.notices.map(n=><Notice key={n}>{n}</Notice>)}
  {data.groups.map(g=><section className={s.card} key={g.id}><h2>{g.title}</h2><dl className={s.keyValues}>{g.fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section>)}
  {fileError&&<div role="alert"><Notice>{fileError}</Notice></div>}
  {data.documents.map(d=><section className={s.documentCard} key={d.id}><div className={s.cardHeading}><h2>{d.title||label(d.document_type)}</h2><Badge>{label(d.status)}</Badge></div>{d.query_note&&<p className={s.queryNote}>{d.query_note}</p>}
   <p className={s.meta}>{d.document_type==="reservation_form"?"Private PDF viewing is connected for authorised participants.":"Metadata and versions are connected. File viewing for this document type is not yet available."}</p><p className={s.meta}>Approval recorded: {date(d.approved_at)}{d.approved_version_id?" · applies to the recorded approved version":""}</p>
   <details className={s.historyDisclosure} open><summary>Recorded document versions</summary>{[...d.unit_sale_document_versions].filter(v=>!v.redacted_at).sort((a,b)=>b.version_number-a.version_number).map(v=><article key={v.id}><p><strong>{v.is_current?"Current":"Previous"} · version {v.version_number}</strong> · {v.file_name} · {date(v.uploaded_at)}{d.approved_version_id===v.id?" · Approved version":""}</p><button className={s.button} disabled={!["completion_statement","draft_statement_of_account","completion_correspondence","reservation_form"].includes(d.document_type)} title="File viewing for this document type is not connected to the reviewed private-file boundary" onClick={()=>void view(v.id)}>View version {v.version_number}</button></article>)}</details>
  </section>)}
  {!coreWritable&&<Notice>Recorded details are connected. Business actions remain disabled in this integration review.</Notice>}
 </>;
}
