"use client";
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore,type FormEvent} from "react";
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

import {stagingAuth,stagingConfig,stagingReader,stagingSessionKey,stagingRead} from "@/lib/workspace/client";
import {createSupabaseBrowserClient} from "@/lib/supabase/client";
import {createSessionLifecycle} from "@/lib/portal-load-lifecycle";
import {moduleAllowed,optimizedReads,hostedIntegration} from "@/lib/workspace/staging";
import {returnView,returnViews,navigationKey,savedNavigation} from "@/lib/workspace/navigation";
import {BuildingOverview,SnagsRegister,SnagWorkspace,BuildingSettings,SetupViews} from "./WiderViews";
import type {PortalSnapshot} from "@/lib/workspace/types";
export default function ConnectedWorkspace({staging=false}:{staging?:boolean}){
 const storageKey=staging?stagingSessionKey:sessionKey;
 const [snagIdentity,setSnagIdentity]=useState<{id:string;buildingId:string;title:string;unit:string}|null>(null);
 const onSnagIdentity=useCallback((v:{id:string;buildingId:string;title:string;unit:string}|null)=>setSnagIdentity(v),[]);
 const [refresh,setRefresh]=useState(0);
 const [saleRefresh,setSaleRefresh]=useState(0);

 const [config,setConfig]=useState<Config|null>(null),[session,setSession]=useState<Session|null>(null),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 const [collapsed,setCollapsed]=useState(false),[mobile,setMobile]=useState(false),[discussion,setDiscussion]=useState<Record<string,string>>({});
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[feedback,setFeedback]=useState<{saleId:string;text:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const search=useSyncExternalStore(subscribe,searchSnapshot,serverSnapshot),p=useMemo(()=>new URLSearchParams(search),[search]);
 const buildingId=p.get("building")||"",view=p.get("view")||(buildingId?"dashboard":"buildings"),section=p.get("section")||"completion";
 const completionWritable=staging&&hostedIntegration&&config?.completionReview===true;
 const api=useMemo(()=>config&&session?(staging?stagingReader:reader)(config,session):null,[config,session,staging]);
 const requestValues={view,unit:p.get('unit')||'',sale:p.get('sale')||'',q:p.get('q')||'',stage:p.get('stage')||'',queue:p.get('queue')||'',page:p.get('page')||'1'};
 const requestKey=optimizedReads?JSON.stringify(requestValues):'';
 const [unitChoices,setUnitChoices]=useState<{building:string;revision:string;identity:string;rows:{unitId:string;saleId:string;unitNumber:string}[]}|null>(null);
 const workspace=useMemo(()=>createWorkspaceSession(async(scope,signal)=>{if(!api)throw Error("Sign in required");return optimizedReads&&staging&&session?stagingRead<PortalSnapshot>(session,view==='sale'?'record':view==='worklist'?'worklist':'summary',{building:scope.buildingId,...JSON.parse(requestKey)},signal):api.load(scope,signal)},false),[api,requestKey,staging,session,view]);
 const unitRequest=useRef<AbortController|null>(null);
 useEffect(()=>()=>unitRequest.current?.abort(),[session,buildingId,catalog?.access.accessRevision]);
 const state=useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
 const scope=useMemo(()=>{try{return catalog&&buildingId?scopeFor(catalog.access,buildingId,staging):null}catch{return null}},[catalog,buildingId,staging]);
 const activeSnapshot=state.snapshot&&scope&&state.snapshot.scope.accessRevision===scope.accessRevision&&state.snapshot.scope.buildingId===buildingId?state.snapshot:null;
 const [old,setOld]=useState<PortalSnapshot|null>(null);
 if(activeSnapshot&&activeSnapshot!==old)setOld(activeSnapshot);
 const snapshot=useMemo(()=>activeSnapshot??(optimizedReads&&view==='worklist'&&scope&&old?.scope.identity===scope.identity&&old.scope.accessRevision===scope.accessRevision&&old.scope.buildingId===scope.buildingId?{...old,rows:[]}:null),[activeSnapshot,view,scope,old]);
 const building=catalog?.buildings.find(b=>b.id===buildingId);
 let row:SaleRow|undefined;try{if(view==="sale"&&snapshot)row=resolveSale(snapshot,p.get("unit")||"",p.get("sale")||"")}catch{}
 useEffect(()=>{let live=true;(staging?stagingConfig:localConfig)().then(c=>{if(!live)return;setConfig(c);try{const stored=staging?null:JSON.parse(sessionStorage.getItem(storageKey)||"null");if(stored?.expires_at>Date.now()/1000)setSession(stored)}catch{}setBusy(false)}).catch(e=>{if(live){setError(e.message);setBusy(false)}});return()=>{live=false}},[staging,storageKey]);
 useEffect(()=>{
  if(!staging||!config)return;const client=createSupabaseBrowserClient();
  const clear=()=>{setSession(null);setCatalog(null);setDrafts({});setDiscussion({});setFeedback(null);setUnitChoices(null);};
  const lifecycle=createSessionLifecycle({
   validate:async()=>{const r=await client.auth.getUser();return r.error?null:r.data.user;},
   load:async(user)=>{const r=await client.auth.getSession();const next=r.data.session;if(!next||next.user.id!==user.id){clear();return;}setSession({access_token:next.access_token,expires_at:next.expires_at!,user:{id:user.id}});},
   clear,invalidate:()=>setCatalog(null),recheck:async()=>true,error:e=>{clear();setError(e instanceof Error?e.message:'Session unavailable.');}
  });
  const listener=client.auth.onAuthStateChange((event,next)=>lifecycle.observe(event,next));
  void lifecycle.restore().catch(e=>{clear();setError(e.message);});
  return()=>{lifecycle.dispose();listener.data.subscription.unsubscribe();};
 },[staging,config]);
 useEffect(()=>{if(!api)return;const c=new AbortController();api.catalog(c.signal).then(value=>{if(c.signal.aborted)return;setCatalog(value);setError("");if(!new URLSearchParams(location.search).size&&value.buildings.length===1)go({building:value.buildings[0].id,view:"dashboard"},true)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[api]);
 useEffect(()=>{if(scope&&(!staging||["dashboard","worklist","sale"].includes(view)))void workspace.select(scope);else workspace.clear()},[workspace,scope,staging,view]);
 useEffect(()=>{document.title=[row?.unitNumber||(view==="snag"&&snagIdentity?.buildingId===buildingId&&snagIdentity?.id===p.get("snag")?snagIdentity.unit:null),building?.name,view==="sale"?sections.find(v=>v[0]===section)?.[1]:view==="worklist"?"Sales":view==="dashboard"?"Dashboard":view==="snag"?"Snag":view==="snags"?"Snags":view==="setup"?"Setup":"Buildings",staging?(hostedIntegration?"Bunnywell · Integration":optimizedReads?"Bunnywell · Local foundation":"Bunnywell · Staging read-only"):"Bunnywell - Local document review"].filter(Boolean).join(" · ")},[row?.unitNumber,building?.name,buildingId,view,section,staging,snagIdentity,p]);
 useEffect(()=>{if(!staging&&view==="worklist"&&catalog&&buildingId)sessionStorage.setItem("bw-list:"+catalog.access.identity+":"+buildingId,JSON.stringify(Object.fromEntries(p)))},[p,view,catalog,buildingId,staging]);
 useEffect(()=>{const heading=document.querySelector<HTMLElement>("main h1");heading?.focus({preventScroll:true});window.scrollTo(0,0)},[view,buildingId,row?.saleId,section]);
 useEffect(()=>{
  if(staging||view!=="worklist"||!snapshot||!catalog)return;
  const key="bw-scroll:"+catalog.access.identity+":"+buildingId;
  const saved=Number(sessionStorage.getItem(key)||"0");
  window.scrollTo(0,saved);
  const remember=()=>sessionStorage.setItem(key,String(window.scrollY));
  window.addEventListener("scroll",remember,{passive:true});
  return()=>window.removeEventListener("scroll",remember);
 },[view,snapshot,catalog,buildingId,staging]);
 async function signIn(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!config)return;setBusy(true);setError("");const f=new FormData(e.currentTarget);try{const data=await (staging?stagingAuth:auth)(config,"token?grant_type=password",undefined,{email:String(f.get("email")),password:String(f.get("password"))});const next={access_token:data.access_token,expires_at:data.expires_at||Date.now()/1000+data.expires_in,user:{id:data.user.id}};if(!staging){sessionStorage.setItem(storageKey,JSON.stringify(next));setSession(next)}}catch(e){setError(e instanceof Error?e.message:"Sign-in failed")}finally{setBusy(false)}}
 function signOut(){const old=session;workspace.clear();setSession(null);setCatalog(null);sessionStorage.removeItem(storageKey);setDiscussion({});setDrafts({});setUnitChoices(null);setSnagIdentity(null);setFeedback(null);setError("");if(config&&old)void (staging?stagingAuth:auth)(config,"logout",old.access_token).catch(()=>{});}
 function returnList(id=buildingId){if(staging&&catalog){go(savedNavigation(scopeFor(catalog.access,id,true),"worklist"));return;}let saved:Record<string,string>={};try{saved=JSON.parse(sessionStorage.getItem("bw-list:"+catalog?.access.identity+":"+id)||"{}")}catch{}go({...saved,view:"worklist",building:id});}
 function choose(id:string){dialog.current?.close();setMobile(false);if(staging&&catalog){const target=["snag","snags"].includes(view)?"snags":view==="building-settings"||p.get("destination")==="building-settings"?"building-settings":["sale","worklist"].includes(view)?"worklist":"dashboard";go(savedNavigation(scopeFor(catalog.access,id,true),target));return;}if(view==="sale"||view==="worklist")returnList(id);else go({building:id,view:"dashboard"});}
 let savedList:Record<string,string>={};
 try{if(catalog&&buildingId)savedList=JSON.parse(sessionStorage.getItem("bw-list:"+catalog.access.identity+":"+buildingId)||"{}")}catch{}

 const listValues=staging&&scope?savedNavigation(scope,"worklist"):{...savedList,view:"worklist",building:buildingId};
 const allowed=(module:string)=>!staging||moduleAllowed(catalog?.access.role||"",module);
 const record=view==="sale"||view==="snag",snag=staging&&view==="snag"&&snagIdentity?.buildingId===buildingId&&snagIdentity?.id===p.get("snag")?snagIdentity:null;
 const origin=staging?returnView(p):"worklist";
 const returnLabel=origin==="dashboard"?"Back to dashboard":origin==="snags"?"Back to snags":"Back to worklist";
 function returnOrigin(){if(staging&&scope)go(savedNavigation(scope,origin));else returnList();}
 useEffect(()=>{
  if(!staging||!scope||!returnViews.includes(view as typeof returnViews[number]))return;
  const key=navigationKey(scope,view);
  const remember=()=>sessionStorage.setItem(key,JSON.stringify({parameters:Object.fromEntries(p),scroll:window.scrollY}));
  window.addEventListener("workspace-leaving",remember);window.addEventListener("pagehide",remember);
  const scroll=()=>{if(location.search===search)remember();};
  window.addEventListener("scroll",scroll,{passive:true});
  return()=>{window.removeEventListener("workspace-leaving",remember);window.removeEventListener("pagehide",remember);window.removeEventListener("scroll",scroll);};
 },[staging,scope,view,p,search]);
 useEffect(()=>{
  if(!staging||!scope||!returnViews.includes(view as typeof returnViews[number]))return;
  let saved=0;try{saved=Number(JSON.parse(sessionStorage.getItem(navigationKey(scope,view))||"{}").scroll)||0;}catch{}
  let frame=0;const restore=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(document.documentElement.scrollHeight>=saved+innerHeight||saved===0){window.scrollTo(0,saved);observer.disconnect();}});};
  const observer=new ResizeObserver(restore);const main=document.getElementById("workspace-main");if(main)observer.observe(main);restore();
  const timer=setTimeout(()=>observer.disconnect(),8000);
  return()=>{clearTimeout(timer);observer.disconnect();cancelAnimationFrame(frame);};
 },[staging,scope,view]);

 const nav=<><button className={s.workingSelector} aria-label={building?"Working in "+building.name+". Change building":"Choose building"} onClick={()=>dialog.current?.showModal()}><Building2 size={21}/><span><small>{building?"Working in":"Your workspace"}</small><strong>{building?.name||"Choose building"}</strong></span><ChevronRight size={15}/></button><nav className={s.moduleNav} aria-label="Building modules">{building&&<><button onClick={()=>{go({building:buildingId,view:"dashboard"});setMobile(false)}} className={view==="dashboard"?s.moduleActive:""}><LayoutDashboard size={18}/><span>Dashboard</span></button>{allowed("sales")&&<button className={["sale","worklist"].includes(view)?s.moduleActive:""} onClick={()=>{returnList();setMobile(false)}}><Building2 size={18}/><span>Sales</span></button>}{staging&&allowed("snags")&&<button className={["snag","snags"].includes(view)?s.moduleActive:""} onClick={()=>{if(scope)go(savedNavigation(scope,"snags"));setMobile(false)}}><FileText size={18}/><span>Snags</span></button>}</>}{allowed("buildings")&&<button className={view==="building-settings"?s.moduleActive:""} onClick={()=>{go(staging&&building?{view:"building-settings",building:buildingId}:{view:"buildings",destination:"building-settings"});setMobile(false)}}><Building2 size={18}/><span>Buildings</span></button>}{staging&&allowed("setup")&&<button className={view==="setup"?s.moduleActive:""} onClick={()=>{go({view:"setup",...(buildingId?{building:buildingId}:{})});setMobile(false)}}><FileText size={18}/><span>Setup</span></button>}</nav>{view==="sale"&&row&&<nav className={s.saleNav} aria-label="Sale destinations">{sections.map(([id,name])=><a className={s.saleLink} key={id} aria-current={section===id?"page":undefined} href={url({...saleValues(row!),section:id})} onClick={e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go({...saleValues(row!),section:id});setMobile(false)}}}><FileText size={17}/><span>{name}</span></a>)}</nav>}</>;
 return <div className={s.root} data-collapsed={collapsed}><a className={s.skipLink} href="#workspace-main">Skip to workspace</a><aside className={s.sidebar}><div className={s.brand} role="img" aria-label="Bunnywell Homes"/>{nav}<button className={s.collapseButton} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>{collapsed?"Expand":"Collapse"} sidebar</span></button></aside><div className={s.content}>
 <div className={s.prototypeBar}><span className={s.prototypeLabel}>{staging?(hostedIntegration?(completionWritable?"INTEGRATION · COMPLETION REVIEW":"INTEGRATION · READ ONLY"):optimizedReads?"LOCAL FOUNDATION · READ ONLY":"STAGING · READ ONLY"):"LOCAL TEST · COMPLETION REVIEW"} <small>{staging?(hostedIntegration?(completionWritable?"Restricted records · Completion documents and comments connected":"Selected legacy records and test fixtures · Business actions disabled"):optimizedReads?"Synthetic local records · Business actions disabled":"Genuine staging records · Business actions disabled"):"Synthetic local database · Other actions disabled"}</small></span>{session&&<button onClick={signOut}>Sign out</button>}</div><div className={s.breadcrumbBar}><button className={s.mobileMenu} aria-label="Open navigation" aria-expanded={mobile} aria-controls="mobile-navigation" onClick={()=>setMobile(v=>!v)}><Menu size={20}/></button><nav className={s.breadcrumbs} aria-label="Breadcrumb"><LocalLink values={{view:"buildings"}}>Buildings</LocalLink>{building&&<><ChevronRight size={14}/><LocalLink values={{building:buildingId,view:"dashboard"}}>{building.name}</LocalLink>{["sale","worklist"].includes(view)&&<><ChevronRight size={14}/><LocalLink values={listValues}>Sales</LocalLink></>}{staging&&["snag","snags"].includes(view)&&<><ChevronRight size={14}/><LocalLink values={scope?savedNavigation(scope,"snags"):{building:buildingId,view:"snags"}}>Snags</LocalLink>{snag&&<><ChevronRight size={14}/><span>{snag.unit}</span></>}</>}{row&&<><ChevronRight size={14}/><span>{row.unitNumber}</span><ChevronRight size={14}/><span>{sections.find(v=>v[0]===section)?.[1]}</span></>}</>}</nav></div>
 {mobile&&<div id="mobile-navigation" className={s.card}>{nav}</div>}
 {building&&<header className={s.identity} aria-label={record?"Sale identity":"Building identity"}><span className={s.buildingIcon}><Building2 size={23}/></span><div className={s.identityText}><strong>{building.name}{(row||snag)&&<> <span>/</span> {row?.unitNumber||snag?.unit}</>}</strong><p>{row?row.buyerLabel:snag?snag.title:building.address}</p></div>{row?<><div className={s.saleStatus}><span>Sale status</span><Badge>{label(row.stage)}</Badge></div><div className={s.unitSwitch}><select aria-label="Units in this building" value={row.saleId!} onFocus={()=>{if(optimizedReads&&session&&catalog&&!(unitChoices?.building===buildingId&&unitChoices.identity===catalog.access.identity&&unitChoices.revision===catalog.access.accessRevision)){unitRequest.current?.abort();const controller=new AbortController();unitRequest.current=controller;const access=catalog.access;void stagingRead<{unitId:string;saleId:string;unitNumber:string}[]>(session,'unit-options',{building:buildingId},controller.signal).then(rows=>{if(!controller.signal.aborted)setUnitChoices({building:buildingId,identity:access.identity,revision:access.accessRevision,rows})}).catch(()=>{})}}} onChange={e=>{const target=(optimizedReads&&unitChoices?.building===buildingId&&unitChoices.identity===catalog?.access.identity&&unitChoices.revision===catalog?.access.accessRevision?unitChoices.rows:snapshot!.rows).find(r=>r.saleId===e.target.value);if(target?.saleId)go({view:'sale',building:buildingId,unit:target.unitId,sale:target.saleId,section:'completion'})}}>{(optimizedReads&&unitChoices?.building===buildingId&&unitChoices.identity===catalog?.access.identity&&unitChoices.revision===catalog?.access.accessRevision?unitChoices.rows:snapshot!.rows).filter(r=>r.saleId).map(r=><option key={r.saleId} value={r.saleId!}>{r.unitNumber}{'historical' in r&&r.historical?" · previous sale":""}</option>)}</select></div><button className={s.commentsButton} aria-label="Comments &amp; activity" aria-controls="sale-context-panel" onClick={()=>{const target=document.getElementById("sale-context-heading");target?.scrollIntoView({block:"start"});target?.focus({preventScroll:true})}}><MessageSquare size={18}/><span>Comments & activity</span></button></>:<><span className={s.identityRole}>{label(catalog?.access.role||"")} workspace</span>{view==="snag"&&<button className={s.commentsButton} onClick={()=>{const e=document.getElementById("sale-context-heading");e?.scrollIntoView({block:"start"});e?.focus({preventScroll:true})}}><MessageSquare size={18}/><span>Comments & activity</span></button>}</>}</header>}
 <main className={s.main} id="workspace-main">{feedback?.saleId===p.get("sale")&&<p className={s.meta} role="status">{feedback.text}</p>}{building&&<div className={s.backRow}>{record?<button className={s.backButton} onClick={returnOrigin}><ArrowLeft size={15}/>{returnLabel}</button>:<button className={s.backButton} onClick={()=>{setRefresh(v=>v+1);workspace.clear();if(scope&&["dashboard","worklist","sale"].includes(view))void workspace.select(scope,true)}}>Refresh workspace</button>}<button className={s.backButton} onClick={()=>dialog.current?.showModal()}>Change building <Building2 size={15}/></button></div>}
 {!session?<><Heading title={staging?(hostedIntegration?"Sign in to the integration workspace":optimizedReads?"Sign in to the local foundation workspace":"Sign in to the staging workspace"):"Sign in to the local workspace"} description={staging?(hostedIntegration?"Use your integration review account. This workspace contains selected legacy records and separate test fixtures. Access follows your role and building permissions.":optimizedReads?"Use an isolated foundation test account. Access follows your role and building permissions.":"Use your existing staging account. Access follows your role and building permissions."):"Use a synthetic Stage 2 account. This environment is separate from staging and production."}/><form className={s.card} style={{maxWidth:540}} onSubmit={signIn}><label className={s.field}>Email<input name="email" type="email" required autoComplete="username"/></label><label className={s.field}>Password<input name="password" type="password" required autoComplete="current-password"/></label>{error&&<Notice>{error}</Notice>}<button className={s.primary} disabled={busy||!config}>{busy?"Please wait...":"Sign in"}</button></form></>:
 error?<><Heading title="Workspace access unavailable"/><Notice>{error}</Notice></>:!catalog?<><Heading title="Checking workspace access"/><Notice>Verifying the authenticated account...</Notice></>:view==="buildings"?<><Heading title="Choose your building" description="Choose where you are working today. Each building has its own workspace."/><div className={s.buildingCards}>{catalog.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)} aria-label={"Open "+b.name}><span className={s.buildingCardIcon}><Building2 size={25}/></span><span className={s.buildingCardName}>{b.name}</span><span>{b.address}</span><span className={s.buildingCardFoot}>Open workspace</span></button>)}</div></>:
 staging&&view==="setup"?allowed("setup")?<SetupViews key={refresh} session={session} p={p}/>:<Notice>Setup is unavailable for this role.</Notice>:
 !scope||!building?<><Heading title="Building unavailable"/><Notice>This building is unavailable for this account. No alternative record has been opened.</Notice></>:
 staging&&view==="snags"?(allowed("snags")?<SnagsRegister key={refresh+":"+buildingId} session={session} building={buildingId} p={p}/>:<Notice>Snags unavailable for this role.</Notice>):
 staging&&view==="snag"?(allowed("snags")?<SnagWorkspace key={refresh+":"+buildingId+":"+p.get("snag")} session={session} building={buildingId} snagId={p.get("snag")||""} onIdentity={onSnagIdentity}/>:<Notice>Snags unavailable for this role.</Notice>):
 staging&&view==="building-settings"?(allowed("buildings")?<BuildingSettings key={refresh+":"+buildingId} session={session} building={buildingId}/>:<Notice>Building configuration unavailable for this role.</Notice>):
 staging&&["worklist","sale"].includes(view)&&!allowed("sales")?<Notice>Sales is unavailable for this role.</Notice>:
 state.error?<><Heading title="Workspace unavailable"/><Notice>{state.error}</Notice></>:
 !snapshot?<><Heading title={"Loading "+building.name}/><Notice>Loading this building only. Previous-building records have been cleared.</Notice></>:
 view==="dashboard"?(staging?<BuildingOverview snapshot={snapshot as PortalSnapshot} onList={()=>returnList()}/>:<Dashboard snapshot={snapshot} onList={()=>returnList()}/>):
 view==="worklist"?<Worklist snapshot={snapshot} parameters={p} loading={!activeSnapshot}/>:
 view==="sale"&&row&&api?<div className={s.saleLayout}><div className={s.saleTask}><SaleTask readOnly={staging&&!completionWritable} refresh={saleRefresh} key={scope.identity+":"+row.saleId} api={api} scope={scope} row={row} section={section} task={p.get("task")||"documents"} onTask={task=>go({...saleValues(row!),section,task})} onSaved={message=>{setFeedback({saleId:row!.saleId!,text:message});setSaleRefresh(v=>v+1);void workspace.select(scope,true)}}/></div><Discussion refresh={saleRefresh} readOnly={staging&&(!completionWritable||section!=="completion"||!["exchanged","completion_pending"].includes(row.stage))} key={scope.identity+":"+row.saleId} api={api} row={row} draft={drafts[row.saleId!]||""} onDraft={v=>setDrafts(d=>({...d,[row!.saleId!]:v}))} view={discussion[row.saleId!]||"comments"} onView={v=>setDiscussion(d=>({...d,[row!.saleId!]:v}))}/></div>:
 <><Heading title="Sale unavailable"/><Notice>The building, unit and sale attempt do not match. No same-numbered unit has been substituted.</Notice></>}
 <footer className={s.pageFooter}>Bunnywell Homes · {staging?(hostedIntegration?(completionWritable?"Hosted integration · Restricted data · Completion document review":"Hosted integration · Restricted review data · Read-only"):optimizedReads?"Local synthetic foundation review":"Staging read-only review"):"Local synthetic Completion review"}</footer></main></div>
 <dialog ref={dialog} style={{margin:"auto",padding:28,maxWidth:"min(1000px,94vw)",maxHeight:"85vh",border:"1px solid #d9e3dd",borderRadius:8,color:"#0f3d31"}}><div className={s.cardHeading}><h2>Change building</h2><button className={s.button} onClick={()=>dialog.current?.close()}>Close</button></div><p>Switching from a sale opens the other building&apos;s worklist.</p><div className={s.buildingCards}>{catalog?.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)}>{b.name}<small>{b.address}</small></button>)}</div></dialog></div>;
}






