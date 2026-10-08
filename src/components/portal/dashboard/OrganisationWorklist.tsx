"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ArrowUpRight, AlertCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import { SaleMentionsInbox } from "../sales/SaleConversation";
import { destinationUrl, filterWork } from "@/lib/dashboard/presentation";
import { calendarDays, deadlineState, formatWorkDate, londonDate } from "@/lib/dashboard/dates";
import type { DashboardSnapshot, WorkDestination, WorkItem, WorkModule } from "@/lib/dashboard/types";
import styles from "./OrganisationWorklist.module.css";

const PAGE_SIZE = 10;
export function OrganisationWorklist({ identity, buildingId, external = false }: { identity: string; buildingId: string; external?: boolean }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState<"ours" | "others">("ours");
  const [module, setModule] = useState<"all" | WorkModule>("all");
  const [page, setPage] = useState(0);
  const [expandedDates, setExpandedDates] = useState(false);
  const active = useRef<AbortController | null>(null);
  const lastLoaded = useRef(0);
  const requestKey = `${identity}:${buildingId}`;
  const currentKey = useRef(requestKey);
  const pendingRefresh = useRef(false);
  useEffect(() => { currentKey.current = requestKey; }, [requestKey]);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden" || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session || data.session.user.id !== identity.split(":")[0]) { setSnapshot(null); throw new Error("Sign in again to see your work."); }
      const response = await fetch(`/api/dashboard?building=${encodeURIComponent(buildingId || "all")}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal,
      });
      const result = await response.json();
      if (controller.signal.aborted || currentKey.current !== requestKey) return;
      if (!response.ok) {
        // Revocation, logout and identity changes never retain visible stale records.
        if ([401, 403].includes(response.status)) setSnapshot(null);
        throw new Error(result.error ?? "Worklist unavailable.");
      }
      if (!Array.isArray(result.items) || result.scope?.identity !== identity || result.scope?.buildingId !== buildingId) { setSnapshot(null); throw new Error("The worklist scope changed. Reload the portal."); }
      setSnapshot(result); setError(""); lastLoaded.current = Date.now();
    } catch (cause) {
      if (currentKey.current === requestKey) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Refresh timed out. Try again.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null; setRefreshing(false);
        if (pendingRefresh.current) { pendingRefresh.current = false; window.dispatchEvent(new Event("portal-work-changed")); }
      }
    }
  }, [buildingId, identity, requestKey]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => { if (Date.now() - lastLoaded.current > 15_000) void refresh(); };
    const onMutation = () => { lastLoaded.current = 0; if (active.current) pendingRefresh.current = true; else void refresh(); };
    const timer = window.setInterval(() => void refresh(), 60_000);
    const auth = createSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || session && session.user.id !== identity.split(":")[0]) { active.current?.abort(); setSnapshot(null); setError("Sign in to see your work."); }
    });
    window.addEventListener("focus", onFocus); window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus); window.addEventListener("sale-activity-changed", onMutation);
    window.addEventListener("portal-work-changed", onMutation);
    return () => {
      clearTimeout(initial); clearInterval(timer); active.current?.abort(); active.current = null;
      auth.data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("sale-activity-changed", onMutation);
      window.removeEventListener("portal-work-changed", onMutation);
    };
  }, [identity, refresh]);

  const current = snapshot?.scope.identity === identity && snapshot.scope.buildingId === buildingId ? snapshot : null;
  const failures = current?.sources.filter(s => s.state === "unavailable") ?? [];
  const selected = current ? filterWork(current, queue, module) : null;
  const ourCounts = current ? filterWork(current, "ours", module) : null;
  const otherCounts = current ? filterWork(current, "others", module) : null;
  const pageIndex = Math.min(page, Math.max(0, Math.ceil((selected?.records ?? 0) / PAGE_SIZE) - 1));
  const visible = selected?.rows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE) ?? [];
  const asOf = current ? Date.parse(current.asOf) : 0;
  const deadlines = current?.items.filter(item => item.urgent || ["overdue", "today", "soon"].includes(deadlineState(item.deadline, asOf, expandedDates ? 30 : 7))) ?? [];
  const deadlineRecords = new Set(deadlines.map(item => item.recordKey));
  const allowedModules: ("all" | WorkModule)[] = external ? ["all", "sales"] : current?.sources.some(s => s.key === "sales" && s.state !== "not_permitted") ? ["all", "sales", "snags", "other"] : ["all", "snags", "other"];
  const href = (destination: WorkDestination) => destinationUrl(destination, buildingId, external ? "sales" : "dashboard");
  function open(event: React.MouseEvent<HTMLAnchorElement>, destination: WorkDestination) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (destination.unitId) markUnitOpenIntent(destination.unitId);
    window.history.pushState(null, "", href(destination));
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const actionLink = (item: WorkItem) => item.destination
    ? <a className={styles.workLink} href={href(item.destination)} onClick={event => open(event, item.destination!)}>{item.action}<ArrowUpRight size={15} aria-hidden /></a>
    : <span className={styles.workLink}>{item.action}</span>;
  const timing = (item: WorkItem) => <>
    <span>{item.responsibility.label}</span>
    <span>{item.waiting.since ? `${item.waiting.basis}: ${formatWorkDate(item.waiting.since, item.waiting.precision)}${!item.waiting.fallback ? ` · ${Math.max(0, calendarDays(item.waiting.since.length === 10 ? item.waiting.since : londonDate(new Date(item.waiting.since)), londonDate(asOf)))} days waiting` : ""}` : item.waiting.basis}</span>
    {item.deadline && <strong className={styles.deadline}>{item.deadline.basis}: {formatWorkDate(item.deadline.at, item.deadline.precision)} · {({ overdue: "Passed", today: "Due today", soon: "Approaching", future: "Upcoming", none: "" })[deadlineState(item.deadline, asOf)]}</strong>}
    {!item.canAct && <span>Read only here · an authorised colleague is required.</span>}
  </>;

  return <section className={styles.root} aria-label={external ? "Sales organisation worklist" : "Portfolio overview"}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Organisation work</p><h2>{external ? "Your team’s sales work" : "Portfolio overview"}</h2>
        <p>{current?.scope.team ?? "Checking team access"} · {current?.scope.label ?? (buildingId ? "Selected building" : "All accessible buildings")}</p></div>
      <div className={styles.refresh}><button type="button" className="secondary" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={15} aria-hidden />{refreshing ? "Refreshing…" : "Refresh work"}</button>
        <span role="status">{current ? `${error ? "Last known snapshot" : "Refreshed"} ${formatWorkDate(current.asOf)} · London` : "Loading current work"}</span>
        {!external && current?.sources.some(source => source.key === "sales" && source.state !== "not_permitted") && <SaleMentionsInbox />}</div>
    </header>
    {error && <div role="alert" className={styles.warning}><AlertCircle size={18} aria-hidden /><p>{error} {current && "Displayed work may be stale."}</p></div>}
    {failures.length > 0 && <div role="status" className={styles.warning}><p>Partial coverage: {failures.map(f => f.label).join(", ")} unavailable. Refresh to retry. Available counts exclude these sources.</p></div>}
    {!current && !error && <p className={styles.empty}>Checking your organisation’s outstanding work…</p>}
    {current && <>
      {deadlineRecords.size > 0 && <div className={styles.urgent}><strong>{deadlineRecords.size} records with urgent work or approaching/passed dates</strong><a href="#work-deadlines">Review dates and exceptions</a></div>}
      <div className={styles.main}>
        <div className={styles.work}>
          <div className={styles.tabs} aria-label="Responsibility">
            <button aria-pressed={queue === "ours"} onClick={() => { setQueue("ours"); setPage(0); }}>Our actions <span>{ourCounts?.records ?? 0}</span></button>
            <button aria-pressed={queue === "others"} onClick={() => { setQueue("others"); setPage(0); }}>Waiting on others <span>{otherCounts?.records ?? 0}</span></button>
          </div>
          <div className={styles.filters} aria-label="Work modules">{allowedModules.map(key => <button key={key} aria-pressed={module === key} onClick={() => { setModule(key); setPage(0); }}>{({ all: "All", sales: "Sales", snags: "Snags & defects", other: "Other" })[key]}</button>)}
            {(module !== "all" || queue !== "ours" || page > 0) && <button onClick={() => { setModule("all"); setQueue("ours"); setPage(0); }}>Reset filters</button>}</div>
          <p className={styles.count}>{selected?.records ?? 0} affected records · {selected?.tasks ?? 0} outstanding tasks. A record can have work in both tabs.{module === "all" && selected && <> {(["sales", "snags", "other"] as const).map(key => `${new Set(selected.items.filter(item => item.module === key).map(item => item.recordKey)).size} ${{ sales: "sale files", snags: "snags/defects", other: "other records" }[key]}`).join(" · ")}.</>}</p>
          {visible.length ? <ol className={styles.rows}>{visible.map(row => <li key={row.key} className={styles.row}>
            <p className={styles.reference}>{row.buildingName} · {row.reference}</p>
            <p className={styles.position}>{row.items[0].source} · {row.items[0].position}</p>
            {actionLink(row.items[0])}<div className={styles.context}>{timing(row.items[0])}</div>
            {(row.items.length > 1 || row.items[0].context) && <details><summary>{row.items.length > 1 ? `${row.items.length - 1} more outstanding ${row.items.length === 2 ? "action" : "actions"} and context` : "Latest business context"}</summary>
              {row.items[0].context && <blockquote>{row.items[0].context.text}<footer>{row.items[0].context.account ?? "Account not recorded"}{row.items[0].context.at ? ` · ${formatWorkDate(row.items[0].context.at)}` : ""}</footer></blockquote>}
              {row.items.slice(1).map(item => <div key={item.id} className={styles.secondary}>{actionLink(item)}<div className={styles.context}>{timing(item)}</div>{item.context?.text !== row.items[0].context?.text && item.context && <blockquote>{item.context.text}<footer>{item.context.account ?? "Account not recorded"}{item.context.at ? ` · ${formatWorkDate(item.context.at)}` : ""}</footer></blockquote>}</div>)}
            </details>}
          </li>)}</ol> : <p className={styles.empty}>{current.buildings.length === 0 ? "No accessible buildings in this scope." : failures.length || error ? "No work is shown from the available sources. Unavailable sources still need checking." : module !== "all" ? "No outstanding work matches this module and team filter." : queue === "ours" ? "All clear — no outstanding actions for your team in this scope." : "No outstanding work is currently waiting on another team."}</p>}
          {(selected?.records ?? 0) > PAGE_SIZE && <nav className={styles.pagination} aria-label="Worklist pages"><button className="secondary" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Previous</button><span>{pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, selected!.records)} of {selected!.records} records</span><button className="secondary" disabled={(pageIndex + 1) * PAGE_SIZE >= selected!.records} onClick={() => setPage(pageIndex + 1)}>Next</button></nav>}
        </div>
        <aside id="work-deadlines" className={styles.aside}><h3>Dates & exceptions</h3><p>Saved dates, not age-based service targets.</p><button className={styles.textButton} onClick={() => setExpandedDates(!expandedDates)}>{expandedDates ? "Show next 7 days" : "Show next 30 days"}</button>
          {deadlines.length ? <ul>{deadlines.slice(0, 6).map(item => <li key={item.id}><strong>{item.reference}</strong>{actionLink(item)}<span>{item.deadline ? `${item.deadline.basis}: ${formatWorkDate(item.deadline.at, item.deadline.precision)}` : "Urgent resident defect"}</span></li>)}</ul> : <p>No recorded deadlines in this window from available sources.</p>}
          {deadlines.length > 6 && <p>{deadlines.length - 6} further dated tasks appear in the worklist.</p>}
        </aside>
      </div>
      {!external && <details className={styles.summaries} open><summary>Portfolio position</summary><dl>{current.summaries.map(summary => <div key={summary.key}><dt>{summary.label}</dt><dd>{summary.value ?? "Unavailable"} <small>{summary.value === null ? "" : summary.unit}</small></dd>{summary.detail && <p>{summary.detail}</p>}</div>)}</dl></details>}
      <details className={styles.activity}><summary>Recent business activity · last 7 London calendar days</summary><p>Latest recorded milestone per event type; open a sale’s activity for the full history. Unread messages do not determine outstanding work.</p>
        {current.activity.length ? <ul>{current.activity.map(event => <li key={event.id}><a href={href(event.destination)} onClick={click => open(click, event.destination)}>{event.text}</a><span>{event.account ?? "Account not recorded"} · {formatWorkDate(event.at)}</span></li>)}</ul> : <p>{current.sources.some(s => s.key === "history" && s.state === "unavailable") ? "Business history unavailable." : "No recent sales milestones in the available history."}</p>}
      </details>
      {!external && current.buildings.length > 1 && <details className={styles.activity}><summary>Building comparison</summary><ul>{current.buildings.map(building => <li key={building.id}><strong>{building.name}</strong><span>{building.sales ?? "—"} sales-route units · {building.rentals ?? "—"} active rentals · {building.snags ?? "—"} developer snags · {building.defects ?? "—"} resident defects</span></li>)}</ul><p>Sales and rental populations can overlap. A dash means unavailable or outside this role’s permissions.</p></details>}
    </>}
  </section>;
}
