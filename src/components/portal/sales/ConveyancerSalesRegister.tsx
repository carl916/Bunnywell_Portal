"use client";

import type { MouseEvent, RefCallback } from "react";
import type { Building } from "@/lib/data/production";
import type { RegisterState } from "@/lib/sales/register-session";
import { saleStatusLabel, SALES_ROUTE_STATUSES } from "@/lib/units/commercial-allocation";
import type { WorkDestination } from "@/lib/dashboard/types";
import { saleRecordUrl } from "@/lib/sales/developer-overview";
import { SALES_CATEGORIES } from "@/lib/dashboard/work-classification";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import type { RegisterFilters } from "@/lib/sales/register";
import { filterSalesRegister, prominentActions, sortSalesRegisterByUrgency, salesRegisterCount } from "@/lib/sales/register-presentation";
import { SaleMentionsInbox } from "./SaleConversation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import { SalesOverviewControls } from "./SalesOverviewControls";
import styles from "./ConveyancerSalesRegister.module.css";

// Preserve the register's non-financial work visibility.
const { reservation, commercial, exchange, notice, documents, completion, "record-checks": recordChecks, unallocated } = SALES_CATEGORIES;
const categories = { reservation, commercial, exchange, notice, documents, completion, "record-checks": recordChecks, unallocated };

export function ConveyancerSalesRegister({ buildingId, buildings, filters, onFilters, register, onRetry, requestedUnavailable, search, onOpen, resultsSpace }: {
  buildingId: string; buildings: Building[];
  filters: RegisterFilters; onFilters: (filters: RegisterFilters) => void; register: RegisterState; onRetry: () => void; requestedUnavailable: boolean;
  search: string; onOpen: (href: string) => void; resultsSpace: RefCallback<HTMLDivElement>;
}) {
  const { snapshot, error, revoked, refreshing } = register;
  const ready = Boolean(snapshot?.actionsAvailable && !error && !revoked);
  const loading = !snapshot && !error && !revoked;
  const unavailable = !loading && !ready;
  const ours = filters.responsibility === "ours";
  const rows = revoked ? [] : snapshot?.rows ?? [];
  // Failed action reads must not silently turn a restricted filter into an empty workload.
  const filtered = filterSalesRegister(rows, { ...filters, responsibility: ready ? filters.responsibility : "all", category: ready ? filters.category : "" });
  const ordered = ready && ours ? sortSalesRegisterByUrgency(filtered, Date.parse(snapshot!.asOf), filters.category) : filtered;
  const page = Math.min(filters.page, Math.max(1, Math.ceil(ordered.length / SALES_PAGE_SIZE)));
  const visible = ordered.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);
  const href = (destination: WorkDestination) => {
    const url = new URL(saleRecordUrl(destination, search), "http://portal.local");
    url.searchParams.set("workRegister", "1");
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const open = (event: MouseEvent<HTMLAnchorElement>, destination: WorkDestination) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); if (destination.unitId) markUnitOpenIntent(destination.unitId);
    onOpen(href(destination));
  };
  const scope = snapshot?.scope.label ?? buildings.find(b => b.id === buildingId)?.name ?? "All buildings";
  const stages = SALES_ROUTE_STATUSES.map(status => ({ status, label: saleStatusLabel(status), count: rows.filter(row => row.stage === status).length, value: null }));

  return <section className={`panel ${styles.root}`} id="sales-results" aria-label="Sales overview" aria-busy={loading}>
    <div className={styles.heading}><h2>Sales overview</h2><SaleMentionsInbox /></div>
    {requestedUnavailable && <p role="alert">The requested sale is unavailable in your current access or scope.</p>}
    <SalesOverviewControls stages={stages} scope={scope} loading={!snapshot || revoked} categories={categories} actionsUnavailable={!ready}
      filters={{ ...filters, category: filters.category ?? "", work: filters.responsibility }}
      onFilters={next => onFilters({ ...next, responsibility: next.work })} />
    <p className={styles.count} role="status">
      {loading ? "Loading sales…" : revoked ? "Sales access unavailable" : !ready ? snapshot ? `Responsibility unavailable · ${filtered.length} ${filtered.length === 1 ? "sale" : "sales"} shown` : "Sales information unavailable" : salesRegisterCount(filtered.length, filters.responsibility)}
      <span className={styles.refreshing}>{refreshing && snapshot ? "Refreshing…" : ""}</span>
    </p>
    <div ref={resultsSpace}><div id="sales-register-results">
      {unavailable && <div className={styles.notice} role="alert">
        <p>{error || "Next steps could not be loaded."}{snapshot && " Displayed dates and stages are from the last successful load."}
          {!revoked && (filters.responsibility !== "all" || filters.category) && " The responsibility filter and action category cannot be applied until next steps are available; all matching sales are shown."}</p>
        {!revoked && <button type="button" className={styles.retry} disabled={refreshing} onClick={onRetry}>{refreshing ? "Retrying…" : "Retry loading sales"}</button>}
      </div>}
      <table className={styles.table} aria-label="Sales register" aria-busy={loading}>
        <colgroup><col style={{ width:"19%" }} /><col style={{ width:"15%" }} /><col style={{ width:"30%" }} /><col style={{ width:"16%" }} /><col style={{ width:"20%" }} /></colgroup>
        <thead><tr><th scope="col">Unit / building</th><th scope="col">Stage</th><th scope="col">Next step</th><th scope="col">Action with</th><th scope="col">Key date</th></tr></thead>
        <tbody>{loading ? Array.from({ length: 4 }, (_, index) => <tr key={index} aria-hidden="true" className={styles.skeletonRow}>
          <td data-label="Unit / building"><span className={styles.skeleton} /><span className={styles.skeletonShort} /></td>
          <td data-label="Stage"><span className={styles.skeletonShort} /></td>
          <td data-label="Next step"><span className={styles.skeleton} /><span className={styles.skeletonShort} /></td>
          <td data-label="Action with"><span className={styles.skeleton} /></td>
          <td data-label="Key date"><span className={styles.skeleton} /></td>
        </tr>) : visible.map(row => {
          const actions = ready ? prominentActions(row, filters.responsibility, filters.category) : [];
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
            <td data-label="Action with">{actions.length ? [...new Set(actions.map(action => action.party.label))].map(party => <div key={party}>{party}</div>) : "—"}</td>
            <td data-label="Key date">{row.keyDate ? <><span className={row.keyDate.warning ? styles.warning : undefined}>{row.keyDate.label}</span>{!row.keyDate.label.includes(row.keyDate.actual) && <span className={styles.secondary}>{row.keyDate.actual}</span>}</> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
      {!loading && !visible.length && <p className={styles.empty}>{revoked ? "Reload the portal to verify your access." : ready ? "No sales match these filters." : "Retry to load the sales register."}</p>}
      {!loading && snapshot && !revoked && <SalesPagination total={filtered.length} currentPage={page} onPageChange={page => onFilters({ ...filters, page })} />}
    </div></div>
  </section>;
}
