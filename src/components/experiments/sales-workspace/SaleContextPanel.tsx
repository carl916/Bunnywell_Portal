"use client";
import { useEffect, useRef } from "react";
import type { NavigationState } from "@/lib/experiments/sales-workspace/model";
import { History } from "./PrototypeUI";
import s from "./Workspace.module.css";
export type ContextTab = "comments" | "activity";
export type DiscussionState = { tab: ContextTab; draft: string };
export type ConversationFixture = "empty" | "few" | "long";
export function conversationFixture(search: string): ConversationFixture {
  const value = new URLSearchParams(search).get("conversation");
  return value === "empty" || value === "long" ? value : "few";
}
export function SaleContextPanel({ state, buildingName, discussion, onChange, fixture }: {
  state: NavigationState; buildingName: string; discussion: DiscussionState;
  onChange: (patch: Partial<DiscussionState>) => void; fixture: ConversationFixture;
}) {
  const panel = useRef<HTMLElement>(null);
  // Fit beneath the actual identity, including zoom and the initial header offset.
  useEffect(() => {
    const node = panel.current!;
    const identity = document.querySelector<HTMLElement>('[aria-label="Sale identity"]');
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = (identity?.getBoundingClientRect().height ?? 78) + 16;
      const workspace = node.parentElement!.getBoundingClientRect();
      node.style.setProperty("--context-top", top + "px");
      // The task may now be shorter than a full conversation. Respect its bottom
      // so sticky containment cannot push the discussion heading under the identity.
      node.style.setProperty("--context-height", Math.max(0, Math.min(window.innerHeight - 16, workspace.bottom) - Math.max(top, workspace.top)) + "px");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    if (identity) observer.observe(identity);
    observer.observe(node.parentElement!);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule); };
  }, []);
  const count = fixture === "empty" ? 0 : fixture === "long" ? 24 : 2;
  const messages = [
    "The sample buyer details have been checked for " + buildingName + ", unit " + state.unit.unit_number + ".",
    "Please keep the agreed parking condition visible when reviewing this reservation.",
    "The current document version is available for the team to review.",
    "The service-charge detail is noted in this fictional discussion.",
    "The next review will use the current document and its recorded query.",
    "Please refer to the completion date shown in the task workspace.",
  ];
  return <aside ref={panel} id="sale-context-panel" className={s.contextPanel} aria-labelledby="sale-context-heading">
    <header className={s.contextHeader}><div><h2 id="sale-context-heading" tabIndex={-1}>Comments & activity</h2>
      <p>{buildingName} / {state.unit.unit_number}</p><small>{state.unit.buyer}</small></div></header>
    <div className={s.drawerTabs} aria-label="Comments and activity views">
      <button aria-pressed={discussion.tab === "comments"} aria-controls="sale-context-content" onClick={() => onChange({tab:"comments"})}>Comments <span>{count}</span></button>
      <button aria-pressed={discussion.tab === "activity"} aria-controls="sale-context-content" onClick={() => onChange({tab:"activity"})}>Activity</button>
    </div>
    <p className={s.contextFixture}>Fictional records · no read receipts or sending.</p>
    <div id="sale-context-content" key={discussion.tab} className={s.contextMessages} role="region" aria-label={discussion.tab === "comments" ? "Conversation messages" : "Sale activity"} tabIndex={0}>
      {discussion.tab === "comments" ? count === 0 ? <p className={s.emptyConversation}>No comments yet for this sale.</p> :
        Array.from({length:count},(_,i)=><article className={s.comment} key={i}><div>
          <strong>{i % 2 ? "Dana Miller · Developer" : "Sam Taylor · Sales agent"}</strong>
          <p>{messages[i % messages.length]}</p><small>{5 + Math.floor(i/2)} Oct 2026, {i % 2 ? "10:15" : "09:30"}</small>
        </div></article>) :
        state.scenario.id.startsWith("completion-") ? <History completed={state.scenario.status === "Completed"} /> :
        <p className={s.meta}>Viewing the saved {state.scenario.label.toLowerCase()} snapshot. Scenario selection does not create an audit event.</p>}
    </div>
    {discussion.tab === "comments" && <div className={s.contextComposer}>
      <label className={s.field}>Draft comment<textarea value={discussion.draft} onChange={e=>onChange({draft:e.target.value})} placeholder="Try a local draft…" aria-describedby="local-draft-note" /></label>
      <div><p id="local-draft-note" className={s.contextFixture}>Local draft only · cleared on reload.</p><button className={s.primary} disabled>Send comment</button></div>
    </div>}
  </aside>;
}
