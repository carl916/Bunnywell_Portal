"use client";

import type { MouseEvent } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import { datesToReview, moduleDestination, type AttentionCount } from "@/lib/dashboard/overview";
import { destinationUrl } from "@/lib/dashboard/presentation";
import { deadlineState, formatWorkDate } from "@/lib/dashboard/dates";
import { isUnallocatedWork, isWorkObservation } from "@/lib/dashboard/work-classification";
import type { DashboardSnapshot, WorkItem } from "@/lib/dashboard/types";
import { SaleMentionsInbox } from "../sales/SaleConversation";
import styles from "./InternalDashboard.module.css";

function navigate(event: MouseEvent<HTMLAnchorElement>, href: string, unitId?: string | null) {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (unitId) markUnitOpenIntent(unitId);
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function InternalDashboard({ snapshot, buildingId, scopeLabel, error, refreshing, refresh }: {
  snapshot: DashboardSnapshot | null; buildingId: string; scopeLabel?: string;
  error: string; refreshing: boolean; refresh: () => void;
}) {
  const overview = snapshot?.overview;
  const loading = !snapshot && !error;
  const failures = snapshot?.sources.filter(source => source.state === "unavailable") ?? [];
  const dates = snapshot ? datesToReview(snapshot) : [];
  const buildings = new Map(snapshot?.buildings.map(building => [building.id, building.name]));
  const emptyValue = loading ? "Loading…" : "Unavailable";
  const metric = (key: string) => snapshot?.summaries.find(summary => summary.key === key)?.value ?? emptyValue;
  const noRentals = snapshot?.summaries.find(summary => summary.key === "rentals")?.value === 0;
  const rentalEvidence = snapshot?.summaries.find(summary => summary.key === "reported_arrears")?.detail;
  const general = (screen: string, label: string, extra: Record<string, string> = {}) => {
    const href = moduleDestination(screen, buildingId, extra);
    return <a href={href} onClick={event => navigate(event, href)}>{label}<ArrowUpRight size={14} aria-hidden /></a>;
  };
  const count = (value: AttentionCount | undefined) => {
    if (!value || value.value === null) return <span className={styles.muted}>{emptyValue}</span>;
    const text = `${value.value} ${value.value === 1 ? ({ "unit rows": "unit row", "sale attempts": "sale attempt", "snag records": "snag record", "rental units": "rental unit" })[value.unit] ?? value.unit : value.unit}`;
    return value.href && !error ? <a className={styles.countLink} href={value.href} onClick={event => navigate(event, value.href!)}>{text}<ArrowUpRight size={14} aria-hidden /></a> : <span>{text}</span>;
  };
  const dateRows = (items: WorkItem[]) => items.map(item => {
    const href = item.destination ? destinationUrl(item.destination, buildingId) : null;
    return <tr key={item.id}>
      <td><strong>{item.reference}</strong><small>{buildings.get(item.buildingId) ?? "Building unavailable"}</small></td>
      <td>{item.action}<small>{isWorkObservation(item) ? "Recorded contractual date" : item.deadline?.basis === "Fixed-term review date" ? "Review date" : item.deadline ? "Actionable deadline" : item.urgent ? "Urgent resident defect" : isUnallocatedWork(item) ? "Responsible team unallocated" : item.responsibility.allocation === "unavailable" ? "Appointment unavailable" : "Undated exception"}</small></td>
      <td>{item.deadline ? <>{formatWorkDate(item.deadline.at, item.deadline.precision)}<small>{isWorkObservation(item) && deadlineState(item.deadline, Date.parse(snapshot!.asOf)) === "overdue" ? "Passed date" : item.deadline.basis}</small></> : <span className={styles.muted}>No deadline recorded</span>}</td>
      <td>{href ? <a className={styles.open} href={href} aria-label={`Open ${item.reference}: ${item.action}`} onClick={event => navigate(event, href, item.unitId)}>Open<ArrowUpRight size={14} aria-hidden /></a> : <span className={styles.muted}>Authorised colleague</span>}</td>
    </tr>;
  });
  const datesTable = (items: WorkItem[], label: string) => <div className={styles.dateScroll} tabIndex={0} role="region" aria-label={label}>
    <table className={styles.datesTable}><thead><tr><th scope="col">Unit / building</th><th scope="col">Issue</th><th scope="col">Recorded date</th><th scope="col">Open</th></tr></thead><tbody>{dateRows(items)}</tbody></table>
  </div>;

  return <section className={styles.dashboard} aria-label="Dashboard">
    <header className={styles.header}>
      <div><h1>Dashboard</h1><p>{snapshot?.scope.label ?? scopeLabel ?? (buildingId ? "Selected building" : "All accessible buildings")} · {snapshot?.scope.team ?? "Developer team"}</p></div>
      <div className={styles.tools}><button type="button" className="secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={15} aria-hidden />{refreshing ? "Refreshing…" : "Refresh work"}</button><SaleMentionsInbox /></div>
    </header>
    <div className={styles.status} role="status">{snapshot ? `${error ? "Last known snapshot" : "Refreshed"} ${formatWorkDate(snapshot.asOf)} · London` : error ? "Dashboard unavailable" : "Loading dashboard…"}</div>
    {error && <div className={styles.warning} role="alert">{error} {snapshot && "Displayed work may be stale."}</div>}
    {failures.length > 0 && <p className={styles.warning} role="status">Unavailable: {failures.map(source => source.label).join(", ")}. Refresh to retry; affected counts are not shown as zero.</p>}

    <section className={`panel ${styles.position}`} aria-labelledby="dashboard-position" aria-busy={loading}>
      <h2 id="dashboard-position">{buildingId ? "Building position" : "Portfolio position"}</h2>
      <div className={styles.positions}>
        <div><div className={styles.groupHeading}><h3>Sales</h3>{general("sales", "Open Sales")}</div>
          <dl className={styles.pipeline}>{(overview?.sales ?? ["For sale", "Reserved", "Exchanged", "Completed", "Handed over"].map(label => ({ key: label, label, value: null }))).map(stage => <div key={stage.key}><dt>{stage.label}</dt><dd>{stage.value ?? emptyValue}</dd></div>)}</dl>
          <p className={styles.caption}>Units on the sales pipeline.</p>
        </div>
        <div><div className={styles.groupHeading}><h3>Snags & defects</h3>{general("snags", "Open Snags")}</div>
          <dl className={styles.metrics}><div><dt>Active developer snags</dt><dd>{metric("developer_snags")}</dd></div><div><dt>Active resident defects</dt><dd>{metric("resident_defects")}</dd></div></dl>
          <div className={styles.sourceLinks}>{general("snags", "Developer snags", { snagSource: "developer_snag" })}{general("snags", "Resident defects", { snagSource: "leaseholder_defect" })}</div>
        </div>
        <div><div className={styles.groupHeading}><h3>Rentals</h3>{general("rentals", "Open Rentals")}</div>
          <div>{noRentals && <p className={styles.caption}>No active rental units</p>}<dl className={styles.metrics}><div><dt>Occupied</dt><dd>{metric("occupied")}</dd></div><div><dt>Void</dt><dd>{metric("voids")}</dd></div></dl></div>
          <p className={styles.evidence}>{rentalEvidence ?? (loading ? "Loading rental evidence…" : "Rental evidence unavailable. No reported arrears is not proof that rent is paid.")}</p>
        </div>
      </div>
    </section>

    <section className={`panel ${styles.attention}`} aria-labelledby="dashboard-attention" aria-busy={loading}>
      <h2 id="dashboard-attention">Work needing attention</h2>
      <table className={styles.attentionTable}><thead><tr><th scope="col">Area</th><th scope="col">Our team</th><th scope="col">Other teams</th></tr></thead><tbody>
        {(overview?.attention ?? [{ key: "sales", label: "Sales" }, { key: "fees", label: "Agent Fees" }, { key: "snags", label: "Snags & defects" }, { key: "rentals", label: "Rentals" }]).map(row => <tr key={row.key}>
          <th scope="row">{"href" in row ? <a href={row.href} onClick={event => navigate(event, row.href)}>Open {row.label}<ArrowUpRight size={14} aria-hidden /></a> : row.label}{"note" in row && row.note && <small>{row.note}</small>}{"unallocated" in row && row.unallocated && row.unallocated.value !== null && row.unallocated.value > 0 && <small className={styles.unallocated}>Unallocated: {count(row.unallocated)}</small>}</th>
          <td>{count("ours" in row ? row.ours : undefined)}</td><td>{count("others" in row ? row.others : undefined)}</td>
        </tr>)}
      </tbody></table>
      <p className={styles.caption}>Records can appear in both columns and areas. Linked counts open matching views; other counts are summaries.</p>
      <div className={styles.additional}>
        <h3>Other existing work</h3>
        {!overview ? <p className={styles.muted}>{emptyValue}</p> : overview.additional.length ? <ul>{overview.additional.map(group => <li key={group.key}><span><strong>{group.count}</strong> · {group.label}{group.detail && <small>{group.detail}</small>}</span>{group.href ? <a href={group.href} onClick={event => navigate(event, group.href!)}>{group.linkLabel ?? "Open area"}<ArrowUpRight size={14} aria-hidden /></a> : <span className={styles.muted}>Review with an authorised colleague</span>}</li>)}</ul> : <p className={styles.muted}>No additional work from the available sources.</p>}
      </div>
    </section>

    <section className={`panel ${styles.dates}`} aria-labelledby="dashboard-dates" aria-busy={loading}>
      <h2 id="dashboard-dates">Dates to review</h2>
      <p className={styles.caption}>Recorded deadlines and saved dates to check. Time waiting is not a deadline.</p>
      <div className={styles.dateContent}>{!snapshot ? <p className={styles.muted}>{loading ? "Loading dates…" : "Dates unavailable."}</p> : dates.length ? datesTable(dates.slice(0, 5), "Priority dates to review") : <p className={styles.muted}>No dates or exceptions in the current review window{failures.length || error ? " from the available sources" : ""}.</p>}</div>
      {dates.length > 5 && <details className={styles.remaining}><summary>{dates.length - 5} more dates and exceptions</summary><p className={styles.caption}>These entries have no combined working-page view. Open each record below.</p>{datesTable(dates.slice(5), "Remaining dates to review")}</details>}
    </section>

    <details className={`panel ${styles.activity}`}><summary>Recent sales activity · Last 7 days</summary>
      <p className={styles.caption}>Up to 7 entries from the last 7 London calendar days. Latest milestone per sale and event type; open a sale for its full history.</p>
      {!snapshot ? <p className={styles.muted}>{loading ? "Loading recent activity…" : "Recent activity unavailable."}</p> : snapshot.sources.some(source => source.key === "history" && source.state !== "ready") ? <p className={styles.muted}>Recent activity unavailable.</p> : snapshot.activity.length ? <ul>{snapshot.activity.map(event => {
        const href = destinationUrl(event.destination, buildingId);
        return <li key={event.id}><a href={href} onClick={click => navigate(click, href, event.destination.unitId)}>{[event.buildingName, event.reference].filter(Boolean).join(" · ")}{(event.buildingName || event.reference) && " — "}{event.text}</a><small>{event.account ?? "Account not recorded"} · {formatWorkDate(event.at)}</small></li>;
      })}</ul> : <p className={styles.muted}>No recent sales milestones in the available history.</p>}
    </details>
  </section>;
}
