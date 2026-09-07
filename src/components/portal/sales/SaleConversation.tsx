"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefCallback } from "react";
import { CheckCircle2, FileText, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { activityPresentation, COMMENT_LIMIT, discussionDraftKey, discussionRpc, mentionLink, mergeComments, personRole,
  type CommentPage, type MentionNotification, type Revision, type SaleActivity, type SaleComment, type SalePerson } from "@/lib/sales/discussion";
import styles from "./SaleConversation.module.css";

const time = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { dateStyle: "long" });
const refreshUnread = () => window.dispatchEvent(new Event("sale-discussion-changed"));
type Draft = { body: string; mentions: SalePerson[]; parent: SaleComment | null; stage: string; clientId: string };
const emptyDraft = (): Draft => ({ body: "", mentions: [], parent: null, stage: "", clientId: crypto.randomUUID() });

export function useSaleUnread(saleIds: string[]) {
  const key = [...saleIds].sort().join(",");
  const [state, setState] = useState<{ key: string; counts: Record<string, number> }>({ key: "", counts: {} });
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const ids = key.split(",").filter(Boolean);
      try {
        const counts: Record<string, number> = {};
        for (let i = 0; i < ids.length; i += 500) Object.assign(counts, await discussionRpc("sale_comment_unread", { p_sales: ids.slice(i, i + 500) }));
        if (active) setState({ key, counts });
      } catch { if (active) setState({ key, counts: {} }); }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("sale-discussion-changed", refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("sale-discussion-changed", refresh); };
  }, [key]);
  return state.key === key ? state.counts : {};
}

export function SaleMentionsInbox() {
  const [items, setItems] = useState<MentionNotification[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try { const next = await discussionRpc<MentionNotification[]>("sale_mentions_inbox"); if (active) setItems(next ?? []); }
      catch { if (active) setItems([]); }
    };
    void refresh(); const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("sale-discussion-changed", refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("sale-discussion-changed", refresh); };
  }, []);
  return <div className="text-sm">
    <button className="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>@ Mentions {items.length > 0 && <UnreadBadge count={items.length} />}</button>
    {open && <div className="mt-2 border border-[#d9ded6] bg-white p-3">
      {items.length === 0 ? <p>No unread mentions.</p> : items.map((item) => <a className="block border-b border-[#eef0eb] py-2 underline" key={item.id} href={mentionLink(item)}>
        {item.author_name} mentioned you · Unit {item.unit_number}, {item.building_name}<span className="block text-xs text-[#617169]">{time(item.created_at)}</span>
      </a>)}
    </div>}
  </div>;
}

export function UnreadBadge({ count }: { count: number }) { return count > 0 ? <span className={styles.badge} aria-label={`${count} unread comments`}>{count}</span> : null; }

// Intent survives workspace switches and resizing. Automatic desktop visibility
// never grants permission to open a modal or to move focus into Comments.
export function useSaleConversationLayout() {
  const [intent, setIntent] = useState<"default" | "open" | "closed">("default");
  const [docked, setDocked] = useState<boolean | null>(null);
  const containerRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
    if (!element) return;
    const css = getComputedStyle(element);
    const dimension = (name: string) => Number.parseFloat(css.getPropertyValue(name));
    const minimum = dimension("--conversation-main-min") + dimension("--conversation-rail-min") + dimension("--conversation-gap");
    const restoreMargin = dimension("--conversation-restore-margin");
    let previous: boolean | null = null;
    const observer = new ResizeObserver(([entry]) => {
      // Measure the full, inline-contained layout, never the shrinking content
      // column. CSS owns the dimensions; JS owns only the hysteresis decision.
      const next = entry.contentRect.width >= minimum + (previous === false ? restoreMargin : 0);
      if (next !== previous) { previous = next; setDocked(next); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { containerRef, docked: docked === true, intent, setIntent,
    open: docked !== null && (intent === "open" || (intent === "default" && docked)) };
}

export function SaleConversationLayout({ children, saleId, unitId, userId, containerRef, docked, open, onClose, unread, internal, onStage, targetComment, stageLinks = true }: {
  children: ReactNode; saleId?: string; unitId: string; userId: string; containerRef: RefCallback<HTMLDivElement>; docked: boolean; open: boolean; onClose: () => void;
  unread: number; internal: boolean; onStage: (stage: string) => void; targetComment?: string; stageLinks?: boolean;
}) {
  const [started, setStarted] = useState<{ unit: string; id: string } | null>(null);
  const identity = saleId ?? (started?.unit === unitId ? started.id : undefined);
  return <div ref={containerRef} className={styles.layout} data-docked={open && docked} data-presentation={open ? docked ? "inline" : "overlay" : "collapsed"}>
    <div className={styles.workspace}>{children}</div>
    <SaleConversation key={`${userId}:${identity ?? unitId}`} saleId={identity} unitId={unitId} userId={userId} open={open} modal={!docked}
      onClose={onClose} unread={unread} internal={internal} onStage={onStage} targetComment={targetComment}
      onStarted={(id) => setStarted({ unit: unitId, id })} stageLinks={stageLinks} />
  </div>;
}

function PlainText({ body }: { body: string }) {
  // React escapes all text; only explicit http(s) links become anchors.
  return <>{body.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part)}</>;
}

function SaleConversation({ saleId, unitId, userId, open, modal, onClose, unread, internal, onStage, targetComment, onStarted, stageLinks }: {
  saleId?: string; unitId: string; userId: string; open: boolean; modal: boolean; onClose: () => void; unread: number; internal: boolean;
  onStage: (stage: string) => void; targetComment?: string; onStarted: (id: string) => void; stageLinks: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const activityFeed = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const commentsRef = useRef<SaleComment[]>([]);
  const acknowledged = useRef(new Set<string>());
  const inFlight = useRef(false);
  const atBottom = useRef(true);
  const initialScroll = useRef(false);
  const pendingScroll = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comments, setComments] = useState<SaleComment[]>([]);
  const [people, setPeople] = useState<SalePerson[]>([]);
  const [candidates, setCandidates] = useState<SalePerson[] | null>(null);
  const [draft, setDraft] = useState<Draft>(() => {
    try { const saved = saleId && sessionStorage.getItem(discussionDraftKey(userId, saleId)); if (saved) return JSON.parse(saved); } catch { /* session storage may be unavailable */ }
    return emptyDraft();
  });
  const [editing, setEditing] = useState<SaleComment | null>(null);
  const [editText, setEditText] = useState("");
  const [editMentions, setEditMentions] = useState<SalePerson[]>([]);
  const [history, setHistory] = useState<{ id: string; revisions: Revision[] } | null>(null);
  const [hasBefore, setHasBefore] = useState(false);
  const [hasAfter, setHasAfter] = useState(false);
  const [activity, setActivity] = useState<SaleActivity[]>([]);
  const [moreActivity, setMoreActivity] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const text = editing ? editText : draft.body;
  const selectedMentions = editing ? editMentions : draft.mentions;
  const suggestions = mentionQuery === null ? [] : people.filter((p) => p.name.toLowerCase().includes(mentionQuery.toLowerCase()) && !selectedMentions.some((m) => m.id === p.id)).slice(0, 8);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || modal || !panel.current) return;
    const element = panel.current;
    const measure = () => element.style.setProperty("--conversation-top", `${Math.max(100, element.getBoundingClientRect().top)}px`);
    const frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, { passive: true }); window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [open, modal]);
  useEffect(() => {
    if (saleId) try { sessionStorage.setItem(discussionDraftKey(userId, saleId), JSON.stringify(draft)); } catch { /* state still preserves drafts within this sale */ }
  }, [draft, saleId, userId]);

  const fail = useCallback((reason: unknown) => {
    if (!alive.current) return;
    const message = reason instanceof Error ? reason.message : "Could not load this conversation. Retry.";
    setError(message);
    if (/not assigned|access has ended|permission denied|access denied/i.test(message)) {
      setDenied(true); setComments([]); commentsRef.current = []; setPeople([]); setActivity([]); setHistory(null); setCandidates(null);
    }
  }, []);

  const accept = useCallback((incoming: SaleComment[], replace = false) => {
    const merged = mergeComments(replace ? [] : commentsRef.current, incoming);
    const previousLast = commentsRef.current.at(-1)?.sequence ?? 0;
    const added = merged.some((c) => c.sequence > previousLast);
    if (previousLast && added && !atBottom.current) setNewMessages(true);
    commentsRef.current = merged; setComments(merged);
    if (added && atBottom.current && initialScroll.current) requestAnimationFrame(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; });
  }, []);

  const load = useCallback(async () => {
    if (!saleId) return;
    try {
      const [page, participants] = await Promise.all([
        discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, p_unit: unitId, ...(targetComment ? { p_target: targetComment } : {}) }),
        discussionRpc<SalePerson[]>("sale_discussion_people", { p_sale: saleId }),
      ]);
      if (!alive.current) return;
      setDenied(false); accept(page.comments ?? [], true); setPeople(participants ?? []); setHasBefore(page.hasBefore); setHasAfter(page.hasAfter); setLoaded(true);
      pendingScroll.current = targetComment ?? page.comments?.find((c) => c.unread)?.id ?? "bottom";
    } catch (reason) { fail(reason); } finally { if (alive.current) setBusy(false); }
  }, [saleId, unitId, targetComment, accept, fail]);

  useEffect(() => { if (open && !loaded && !denied) void Promise.resolve().then(load); }, [open, loaded, denied, load]);
  useEffect(() => {
    if (!open || tab !== "comments" || !loaded) return;
    if (pendingScroll.current) {
      const target = pendingScroll.current; pendingScroll.current = null;
      requestAnimationFrame(() => {
        if (target === "bottom") { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }
        else panel.current?.querySelector<HTMLElement>(`[data-comment-id="${target}"]`)?.scrollIntoView({ block: "center" });
        initialScroll.current = true;
      });
    }
  }, [comments, open, tab, loaded]);

  // Keep mounted DOM (and independent scroll positions) through tab / mode changes.
  useEffect(() => {
    if (!open || !modal || !panel.current) return;
    const element = panel.current;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const inert: Array<[HTMLElement, boolean]> = [];
    let ancestor: HTMLElement = element;
    while (ancestor.parentElement) {
      for (const sibling of ancestor.parentElement.children) if (sibling !== ancestor && sibling instanceof HTMLElement && !sibling.hasAttribute("data-conversation-backdrop")) {
        inert.push([sibling, sibling.inert]); sibling.setAttribute("inert", "");
      }
      ancestor = ancestor.parentElement;
    }
    element.querySelector<HTMLButtonElement>("button")?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,select,[tabindex="0"]')].filter((node) => node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    element.addEventListener("keydown", keys);
    return () => {
      element.removeEventListener("keydown", keys); inert.forEach(([node, old]) => { if (!old) node.removeAttribute("inert"); }); document.body.style.overflow = previousOverflow;
      if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('[aria-controls="sale-conversation"]')?.focus({ preventScroll: true });
    };
  }, [open, modal]);

  // Recheck access while visible, fetch arrivals and refresh the currently read
  // page for edits. No page reload and no scrolling away from older messages.
  useEffect(() => {
    if (!open || !saleId || !loaded || denied) return;
    let running = false;
    const refresh = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const participants = await discussionRpc<SalePerson[]>("sale_discussion_people", { p_sale: saleId });
        if (!alive.current) return;
        setPeople(participants);
        const current = commentsRef.current;
        const visible = [...(feed.current?.querySelectorAll<HTMLElement>("[data-comment-id]") ?? [])].find((node) => node.getBoundingClientRect().bottom > (feed.current?.getBoundingClientRect().top ?? 0));
        const first = current.find((c) => c.id === visible?.dataset.commentId)?.sequence ?? current[0]?.sequence ?? 1;
        const [updates, arrivals] = await Promise.all([
          discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, p_after: Math.max(0, first - 1) }),
          discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, p_after: current.at(-1)?.sequence ?? 0 }),
        ]);
        if (alive.current) { accept(updates.comments); accept(arrivals.comments); setHasAfter(arrivals.hasAfter); }
        refreshUnread();
      } catch (reason) { fail(reason); } finally { running = false; }
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [open, saleId, loaded, denied, accept, fail]);

  useEffect(() => {
    if (!open || tab !== "comments" || !saleId || !feed.current || denied) return;
    let active = true;
    let reading = false;
    const presented = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { const id = (entry.target as HTMLElement).dataset.readComment!; if (entry.isIntersecting) presented.add(id); else presented.delete(id); });
    }, { root: feed.current, threshold: 1 });
    // Observe the end of the message so even an update taller than the viewport
    // can be acknowledged after it is scrolled through.
    feed.current.querySelectorAll<HTMLElement>("[data-read-comment]").forEach((node) => observer.observe(node));
    const timer = setInterval(async () => {
      if (!active || reading || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const visible = commentsRef.current.filter((c) => presented.has(c.id) && !acknowledged.current.has(`${c.id}:${c.version}`)).slice(0, 100);
      const ids = visible.map((c) => c.id);
      if (!ids.length) return;
      reading = true;
      try {
        await discussionRpc("sale_comment_read", { p_sale: saleId, p_comments: ids });
        if (active && alive.current) {
          visible.forEach((c) => acknowledged.current.add(`${c.id}:${c.version}`));
          if (visible.some((c) => c.unread)) accept(visible.map((c) => ({ ...c, unread: false })));
          refreshUnread();
        }
      } catch (reason) { fail(reason); } finally { reading = false; }
    }, 900);
    return () => { active = false; observer.disconnect(); clearInterval(timer); };
  }, [open, tab, saleId, comments, denied, accept, fail]);

  const loadActivity = useCallback(async (before?: SaleActivity) => {
    if (!saleId) return;
    try {
      const rows = await discussionRpc<SaleActivity[]>("sale_activity_page", { p_sale: saleId, ...(before ? { p_before_time: before.created_at, p_before_id: before.id } : {}) });
      if (alive.current) {
        const scrollTop = activityFeed.current?.scrollTop ?? 0;
        const height = activityFeed.current?.scrollHeight ?? 0;
        setActivity((old) => [...new Map([...old, ...rows.slice(0, 50)].map((event) => [event.id, event])).values()]
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)));
        if (before || !activityLoaded) setMoreActivity(rows.length > 50);
        setActivityLoaded(true);
        if (!before && scrollTop > 20) requestAnimationFrame(() => { if (activityFeed.current) activityFeed.current.scrollTop = scrollTop + activityFeed.current.scrollHeight - height; });
      }
    } catch (reason) { fail(reason); } finally { if (alive.current) setBusy(false); }
  }, [saleId, fail, activityLoaded]);
  useEffect(() => {
    if (!open || tab !== "activity") return;
    const refresh = () => { if (document.visibilityState === "visible") void loadActivity(); };
    if (!activityLoaded) void Promise.resolve().then(refresh);
    const timer = setInterval(refresh, 15000); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [open, tab, activityLoaded, loadActivity]);

  async function paginate(direction: "before" | "after") {
    if (!saleId || busy) return;
    setBusy(true);
    const height = feed.current?.scrollHeight ?? 0;
    const top = feed.current?.scrollTop ?? 0;
    try {
      const page = await discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, ...(direction === "before" ? { p_before: comments[0]?.sequence } : { p_after: comments.at(-1)?.sequence }) });
      if (!alive.current) return;
      accept(page.comments); if (direction === "before") setHasBefore(page.hasBefore); else setHasAfter(page.hasAfter);
      if (direction === "before") requestAnimationFrame(() => { if (feed.current) feed.current.scrollTop = top + feed.current.scrollHeight - height; });
    } catch (reason) { fail(reason); } finally { if (alive.current) setBusy(false); }
  }

  async function reveal(id: string) {
    if (!saleId || !/^[\da-f-]{36}$/i.test(id)) return;
    const node = panel.current?.querySelector<HTMLElement>(`[data-comment-id="${id}"]`);
    if (node) { node.scrollIntoView({ block: "center" }); node.focus({ preventScroll: true }); return; }
    try {
      const page = await discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, p_target: id });
      if (alive.current) { accept(page.comments, true); setHasBefore(page.hasBefore); setHasAfter(page.hasAfter); pendingScroll.current = id; }
    } catch (reason) { fail(reason); }
  }

  function updateText(value: string, position: number) {
    if (editing) setEditText(value); else setDraft((old) => ({ ...old, body: value }));
    setCaret(position); setMentionIndex(0); setMentionQuery(value.slice(0, position).match(/(?:^|\s)@([^@\n]{0,60})$/)?.[1] ?? null);
  }
  function chooseMention(person: SalePerson) {
    const before = text.slice(0, caret).replace(/@[^@\n]*$/, `@${person.name} `);
    const body = before + text.slice(caret);
    if (editing) { setEditText(body); setEditMentions([...editMentions, person]); }
    else setDraft((old) => ({ ...old, body, mentions: [...old.mentions, person] }));
    setMentionQuery(null); input.current?.focus();
  }

  async function send() {
    if (!saleId || inFlight.current || !text.trim() || text.length > COMMENT_LIMIT) return;
    inFlight.current = true; setBusy(true); setSending(true); setError("");
    try {
      const id = await discussionRpc<string>("sale_comment_write", { p_sale: saleId, p_body: text, p_client: draft.clientId,
        p_parent: editing?.parent_id ?? draft.parent?.id ?? null, p_stage: editing?.stage ?? (draft.stage || null),
        p_mentions: selectedMentions.map((person) => person.id), p_comment: editing?.id ?? null, p_version: editing?.version ?? null });
      if (!alive.current) return;
      if (editing) { setEditing(null); setEditText(""); setHistory(null); } else setDraft(emptyDraft());
      const page = await discussionRpc<CommentPage>("sale_comment_page", { p_sale: saleId, p_target: id });
      if (alive.current) { accept(page.comments, true); setHasBefore(page.hasBefore); setHasAfter(page.hasAfter); pendingScroll.current = id; setMentionQuery(null); refreshUnread(); }
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes("earlier update was already sent")) setDraft((old) => ({ ...old, clientId: crypto.randomUUID() }));
      fail(reason);
    } finally { inFlight.current = false; if (alive.current) { setBusy(false); setSending(false); } }
  }

  async function viewDocument(versionId: string) {
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      const response = await fetch(`/api/sales/reservations?${new URLSearchParams({ versionId, discussionSaleId: saleId! })}`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (reason) { fail(reason); }
  }

  async function managePeople() {
    if (candidates) { setCandidates(null); return; }
    try { setCandidates(await discussionRpc<SalePerson[]>("sale_discussion_people", { p_sale: saleId, p_candidates: true })); } catch (reason) { fail(reason); }
  }

  return <>
    {open && modal && <div data-conversation-backdrop className={styles.backdrop} onClick={onClose} />}
    <aside ref={panel} id="sale-conversation" className={styles.panel} hidden={!open} data-modal={modal} role={modal ? "dialog" : "complementary"} aria-modal={modal && open ? true : undefined} aria-label="Sale comments and activity">
      <header className={styles.header}>
        <div className={styles.heading}><h4>{tab === "comments" ? "Comments" : "Activity"}</h4><button type="button" onClick={onClose} aria-label="Close comments panel"><X size={18} /></button></div>
        <p className={styles.audience}>Shared with the agent, developer and solicitor assigned to this sale.</p>
        <div className={styles.tabs} role="tablist" aria-label="Conversation views">
          {(["comments", "activity"] as const).map((view, index) => <button key={view} id={`conversation-tab-${view}`} type="button" role="tab" aria-selected={tab === view} aria-controls={`conversation-${view}`} tabIndex={tab === view ? 0 : -1} onClick={() => setTab(view)}
            onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "comments" : event.key === "End" ? "activity" : index === 0 ? "activity" : "comments"; setTab(next); document.getElementById(`conversation-tab-${next}`)?.focus(); } }}>
            {view === "comments" ? <>Comments <UnreadBadge count={unread} /></> : "Activity"}
          </button>)}
        </div>
      </header>
      {error && <div className={styles.error} role="alert">{error} <button className={styles.link} onClick={() => { setDenied(false); void load(); }}>Retry</button></div>}
      {internal && saleId && !denied && <div className="px-4 pt-2 text-xs"><button className={styles.link} onClick={managePeople} aria-expanded={!!candidates}>Sale participants</button></div>}
      {candidates && <div className={styles.people}><p className={styles.meta}>Assign individual agents and solicitors to this transaction.</p>{candidates.map((person) => <div key={person.id} className={styles.person}><span>{person.name}<span className="block text-xs">{personRole(person.role)}{person.organisation ? ` · ${person.organisation}` : ""}</span></span>
        {["admin", "developer"].includes(person.role) ? <span className={styles.meta}>Portal access</span> : <button className={styles.link} onClick={async () => {
          try { await discussionRpc("sale_discussion_assign", { p_sale: saleId, p_user: person.id, p_assigned: !person.assigned }); setCandidates(await discussionRpc("sale_discussion_people", { p_sale: saleId, p_candidates: true })); setPeople(await discussionRpc("sale_discussion_people", { p_sale: saleId })); } catch (reason) { fail(reason); }
        }}>{person.assigned ? "Revoke" : "Assign"}</button>}</div>)}</div>}
      <div ref={feed} className={styles.feed} hidden={tab !== "comments"} role="tabpanel" id="conversation-comments" aria-labelledby="conversation-tab-comments" onScroll={() => { const node = feed.current!; atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; if (atBottom.current) setNewMessages(false); }}>
        {!saleId && <div className={styles.empty}><p>Start the shared conversation for this sale file before submitting a reservation.</p><button className="secondary mt-3" disabled={busy} onClick={async () => { setBusy(true); try { onStarted(await discussionRpc<string>("sale_discussion_start", { p_unit: unitId })); } catch (reason) { fail(reason); setBusy(false); } }}>Start conversation</button></div>}
        {!loaded && saleId && !denied && !error && <p className={styles.empty} role="status">Loading conversation…</p>}
        {loaded && comments.length === 0 && !denied && <p className={styles.empty}>No comments yet. Add an update for the team working on this sale.</p>}
        {hasBefore && <button className={styles.load} disabled={busy} onClick={() => paginate("before")}>Load older comments</button>}
        {comments.map((comment, index) => <div key={comment.id}>
          {(index === 0 || day(comments[index - 1].created_at) !== day(comment.created_at)) && <div className={styles.date}>{day(comment.created_at)}</div>}
          <article className={styles.message} data-comment-id={comment.id} id={`comment-${comment.id}`} tabIndex={-1}>
            <span className={styles.avatar} aria-hidden>{comment.author_name.split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}</span>
            <div><span className={styles.author}>{comment.author_name}</span>{comment.unread && <span className={styles.badge}>New</span>}
              <p className={styles.meta}>{[comment.author_organisation, personRole(comment.author_role)].filter(Boolean).join(" · ")}</p>
              <p className={styles.meta}><time dateTime={comment.created_at}>{time(comment.created_at)}</time>{comment.edited_at && <> · <button className={styles.link} onClick={async () => { try { setHistory({ id: comment.id, revisions: await discussionRpc("sale_comment_history", { p_sale: saleId, p_comment: comment.id }) }); } catch (reason) { fail(reason); } }}>Edited</button></>}{comment.stage && ` · ${personRole(comment.stage)}`}</p>
              {comment.parent_id && <button className={styles.reply} onClick={() => reveal(comment.parent_id!)}>Reply to {comments.find((c) => c.id === comment.parent_id)?.author_name ?? "earlier comment"}<span className="block line-clamp-2">{comments.find((c) => c.id === comment.parent_id)?.body ?? "View original message"}</span></button>}
              <p className={styles.body}><PlainText body={comment.body} /></p>
              <span data-read-comment={comment.id} className="block h-px" aria-hidden />
              <div className={styles.actions}><button onClick={() => { setDraft((old) => ({ ...old, parent: comment })); setEditing(null); input.current?.focus(); }}>Reply</button>
                {comment.author_id === userId && <button onClick={() => { setEditing(comment); setEditText(comment.body); setEditMentions(comment.mention_ids.map((id) => people.find((person) => person.id === id) ?? { id, name: "Former participant", role: "", organisation: null, assigned: false })); input.current?.focus(); }}>Edit</button>}
              </div>
              {history?.id === comment.id && <div className={styles.history}><div className={styles.context}><strong>Revision history</strong><button onClick={() => setHistory(null)}>Close</button></div>{history.revisions.map((revision) => <div key={revision.version}><p className={styles.meta}>Version {revision.version} · {time(revision.recorded_at)}</p><p className={styles.body}><PlainText body={revision.body} /></p></div>)}</div>}
            </div>
          </article>
        </div>)}
        {hasAfter && <button className={styles.load} disabled={busy} onClick={() => paginate("after")}>Load newer comments</button>}
      </div>
      <div ref={activityFeed} className={styles.feed} hidden={tab !== "activity"} role="tabpanel" id="conversation-activity" aria-labelledby="conversation-tab-activity">
        {!activityLoaded && saleId && !error ? <p className={styles.empty} role="status">Loading activity…</p> : activity.length === 0 && <p className={styles.empty}>No workflow activity recorded.</p>}
        {activity.map((event, index) => { const item = activityPresentation(event); return <div key={event.id}>
          {(index === 0 || day(activity[index - 1].created_at) !== day(event.created_at)) && <div className={styles.date}>{day(event.created_at)}</div>}
          <article className={styles.message}><span className="pt-1 text-[#617169]" aria-hidden>{item.kind === "document" ? <FileText size={17} /> : <CheckCircle2 size={17} />}</span><div>
            <p className={styles.author}>{item.title}</p><p className={styles.meta}>{[event.actor_name ?? (event.actor_role ? "Recorded participant" : "Recorded user"), event.actor_organisation, personRole(event.actor_role)].filter(Boolean).join(" · ")}</p>
            <p className={styles.meta}>Recorded <time dateTime={event.created_at}>{time(event.created_at)}</time>{item.stage && ` · ${personRole(item.stage)}`}</p>
            {item.details.map((detail, i) => <p key={i} className={styles.body}>{detail}</p>)}
            <div className={styles.actions}>{event.version_id ? <button className={styles.link} onClick={() => viewDocument(event.version_id!)}>View document version</button> : typeof event.metadata.fileName === "string" && <span>Historical file link unavailable</span>}
              {item.stage && stageLinks && <button className={styles.link} onClick={() => { onStage(item.stage!); if (modal) onClose(); }}>View {item.stage}</button>}</div>
          </div></article>
        </div>; })}
        {moreActivity && <button className={styles.load} disabled={busy} onClick={() => loadActivity(activity.at(-1))}>Load older activity</button>}
      </div>
      {newMessages && tab === "comments" && <button className={styles.newMessages} onClick={() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); setNewMessages(false); }}>New messages ↓</button>}
      {tab === "comments" && saleId && !denied && <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {editing ? <div className={styles.context}>Editing your comment <button type="button" onClick={() => { setEditing(null); setMentionQuery(null); }}>Cancel edit</button></div>
          : draft.parent && <div className={styles.context}><span>Replying to {draft.parent.author_name}</span><button type="button" onClick={() => setDraft((old) => ({ ...old, parent: null }))}>Cancel reply</button></div>}
        {!editing && <label className={styles.context}>Stage context <select value={draft.stage} onChange={(event) => setDraft((old) => ({ ...old, stage: event.target.value }))}><option value="">Whole sale</option>{["reservation", "exchange", "completion", "handover"].map((stage) => <option key={stage} value={stage}>{personRole(stage)}</option>)}</select></label>}
        {suggestions.length > 0 && <div className={styles.suggestions} role="listbox" id="sale-mention-suggestions" aria-label="Mention sale participant">{suggestions.map((person, index) => <button type="button" role="option" id={`mention-${person.id}`} aria-selected={index === mentionIndex} key={person.id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(person)}>{person.name}<span className="block text-xs">{personRole(person.role)}{person.organisation ? ` · ${person.organisation}` : ""}</span></button>)}</div>}
        <label className="sr-only" htmlFor="sale-comment-composer">Write an update</label>
        <textarea ref={input} id="sale-comment-composer" value={text} placeholder="Write an update…" maxLength={COMMENT_LIMIT} disabled={sending} aria-describedby="sale-comment-shortcut" aria-controls={suggestions.length ? "sale-mention-suggestions" : undefined} aria-activedescendant={suggestions[mentionIndex] ? `mention-${suggestions[mentionIndex].id}` : undefined}
          onChange={(event) => updateText(event.target.value, event.target.selectionStart)} onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); }
            else if (suggestions.length && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); }
            else if (suggestions.length && event.key === "Tab") { event.preventDefault(); chooseMention(suggestions[mentionIndex]); }
            else if (event.key === "Escape" && mentionQuery !== null) { event.stopPropagation(); setMentionQuery(null); }
          }} />
        {selectedMentions.length > 0 && <div className={styles.mentions}>{selectedMentions.map((person) => <button type="button" key={person.id} aria-label={`Remove mention of ${person.name}`} onClick={() => { if (editing) setEditMentions(editMentions.filter((p) => p.id !== person.id)); else setDraft((old) => ({ ...old, mentions: old.mentions.filter((p) => p.id !== person.id) })); }}>@{person.name} ×</button>)}</div>}
        <div className={styles.composerBottom}><span className={styles.hint} id="sale-comment-shortcut">Ctrl/Cmd+Enter to send<br />@ to mention · Tab to select<br />{text.length.toLocaleString()} / 5,000</span><button className="primary" type="submit" disabled={busy || !loaded || !text.trim() || text.length > COMMENT_LIMIT}>{sending ? "Sending…" : editing ? "Save edit" : "Send"}</button></div>
      </form>}
    </aside>
  </>;
}
