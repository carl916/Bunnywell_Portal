"use client";
import MentionComposer from './MentionComposer';
import mentionStyles from './MentionComposer.module.css';
import type {SalePerson} from '@/lib/sales/discussion';
import {useContextPanelLayout} from "./useContextPanelLayout";
import {hostedWorkspace} from "@/lib/workspace/staging";
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { reader } from "@/lib/experiments/building-integration/reader";
import type { SaleRow, Scope } from "@/lib/experiments/building-contracts/contracts";
import { activityPresentation, mergeComments, type CommentPage } from "@/lib/sales/discussion";
import { Notice, date, label, LocalLink, saleValues } from "./TaskWorkspace";
import {accessUnavailable,createRecordRead} from "@/lib/workspace/record-read";
import {scheduleBackgroundRead} from "@/lib/workspace/background-read";
import {mergeCommentPage,mergeActivityPage,type ActivityPage} from '@/lib/workspace/discussion-pages';
import {RecordReadinessContext} from './useRecordRead';
import s from "../sales-workspace/Workspace.module.css";

const subscribeReady=()=>()=>{},readySnapshot=()=>true;
export function Discussion({ api, row, scope:access, view, onView, draft, onDraft, readOnly=false,refresh=0,attempts,overview,visible=true,prefetchEnabled=true,targetComment,mentionIds=[],onMentions=()=>{} }: {
  api: ReturnType<typeof reader>; row: SaleRow; scope:Scope; view: string; onView: (v: string) => void;
  targetComment?:string;mentionIds?:string[];onMentions?:(ids:string[])=>void;overview?:ReactNode; attempts?:{id:string;label:string}[];readOnly?: boolean; refresh?:number; draft: string; onDraft: (v: string) => void; visible?:boolean;prefetchEnabled?:boolean;
}) {
  const tabId=useId(),tabs=["overview","comments","activity"],tabButtons=useRef<(HTMLButtonElement|null)[]>([]);
  const panel = useRef<HTMLElement>(null), alive = useRef(true), submission = useRef({ body: "", id: "" });
  const key=[access.identity,access.accessRevision,access.role,row.buildingId,row.unitId,row.saleId].join(':');
  const scope=useMemo(()=>({buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleId!}),[row.buildingId,row.unitId,row.saleId]);
  // This authorised sale stays mounted across stages and worklist navigation.
  // Reuse the workspace's record stores; data never goes into browser storage.
  const reads=useMemo(()=>({key,comments:createRecordRead<CommentPage>(),activity:createRecordRead<ActivityPage>(),permission:createRecordRead<{writable:boolean;people:SalePerson[]}>()}),[key]);
  const commentState=useSyncExternalStore(reads.comments.subscribe,reads.comments.getSnapshot,reads.comments.getSnapshot);
  const activityState=useSyncExternalStore(reads.activity.subscribe,reads.activity.getSnapshot,reads.activity.getSnapshot);
  const permission=useSyncExternalStore(reads.permission.subscribe,reads.permission.getSnapshot,reads.permission.getSnapshot);
  const comments=commentState.data?.comments||[],activity=activityState.data?.items||[];
  const older=commentState.data?.hasBefore,newer=commentState.data?.hasAfter,moreActivity=activityState.data?.hasMore;
  const [errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const readiness=useContext(RecordReadinessContext);
  const ready=useSyncExternalStore(readiness?.subscribe||subscribeReady,readiness?.getSnapshot||readySnapshot,readySnapshot);
  const denied=useCallback(()=>{reads.comments.clear();reads.activity.clear();reads.permission.clear();window.dispatchEvent(new Event('workspace-access-invalid'));},[reads]);
  const readComments=useCallback(async(signal:AbortSignal)=>{
    const page=await api.workflow.comments(scope,undefined,signal,undefined,targetComment),previous=reads.comments.getSnapshot().data;
    return mergeCommentPage(previous,page);
  },[api,scope,reads,targetComment]);
  const readActivity=useCallback(async(signal:AbortSignal)=>{
    const page=await api.workflow.activity(scope,undefined,signal),previous=reads.activity.getSnapshot().data;
    return mergeActivityPage(previous,page);
  },[api,scope,reads]);
  const prefetch=useCallback(()=>{
    if(!visible||!prefetchEnabled||!scope.saleId||document.visibilityState==='hidden'||readiness&&!readiness.getSnapshot())return;
    void reads.comments.ensure(key,readComments,denied);
    void reads.activity.ensure(key,readActivity,denied);
  },[visible,prefetchEnabled,scope.saleId,readiness,reads,key,readComments,readActivity,denied]);
  const lastRefresh=useRef(refresh);
  useEffect(()=>{if(lastRefresh.current!==refresh){lastRefresh.current=refresh;reads.comments.invalidate();reads.activity.invalidate();reads.permission.invalidate();}},[refresh,reads]);
  useEffect(()=>{
    if(!visible||!prefetchEnabled||!ready)return;
    let cancel=scheduleBackgroundRead(prefetch);
    const wake=()=>{if(document.visibilityState==='visible'){cancel();cancel=scheduleBackgroundRead(prefetch);}};
    document.addEventListener('visibilitychange',wake);
    return()=>{cancel();document.removeEventListener('visibilitychange',wake);};
  },[visible,prefetchEnabled,ready,prefetch,refresh]);
  useEffect(()=>{
    if(!visible||!row.saleId)return;
    if(view==='comments')void reads.comments.ensure(key,readComments,denied);
    if(view==='activity')void reads.activity.ensure(key,readActivity,denied);
  },[visible,view,row.saleId,reads,key,readComments,readActivity,denied,retry,refresh]);
  const locked=readOnly||(hostedWorkspace&&(!permission.data?.writable||Boolean(permission.error)||permission.loading));
  useEffect(()=>{if(!visible||!hostedWorkspace||readOnly||!scope.saleId||view!=="comments")return;void reads.permission.ensure(key,signal=>api.workflow.action(scope,{action:"comment_context"},signal) as Promise<{writable:boolean;people:SalePerson[]}>,denied);},[visible,api,scope,readOnly,view,refresh,reads,key,denied,retry]);
  useContextPanelLayout(panel,prefetchEnabled&&visible);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false;queueMicrotask(()=>{if(!alive.current){reads.comments.cancel();reads.activity.cancel();reads.permission.cancel();}}); };
  }, [reads]);
  const focusedComment=useRef('');
  useEffect(()=>{if(!visible||view!=='comments'||!targetComment||focusedComment.current===targetComment||!commentState.data?.comments.some(c=>c.id===targetComment))return;
   const element=document.getElementById('comment-'+targetComment);if(element){element.scrollIntoView({block:'center'});element.focus({preventScroll:true});focusedComment.current=targetComment;}
  },[visible,view,targetComment,commentState.data]);
  async function send() {
    if (locked || busy || !draft.trim()) return;
    setBusy(true); setErrors(old=>({...old,comments:""}));
    const fingerprint=JSON.stringify([draft,mentionIds]);
    if (submission.current.body !== fingerprint) submission.current = { body: fingerprint, id: crypto.randomUUID() };
    try {
      const saved = await api.workflow.action(scope, { action: "comment", body: draft, mentionIds, clientId: submission.current.id }) as { id: string };
      if (!alive.current) return;
      onDraft(""); onMentions([]); submission.current = { body: "", id: "" };
      reads.activity.invalidate();
      if(prefetchEnabled)void reads.activity.ensure(key,readActivity,denied);
      await reads.comments.load(key,async signal=>mergeCommentPage(reads.comments.getSnapshot().data,await api.workflow.comments(scope,undefined,signal,undefined,saved.id)),denied);
    } catch (e) { if (alive.current) {setErrors(old=>({...old,comments:(e as Error).message}));if(accessUnavailable(e))denied();} }
    finally { if (alive.current) setBusy(false); }
  }
  async function loadOlder(after = false) {
    setBusy(true);
    try {
      if (view === "comments") { await reads.comments.load(key,async signal=>{const p=await api.workflow.comments(scope,after?undefined:comments[0]?.sequence,signal,after?comments.at(-1)?.sequence:undefined);return {comments:mergeComments(comments,p.comments),hasBefore:after?Boolean(older):p.hasBefore,hasAfter:after?p.hasAfter:Boolean(newer)};},denied); }
      else { await reads.activity.load(key,async signal=>{const p=await api.workflow.activity(scope,activity.at(-1),signal);return{items:[...activity,...p.slice(0,50)],hasMore:p.length>50};},denied); }
    } catch (e) { if (alive.current) setErrors(old=>({...old,[view]:(e as Error).message})); }
    finally { if (alive.current) setBusy(false); }
  }
  return <aside ref={panel} className={s.contextPanel} id="sale-context-panel" data-sale-information>
    <header className={s.contextHeader}><h2 id="sale-context-heading" tabIndex={-1}>Sale information</h2></header>
    <div className={s.drawerTabs} role="tablist" aria-label="Sale information">{tabs.map((v,i)=><button key={v} ref={el=>{tabButtons.current[i]=el;}} id={tabId+'-'+v} type="button" role="tab" aria-selected={v===view} aria-controls={tabId+'-'+v+'-panel'} tabIndex={v===view?0:-1} onClick={()=>onView(v)} onKeyDown={e=>{const next=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(next!==null){e.preventDefault();onView(tabs[next]);tabButtons.current[next]?.focus();}}}>{label(v)}</button>)}</div>
    {tabs.map(v=>{const current=v==='comments'?commentState:activityState,loaded=current.data!==undefined,error=errors[v]||current.error||(v==='comments'?permission.error:'');return <div key={v} id={tabId+'-'+v+'-panel'} role="tabpanel" aria-labelledby={tabId+'-'+v} tabIndex={0} hidden={v!==view} className={s.informationTabPanel}>
    {v==='overview'?<div className={s.contextMessages} tabIndex={0} role="region" aria-label="Sale overview">{overview||<p>Sale overview is unavailable in this review.</p>}</div>:!row.saleId?<p className={s.meta}>Sale discussion becomes available once a reservation exists.</p>:<>
    {error&&<div role="alert"><Notice>{error} <button className={s.button} onClick={()=>{setErrors(old=>({...old,[v]:''}));(v==='comments'?reads.comments:reads.activity).invalidate();setRetry(n=>n+1);}}>Retry {v}</button></Notice></div>}
    <div className={s.contextMessages} tabIndex={0} role="region" aria-label={v==='comments'?'Conversation messages':'Sale activity'}>
      {!loaded&&!error&&<p role="status">Loading this sale&apos;s {v}...</p>}
      {v==='activity'&&attempts&&attempts.length>1&&<details className={s.historyDisclosure}><summary>Previous reservations for this unit</summary>{attempts.map(a=><p key={a.id}><LocalLink values={{...saleValues(row),sale:a.id,section:'reservation'}}>{a.label}</LocalLink></p>)}</details>}
      {v==='comments'?<>{older&&<button className={s.button} disabled={busy||current.loading} onClick={()=>void loadOlder()}>Load older comments</button>}
      {loaded&&!comments.length&&<p className={s.emptyConversation}>No comments yet for this sale.</p>}
      {newer&&<button className={s.button} disabled={busy||current.loading} onClick={()=>void loadOlder(true)}>Load newer comments</button>}{comments.map(c=><article key={c.id} id={'comment-'+c.id} tabIndex={-1} className={s.comment+' '+(c.id===targetComment?mentionStyles.target:'')}><div><strong>{c.author_name} · {label(c.author_role||'')}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.body}</p>{c.mention_ids.length>0&&<div className={mentionStyles.mentions} aria-label="Mentioned people">{c.mention_ids.map(id=><span key={id}>@{permission.data?.people?.find(p=>p.id===id)?.name||'Tagged colleague'}</span>)}</div>}<small>{date(c.created_at)} · {new Date(c.created_at).toLocaleTimeString('en-GB')}</small></div></article>)}</>:<>
      {loaded&&!activity.length&&<p>No recorded activity for this sale.</p>}{activity.map(a=>{const item=activityPresentation(a);return <article key={a.id} className={s.comment}><div><strong>{item.title}</strong>{item.details.map((d,i)=><p key={i}>{d}</p>)}<small>{a.actor_name||'Recorded actor'} · {date(a.created_at)} · {new Date(a.created_at).toLocaleTimeString('en-GB')}</small></div></article>;})}{moreActivity&&<button className={s.button} disabled={busy||current.loading} onClick={()=>void loadOlder()}>Load older activity</button>}</>}
    </div>
    {v==='comments'&&<form className={s.contextComposer} onSubmit={e=>{e.preventDefault();void send();}}>
      <MentionComposer value={draft} onChange={onDraft} people={permission.data?.people||[]} mentionIds={mentionIds} onMentions={onMentions} disabled={locked||busy}/>
      <div><small>{locked?'Connected history · sending is disabled':'Type @ to tag a colleague · staging capture only'}</small><button className={s.primary} disabled={locked||busy||!draft.trim()}>{busy?'Saving comment...':'Send comment'}</button></div>
    </form>}
    </>}
    </div>})}
  </aside>;
}
