"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Building2, ChevronRight, Menu, X } from "lucide-react";
import { contractVersion, offlinePath, sameScope, type Catalog, type Scope, type SaleRow } from "@/lib/experiments/building-contracts/contracts";
import { createWorkspaceSession } from "@/lib/experiments/building-contracts/session";
import { filtersFrom, readReturn, returnKey, type Filters } from "@/lib/experiments/building-contracts/navigation";
import s from "./Workspace.module.css";

const event="building-contracts-navigation";
const subscribe=(f:()=>void)=>{window.addEventListener("popstate",f);window.addEventListener(event,f);return()=>{window.removeEventListener("popstate",f);window.removeEventListener(event,f);};};
const locationSnapshot=()=>window.location.search;
function move(p:URLSearchParams,replace=false){window.history[replace?"replaceState":"pushState"]({}, "",offlinePath+(p.size?"?"+p:""));window.dispatchEvent(new Event(event));}
async function readFixture(p:URLSearchParams,signal:AbortSignal) {
  const response=await fetch(offlinePath+"/fixtures?"+p,{signal,cache:"no-store"});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error??"Sample unavailable");
  return value;
}
const names={developer:"Developer","developer-single":"Developer · one building",admin:"Admin",agent:"Sales agent","agent-colleague":"Sales agent colleague","agent-other":"Other agent organisation",conveyancer:"Conveyancer"};
const stageName=(stage:string)=>stage.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());
const queueName=(queue:string)=>queue==="ours"?"Our actions":queue==="others"?"Waiting on others":"Unallocated";

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current!,trigger=document.activeElement;dialog.showModal();return()=>{dialog.close();if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});};},[]);
  return <dialog className={s.drawer} ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();close();}}>
    <div className={s.contractDrawer}><button autoFocus className={s.button} onClick={close} aria-label="Close drawer"><X size={16}/>Close</button><h2>{title}</h2>{children}</div>
  </dialog>;
}
function Actions({row,open}:{row:SaleRow;open:()=>void}) {
  const warning=row.warning?<p role="status" className={s.queryNote}>{row.warning}</p>:null;
  if(!row.actions.length)return <>{warning}<p>{row.preview.state==="Draft - not submitted"?"Reservation draft · not yet submitted":"No outstanding action recorded"}</p><small>Draft preparation is not counted as a hand-off.</small></>;
  return <div className={s.contractActions}>{warning}
    <p className={s.meta}>{row.actions.filter(a=>a.queue==="ours").length} our · {row.actions.filter(a=>a.queue==="others").length} waiting{row.actions.some(a=>a.queue==="unallocated")?" · "+row.actions.filter(a=>a.queue==="unallocated").length+" unallocated":""}</p>
    {row.actions.map((a,i)=><div key={a.id} data-primary={i===0}><span className={s.queueLabel}>{i===0?"Primary · ":"Also outstanding · "}{queueName(a.queue)}</span><button className={s.textButton} onClick={open}>{a.title}</button><small>{a.party.label}{a.deadline?" · "+a.deadline.basis+" "+a.deadline.at.slice(0,10):""}</small></div>)}
  </div>;
}
export function ContractWorkspace() {
  const search=useSyncExternalStore(subscribe,locationSnapshot,()=>"");
  const p=new URLSearchParams(search), alias=p.get("viewer")??"developer", mode=p.get("data")??"ready";
  return <AccountWorkspace key={alias+":"+mode} search={search} alias={alias} mode={mode}/>;
}
function AccountWorkspace({search,alias,mode}:{search:string;alias:string;mode:string}) {
  const p=new URLSearchParams(search);
  const [catalogState,setCatalog]=useState<{alias:string;value:Catalog|null;error:string}>({alias:"",value:null,error:""});
  const catalog=catalogState.alias===alias?catalogState.value:null;
  const [switching,setSwitching]=useState(false),[menu,setMenu]=useState(false);
  const currentBuilding=catalog?.buildings.find(b=>b.id===p.get("building"))??null;
  const scopeIdentity=catalog&&currentBuilding?JSON.stringify({...catalog.scope,buildingId:currentBuilding.id}):"";
  const scope:Scope|null=scopeIdentity?JSON.parse(scopeIdentity):null;
  const [session]=useState(()=>createWorkspaceSession((scope,signal)=>readFixture(new URLSearchParams({kind:"workspace",viewer:alias,building:scope.buildingId,mode}),signal)));
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  const workspace=scope&&state.snapshot&&sameScope(scope,state.snapshot.scope)?state.snapshot:null;
  const filters=filtersFrom(p),view=p.get("view")==="sales"?"sales":"dashboard";
  const requestedUnit=p.get("unit"),requestedSale=p.get("sale");
  const row=workspace?.rows.find(r=>r.unitId===requestedUnit&&r.saleId===requestedSale&&r.saleId)??null;
  const invalid=Boolean(catalog&&(p.get("building")&&!currentBuilding||requestedUnit&&!p.get("building"))||workspace&&requestedUnit&&!row);
  const title=currentBuilding?currentBuilding.name+(row?" · "+row.unitNumber:"")+" · "+(view==="sales"?"Sales":"Dashboard")+" | Bunnywell":"Buildings | Bunnywell";
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    readFixture(new URLSearchParams({kind:"catalog",viewer:alias}),controller.signal).then(value=>{
      if(value.contract!==contractVersion||!value.fixtureOnly||!Array.isArray(value.buildings))throw new Error("Invalid building catalogue.");
      if(alive)setCatalog({alias,value,error:""});
    }).catch(e=>{if(alive&&!controller.signal.aborted)setCatalog({alias,value:null,error:String(e.message)});});
    return()=>{alive=false;controller.abort();};
  },[alias]);
  useEffect(()=>{const selected:Scope|null=scopeIdentity?JSON.parse(scopeIdentity):null;if(selected)void session.select(selected);else session.clear();return()=>session.clear();},[scopeIdentity,session]);
  useEffect(()=>{
    if(catalog?.buildings.length===1&&!new URLSearchParams(search).has("building")&&!new URLSearchParams(search).has("unit")){
      const next=new URLSearchParams(search);next.set("building",catalog.buildings[0].id);move(next,true);
    }
  },[catalog,search]);
  useEffect(()=>{const apply=()=>{if(document.title!==title)document.title=title;};apply();const observer=new MutationObserver(apply);observer.observe(document.head,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect();},[title]);
  useEffect(()=>{
    if(!workspace)return;
    const frame=requestAnimationFrame(()=>performance.mark("building-contracts-usable",{detail:{building:workspace.building.id,view}}));
    return()=>cancelAnimationFrame(frame);
  },[workspace,view]);
  const persist=(next:Filters=filters)=>{
    if(scope&&view==="sales")sessionStorage.setItem(returnKey(scope),JSON.stringify({...next,scroll:window.scrollY}));
  };
  useEffect(()=>{
    if(!scopeIdentity||view!=="sales"||requestedUnit)return;
    const key=returnKey(JSON.parse(scopeIdentity));const save=()=>sessionStorage.setItem(key,JSON.stringify({...filtersFrom(new URLSearchParams(window.location.search)),scroll:window.scrollY}));
    window.addEventListener("scroll",save,{passive:true});return()=>window.removeEventListener("scroll",save);
  },[scopeIdentity,view,requestedUnit]);
  useEffect(()=>{
    if(workspace&&scopeIdentity&&view==="sales"&&!requestedUnit){
      const saved=readReturn(sessionStorage,JSON.parse(scopeIdentity));const frame=requestAnimationFrame(()=>window.scrollTo(0,saved.scroll));return()=>cancelAnimationFrame(frame);
    }
  },[workspace,scopeIdentity,view,requestedUnit]);
  function navigate(patch:Record<string,string|null>,restore=false) {
    persist();const next=new URLSearchParams(search);
    for(const [key,value]of Object.entries(patch)){if(value===null)next.delete(key);else next.set(key,value);}
    if(restore&&catalog){
      const b=next.get("building")!;
      const saved=readReturn(sessionStorage,{...catalog.scope,buildingId:b});
      for(const [key,val]of Object.entries({q:saved.search,stage:saved.stage,queue:saved.queue,page:String(saved.page)})){if(val)next.set(key,val);else next.delete(key);}
    }
    move(next);setMenu(false);
  }
  function choose(buildingId:string) {
    setSwitching(false);
    navigate({building:buildingId,view:requestedUnit||currentBuilding?"sales":"dashboard",unit:null,sale:null,q:null,stage:null,queue:null,page:null},true);
  }
  function setFilter(patch:Record<string,string|null>){navigate({...patch,page:"1"});window.scrollTo(0,0);}
  function closeSale(){navigate({unit:null,sale:null});}
  const openRow=(r:SaleRow)=>{if(r.saleId)navigate({unit:r.unitId,sale:r.saleId});};
  const filtered=workspace?.rows.filter(r=>(!filters.stage||r.stage===filters.stage)&&(!filters.queue||r.actions.some(a=>a.queue===filters.queue))&&
    (r.unitNumber+" "+r.buyerLabel).toLowerCase().includes(filters.search.toLowerCase()))??[];
  const pageCount=Math.max(1,Math.ceil(filtered.length/3)),page=Math.min(filters.page,pageCount),shown=filtered.slice((page-1)*3,page*3);
  const count=(q:"ours"|"others"|"unallocated")=>workspace?.counts[q];
  return <div className={s.root}>
    <a className={s.contractSkip} href="#contract-main">Skip to workspace</a>
    <aside className={s.sidebar+" "+(menu?s.contractMenuOpen:"")} aria-label="Workspace navigation">
      <div className={s.brand}><span className={s.brandMark}>bh</span><span>BUNNYWELL<small>H O M E S</small></span></div>
      {currentBuilding&&<button className={s.workspaceLabel} onClick={()=>setSwitching(true)}><Building2 size={22}/><span><small>Working in</small><strong>{currentBuilding.name}</strong></span><ChevronRight size={16}/></button>}
      <nav className={s.moduleNav}>{currentBuilding&&<><button className={view==="dashboard"?s.moduleActive:""} onClick={()=>navigate({view:"dashboard",unit:null,sale:null})}>Dashboard</button><button className={view==="sales"?s.moduleActive:""} onClick={()=>navigate({view:"sales",unit:null,sale:null},true)}>Sales</button></>}
      <button onClick={()=>navigate({building:null,view:null,unit:null,sale:null,q:null,stage:null,queue:null,page:null})}>Buildings</button></nav>
    </aside>
    <div className={s.content}>
      <div className={s.prototypeBar}><span className={s.prototypeLabel}>STAGE 1 · OFFLINE FIXTURES</span><div className={s.prototypeControls}>
        <label>Fixture account<select aria-label="Fixture account" value={alias} onChange={e=>{persist();move(new URLSearchParams({viewer:e.target.value}));}}>{Object.entries(names).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>Data<select aria-label="Fixture data" value={mode} onChange={e=>navigate({data:e.target.value,unit:null,sale:null})}>{["ready","loading","empty","error","unavailable","incomplete"].map(v=><option key={v}>{v}</option>)}</select></label>
      </div></div>
      <div className={s.breadcrumbBar}><button className={s.mobileMenu} aria-label="Toggle navigation" onClick={()=>setMenu(!menu)}><Menu size={22}/></button><nav className={s.breadcrumbs} aria-label="Breadcrumb"><button onClick={()=>navigate({building:null,view:null,unit:null,sale:null})}>Buildings</button>{currentBuilding&&<><ChevronRight size={12}/><button onClick={()=>navigate({view:"dashboard",unit:null,sale:null})}>{currentBuilding.name}</button><ChevronRight size={12}/><span>{view==="sales"?"Sales":"Dashboard"}</span>{row&&<><ChevronRight size={12}/><span>{row.unitNumber}</span></>}</>}</nav></div>
      {currentBuilding&&<div className={s.identity} data-testid="building-identity"><Building2 size={24}/><div><strong>{currentBuilding.name}{row?" / "+row.unitNumber:""}</strong><p>{currentBuilding.address}</p></div></div>}
      <main id="contract-main" className={s.contractMain}>
        {currentBuilding&&<div className={s.backRow}>{row?<button className={s.backButton} onClick={closeSale}>Back to worklist</button>:<span/>}<button className={s.backButton} onClick={()=>setSwitching(true)}>Change building</button></div>}
        {!catalog?<div role="status">{catalogState.alias===alias&&catalogState.error?catalogState.error:"Loading accessible buildings…"}</div>:
         invalid?<><h1>Workspace unavailable</h1><p>The building, unit and sale attempt do not match your fixture access.</p><button className={s.button} onClick={()=>navigate({unit:null,sale:null})}>Return to building worklist</button></>:
         !currentBuilding?<><div className={s.pageHeading}><div><p className={s.eyebrow}>BUILDINGS</p><h1>Choose your building</h1><p>Select a workspace explicitly to begin.</p></div></div><div className={s.buildingCards}>{catalog.buildings.map(b=><button key={b.id} className={s.buildingCard} onClick={()=>choose(b.id)}><Building2 size={28}/><span className={s.buildingCardName}>{b.name}</span><span>{b.address}</span><span className={s.buildingCardFoot}>Open building <ChevronRight size={17}/></span></button>)}</div></>:
         !workspace?<section aria-label="Workspace data state" aria-busy={state.loading}><h1>{state.scope&&scope&&sameScope(state.scope,scope)&&state.error?"Workspace unavailable":"Loading "+currentBuilding.name}</h1><p>{state.scope&&scope&&sameScope(state.scope,scope)?state.error:""}</p><p>No previous building records are displayed.</p>{state.error&&<button className={s.button} onClick={()=>scope&&session.select(scope,true)}>Retry fixture load</button>}</section>:
         <div data-testid="workspace-ready" data-building={workspace.building.id}>
          <div className={s.pageHeading}><div><p className={s.eyebrow}>BUILDING WORKSPACE / {view==="sales"?"SALES":"DASHBOARD"}</p><h1>{view==="sales"?"Sales worklist":"Your building at a glance"}</h1><p>{workspace.population}. Fictional snapshot · 3 November 2026.</p></div></div>
          {view==="dashboard"?<div className={s.dashboardGrid}><section className={s.listCard}><h2>Work to pick up</h2>{(["ours","others","unallocated"] as const).map(queue=><section key={queue} className={s.dashboardQueue}><h3>{queueName(queue)}</h3><p data-testid={"count-"+queue}>{count(queue)?count(queue)!.actions+" actions across "+count(queue)!.sales+" sales":"Unavailable - incomplete source"}</p>{workspace.rows.filter(r=>r.actions.some(a=>a.queue===queue)).slice(0,2).map(r=><p key={r.unitId}><button className={s.textButton} onClick={()=>navigate({view:"sales",unit:r.unitId,sale:r.saleId})}>{r.unitNumber} · {r.actions.find(a=>a.queue===queue)!.title}</button></p>)}<button className={s.button} onClick={()=>navigate({view:"sales",queue,page:"1",q:null,stage:null})}>View {queueName(queue).toLowerCase()}</button></section>)}</section>
          <section className={s.listCard}><h2>Current sales</h2><p data-testid="distinct-count">{workspace.counts.distinctSales??"Unavailable"} distinct sales with outstanding work</p><p className={s.meta}>A sale may appear in both queues. Do not add their sale counts.</p>{Object.entries(workspace.counts.stages).map(([key,value])=><p key={key}>{stageName(key)}: {value} units</p>)}<button className={s.primary} onClick={()=>navigate({view:"sales"},true)}>Open sales worklist</button></section></div>:
          <><div className={s.stageCounts} aria-label="Sale stage filters">{[["",workspace.counts.units],...Object.entries(workspace.counts.stages)].map(([key,value])=><button key={key} aria-pressed={filters.stage===key} onClick={()=>setFilter({stage:String(key)})}>{key?stageName(String(key)):"All"} <strong>{value}</strong></button>)}</div>
          <div className={s.listCard}><div className={s.filters}><label>Search units or buyers<input aria-label="Search this building" className={s.contractSearch} value={filters.search} onChange={e=>setFilter({q:e.target.value})} placeholder="Search this building"/></label><label>Responsibility<select value={filters.queue} onChange={e=>setFilter({queue:e.target.value})}><option value="">All responsibilities</option><option value="ours">Our actions</option><option value="others">Waiting on others</option><option value="unallocated">Unallocated</option></select></label></div>
          {!filtered.length?<><h2>{workspace.rows.length?"No matching sales":"No sales to show"}</h2><button className={s.button} onClick={()=>setFilter({q:null,stage:null,queue:null})}>Clear filters</button></>:
          <table className={s.contractTable}><thead><tr><th>Unit / buyer</th><th>Floor</th><th>Sale status</th><th>Next actions / responsibility</th></tr></thead><tbody>{shown.map(r=><tr key={r.unitId} data-unit-id={r.unitId}><td><button className={s.textButton} disabled={!r.saleId} onClick={()=>openRow(r)} aria-label={"Open "+r.unitNumber+", "+r.buyerLabel}>{r.unitNumber} ↗</button><small>{r.buyerLabel}</small></td><td>{r.floor}</td><td>{stageName(r.stage)}</td><td><Actions row={r} open={()=>openRow(r)}/></td></tr>)}</tbody></table>}
          <div className={s.actions}><button className={s.button} disabled={page<=1} onClick={()=>navigate({page:String(page-1)})}>Previous page</button><span>Page {page} of {pageCount}</span><button className={s.button} disabled={page>=pageCount} onClick={()=>navigate({page:String(page+1)})}>Next page</button></div></div></>}
         </div>}
        <footer className={s.pageFooter}>Local fixture contracts · business actions unavailable · no remote services</footer>
      </main>
    </div>
    {switching&&catalog&&<Modal title="Change building" close={()=>setSwitching(false)}><div className={s.buildingCards}>{catalog.buildings.map(b=><button key={b.id} className={s.buildingCard} onClick={()=>choose(b.id)}><strong>{b.name}</strong><span>Open this building’s worklist</span></button>)}</div></Modal>}
    {row&&!switching&&!invalid&&<Modal title={currentBuilding!.name+" / "+row.unitNumber} close={closeSale}>
      <button className={s.backButton} onClick={closeSale}>Back to worklist</button><h3>{row.preview.heading}</h3><p>{row.buyerLabel}</p><dl className={s.keyValues}><div><dt>Status</dt><dd>{row.preview.state}</dd></div><div><dt>Responsible team</dt><dd>{row.preview.responsibleTeam}</dd></div>{row.preview.expectedInvoiceGross!==undefined&&<div><dt>Expected gross invoice</dt><dd>£{row.preview.expectedInvoiceGross.toLocaleString("en-GB")}</dd></div>}</dl>
      <p>Read-only context. No submission form is opened by default.</p><Actions row={row} open={()=>{}}/>
      {row.preview.onBehalf&&<details className={s.historyDisclosure}><summary>Existing authorised option</summary><p>Responsibility stays with the appointed organisation. Existing record and backend checks still apply.</p><button className={s.button} disabled>{row.preview.onBehalf.label}</button></details>}
      <div className={s.queryNote}><strong>Existing sale file boundary</strong><p>Requires approval of the same synthetic environment and exact building, unit and sale attempt. Opening may record a visit or expire authority. Nothing is opened or preloaded here.</p><button className={s.button} disabled>Open existing sale file · Stage 2 approval required</button><small>Record: {row.saleId}</small></div>
      <button className={s.button} onClick={()=>setSwitching(true)}>Change building</button>
    </Modal>}
  </div>;
}
