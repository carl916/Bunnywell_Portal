"use client";

import type { CSSProperties, MouseEvent } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import { datesToReview, moduleDestination, type AttentionCount } from "@/lib/dashboard/overview";
import { destinationUrl } from "@/lib/dashboard/presentation";
import { deadlineState, formatWorkDate } from "@/lib/dashboard/dates";
import { isUnallocatedWork, isWorkObservation } from "@/lib/dashboard/work-classification";
import type { DashboardSnapshot, WorkItem } from "@/lib/dashboard/types";
import { SaleMentionsInbox } from "../sales/SaleConversation";
import salesStyles from "../sales/DeveloperSalesResults.module.css";
import styles from "./InternalDashboard.module.css";

function DashboardSkeleton({ variant = "line" }: { variant?: "line" | "metric" | "count" | "secondary" | "action" | "status" }) {
  return <span aria-hidden="true" className={`${salesStyles.skeleton} ${styles.skeleton} ${styles[`${variant}Skeleton`]}`} />;
}

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
  // Size the mobile grid for whole counts; large counts / enlarged text reflow.
  const pipelineCountWidth = Math.max(0, ...(overview?.sales ?? []).map(stage => String(stage.value ?? "").length)) * .85;
  const pipelineLabel = (label: string) => ({ Reserved: "Re\u00adserved", Exchanged: "Ex\u00adchanged", Completed: "Com\u00adpleted" })[label] ?? label;
  const failures = snapshot?.sources.filter(source => source.state === "unavailable") ?? [];
  const dates = snapshot ? datesToReview(snapshot) : [];
  const buildings = new Map(snapshot?.buildings.map(building => [building.id, building.name]));
  const emptyValue = loading ? <DashboardSkeleton variant="metric" /> : <span className={styles.muted}>Unavailable</span>;
  const metric = (key: string) => snapshot?.summaries.find(summary => summary.key === key)?.value ?? emptyValue;
  const noRentals = snapshot?.summaries.find(summary => summary.key === "rentals")?.value === 0;
  const rentalEvidence = snapshot?.summaries.find(summary => summary.key === "reported_arrears")?.detail;
  const general = (screen: string, label: string, extra: Record<string, string> = {}) => {
    const href = moduleDestination(screen, buildingId, extra);
    return <a href={href} onClick={event => navigate(event, href)}>{label}<ArrowUpRight size={14} aria-hidden /></a>;
  };
  const count = (value: AttentionCount | undefined) => {
    if (!value || value.value === null) return loading ? <DashboardSkeleton variant="count" /> : <span className={styles.muted}>Unavailable</span>;
    const text = `${value.value} ${value.value === 1 ? ({ "unit rows": "unit row", "sale attempts": "sale attempt", "snag records": "snag record", "rental units": "rental unit" })[value.unit] ?? value.unit : value.unit}`;
    return value.href && !error ? <a className={styles.countLink} href={value.href} onClick={event => navigate(event, value.href!)}>{text}<ArrowUpRight size={14} aria-hidden /></a> : <span>{text}</span>;
  };
  const dateRows = (items: WorkItem[]) => items.map(item => {
    const href = item.destination ? destinationUrl(item.destination, buildingId) : null;
    return <tr key={item.id} role="row">
      <td role="cell" className={styles.dateIdentity}><strong>{item.reference}</strong><small>{buildings.get(item.buildingId) ?? "Building unavailable"}</small></td>
      <td role="cell" className={styles.dateIssue}>{item.action}<small>{isWorkObservation(item) ? "Recorded contractual date" : item.deadline?.basis === "Fixed-term review date" ? "Review date" : item.deadline ? "Actionable deadline" : item.urgent ? "Urgent resident defect" : isUnallocatedWork(item) ? "Responsible team unallocated" : item.responsibility.allocation === "unavailable" ? "Appointment unavailable" : "Undated exception"}</small></td>
      <td role="cell" className={styles.dateValue}>{item.deadline ? <>{formatWorkDate(item.deadline.at, item.deadline.precision)}<small>{isWorkObservation(item) && deadlineState(item.deadline, Date.parse(snapshot!.asOf)) === "overdue" ? "Passed date" : item.deadline.basis}</small></> : <span className={styles.muted}>No deadline recorded</span>}</td>
      <td role="cell" className={styles.dateAction}>{href ? <a className={styles.open} href={href} aria-label={`Open ${item.reference}: ${item.action}`} onClick={event => navigate(event, href, item.unitId)}>Open<ArrowUpRight size={14} aria-hidden /></a> : <span className={styles.muted}>Authorised colleague</span>}</td>
    </tr>;
  });
  const datesTable = (items: WorkItem[], label: string) => <div className={styles.dateScroll} tabIndex={0} role="region" aria-label={label}>
    <table className={styles.datesTable} role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Unit / building</th><th role="columnheader" scope="col">Issue</th><th role="columnheader" scope="col">Recorded date</th><th role="columnheader" scope="col">Open</th></tr></thead><tbody role="rowgroup">{loading ? Array.from({ length: 2 }, (_, index) => <tr key={index} aria-hidden="true" className={styles.dateSkeletonRow}>
      {Array.from({ length: 3 }, (_, cell) => <td key={cell}><DashboardSkeleton /><small><DashboardSkeleton variant="secondary" /></small></td>)}
      <td><DashboardSkeleton variant="action" /></td>
    </tr>) : dateRows(items)}</tbody></table>
  </div>;

  return <section className={styles.dashboard} aria-label="Dashboard">
    <header className={styles.header}>
      <div><h1>Dashboard</h1><p>{snapshot?.scope.label ?? scopeLabel ?? (buildingId ? "Selected building" : "All accessible buildings")} · {snapshot?.scope.team ?? "Developer team"}</p></div>
      <div className={styles.tools}><button type="button" className="secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={15} aria-hidden />{refreshing ? "Refreshing…" : "Refresh work"}</button><SaleMentionsInbox /></div>
    </header>
    <div className={styles.status} role="status">{snapshot ? `${error ? "Last known snapshot" : "Refreshed"} ${formatWorkDate(snapshot.asOf)}` : error ? "Dashboard unavailable" : <><span className={salesStyles.srOnly}>Loading dashboard…</span><DashboardSkeleton variant="status" /></>}</div>
    {error && <div className={styles.warning} role="alert">{error} {snapshot && "Displayed work may be stale."}</div>}
    {failures.length > 0 && <p className={styles.warning} role="status">Unavailable: {failures.map(source => source.label).join(", ")}. Refresh to retry; affected counts are not shown as zero.</p>}

    <section className={`panel ${styles.position}`} aria-labelledby="dashboard-position" aria-busy={loading}>
      <h2 id="dashboard-position">{buildingId ? "Building position" : "Portfolio position"}</h2>
      <div className={styles.positions}>
        <div><div className={styles.groupHeading}><h3>Sales</h3>{general("sales", "Open Sales")}</div>
          <div className={styles.pipelineScroll} role="region" aria-label="Sales pipeline">
            <dl className={styles.pipeline} style={{ "--pipeline-count-width": `${pipelineCountWidth}rem` } as CSSProperties}>{(overview?.sales ?? ["For sale", "Reserved", "Exchanged", "Completed", "Handed over"].map(label => ({ key: label, label, value: null }))).map(stage => <div key={stage.key}><dt>{pipelineLabel(stage.label)}</dt><dd>{stage.value ?? emptyValue}</dd></div>)}</dl>
          </div>
          <p className={styles.caption}>Units on the sales pipeline.</p>
        </div>
        <div><div className={styles.groupHeading}><h3>Snags & defects</h3>{general("snags", "Open Snags")}</div>
          <dl className={styles.metrics}><div><dt>Active developer snags</dt><dd>{metric("developer_snags")}</dd></div><div><dt>Active resident defects</dt><dd>{metric("resident_defects")}</dd></div></dl>
          <div className={styles.sourceLinks}>{general("snags", "Developer snags", { snagSource: "developer_snag" })}{general("snags", "Resident defects", { snagSource: "leaseholder_defect" })}</div>
        </div>
        <div><div className={styles.groupHeading}><h3>Rentals</h3>{general("rentals", "Open Rentals")}</div>
          <dl className={styles.metrics}><div><dt>Occupied</dt><dd>{metric("occupied")}</dd></div><div><dt>Void</dt><dd>{metric("voids")}</dd></div></dl>
          <div><p className={styles.rentalCaption}>{noRentals ? "No active rental units" : loading ? <DashboardSkeleton variant="secondary" /> : null}</p>
            <p className={styles.evidence}>{rentalEvidence ?? (loading ? <><DashboardSkeleton /><DashboardSkeleton /><DashboardSkeleton variant="secondary" /></> : "Rental evidence unavailable. No reported arrears is not proof that rent is paid.")}</p></div>
        </div>
      </div>
    </section>

    <section className={`panel ${styles.attention}`} aria-labelledby="dashboard-attention" aria-busy={loading}>
      <h2 id="dashboard-attention">Work needing attention</h2>
      <table className={styles.attentionTable}><thead><tr><th scope="col">Area</th><th scope="col">Our team</th><th scope="col">Other teams</th></tr></thead><tbody>
        {(overview?.attention ?? [{ key: "sales", label: "Sales" }, { key: "fees", label: "Agent Fees" }, { key: "snags", label: "Snags & defects" }, { key: "rentals", label: "Rentals" }]).map(row => <tr key={row.key}>
          <th scope="row">{"href" in row ? <a href={row.href} onClick={event => navigate(event, row.href)}>Open {row.label}<ArrowUpRight size={14} aria-hidden /></a> : <span className={styles.areaLabel}>{row.label}</span>}{"note" in row && row.note && <small>{row.note}</small>}{loading && ["sales", "fees"].includes(row.key) && <small className={styles.noteSkeleton}><DashboardSkeleton variant="secondary" /></small>}{"unallocated" in row && row.unallocated && row.unallocated.value !== null && row.unallocated.value > 0 && <small className={styles.unallocated}>Unallocated: {count(row.unallocated)}</small>}</th>
          <td>{count("ours" in row ? row.ours : undefined)}</td><td>{count("others" in row ? row.others : undefined)}</td>
        </tr>)}
      </tbody></table>
      <p className={styles.caption}>Records can appear in both columns and areas. Linked counts open matching views; other counts are summaries.</p>
      <div className={styles.additional}>
        <h3>Other existing work</h3>
        {!overview ? loading ? <div className={styles.additionalSkeleton} aria-hidden="true"><div><DashboardSkeleton /><DashboardSkeleton variant="secondary" /></div><DashboardSkeleton variant="action" /></div> : <p className={styles.muted}>Unavailable</p> : overview.additional.length ? <ul>{overview.additional.map(group => <li key={group.key}><span><strong>{group.count}</strong> · {group.label}{group.detail && <small>{group.detail}</small>}</span>{group.href ? <a href={group.href} onClick={event => navigate(event, group.href!)}>{group.linkLabel ?? "Open area"}<ArrowUpRight size={14} aria-hidden /></a> : <span className={styles.muted}>Review with an authorised colleague</span>}</li>)}</ul> : <p className={styles.muted}>No additional work from the available sources.</p>}
      </div>
    </section>

    <section className={`panel ${styles.dates}`} aria-labelledby="dashboard-dates" aria-busy={loading}>
      <h2 id="dashboard-dates">Dates to review</h2>
      <p className={styles.caption}>Recorded deadlines and saved dates to check. Time waiting is not a deadline.</p>
      <div className={styles.dateContent}>{!snapshot ? loading ? datesTable([], "Priority dates to review") : <p className={styles.muted}>Dates unavailable.</p> : dates.length ? datesTable(dates.slice(0, 5), "Priority dates to review") : <p className={styles.muted}>No dates or exceptions in the current review window{failures.length || error ? " from the available sources" : ""}.</p>}</div>
      {dates.length > 5 && <details className={styles.remaining}><summary>{dates.length - 5} more dates and exceptions</summary><p className={styles.caption}>These entries have no combined working-page view. Open each record below.</p>{datesTable(dates.slice(5), "Remaining dates to review")}</details>}
    </section>

    <details className={`panel ${styles.activity}`} aria-busy={loading}><summary>Recent sales activity · Last 7 days</summary>
      <p className={styles.caption}>Up to 7 entries from the last 7 days. Latest milestone per sale and event type; open a sale for its full history.</p>
      {!snapshot ? loading ? <ul aria-hidden="true">{Array.from({ length: 2 }, (_, index) => <li key={index}><DashboardSkeleton /><small><DashboardSkeleton variant="secondary" /></small></li>)}</ul> : <p className={styles.muted}>Recent activity unavailable.</p> : snapshot.sources.some(source => source.key === "history" && source.state !== "ready") ? <p className={styles.muted}>Recent activity unavailable.</p> : snapshot.activity.length ? <ul>{snapshot.activity.map(event => {
        const href = destinationUrl(event.destination, buildingId);
        return <li key={event.id}><a href={href} onClick={click => navigate(click, href, event.destination.unitId)}>{[event.buildingName, event.reference].filter(Boolean).join(" · ")}{(event.buildingName || event.reference) && " — "}{event.text}</a><small>{event.account ?? "Account not recorded"} · {formatWorkDate(event.at)}</small></li>;
      })}</ul> : <p className={styles.muted}>No recent sales milestones in the available history.</p>}
    </details>
  </section>;
}
