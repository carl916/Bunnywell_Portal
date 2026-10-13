"use client";

import { useEffect, useMemo, type MouseEvent, type RefCallback } from "react";
import { saleRecordUrl, salesReviewDestination, salesWorkSummary, selectDeveloperSalesRows, visibleSalesWork, type DeveloperSalesRow, type SalesOverviewFilters } from "@/lib/sales/developer-overview";
import { formatGbp } from "@/lib/sales/currency";
import { saleStatusLabel } from "@/lib/units/commercial-allocation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import { SalesOverviewControls, type SalesStageTotal } from "./SalesOverviewControls";
import styles from "./DeveloperSalesResults.module.css";

type Props = {
  rows: DeveloperSalesRow[] | null; filters: SalesOverviewFilters; onFilters: (filters: SalesOverviewFilters) => void;
  search: string; onOpen: (href: string, unitId: string) => void; prices?: Map<string, number>;
  error: string; refreshing: boolean; onRetry: () => void; now: number;
  stageAges?: Map<string, string>; unread?: Map<string, number>;
  stages: SalesStageTotal[]; scope: string; resultsSpace: RefCallback<HTMLDivElement>;
};

export function DeveloperSalesResults({ rows, filters, onFilters, search, onOpen, prices, error, refreshing, onRetry, now, stageAges, unread, stages, scope, resultsSpace }: Props) {
  const workUnavailable = rows?.some(row => row.workUnavailable) ?? false;
  const workFiltered = filters.work !== "all" || Boolean(filters.category);
  const selected = useMemo(() => workUnavailable && workFiltered ? [] : selectDeveloperSalesRows(rows ?? [], filters, now), [rows, filters, now, workUnavailable, workFiltered]);
  const displayError = error || (workUnavailable ? "Action counts are unavailable because workflow or fee inputs are incomplete. Refresh before reviewing team work." : "");
  const page = Math.min(filters.page, Math.max(1, Math.ceil(selected.length / SALES_PAGE_SIZE)));
  useEffect(() => { if (rows && !workUnavailable && page !== filters.page) onFilters({ ...filters, page }); }, [rows, filters, page, onFilters, workUnavailable]);
  const visible = selected.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);
  const change = (patch: Partial<SalesOverviewFilters>) => onFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  function open(event: MouseEvent<HTMLAnchorElement>, href: string, unitId: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(href, unitId);
  }
  return <section className={`panel ${styles.results}`} id="sales-results" aria-labelledby="sales-results-heading" aria-busy={!rows && !error}>
    <header className={styles.header}><h2 id="sales-results-heading">Sales overview</h2>
      {refreshing && rows && <span className={styles.refresh} role="status">Refreshing…</span>}
    </header>
    <SalesOverviewControls stages={stages} scope={scope} filters={filters} onFilters={onFilters} loading={!rows || workUnavailable} />
    <p className={styles.count} role="status">{!rows ? displayError ? "Sales unavailable" : "Loading Sales…" : workUnavailable && workFiltered ? "Action counts unavailable" : `${selected.length} ${selected.length === 1 ? "sale" : "sales"}${filters.work === "ours" ? " requiring your team’s attention" : filters.work === "others" ? " waiting on other teams" : " in this view"}${error ? " · last loaded results" : ""}`}</p>
    <div ref={resultsSpace}><div>
    {displayError && <div className={styles.error} role="alert"><p>{displayError} {rows && "Showing the last loaded position. Review controls are disabled until a successful refresh."}</p><button type="button" className="secondary" onClick={onRetry} disabled={refreshing}>Retry Sales</button></div>}
    <div className={styles.tableScroll} tabIndex={0} aria-label="Sales results">
      <table role="table"><colgroup><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "32%" }} /><col style={{ width: "20%" }} /><col style={{ width: "16%" }} /></colgroup><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Unit / building</th><th role="columnheader" scope="col">Stage / price</th><th role="columnheader" scope="col">Next step</th><th role="columnheader" scope="col">Key date</th><th role="columnheader" scope="col"><span className={styles.srOnly}>Open sale</span></th></tr></thead>
        <tbody role="rowgroup">{!rows && !error ? Array.from({ length: 5 }, (_, index) => <tr key={index} aria-hidden="true">{Array.from({ length: 5 }, (_, cell) => <td key={cell}><span className={styles.skeleton} /></td>)}</tr>) : visible.map(row => {
          const actions = visibleSalesWork(row, filters), first = actions[0];
          const href = saleRecordUrl(salesReviewDestination(actions, row.destination), search), unitHref = saleRecordUrl(row.destination, search);
          return <tr key={row.unitId} role="row">
            <td role="cell" className={styles.identity}><a className={styles.unit} href={unitHref} onClick={event => open(event, unitHref, row.unitId)}>Unit {row.unitNumber}</a><small>{row.buildingName}</small>
              {Boolean(unread?.get(row.unitId)) && <a className={styles.comments} href={`${unitHref}&conversation=${encodeURIComponent(row.destination.saleId ?? "")}`} onClick={event => open(event, `${unitHref}&conversation=${encodeURIComponent(row.destination.saleId ?? "")}`, row.unitId)}>{unread?.get(row.unitId)} unread comments</a>}
            </td>
            <td role="cell" className={styles.position}><span className={styles.stage}>{saleStatusLabel(row.stage)}</span><small>{prices?.get(row.unitId) ? formatGbp(prices.get(row.unitId)!) : "Price not recorded"}</small>{stageAges?.get(row.unitId) && <small>{stageAges.get(row.unitId)} in stage</small>}</td>
            <td role="cell" className={styles.next}><p>{salesWorkSummary(actions) || row.warning || row.neutral}</p>{row.warning && salesWorkSummary(actions) && <p className={styles.mobileWarning}>{row.warning}</p>}{first && !(filters.work === "ours" && actions.every(item => item.responsibility.kind === "developer" && item.ours && item.canAct)) && <small>Action with {[...new Set(actions.map(item=>item.responsibility.label))].join(" / ")}{!first.canAct ? " · authorised colleague required" : ""}</small>}
            </td>
            <td role="cell" className={styles.keyDate}><span className={row.keyDate?.warning ? styles.warning : undefined}>{row.keyDate?.label ?? "—"}</span>{row.keyDate && !row.keyDate.label.includes(row.keyDate.actual) && <small>{row.keyDate.actual}</small>}</td>
            <td role="cell" className={styles.primaryAction}>{displayError ? <button type="button" className={styles.review} disabled>Review unavailable</button> : <a className={styles.review} href={href} onClick={event => open(event, href, row.unitId)}>{actions.length > 1 ? `Review ${actions.length} actions` : first ? "Review action" : row.neutral === "Available for reservation" ? "Start reservation" : "Open sale"}</a>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {rows && !selected.length && <p className={styles.empty}>{displayError ? "Current responsibilities are unavailable. Retry before treating this view as clear." : "No sales match this view. Try another team, category or filter."}</p>}
    {rows && <SalesPagination total={selected.length} currentPage={page} onPageChange={page => change({ page })} />}
    </div></div>
  </section>;
}
