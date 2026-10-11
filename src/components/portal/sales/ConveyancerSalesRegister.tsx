"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import type { Building } from "@/lib/data/production";
import type { RegisterState } from "@/lib/sales/register-session";
import { saleStatusLabel, SALES_ROUTE_STATUSES } from "@/lib/units/commercial-allocation";
import type { WorkDestination } from "@/lib/dashboard/types";
import { destinationUrl } from "@/lib/dashboard/presentation";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import type { RegisterFilters, ResponsibilityFilter } from "@/lib/sales/register";
import { filterSalesRegister, prominentActions, INITIAL_REGISTER_FILTERS, sortSalesRegisterByUrgency, salesRegisterCount } from "@/lib/sales/register-presentation";
import { SaleMentionsInbox } from "./SaleConversation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import styles from "./ConveyancerSalesRegister.module.css";

const tabs: { value: ResponsibilityFilter; label: string }[] = [
  { value: "ours", label: "Our team" }, { value: "others", label: "Other teams" }, { value: "all", label: "All teams" },
];

export function ConveyancerSalesRegister({ buildingId, buildings, filters, onFilters, register, onRetry, requestedUnavailable }: {
  buildingId: string; buildings: Building[];
  filters: RegisterFilters; onFilters: (filters: RegisterFilters) => void; register: RegisterState; onRetry: () => void; requestedUnavailable: boolean;
}) {
  const { snapshot, error, revoked, refreshing } = register;
  const ready = Boolean(snapshot?.actionsAvailable && !error && !revoked);
  const loading = !snapshot && !error && !revoked;
  const unavailable = !loading && !ready;
  const ours = filters.responsibility === "ours";
  const rows = revoked ? [] : snapshot?.rows ?? [];
  // Failed action reads must not silently turn a restricted filter into an empty workload.
  const filtered = filterSalesRegister(rows, { ...filters, responsibility: ready ? filters.responsibility : "all" });
  const ordered = ready && ours ? sortSalesRegisterByUrgency(filtered, Date.parse(snapshot!.asOf)) : filtered;
  const page = Math.min(filters.page, Math.max(1, Math.ceil(ordered.length / SALES_PAGE_SIZE)));
  const visible = ordered.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);
  const update = (patch: Partial<RegisterFilters>) => onFilters({ ...filters, ...patch, page: 1 });
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    update({ responsibility: tabs[next].value });
    document.getElementById(`sales-team-${tabs[next].value}`)?.focus();
  };
  const href = (destination: WorkDestination) => {
    const url = new URL(destinationUrl(destination, buildingId, "sales"), "http://portal.local");
    url.searchParams.set("workRegister", "1");
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const open = (event: MouseEvent<HTMLAnchorElement>, destination: WorkDestination) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); if (destination.unitId) markUnitOpenIntent(destination.unitId);
    window.history.pushState(null, "", href(destination)); window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const changed = filters.search || filters.stage !== "all" || !ours;

  return <section className={`panel ${styles.root}`} aria-label="Sales register">
    <div className={styles.heading}><div><h2>Sales</h2><p>{snapshot?.scope.label ?? buildings.find(b => b.id === buildingId)?.name ?? "All buildings"}{snapshot?.scope.team ? ` · ${snapshot.scope.team}` : ""}</p></div><SaleMentionsInbox /></div>
    {requestedUnavailable && <p role="alert">The requested sale is unavailable in your current access or scope.</p>}
    <div className={styles.tabs} role="tablist" aria-label="Action responsibility">
      {tabs.map((tab, index) => <button key={tab.value} id={`sales-team-${tab.value}`} type="button" role="tab"
        aria-selected={filters.responsibility === tab.value} aria-controls="sales-register-results"
        tabIndex={filters.responsibility === tab.value ? 0 : -1} disabled={!ready}
        onKeyDown={event => tabKeyDown(event, index)} onClick={() => update({ responsibility: tab.value })}>{tab.label}</button>)}
    </div>
    <div id="sales-register-results" role="tabpanel" aria-labelledby={`sales-team-${filters.responsibility}`}>
      <div className={styles.controls}>
        <label className="field-label">Search<input className="field" type="search" value={filters.search} onChange={e => update({ search: e.target.value })} placeholder="Unit or building" /></label>
        <label className="field-label">Stage<select aria-label="Stage" className="field" value={filters.stage} onChange={e => update({ stage: e.target.value })}><option value="all">All sales</option>{SALES_ROUTE_STATUSES.map(stage => <option key={stage} value={stage}>{saleStatusLabel(stage)}</option>)}</select></label>
        {changed && <button className={styles.reset} onClick={() => onFilters(INITIAL_REGISTER_FILTERS)}>Reset filters</button>}
      </div>
      {unavailable && <div className={styles.notice} role="alert">
        <p>{error || "Next steps could not be loaded."}{snapshot && " Displayed dates and stages are from the last successful load."}
          {!revoked && filters.responsibility !== "all" && " The responsibility filter cannot be applied until next steps are available; all matching sales are shown."}</p>
        {!revoked && <button type="button" className={styles.retry} disabled={refreshing} onClick={onRetry}>{refreshing ? "Retrying…" : "Retry loading sales"}</button>}
      </div>}
      <p className={styles.count} role="status">
        {loading ? "Loading sales…" : revoked ? "Sales access unavailable" : !ready ? snapshot ? `Responsibility unavailable · ${filtered.length} ${filtered.length === 1 ? "sale" : "sales"} shown` : "Sales information unavailable" : salesRegisterCount(filtered.length, filters.responsibility)}
        {refreshing && snapshot && <span className={styles.refreshing}>Refreshing…</span>}
      </p>
      <table className={`${styles.table} ${ours ? styles.ourTable : ""}`} aria-label="Sales register" aria-busy={loading}>
        <thead><tr><th scope="col">Unit / building</th><th scope="col">Stage</th><th scope="col">Next step</th>{!ours && <th scope="col">Action with</th>}<th scope="col">Key date</th></tr></thead>
        <tbody>{loading ? Array.from({ length: 4 }, (_, index) => <tr key={index} aria-hidden="true" className={styles.skeletonRow}>
          <td data-label="Unit / building"><span className={styles.skeleton} /><span className={styles.skeletonShort} /></td>
          <td data-label="Stage"><span className={styles.skeletonShort} /></td>
          <td data-label="Next step"><span className={styles.skeleton} /><span className={styles.skeletonShort} /></td>
          {!ours && <td data-label="Action with"><span className={styles.skeleton} /></td>}
          <td data-label="Key date"><span className={styles.skeleton} /></td>
        </tr>) : visible.map(row => {
          const actions = ready ? prominentActions(row, filters.responsibility) : [];
          const primary = actions[0];
          // Open the existing workflow, where the remaining tasks remain accessible.
          const destination = primary?.destination ?? row.destination;
          const review = actions.length > 1 ? `Review ${actions.length} actions` : "Review action";
          return <tr key={row.unitId}>
            <td data-label="Unit / building"><a className={styles.unit} href={href(row.destination)} onClick={e => open(e, row.destination)}>Unit {row.unitNumber}</a><span className={styles.secondary}>{row.buildingName}</span></td>
            <td data-label="Stage"><span className={styles.stage}>{saleStatusLabel(row.stage)}</span></td>
            <td data-label="Next step">
              <span>{primary ? <>{primary.label}{actions.length > 1 && <span className={styles.more}> · {actions.length - 1} more {actions.length === 2 ? "action" : "actions"}</span>}</> : ready ? row.neutral : "Next steps unavailable"}</span>
              {row.warning && <span className={styles.warning}>{row.warning}</span>}
              {primary && <a className={styles.review} aria-label={`${review} for Unit ${row.unitNumber}`} href={href(destination)} onClick={e => open(e, destination)}>{review}<span aria-hidden="true"> →</span></a>}
            </td>
            {!ours && <td data-label="Action with">{actions.length ? [...new Set(actions.map(action => action.party.label))].map(party => <div key={party}>{party}</div>) : "—"}</td>}
            <td data-label="Key date">{row.keyDate ? <><span className={row.keyDate.warning ? styles.warning : undefined}>{row.keyDate.label}</span>{!row.keyDate.label.includes(row.keyDate.actual) && <span className={styles.secondary}>{row.keyDate.actual}</span>}</> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
      {!loading && !visible.length && <p className={styles.empty}>{revoked ? "Reload the portal to verify your access." : ready ? "No sales match these filters." : "Retry to load the sales register."}</p>}
      {!loading && snapshot && !revoked && <SalesPagination total={filtered.length} currentPage={page} onPageChange={page => onFilters({ ...filters, page })} />}
    </div>
  </section>;
}
