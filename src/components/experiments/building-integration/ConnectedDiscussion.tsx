"use client";
import { useEffect, useRef, useState } from "react";
import type { reader } from "@/lib/experiments/building-integration/reader";
import type { SaleRow } from "@/lib/experiments/building-contracts/contracts";
import { activityPresentation, COMMENT_LIMIT, mergeComments, type SaleComment, type SaleActivity } from "@/lib/sales/discussion";
import { Notice, date, label } from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";

export function Discussion({ api, row, view, onView, draft, onDraft }: {
  api: ReturnType<typeof reader>; row: SaleRow; view: string; onView: (v: string) => void;
  draft: string; onDraft: (v: string) => void;
}) {
  const panel = useRef<HTMLElement>(null), alive = useRef(true), submission = useRef({ body: "", id: "" });
  const [comments, setComments] = useState<SaleComment[]>([]), [activity, setActivity] = useState<SaleActivity[]>([]);
  const [older, setOlder] = useState(false), [newer, setNewer] = useState(false), [moreActivity, setMoreActivity] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const scope = { buildingId: row.buildingId, unitId: row.unitId, saleId: row.saleId! };
  useEffect(() => {
    let frame = 0;
    const update = () => { const e = panel.current, i = document.querySelector("header[aria-label='Sale identity']"); if (!e || !i) return; const top = i.getBoundingClientRect().height + 16, b = e.parentElement!.getBoundingClientRect(); e.style.setProperty("--context-top", top + "px"); e.style.setProperty("--context-height", Math.max(0, Math.min(innerHeight - 16, b.bottom) - Math.max(top, b.top)) + "px"); };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    if (panel.current?.parentElement) observer.observe(panel.current.parentElement);
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, { passive: true }); schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule); };
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    const scope = { buildingId: row.buildingId, unitId: row.unitId, saleId: row.saleId! };
    const load = view === "comments" ? api.workflow.comments(scope, undefined, c.signal).then(p => {
      if (!c.signal.aborted) { setComments(p.comments); setOlder(p.hasBefore); setNewer(p.hasAfter); }
    }) : api.workflow.activity(scope, undefined, c.signal).then(p => {
      if (!c.signal.aborted) { setActivity(p.slice(0, 50)); setMoreActivity(p.length > 50); }
    });
    load.then(() => { if (!c.signal.aborted) { setLoaded(true); setError(""); } }).catch(e => { if (!c.signal.aborted) setError(e.message); });
    return () => c.abort();
  }, [api, row.buildingId, row.unitId, row.saleId, view]);
  async function send() {
    if (busy || !draft.trim()) return;
    setBusy(true); setError("");
    if (submission.current.body !== draft) submission.current = { body: draft, id: crypto.randomUUID() };
    try {
      const saved = await api.workflow.action(scope, { action: "comment", body: draft, clientId: submission.current.id }) as { id: string };
      if (!alive.current) return;
      onDraft(""); submission.current = { body: "", id: "" };
      const p = await api.workflow.comments(scope, undefined, undefined, undefined, saved.id);
      if (alive.current) { setComments(p.comments); setOlder(p.hasBefore); setNewer(p.hasAfter); setLoaded(true); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function loadOlder(after = false) {
    setBusy(true);
    try {
      if (view === "comments") { const p = await api.workflow.comments(scope, after ? undefined : comments[0]?.sequence, undefined, after ? comments.at(-1)?.sequence : undefined); if (alive.current) { setComments(old => mergeComments(old, p.comments)); if (after) setNewer(p.hasAfter); else setOlder(p.hasBefore); } }
      else { const p = await api.workflow.activity(scope, activity.at(-1)); if (alive.current) { setActivity(old => [...old, ...p.slice(0, 50)]); setMoreActivity(p.length > 50); } }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <aside ref={panel} className={s.contextPanel} id="sale-context-panel">
    <header className={s.contextHeader}><h2 id="sale-context-heading" tabIndex={-1}>Comments & activity</h2><p>{row.buildingName} / {row.unitNumber}</p><small>{row.buyerLabel}</small></header>
    <div className={s.drawerTabs} aria-label="Comments and activity views">{["comments", "activity"].map(v => <button key={v} aria-pressed={v === view} onClick={() => onView(v)}>{label(v)}</button>)}</div>
    {error && <div role="alert"><Notice>{error}</Notice></div>}
    <div className={s.contextMessages} tabIndex={0} role="region" aria-label={view === "comments" ? "Conversation messages" : "Sale activity"}>
      {!loaded && <p>Loading this sale&apos;s {view}...</p>}
      {view === "comments" ? <>{older && <button className={s.button} disabled={busy} onClick={() => void loadOlder()}>Load older comments</button>}
        {loaded && !comments.length && <p className={s.emptyConversation}>No comments yet for this sale.</p>}
        {newer && <button className={s.button} disabled={busy} onClick={() => void loadOlder(true)}>Load newer comments</button>}{comments.map(c => <article key={c.id} className={s.comment}><div><strong>{c.author_name} · {label(c.author_role || "")}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.body}</p><small>{date(c.created_at)} · {new Date(c.created_at).toLocaleTimeString("en-GB")}</small></div></article>)}</> :
        <>{loaded && !activity.length && <p>No recorded activity for this sale.</p>}{activity.map(a => { const v = activityPresentation(a); return <article key={a.id} className={s.comment}><div><strong>{v.title}</strong>{v.details.map((d, i) => <p key={i}>{d}</p>)}<small>{a.actor_name || "Recorded actor"} · {date(a.created_at)} · {new Date(a.created_at).toLocaleTimeString("en-GB")}</small></div></article>; })}{moreActivity && <button className={s.button} disabled={busy} onClick={() => void loadOlder()}>Load older activity</button>}</>}
    </div>
    {view === "comments" && <form className={s.contextComposer} onSubmit={e => { e.preventDefault(); void send(); }}>
      <label className={s.field}>Comment<textarea aria-label="Comment" value={draft} maxLength={COMMENT_LIMIT} disabled={busy} onChange={e => onDraft(e.target.value)} placeholder="Add an update for this sale"/></label>
      <div><small>Saved to this local sale · no mentions or notifications</small><button className={s.primary} disabled={busy || !draft.trim()}>{busy ? "Saving comment..." : "Send comment"}</button></div>
    </form>}
  </aside>;
}
