"use client";
import {SnagNavigation} from "./SnagNavigation";
import {snagListContext} from "@/lib/workspace/snag-list";
import snagStyles from "./Snags.module.css";
import {salePanelKey,readSalePanel,writeSalePanel,clearSalePanels,type InformationTab} from "@/lib/workspace/sale-panel-state";
import {Activity,useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore,type FormEvent} from "react";
import {Building2,ArrowLeft,ChevronRight,MessageSquare,Menu,PanelLeftClose,PanelLeftOpen,LayoutDashboard,Settings,ClipboardCheck,Handshake} from "lucide-react";
import {auth,localConfig,reader,sessionKey,type Catalog,type Config,type Session} from "@/lib/experiments/building-integration/reader";
import SharedSaleWorkspace from './SharedSaleWorkspace';
import SaleNavigation from "./SaleNavigation";
import MobileSaleHeader from "./MobileSaleHeader";
import mobileStyles from "./MobileSaleWorkspace.module.css";
import {completionTask,exchangeTask} from "@/lib/workspace/completion-navigation";
import {createWorkspaceCredentials,createWorklistCache} from "@/lib/workspace/client-state";
import {createWorkspaceSession} from "@/lib/experiments/building-contracts/session";
import {scopeFor} from "@/lib/experiments/building-contracts/projection";
import {resolveSale,type SaleRow,type Scope} from "@/lib/experiments/building-contracts/contracts";
import {Heading,Notice,Badge,LocalLink,sections,label,go,saleValues} from "./TaskWorkspace";
import {Dashboard,Worklist} from "./BuildingWorkspace";
import s from "../sales-workspace/Workspace.module.css";
const subscribe=(fn:()=>void)=>{window.addEventListener("popstate",fn);return()=>window.removeEventListener("popstate",fn)};
const searchSnapshot=()=>location.search,serverSnapshot=()=>"";

import {stagingAuth,stagingConfig,stagingReader,stagingSessionKey,stagingRead} from "@/lib/workspace/client";
import {createSupabaseBrowserClient} from "@/lib/supabase/client";
import {createSessionLifecycle} from "@/lib/portal-load-lifecycle";
import {verifiedSessionUser} from "@/lib/workspace/verified-session";
import {moduleAllowed,optimizedReads,hostedWorkspace,hostedStaging} from "@/lib/workspace/staging";
import {returnView,returnViews,navigationKey,savedNavigation} from "@/lib/workspace/navigation";
import SetupPassword from "./SetupPassword";
import SetupWorkspace from "./SetupWorkspace";
import {BuildingOverview,SnagsRegister,SnagWorkspace} from "./WiderViews";
import {accessUnavailable} from "@/lib/workspace/record-read";
import type {PortalSnapshot} from "@/lib/workspace/types";
export default function ConnectedWorkspace({staging=false}:{staging?:boolean}){
 const [credentials]=useState(createWorkspaceCredentials),[worklistCache]=useState(createWorklistCache);
 const storageKey=staging?stagingSessionKey:sessionKey;
 const [snagIdentity,setSnagIdentity]=useState<{id:string;buildingId:string;title:string;unit:string}|null>(null);
 const onSnagIdentity=useCallback((v:{id:string;buildingId:string;title:string;unit:string}|null)=>setSnagIdentity(v),[]);
 const [refresh,setRefresh]=useState(0),[catalogRefresh,setCatalogRefresh]=useState(0);

 const [saleRefresh,setSaleRefresh]=useState(0);
 const [refreshError,setRefreshError]=useState('');
 const [retainedSale,setRetainedSale]=useState<{access:string;scope:Scope;row:SaleRow;section:string;task:string}|null>(null);
 const saleScroll=useRef<{key:string;y:number}|null>(null);

 const [config,setConfig]=useState<Config|null>(null),[session,setSession]=useState<Session|null>(null),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 const [authState,setAuthState]=useState<"restoring"|"ready"|"unavailable">("restoring"),[authError,setAuthError]=useState(""),[bootstrapAttempt,setBootstrapAttempt]=useState(0);
 const [collapsed,setCollapsed]=useState(false),[mobile,setMobile]=useState(false),[discussion,setDiscussion]=useState<Record<string,string>>({});
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[feedback,setFeedback]=useState<{saleId:string;context:string;text:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const [informationContext,setInformationContext]=useState<string|null>(null);
 const [dismissedComment,setDismissedComment]=useState('');
 const closeInformation=()=>{setInformationContext(null);setDismissedComment(search);};
 const search=useSyncExternalStore(subscribe,searchSnapshot,serverSnapshot),p=useMemo(()=>new URLSearchParams(search),[search]);
 const buildingId=p.get("building")||"",view=p.get("view")||(buildingId?"dashboard":"buildings"),sectionParameter=p.get("section")||"";
 const completionWritable=staging&&hostedWorkspace&&config?.completionReview===true;
 const api=useMemo(()=>config&&session?(staging?stagingReader:reader)(config,session):null,[config,session,staging]);
 const requestValues={view,unit:p.get('unit')||'',sale:p.get('sale')||'',q:p.get('q')||'',stage:p.get('stage')||'',queue:p.get('queue')||'',page:p.get('page')||'1'};
 const requestKey=optimizedReads?JSON.stringify(requestValues):'';
 const [unitChoices,setUnitChoices]=useState<{building:string;revision:string;identity:string;rows:{unitId:string;saleId:string|null;unitNumber:string}[]}|null>(null);
 useEffect(()=>{const saved=()=>{worklistCache.clear();setCatalogRefresh(v=>v+1);setUnitChoices(null)};window.addEventListener("workspace-operations-saved",saved);return()=>window.removeEventListener("workspace-operations-saved",saved)},[worklistCache]);
 const workspace=useMemo(()=>createWorkspaceSession(async(scope,signal)=>{if(!api)throw Error("Sign in required");if(optimizedReads&&staging&&session){const values=JSON.parse(requestKey),cached=view==='worklist'?worklistCache.get(scope,new URLSearchParams(values)):null;if(cached)return cached;const result=await stagingRead<PortalSnapshot>(session,view==='sale'?'record':view==='worklist'?'worklist':'summary',{building:scope.buildingId,...values},signal);if(!signal.aborted&&view==='worklist')worklistCache.put(result);return result;}return api.load(scope,signal)},false),[api,requestKey,staging,session,view,worklistCache]);
 const unitRequest=useRef<AbortController|null>(null);
 useEffect(()=>()=>unitRequest.current?.abort(),[session,buildingId,catalog?.access.accessRevision]);
 const state=useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
 const scope=useMemo(()=>{try{return catalog&&buildingId?scopeFor(catalog.access,buildingId,staging):null}catch{return null}},[catalog,buildingId,staging]);
 const activeSnapshot=state.snapshot&&scope&&state.snapshot.scope.accessRevision===scope.accessRevision&&state.snapshot.scope.buildingId===buildingId?state.snapshot:null;
 const [old,setOld]=useState<PortalSnapshot|null>(null);
 if(activeSnapshot&&activeSnapshot!==old)setOld(activeSnapshot);
 const snapshot=useMemo(()=>activeSnapshot??(optimizedReads&&view==='worklist'&&scope&&old?.scope.identity===scope.identity&&old.scope.accessRevision===scope.accessRevision&&old.scope.buildingId===scope.buildingId?{...old,rows:[]}:null),[activeSnapshot,view,scope,old]);
 const building=catalog?.buildings.find(b=>b.id===buildingId);
 const accessKey=catalog?catalog.access.identity+":"+catalog.access.accessRevision:"signed-out";
 const retainedAllowed=Boolean(retainedSale&&session&&scope&&retainedSale.access===accessKey&&retainedSale.scope.buildingId===buildingId&&(view!=='sale'||retainedSale.row.saleId===(p.get('sale')||null)&&retainedSale.row.unitId===p.get('unit'))&&!error&&!state.error);
 let row:SaleRow|undefined;try{if(view==="sale"&&snapshot)row=p.get('sale')?resolveSale(snapshot,p.get('unit')||'',p.get('sale')!):snapshot.rows.find(r=>r.unitId===p.get('unit')&&!r.saleId)}catch{}
 if(view==='sale'&&!activeSnapshot&&retainedAllowed)row=retainedSale!.row;
 if(error||!session)row=undefined;
 const section=sections.some(([id])=>id===sectionParameter)?sectionParameter:row?.progression?.destination.section||'reservation';
 const task=section==='commercial'&&p.get('task')==='amend'?'amend':section==='exchange'?exchangeTask(p.get('task'),row?.progression?.stages.exchange==='complete'||row?.progression?.next==='Record exchange'):completionTask(p.get('task')||(!sectionParameter||section==='completion'?row?.progression?.destination.task||null:null));
 if(retainedSale&&!retainedAllowed&&(!row||retainedSale.access!==accessKey))setRetainedSale(null);
 if(row&&scope&&(!retainedSale||retainedSale.row!==row||retainedSale.section!==section||retainedSale.task!==task))setRetainedSale({access:accessKey,scope,row,section,task});
 const saleEntry=row&&scope?{row,scope,section,task}:retainedAllowed?retainedSale:null;
 const panelKey=saleEntry?salePanelKey(accessKey,saleEntry.row.buildingId,saleEntry.row.unitId,saleEntry.row.saleId):'';
 const storedPanel=panelKey?readSalePanel(panelKey):{tab:'overview',draft:'',mentionIds:[]};
 const informationKey=accessKey+':'+search;
 if(informationContext!==null&&informationContext!==informationKey)setInformationContext(null);
 const targetComment=/^[0-9a-f-]{36}$/i.test(p.get('comment')||'')?p.get('comment')!:undefined;
 const linkedComment=Boolean(targetComment&&dismissedComment!==search);
 const informationOpen=view==='sale'&&(informationContext===informationKey||linkedComment);
 function openInformation(tab:InformationTab='overview'){
  setDiscussion(current=>({...current,[panelKey]:tab}));writeSalePanel(panelKey,{tab});
  setInformationContext(informationKey);
 }
 // Resolve entry once and record it in the URL. Refreshing after a save updates
 // progression, but must not move the user away from their confirmation.
 useEffect(()=>{if(!row)return;if(!sectionParameter||(['exchange','completion'].includes(section)&&!p.get('task')))go({...Object.fromEntries(p),section,...(['exchange','completion'].includes(section)?{task}:{})},true);},[row,sectionParameter,section,task,p]);
 if(feedback&&feedback.context!==search)setFeedback(null);
 useEffect(()=>{let live=true;(staging?stagingConfig:localConfig)().then(c=>{if(!live)return;setConfig(c);try{const stored=staging?null:JSON.parse(sessionStorage.getItem(storageKey)||"null");if(stored?.expires_at>Date.now()/1000)setSession(stored)}catch{}if(!staging)setAuthState("ready");setBusy(false)}).catch(e=>{if(live){setAuthError(e.message);setAuthState("unavailable");setBusy(false)}});return()=>{live=false}},[staging,storageKey,bootstrapAttempt]);
 useEffect(()=>{
  if(!staging||!config)return;const client=createSupabaseBrowserClient();
  let live=true,authRevision=0;
  const clear=()=>{if(!live)return;setAuthState("ready");authRevision++;credentials.clear();worklistCache.clear();setOld(null);setRetainedSale(null);setSession(null);setCatalog(null);setDrafts({});clearSalePanels();setDiscussion({});setFeedback(null);setUnitChoices(null);};
  const lifecycle=createSessionLifecycle({
   validate:async()=>verifiedSessionUser(await client.auth.getUser()),
   load:async(user)=>{const revision=authRevision;const r=await client.auth.getSession();if(r.error)throw r.error;const next=r.data.session;if(!live||revision!==authRevision)return;if(!next||next.user.id!==user.id){clear();return;}if(!live)return;setSession(credentials.update({access_token:next.access_token,expires_at:next.expires_at!,user:{id:user.id}}));setAuthError("");setAuthState("ready");setCatalogRefresh(v=>v+1);},
   clear,invalidate:()=>{authRevision++;worklistCache.clear();},recheck:async(user)=>{const revision=authRevision;const verified=await client.auth.getUser();const verifiedUser=verifiedSessionUser(verified);if(!live||revision!==authRevision)return false;if(verifiedUser?.id!==user.id){clear();return false;}const r=await client.auth.getSession();if(!live||revision!==authRevision)return false;if(!r.data.session||r.data.session.user.id!==user.id){clear();return false;}const next=credentials.update({access_token:r.data.session.access_token,expires_at:r.data.session.expires_at!,user:{id:user.id}});const fresh=await stagingRead<Catalog>(next,'catalog');if(live&&revision===authRevision){setCatalog(old=>JSON.stringify(old)===JSON.stringify(fresh)?old:fresh);setRefreshError('');window.dispatchEvent(new Event("workspace-revalidate"));}return false;},error:e=>{if(accessUnavailable(e)){clear();setError(e instanceof Error?e.message:'Session unavailable.');}else setRefreshError(e instanceof Error?e.message:'Could not recheck the session.');}
  });
  const listener=client.auth.onAuthStateChange((event,next)=>{if(event==="PASSWORD_RECOVERY")go({view:"password-setup"},true);lifecycle.observe(event,next)});
  void lifecycle.restore().catch(e=>{if(!live)return;setAuthError(e instanceof Error?e.message:"Could not verify your session.");setAuthState("unavailable");});
  return()=>{live=false;lifecycle.dispose();listener.data.subscription.unsubscribe();};
 },[staging,config,credentials,worklistCache]);
 useEffect(()=>{const denied=()=>{setRetainedSale(null);setOld(null);setDrafts({});clearSalePanels();setDiscussion({});worklistCache.clear();setError('Workspace access changed or this record is unavailable. Recheck access to continue.');};window.addEventListener('workspace-access-invalid',denied);return()=>window.removeEventListener('workspace-access-invalid',denied)},[worklistCache]);
 useEffect(()=>{if(!api)return;const c=new AbortController();api.catalog(c.signal).then(value=>{if(c.signal.aborted)return;setCatalog(old=>JSON.stringify(old)===JSON.stringify(value)?old:value);setError("");if(!new URLSearchParams(location.search).size&&value.buildings.length===1)go({building:value.buildings[0].id,view:"dashboard"},true)}).catch(e=>{if(!c.signal.aborted){if(accessUnavailable(e))setError(e.message);else setRefreshError(e.message)}});return()=>c.abort()},[api,catalogRefresh]);
 useEffect(()=>{if(scope&&(!staging||["dashboard","worklist","sale"].includes(view)))void workspace.select(scope);else workspace.clear();return()=>workspace.clear()},[workspace,scope,staging,view]);
 useEffect(()=>{
  let lastCheck=Date.now();
  const revalidate=()=>{
   if(!scope||Date.now()-lastCheck<30000)return;
   lastCheck=Date.now();worklistCache.clear();
   if(["dashboard","worklist","sale"].includes(view))void workspace.select(scope,true,true);
   // Other modules refresh explicitly; changing their refresh key would
   // discard unfinished Setup/Snag forms merely because the tab regained focus.
   if(view==="sale")setSaleRefresh(v=>v+1);
  };
  window.addEventListener("workspace-revalidate",revalidate);
  return()=>window.removeEventListener("workspace-revalidate",revalidate);
 },[workspace,scope,view,worklistCache]);
 useEffect(()=>{document.title=[row?.unitNumber||(view==="snag"&&snagIdentity?.buildingId===buildingId&&snagIdentity?.id===p.get("snag")?snagIdentity.unit:null),building?.name,view==="sale"?sections.find(v=>v[0]===section)?.[1]:view==="worklist"?"Sales":view==="dashboard"?"Dashboard":view==="snag"?"Snag":view==="snags"?"Snags":view==="setup"?"Setup":"Buildings",staging?(hostedWorkspace?(hostedStaging?"Bunnywell · Staging":"Bunnywell · Integration"):optimizedReads?"Bunnywell · Local foundation":"Bunnywell · Staging read-only"):"Bunnywell - Local document review"].filter(Boolean).join(" · ")},[row?.unitNumber,building?.name,buildingId,view,section,staging,snagIdentity,p]);
 useEffect(()=>{if(!staging&&view==="worklist"&&catalog&&buildingId)sessionStorage.setItem("bw-list:"+catalog.access.identity+":"+buildingId,JSON.stringify(Object.fromEntries(p)))},[p,view,catalog,buildingId,staging]);
 useEffect(()=>{const heading=Array.from(document.querySelectorAll<HTMLElement>('main h1')).find(e=>e.getClientRects().length>0);heading?.focus({preventScroll:true});const key=[accessKey,buildingId,p.get('unit'),p.get('sale'),section,task].join(':');window.scrollTo(0,view==='sale'&&saleScroll.current?.key===key?saleScroll.current.y:0);},[view,buildingId,accessKey,p,section,task]);
 useEffect(()=>{if(view!=='sale'||!p.get('unit'))return;const key=[accessKey,buildingId,p.get('unit'),p.get('sale'),section,task].join(':');const remember=()=>{saleScroll.current={key,y:window.scrollY};};window.addEventListener('workspace-leaving',remember);return()=>window.removeEventListener('workspace-leaving',remember)},[view,accessKey,buildingId,p,section,task]);
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
 function signOut(){const old=session;worklistCache.clear();setOld(null);workspace.clear();setSession(null);setCatalog(null);sessionStorage.removeItem(storageKey);setDiscussion({});setDrafts({});clearSalePanels();setUnitChoices(null);setSnagIdentity(null);setFeedback(null);setError("");if(config&&old)void (staging?stagingAuth:auth)(config,"logout",old.access_token).catch(()=>{});}
 function returnList(id=buildingId){if(staging&&catalog){go(savedNavigation(scopeFor(catalog.access,id,true),"worklist"));return;}let saved:Record<string,string>={};try{saved=JSON.parse(sessionStorage.getItem("bw-list:"+catalog?.access.identity+":"+id)||"{}")}catch{}go({...saved,view:"worklist",building:id});}
 function choose(id:string){if(view==="setup"||view==="building-settings"){go({view:"setup",tab:p.get("tab")||"buildings",building:id});dialog.current?.close();setMobile(false);return;}dialog.current?.close();setMobile(false);if(staging&&catalog){const target=["snag","snags"].includes(view)?"snags":view==="building-settings"||p.get("destination")==="building-settings"?"building-settings":["sale","worklist"].includes(view)?"worklist":"dashboard";go(savedNavigation(scopeFor(catalog.access,id,true),target));return;}if(view==="sale"||view==="worklist")returnList(id);else go({building:id,view:"dashboard"});}
 let savedList:Record<string,string>={};
 try{if(catalog&&buildingId)savedList=JSON.parse(sessionStorage.getItem("bw-list:"+catalog.access.identity+":"+buildingId)||"{}")}catch{}

 const listValues=staging&&scope?savedNavigation(scope,"worklist"):{...savedList,view:"worklist",building:buildingId};
 const allowed=(module:string)=>!staging||moduleAllowed(catalog?.access.role||"",module);
 const record=view==="sale"||view==="snag",snag=staging&&view==="snag"&&snagIdentity?.buildingId===buildingId&&snagIdentity?.id===p.get("snag")?snagIdentity:null;
 const origin=staging?returnView(p):"worklist";
 const returnLabel=origin==="dashboard"?"Back to dashboard":origin==="snags"?"Back to snags":"Back to worklist";
 function returnOrigin(){const list=view==="snag"?snagListContext(p,buildingId):null;if(list){go(list);return;}if(staging&&scope)go(savedNavigation(scope,origin));else returnList();}
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

 const nav=<><button className={s.workingSelector} aria-label={building?"Working in "+building.name+". Change building":"Choose building"} onClick={()=>dialog.current?.showModal()}><Building2 size={21}/><span><small>{building?"Working in":"Your workspace"}</small><strong>{building?.name||"Choose building"}</strong></span><ChevronRight size={15}/></button><nav className={s.moduleNav} aria-label="Building modules">{building&&<><button onClick={()=>{go({building:buildingId,view:"dashboard"});setMobile(false)}} className={view==="dashboard"?s.moduleActive:""}><LayoutDashboard size={18}/><span>Dashboard</span></button>{allowed("sales")&&<button className={["sale","worklist"].includes(view)?s.moduleActive:""} onClick={()=>{returnList();setMobile(false)}}><Handshake size={18}/><span>Sales</span></button>}{staging&&allowed("snags")&&<button className={["snag","snags"].includes(view)?s.moduleActive:""} onClick={()=>{if(scope)go(savedNavigation(scope,"snags"));setMobile(false)}}><ClipboardCheck size={18}/><span>Snags</span></button>}</>}{staging&&allowed("setup")&&<button className={view==="setup"?s.moduleActive:""} onClick={()=>{go({view:"setup",...(buildingId?{building:buildingId}:{})});setMobile(false)}}><Settings size={18}/><span>Setup</span></button>}</nav></>;
 const saleNavigation=view==="sale"&&row&&<SaleNavigation row={row} section={section} role={catalog?.access.role||""} onNavigate={()=>setMobile(false)}/>;
 return <div className={`${s.root} ${mobileStyles.workspace}`} data-collapsed={collapsed} data-sale-workspace={view==="sale"}><a className={s.skipLink} href="#workspace-main">Skip to workspace</a><aside className={`${s.sidebar} ${mobileStyles.desktopSidebar}`}><div className={s.brand} role="img" aria-label="Bunnywell Homes"/>{nav}{saleNavigation}<button className={s.collapseButton} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>{collapsed?"Expand":"Collapse"} sidebar</span></button></aside><div className={`${s.content} ${mobileStyles.workspaceContent}`}>
 <div className={s.prototypeBar}><span className={s.prototypeLabel}>{staging?(hostedWorkspace?(completionWritable?(config?.coreSales?(hostedStaging?"STAGING · NOT LIVE":"INTEGRATION · TEST WORKSPACE"):"INTEGRATION · COMPLETION REVIEW"):"INTEGRATION · READ ONLY"):optimizedReads?"LOCAL FOUNDATION · READ ONLY":"STAGING · READ ONLY"):"LOCAL TEST · COMPLETION REVIEW"} <small>{staging?(hostedWorkspace?(completionWritable?(config?.coreSales?(hostedStaging?"Existing staging users and records · Test correspondence only":"Restricted records · Core Sales connected · External delivery blocked"):"Restricted records · Completion documents and comments connected"):"Selected legacy records and test fixtures · Business actions disabled"):optimizedReads?"Synthetic local records · Business actions disabled":"Genuine staging records · Business actions disabled"):"Synthetic local database · Other actions disabled"}</small></span>{session&&<button onClick={signOut}>Sign out</button>}</div><div className={`${s.breadcrumbBar} ${mobileStyles.breadcrumbRow}`}><button className={`${s.mobileMenu} ${mobileStyles.globalMenu}`} aria-label="Open portal navigation" aria-expanded={mobile} aria-controls="mobile-navigation" onClick={()=>setMobile(v=>!v)}><Menu size={20} aria-hidden="true"/><span className={mobileStyles.globalLabel}>Portal menu</span></button>{view==="sale"&&building&&<button type="button" className={mobileStyles.mobileBack} onClick={returnOrigin}><ArrowLeft size={16} aria-hidden="true"/>{returnLabel}</button>}<nav className={`${s.breadcrumbs} ${mobileStyles.desktopBreadcrumbs}`} aria-label="Breadcrumb"><LocalLink values={{view:"buildings"}}>Buildings</LocalLink>{building&&<><ChevronRight size={14}/><LocalLink values={{building:buildingId,view:"dashboard"}}>{building.name}</LocalLink>{["sale","worklist"].includes(view)&&<><ChevronRight size={14}/><LocalLink values={listValues}>Sales</LocalLink></>}{staging&&["snag","snags"].includes(view)&&<><ChevronRight size={14}/><LocalLink values={snagListContext(p,buildingId)||(scope?savedNavigation(scope,"snags"):{building:buildingId,view:"snags"})}>Snags</LocalLink>{snag&&<><ChevronRight size={14}/><span>{snag.unit}</span></>}</>}{view==="setup"&&<><ChevronRight size={14}/><LocalLink values={{view:"setup",building:buildingId}}>Setup</LocalLink><ChevronRight size={14}/><span>{({buildings:"Buildings",allocation:"Unit allocation",audit:"Audit log",people:"Users & access","email-notifications":"Email notifications"} as Record<string,string>)[p.get("tab")||"buildings"]}</span></>}{row&&<><ChevronRight size={14}/><span>{row.unitNumber}</span><ChevronRight size={14}/><span>{sections.find(v=>v[0]===section)?.[1]}</span></>}</>}</nav></div>
 {mobile&&<div id="mobile-navigation" className={mobileStyles.globalNavigation}>{nav}</div>}
 {building&&<header className={`${s.identity} ${row?mobileStyles.desktopHeader:""}`} aria-label={record?"Sale identity":"Building identity"}><span className={s.buildingIcon}><Building2 size={23}/></span><div className={s.identityText}><strong>{building.name}{(row||snag)&&<> <span>/</span> {row?.unitNumber||snag?.unit}</>}</strong><p>{row?row.buyerLabel:snag?snag.title:building.address}</p></div>{row?<><div className={s.saleStatus}><span>Sale status</span><Badge>{label(row.stage)}</Badge></div><div className={s.unitSwitch}><select aria-label="Units in this building" value={row.saleId||row.unitId} onFocus={()=>{if(optimizedReads&&session&&catalog&&!(unitChoices?.building===buildingId&&unitChoices.identity===catalog.access.identity&&unitChoices.revision===catalog.access.accessRevision)){unitRequest.current?.abort();const controller=new AbortController();unitRequest.current=controller;const access=catalog.access;void stagingRead<{unitId:string;saleId:string|null;unitNumber:string}[]>(session,'unit-options',{building:buildingId},controller.signal).then(rows=>{if(!controller.signal.aborted)setUnitChoices({building:buildingId,identity:access.identity,revision:access.accessRevision,rows})}).catch(()=>{})}}} onChange={e=>{const target=(optimizedReads&&unitChoices?.building===buildingId&&unitChoices.identity===catalog?.access.identity&&unitChoices.revision===catalog?.access.accessRevision?unitChoices.rows:(snapshot?.rows||[row])).find(r=>(r.saleId||r.unitId)===e.target.value);if(target)go({view:'sale',building:buildingId,unit:target.unitId,...(target.saleId?{sale:target.saleId}:{})})}}>{(optimizedReads&&unitChoices?.building===buildingId&&unitChoices.identity===catalog?.access.identity&&unitChoices.revision===catalog?.access.accessRevision?unitChoices.rows:(snapshot?.rows||[row])).map(r=><option key={r.saleId||r.unitId} value={r.saleId||r.unitId}>{r.unitNumber}{'historical' in r&&r.historical?" · previous sale":""}</option>)}</select></div><button className={s.commentsButton} aria-label="Sale information" aria-controls="sale-context-panel" onClick={()=>{const target=document.getElementById("sale-context-heading");target?.scrollIntoView({block:"start"});target?.focus({preventScroll:true})}}><MessageSquare size={18}/><span>Sale information</span></button></>:<><span className={s.identityRole}>{label(catalog?.access.role||"")} workspace</span>{view==="snag"&&<button className={s.commentsButton} onClick={()=>{const e=document.getElementById("sale-context-heading");e?.scrollIntoView({block:"start"});e?.focus({preventScroll:true})}}><MessageSquare size={18}/><span>Comments & activity</span></button>}</>}</header>}
 {building&&row&&<MobileSaleHeader key={`${accessKey}:${row.unitId}:${row.saleId}`} row={row} buildingName={building.name} section={section} role={catalog?.access.role||""} informationOpen={informationOpen} onInformationOpen={()=>openInformation()}/>}
 <main className={`${s.main} ${record||view==="worklist"?s.recordMain:""}`} id="workspace-main">{feedback?.saleId===p.get("sale")&&feedback.context===search&&<p className={s.meta} role="status">{feedback.text}</p>}{building&&<div className={`${s.backRow} ${mobileStyles.desktopBackRow}`}><div className={snagStyles.backNavigation}>{record?<button className={s.backButton} onClick={returnOrigin}><ArrowLeft size={15}/>{returnLabel}</button>:<button className={s.backButton} onClick={()=>{setRefresh(v=>v+1);worklistCache.clear();workspace.clear();if(scope&&["dashboard","worklist","sale"].includes(view))void workspace.select(scope,true)}}>Refresh workspace</button>}{staging&&view==="snag"&&session&&scope&&<SnagNavigation key={accessKey+":"+buildingId} session={session} building={buildingId} p={p}/>}</div><button className={s.backButton} onClick={()=>dialog.current?.showModal()}>Change building <Building2 size={15}/></button></div>}
 {authState!=="ready"?<><Heading title={authState==="restoring"?"Checking your session":"Session verification unavailable"}/>{authState==="restoring"?<div role="status"><Notice>Restoring your authenticated session…</Notice></div>:<Notice>{authError} <button className={s.button} onClick={()=>{setConfig(null);setAuthError("");setAuthState("restoring");setBootstrapAttempt(v=>v+1);}}>Retry session verification</button></Notice>}</>:!session?<><Heading title={staging?(hostedWorkspace?(hostedStaging?"Sign in to the staging workspace":"Sign in to the integration workspace"):optimizedReads?"Sign in to the local foundation workspace":"Sign in to the staging workspace"):"Sign in to the local workspace"} description={staging?(hostedWorkspace?(hostedStaging?"Use your existing staging account. Access follows your role and building permissions. Test correspondence is captured without sending email.":"Use your integration review account. This workspace contains a usable copy of staging and separate fictional test records. External delivery is blocked. Access follows your role and building permissions."):optimizedReads?"Use an isolated foundation test account. Access follows your role and building permissions.":"Use your existing staging account. Access follows your role and building permissions."):"Use a synthetic Stage 2 account. This environment is separate from staging and production."}/><form className={s.card+" "+s.loginForm} onSubmit={signIn}><label className={s.field}>Email<input name="email" type="email" required autoComplete="username"/></label><label className={s.field}>Password<input name="password" type="password" required autoComplete="current-password"/></label>{error&&<Notice>{error}</Notice>}<button className={s.primary} disabled={busy||!config}>{busy?"Please wait...":"Sign in"}</button></form></>:
 view==="password-setup"?<SetupPassword/>:error?<><Heading title="Workspace access unavailable"/><Notice>{error} <button className={s.button} onClick={()=>{setError('');setCatalogRefresh(v=>v+1);if(scope)void workspace.select(scope,true);}}>Recheck access</button></Notice></>:!catalog?<><Heading title="Checking workspace access"/><Notice>Verifying the authenticated account...</Notice></>:view==="buildings"?<><Heading title="Choose your building" description="Choose where you are working today. Each building has its own workspace."/>{config?.operations&&allowed("buildings")&&<details className={s.supportingInformation}><summary>Add a building</summary>{<LocalLink className={s.button} values={{view:"setup"}}>Open building setup</LocalLink>}</details>}<div className={s.buildingCards}>{catalog.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)} aria-label={"Open "+b.name}><span className={s.buildingCardIcon}><Building2 size={25}/></span><span className={s.buildingCardName}>{b.name}</span><span>{b.address}</span><span className={s.buildingCardFoot}>Open workspace</span></button>)}</div></>:
 staging&&["setup","building-settings"].includes(view)?allowed("setup")?<SetupWorkspace key={accessKey+":"+refresh} session={session} p={p}/>:<Notice>Setup is unavailable for this role.</Notice>:
 !scope||!building?<><Heading title="Building unavailable"/><Notice>This building is unavailable for this account. No alternative record has been opened.</Notice></>:
 staging&&view==="snags"?(allowed("snags")?<SnagsRegister writable={config?.operations} key={accessKey+":"+refresh+":"+buildingId} session={session} building={buildingId} p={p}/>:<Notice>Snags unavailable for this role.</Notice>):
 staging&&view==="snag"?(allowed("snags")?<SnagWorkspace writable={config?.operations} key={accessKey+":"+refresh+":"+buildingId+":"+p.get("snag")} session={session} building={buildingId} snagId={p.get("snag")||""} onIdentity={onSnagIdentity}/>:<Notice>Snags unavailable for this role.</Notice>):
 staging&&["worklist","sale"].includes(view)&&!allowed("sales")?<Notice>Sales is unavailable for this role.</Notice>:
 state.error&&!snapshot?<><Heading title="Workspace unavailable"/><Notice>{state.error} <button className={s.button} onClick={()=>void workspace.select(scope,true,true)}>Retry</button></Notice></>:
 !snapshot&&!(view==="sale"&&row)?<><Heading title={"Loading "+building.name}/><Notice>Loading this building only. Previous-building records have been cleared.</Notice></>:
 view==="dashboard"?(staging?<BuildingOverview snapshot={snapshot as PortalSnapshot} onList={()=>returnList()}/>:<Dashboard snapshot={snapshot!} onList={()=>returnList()}/>):
 view==="worklist"?<Worklist snapshot={snapshot!} parameters={p} loading={!activeSnapshot}/>:
 view==="sale"&&row&&api?null:
 <><Heading title="Sale unavailable"/><Notice>The building, unit and sale attempt do not match. No same-numbered unit has been substituted.</Notice></>}
 {refreshError&&<p role="alert" className={s.meta}>Could not refresh workspace access. {refreshError} <button className={s.textButton} onClick={()=>{setCatalogRefresh(v=>v+1);window.dispatchEvent(new Event('visibilitychange'));}}>Retry access check</button></p>}
 {state.error&&snapshot&&<p role="alert" className={s.meta}>Could not refresh the workspace. Previously loaded information is still shown. <button className={s.textButton} onClick={()=>void workspace.select(scope!,true,true)}>Retry refresh</button></p>}
 {saleEntry&&api&&!error&&(!state.error||snapshot)&&<Activity mode={view==='sale'?'visible':'hidden'} key={accessKey+':'+saleEntry.row.buildingId+':'+saleEntry.row.unitId+':'+saleEntry.row.saleId}><SharedSaleWorkspace targetComment={targetComment} mentionIds={storedPanel.mentionIds||[]} onMentions={ids=>{writeSalePanel(panelKey,{mentionIds:ids});setDrafts(d=>({...d}));}} informationOpen={informationOpen} onInformationClose={closeInformation} buildingName={building?.name} coreWritable={Boolean(config?.coreSales)} readOnly={staging&&!completionWritable} refresh={saleRefresh} api={api} scope={saleEntry.scope} row={saleEntry.row} section={saleEntry.section} task={saleEntry.task} onTask={task=>go({...saleValues(saleEntry.row),section:saleEntry.section,task})} onSaved={message=>{worklistCache.clear();setFeedback({saleId:saleEntry.row.saleId!,context:search,text:message});setSaleRefresh(v=>v+1);void workspace.select(saleEntry.scope,true,true)}} draft={drafts[panelKey]??storedPanel.draft} onDraft={v=>{setDrafts(d=>({...d,[panelKey]:v}));writeSalePanel(panelKey,{draft:v});}} discussion={discussion[panelKey+(targetComment?':'+targetComment:'')]||(linkedComment?'comments':storedPanel.tab)} onDiscussion={v=>{setDiscussion(d=>({...d,[panelKey+(targetComment?':'+targetComment:'')]:v}));writeSalePanel(panelKey,{tab:v as InformationTab});}}/></Activity>}
 <footer className={s.pageFooter}>Bunnywell Homes · {staging?(hostedWorkspace?(completionWritable?(config?.coreSales?(hostedStaging?"Staging · Bunnywell Portal":"Hosted integration · Restricted data · Core Sales workflow"):"Hosted integration · Restricted data · Completion document review"):"Hosted integration · Restricted review data · Read-only"):optimizedReads?"Local synthetic foundation review":"Staging read-only review"):"Local synthetic Completion review"}</footer></main></div>
 <dialog ref={dialog} style={{margin:"auto",padding:28,maxWidth:"min(1000px,94vw)",maxHeight:"85vh",border:"1px solid #d9e3dd",borderRadius:8,color:"#0f3d31"}}><div className={s.cardHeading}><h2>Change building</h2><button className={s.button} onClick={()=>dialog.current?.close()}>Close</button></div><p>Switching from a sale opens the other building&apos;s worklist.</p><div className={s.buildingCards}>{catalog?.buildings.map(b=><button className={s.buildingCard} key={b.id} onClick={()=>choose(b.id)}>{b.name}<small>{b.address}</small></button>)}</div></dialog></div>;
}
