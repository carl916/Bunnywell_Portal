"use client";
import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type FormEvent} from "react";
import {Building2,ArrowLeft,ChevronRight,MessageSquare,Menu,PanelLeftClose,PanelLeftOpen,LayoutDashboard,FileText} from "lucide-react";
import {auth,localConfig,reader,sessionKey,type Catalog,type Config,type Session} from "@/lib/experiments/building-integration/reader";
import {createWorkspaceSession} from "@/lib/experiments/building-contracts/session";
import {scopeFor} from "@/lib/experiments/building-contracts/projection";
import {resolveSale,type SaleRow} from "@/lib/experiments/building-contracts/contracts";
import {Heading,Notice,Badge,LocalLink,Discussion,SaleTask,sections,label,go,url,saleValues} from "./TaskWorkspace";
import {Dashboard,Worklist} from "./BuildingWorkspace";
import s from "../sales-workspace/Workspace.module.css";
const subscribe=(fn:()=>void)=>{window.addEventListener("popstate",fn);return()=>window.removeEventListener("popstate",fn)};
const searchSnapshot=()=>location.search,serverSnapshot=()=>"";
export default function ConnectedWorkspace(){
 const [config,setConfig]=useState<Config|null>(null),[session,setSession]=useState<Session|null>(null),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 const [collapsed,setCollapsed]=useState(false),[mobile,setMobile]=useState(false),[discussion,setDiscussion]=useState<Record<string,string>>({});
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[feedback,setFeedback]=useState<{saleId:string;text:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const search=useSyncExternalStore(subscribe,searchSnapshot,serverSnapshot),p=useMemo(()=>new URLSearchParams(search),[search]);
 const buildingId=p.get("building")||"",view=p.get("view")||(buildingId?"dashboard":"buildings"),section=p.get("section")||"completion";
 const api=useMemo(()=>config&&session?reader(config,session):null,[config,session]);
 const workspace=useMemo(()=>createWorkspaceSession(async(scope,signal)=>{if(!api)throw Error("Sign in required");return api.load(scope,signal)},false),[api]);
 const state=useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
 const scope=useMemo(()=>{try{return catalog&&buildingId?scopeFor(catalog.access,buildingId):null}catch{return null}},[catalog,buildingId]);
 const snapshot=state.snapshot&&scope&&state.snapshot.scope.accessRevision===scope.accessRevision&&state.snapshot.scope.buildingId===buildingId?state.snapshot:null;
 const building=catalog?.buildings.find(b=>b.id===buildingId);
 let row:SaleRow|undefined;try{if(view==="sale"&&snapshot)row=resolveSale(snapshot,p.get("unit")||"",p.get("sale")||"")}catch{}
 useEffect(()=>{let live=true;localConfig().then(c=>{if(!live)return;setConfig(c);try{const stored=JSON.parse(sessionStorage.getItem(sessionKey)||"null");if(stored?.expires_at>Date.now()/1000)setSession(stored)}catch{}setBusy(false)}).catch(e=>{if(live){setError(e.message);setBusy(false)}});return()=>{live=false}},[]);
 useEffect(()=>{if(!api)return;const c=new AbortController();api.catalog(c.signal).then(value=>{if(c.signal.aborted)return;setCatalog(value);setError("");if(!new URLSearchParams(location.search).size&&value.buildings.length===1)go({building:value.buildings[0].id,view:"dashboard"},true)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[api]);
 useEffect(()=>{if(scope)void workspace.select(scope);else workspace.clear()},[workspace,scope]);
 useEffect(()=>{document.title=[row?.unitNumber,building?.name,view==="sale"?sections.find(v=>v[0]===section)?.[1]:view==="worklist"?"Sales":view==="dashboard"?"Dashboard":"Buildings","Bunnywell - Local document review"].filter(Boolean).join(" · ")},[row?.unitNumber,building?.name,view,section]);
 useEffect(()=>{if(view==="worklist"&&catalog&&buildingId)sessionStorage.setItem("bw-list:"+catalog.access.identity+":"+buildingId,JSON.stringify(Object.fromEntries(p)))},[p,view,catalog,buildingId]);
 useEffect(()=>{const heading=document.querySelector<HTMLElement>("main h1");heading?.focus({preventScroll:true});window.scrollTo(0,0)},[view,buildingId,row?.saleId,section]);
 useEffect(()=>{
  if(view!=="worklist"||!snapshot||!catalog)return;
  const key="bw-scroll:"+catalog.access.identity+":"+buildingId;
  const saved=Number(sessionStorage.getItem(key)||"0");
  window.scrollTo(0,saved);
  const remember=()=>sessionStorage.setItem(key,String(window.scrollY));
  window.addEventListener("scroll",remember,{passive:true});
  return()=>window.removeEventListener("scroll",remember);
 },[view,snapshot,catalog,buildingId]);
 async function signIn(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!config)return;setBusy(true);setError("");const f=new FormData(e.currentTarget);try{const data=await auth(config,"token?grant_type=password",undefined,{email:String(f.get("email")),password:String(f.get("password"))});const next={access_token:data.access_token,expires_at:data.expires_at||Date.now()/1000+data.expires_in,user:{id:data.user.id}};sessionStorage.setItem(sessionKey,JSON.stringify(next));setSession(next)}catch(e){setError(e instanceof Error?e.message:"Sign-in failed")}finally{setBusy(false)}}
 function signOut(){const old=session;workspace.clear();setSession(null);setCatalog(null);sessionStorage.removeItem(sessionKey);setDiscussion({});setDrafts({});setFeedback(null);setError("");if(config&&old)void auth(config,"logout",old.access_token).catch(()=>{});}
 function returnList(id=buildingId){let saved:Record<string,string>={};try{saved=JSON.parse(sessionStorage.getItem("bw-list:"+catalog?.access.identity+":"+id)||"{}")}catch{}go({...saved,view:"worklist",building:id});}
 function choose(id:string){dialog.current?.close();setMobile(false);if(view==="sale"||view==="worklist")returnList(id);else go({building:id,view:"dashboard"});}
 let savedList:Record<string,string>={};
 try{if(catalog&&buildingId)savedList=JSON.parse(sessionStorage.getItem("bw-list:"+catalog.access.identity+":"+buildingId)||"{}")}catch{}
 const listValues={...savedList,view:"worklist",building:buildingId};
 const nav=<><button className={s.workingSelector} aria-label={building?"Working in "+building.name+". Change building":"Choose building"} onClick={()=>dialog.current?.showModal()}><Building2 size={21}/><span><small>{building?"Working in":"Your workspace"}</small><strong>{building?.name||"Choose building"}</strong></span><ChevronRight size={15}/></button><nav className={s.moduleNav} aria-label="Building modules">{building&&<><button onClick={()=>{go({building:buildingId,view:"dashboard"});setMobile(false)}} className={view==="dashboard"?s.moduleActive:""}><LayoutDashboard size={18}/><span>Dashboard</span></button><button className={["sale","worklist"].includes(view)?s.moduleActive:""} onClick={()=>{returnList();setMobile(false)}}><Building2 size={18}/><span>Sales</span></button></>}<button onClick={()=>{go({view:"buildings"});setMobile(false)}}><Building2 size={18}/><span>Buildings</span></button></nav>{view==="sale"&&row&&<nav className={s.saleNav} aria-label="Sale destinations">{sections.map(([id,name])=><a className={s.saleLink} key={id} aria-current={section===id?"page":undefined} href={url({...saleValues(row!),section:id})} onClick={e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go({...saleValues(row!),section:id});setMobile(false)}}}><FileText size={17}/><span>{name}</span></a>)}</nav>}</>;
 return <div className={s.root} data-collapsed={collapsed}><a className={s.skipLink} href="#workspace-main">Skip to workspace</a><aside className={s.sidebar}><div className={s.brand} role="img" aria-label="Bunnywell Homes"/>{nav}<button className={s.collapseButton} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>{collapsed?"Expand":"Collapse"} sidebar</span></button></aside><div className={s.content}>
 <div className={s.prototypeBar}><span className={s.prototypeLabel}>LOCAL TEST · COMPLETION REVIEW <small>Synthetic local database · Other actions disabled</small></span>{session&&<button onClick={signOut}>Sign out</button>}</div><div className={s.breadcrumbBar}><button className={s.mobileMenu} aria-label="Open navigation" aria-expanded={mobile} aria-controls="mobile-navigation" onClick={()=>setMobile(v=>!v)}><Menu size={20}/></button><nav className={s.breadcrumbs} aria-label="Breadcrumb"><LocalLink values={{view:"buildings"}}>Buildings</LocalLink>{building&&<><ChevronRight size={14}/><LocalLink values={{building:buildingId,view:"dashboard"}}>{building.name}</LocalLink>{["sale","worklist"].includes(view)&&<><ChevronRight size={14}/><LocalLink values={listValues}>Sales</LocalLink></>}{row&&<><ChevronRight size={14}/><span>{row.unitNumber}</span><ChevronRight size={14}/><span>{sections.find(v=>v[0]===section)?.[1]}</span></>}</>}</nav></div>
 {mobile&&<div id="mobile-navigation" className={s.card}>{nav}</div>}
 {building&&<header className={s.identity} aria-label={row?"Sale identity":"Building identity"}><span className={s.buildingIcon}><Building2 size={23}/></span><div className={s.identityText}><strong>{building.name}{row&&<> <span>/</span> {row.unitNumber}</>}</strong><p>{row?row.buyerLabel:building.address}</p></div>{row?<><div className={s.saleStatus}><span>Sale status</span><Badge>{label(row.stage)}</Badge></div><div className={s.unitSwitch}><select aria-label="Units in this building" value={row.unitId} onChange={e=>{const target=snapshot!.rows.find(r=>r.unitId===e.target.value);if(target?.saleId)go(saleValues(target))}}>{snapshot!.rows.filter(r=>r.saleId).map(r=><option key={r.unitId} value={r.unitId}>{r.unitNumber}</option>)}</select></div><button className={s.commentsButton} aria-label="Comments &amp; activity" aria-controls="sale-context-panel" onClick={()=>{const target=document.getElementById("sale-context-heading");target?.scrollIntoView({block:"start"});target?.focus({preventScroll:true})}}><MessageSquare size={18}/><span>Comments & activity</span></button></>:<span className={s.identityRole}>{label(catalog?.access.role||"")} workspace</span>}</header>}
 <main className={s.main} id="workspace-main">{feedback?.saleId===p.get("sale")&&<p className={s.meta} role="status">{feedback.text}</p>}{building&&<div className={s.backRow}>{view==="sale"?<button className={s.backButton} onClick={()=>returnList()}><ArrowLeft size={15}/>Back to worklist</button>:<button className={s.backButton} onClick={()=>{workspace.clear();if(scope)void workspace.select(scope,true)}}>Refresh workspace</button>}<button className={s.backButton} onClick={()=>dialog.current?.showModal()}>Change building <Building2 size={15}/></button></div>}
 {!session?<><Heading title="Sign in to the local workspace" description="Use a synthetic Stage 2 account. This environment is separate from staging and production."/><form className={s.card} style={{maxWidth:540}} onSubmit={signIn}><label className={s.field}>Email<input name="email" type="email" required autoComplete="username"/></label><label className={s.field}>Password<input name="password" type="password" required autoComplete="current-password"/></label>{error&&<Notice>{error}</Notice>}<button className={s.primary} disabled={busy||!config}>{busy?"Please wait...":"Sign in"}</button></form></>:
 error?<><Heading title="Workspace access unavailable"/><Notice>{error}</Notice></>:!catalog?<><Heading title="Checking workspace access"/><Notice>Verifying the authenticated account...</Notice></>:view==="buildings"?<><Heading title="Choose your building" description="Choose where you are working today. Each building has its own sales workspace."/><div className={s.buildingCards}>{catalog.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)} aria-label={"Open "+b.name}><span className={s.buildingCardIcon}><Building2 size={25}/></span><span className={s.buildingCardName}>{b.name}</span><span>{b.address}</span><span className={s.buildingCardFoot}>Open workspace</span></button>)}</div></>:
 !scope||!building?<><Heading title="Building unavailable"/><Notice>This building is unavailable for this account. No alternative record has been opened.</Notice></>:
 state.error?<><Heading title="Workspace unavailable"/><Notice>{state.error}</Notice></>:
 !snapshot?<><Heading title={"Loading "+building.name}/><Notice>Loading this building only. Previous-building records have been cleared.</Notice></>:
 view==="dashboard"?<Dashboard snapshot={snapshot} onList={()=>returnList()}/>:
 view==="worklist"?<Worklist snapshot={snapshot} parameters={p}/>:
 view==="sale"&&row&&api?<div className={s.saleLayout}><div className={s.saleTask}><SaleTask key={scope.identity+":"+row.saleId} api={api} scope={scope} row={row} section={section} task={p.get("task")||"documents"} onTask={task=>go({...saleValues(row!),section,task})} onSaved={message=>{setFeedback({saleId:row!.saleId!,text:message});void workspace.select(scope,true)}}/></div><Discussion key={scope.identity+":"+row.saleId} api={api} row={row} draft={drafts[row.saleId!]||""} onDraft={v=>setDrafts(d=>({...d,[row!.saleId!]:v}))} view={discussion[row.saleId!]||"comments"} onView={v=>setDiscussion(d=>({...d,[row!.saleId!]:v}))}/></div>:
 <><Heading title="Sale unavailable"/><Notice>The building, unit and sale attempt do not match. No same-numbered unit has been substituted.</Notice></>}
 <footer className={s.pageFooter}>Bunnywell Homes · Local synthetic Completion review</footer></main></div>
 <dialog ref={dialog} style={{margin:"auto",padding:28,maxWidth:"min(1000px,94vw)",maxHeight:"85vh",border:"1px solid #d9e3dd",borderRadius:8,color:"#0f3d31"}}><div className={s.cardHeading}><h2>Change building</h2><button className={s.button} onClick={()=>dialog.current?.close()}>Close</button></div><p>Switching from a sale opens the other building&apos;s worklist.</p><div className={s.buildingCards}>{catalog?.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)}>{b.name}<small>{b.address}</small></button>)}</div></dialog></div>;
}






