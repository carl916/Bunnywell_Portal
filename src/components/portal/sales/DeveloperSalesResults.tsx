"use client";

import { useEffect, useMemo, type MouseEvent } from "react";
import { SALES_CATEGORIES } from "@/lib/dashboard/work-classification";
import { INITIAL_SALES_OVERVIEW, saleRecordUrl, salesReviewDestination, salesWorkSummary, selectDeveloperSalesRows, visibleSalesWork, type DeveloperSalesRow, type SalesOverviewFilters } from "@/lib/sales/developer-overview";
import { formatGbp } from "@/lib/sales/currency";
import { SALES_ROUTE_STATUSES, saleStatusLabel } from "@/lib/units/commercial-allocation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import styles from "./DeveloperSalesResults.module.css";

type Props = {
  rows: DeveloperSalesRow[] | null; filters: SalesOverviewFilters; onFilters: (filters: SalesOverviewFilters) => void;
  search: string; onOpen: (href: string, unitId: string) => void; prices?: Map<string, number>;
  error: string; refreshing: boolean; onRetry: () => void; now: number;
  stageAges?: Map<string, string>; unread?: Map<string, number>;
};

export function DeveloperSalesResults({ rows, filters, onFilters, search, onOpen, prices, error, refreshing, onRetry, now, stageAges, unread }: Props) {
  const selected = useMemo(() => selectDeveloperSalesRows(rows ?? [], filters, now), [rows, filters, now]);
  const page = Math.min(filters.page, Math.max(1, Math.ceil(selected.length / SALES_PAGE_SIZE)));
  useEffect(() => { if (rows && page !== filters.page) onFilters({ ...filters, page }); }, [rows, filters, page, onFilters]);
  const visible = selected.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);
  const change = (patch: Partial<SalesOverviewFilters>) => onFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  function open(event: MouseEvent<HTMLAnchorElement>, href: string, unitId: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(href, unitId);
  }
  return <section className={`panel ${styles.results}`} id="sales-results" aria-labelledby="sales-results-heading" aria-busy={!rows && !error}>
    <header className={styles.header}><div><h2 id="sales-results-heading">Sales results</h2>
      <p role="status">{!rows ? error ? "Sales unavailable" : "Loading Sales…" : `${selected.length} ${selected.length === 1 ? "sale" : "sales"}${filters.work === "ours" ? " requiring your team’s attention" : filters.work === "others" ? " waiting on other teams" : " in this view"}${error ? " · last loaded results" : ""}`}</p></div>
      {refreshing && rows && <span className={styles.refresh} role="status">Refreshing…</span>}
    </header>
    <div className={styles.views} role="group" aria-label="Sales responsibility">
      {(["all", "ours", "others"] as const).map(work => <button type="button" key={work} aria-pressed={filters.work === work} onClick={() => change({ work })}>{({ all: "All sales", ours: "Our actions", others: "Other teams" })[work]}</button>)}
    </div>
    <div className={styles.controls}>
      <label>Stage<select value={filters.stage} onChange={event => change({ stage: event.target.value })}><option value="all">All stages</option>{SALES_ROUTE_STATUSES.map(stage => <option key={stage} value={stage}>{saleStatusLabel(stage)}</option>)}</select></label>
      <label>Action category<select value={filters.category} onChange={event => change({ category: event.target.value as SalesOverviewFilters["category"] })}><option value="">All action categories</option>{Object.entries(SALES_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className={styles.search}>Search Sales<input type="search" placeholder="Unit or building" value={filters.search} maxLength={200} onChange={event => change({ search: event.target.value })} /></label>
      <button type="button" className="secondary" onClick={() => onFilters(INITIAL_SALES_OVERVIEW)}>Reset filters</button>
    </div>
    {error && <div className={styles.error} role="alert"><p>{error} {rows && "Showing the last loaded position. Review controls are disabled until a successful refresh."}</p><button type="button" className="secondary" onClick={onRetry} disabled={refreshing}>Retry Sales</button></div>}
    <p className={styles.scrollHint}>Scroll the table sideways for dates and review controls.</p>
    <div className={styles.tableScroll} tabIndex={0} aria-label="Sales table, scroll horizontally for more columns">
      <table><thead><tr><th>Unit / building</th><th>Stage / price</th><th>Next step</th><th>Key date</th><th><span className={styles.srOnly}>Open sale</span></th></tr></thead>
        <tbody>{!rows && !error ? Array.from({ length: 5 }, (_, index) => <tr key={index} aria-hidden="true">{Array.from({ length: 5 }, (_, cell) => <td key={cell}><span className={styles.skeleton} /></td>)}</tr>) : visible.map(row => {
          const actions = visibleSalesWork(row, filters), first = actions[0];
          const href = saleRecordUrl(salesReviewDestination(actions, row.destination), search), unitHref = saleRecordUrl(row.destination, search);
          return <tr key={row.unitId}>
            <td><a className={styles.unit} href={unitHref} onClick={event => open(event, unitHref, row.unitId)}>Unit {row.unitNumber}</a><small>{row.buildingName}</small>
              {Boolean(unread?.get(row.unitId)) && <a className={styles.comments} href={`${unitHref}&conversation=${encodeURIComponent(row.destination.saleId ?? "")}`} onClick={event => open(event, `${unitHref}&conversation=${encodeURIComponent(row.destination.saleId ?? "")}`, row.unitId)}>{unread?.get(row.unitId)} unread comments</a>}
            </td>
            <td><span className={styles.stage}>{saleStatusLabel(row.stage)}</span><small>{prices?.get(row.unitId) ? formatGbp(prices.get(row.unitId)!) : "Price not recorded"}</small>{stageAges?.get(row.unitId) && <small>{stageAges.get(row.unitId)} in stage</small>}</td>
            <td className={styles.next}><p>{salesWorkSummary(actions) || row.warning || row.neutral}</p>{first && !(filters.work === "ours" && actions.every(item => item.responsibility.kind === "developer" && item.ours && item.canAct)) && <small>Action with {[...new Set(actions.map(item=>item.responsibility.label))].join(" / ")}{!first.canAct ? " · authorised colleague required" : ""}</small>}
            </td>
            <td><span className={row.keyDate?.warning ? styles.warning : undefined}>{row.keyDate?.label ?? "—"}</span>{row.keyDate && !row.keyDate.label.includes(row.keyDate.actual) && <small>{row.keyDate.actual}</small>}</td>
            <td>{error ? <button type="button" className={styles.review} disabled>Review unavailable</button> : <a className={styles.review} href={href} onClick={event => open(event, href, row.unitId)}>{actions.length > 1 ? `Review ${actions.length} actions` : first ? "Review action" : row.neutral === "Available for reservation" ? "Start reservation" : "Open sale"}</a>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {rows && !selected.length && <p className={styles.empty}>{error ? "Current responsibilities are unavailable. Retry before treating this view as clear." : "No sales match this view. Try another team, category or filter."}</p>}
    {rows && <SalesPagination total={selected.length} currentPage={page} onPageChange={page => change({ page })} />}
  </section>;
}
