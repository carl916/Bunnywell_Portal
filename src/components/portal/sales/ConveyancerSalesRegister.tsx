"use client";

import type { MouseEvent } from "react";
import type { Building, BuildingFloor, Unit } from "@/lib/data/production";
import type { RegisterState } from "@/lib/sales/register-session";
import { isSalesRouteUnit, saleStatusLabel, SALES_ROUTE_STATUSES, sortUnitsByBuildingFloorOrder } from "@/lib/units/commercial-allocation";
import type { WorkDestination } from "@/lib/dashboard/types";
import { destinationUrl } from "@/lib/dashboard/presentation";
import { markUnitOpenIntent } from "@/lib/audit/unit-open";
import type { RegisterFilters, SalesRegisterRow } from "@/lib/sales/register";
import { filterSalesRegister, prominentActions, INITIAL_REGISTER_FILTERS } from "@/lib/sales/register-presentation";
import { SaleMentionsInbox } from "./SaleConversation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import styles from "./ConveyancerSalesRegister.module.css";

export function ConveyancerSalesRegister({ buildingId, units, buildings, floors, filters, onFilters, register, requestedUnavailable }: {
  buildingId: string; units: Unit[]; buildings: Building[]; floors: BuildingFloor[];
  filters: RegisterFilters; onFilters: (filters: RegisterFilters) => void; register: RegisterState; requestedUnavailable: boolean;
}) {
  const { snapshot, error, revoked, refreshing } = register;
  const ready = Boolean(snapshot?.actionsAvailable && !error && !revoked);
  const fallback: SalesRegisterRow[] = sortUnitsByBuildingFloorOrder(units.filter(unit => (!buildingId || unit.building_id === buildingId) && isSalesRouteUnit(unit)), floors, buildings).map(unit => ({ unitId: unit.id, unitNumber: unit.unit_number, buildingId: unit.building_id, buildingName: buildings.find(b => b.id === unit.building_id)?.name ?? "Building", stage: unit.sale_status, destination: { screen: "sales", buildingId: unit.building_id, unitId: unit.id }, actions: [], keyDate: null, warning: null, neutral: "Next steps unavailable" }));
  const rows = revoked ? [] : snapshot?.rows ?? fallback;
  // Failed action reads must not silently turn a restricted filter into an empty result.
  const filtered = filterSalesRegister(rows, { ...filters, responsibility: ready ? filters.responsibility : "all" });
  const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / SALES_PAGE_SIZE)));
  const visible = filtered.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);
  const update = (patch: Partial<RegisterFilters>) => onFilters({ ...filters, ...patch, page: 1 });
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
  const changed = filters.search || filters.stage !== "all" || filters.responsibility !== "all";

  return <section className={`panel ${styles.root}`} aria-label="Sales register">
    <div className={styles.heading}><div><h2>Sales</h2><p>{snapshot?.scope.label ?? buildings.find(b => b.id === buildingId)?.name ?? "All buildings"}{snapshot?.scope.team ? ` · ${snapshot.scope.team}` : ""}</p></div><SaleMentionsInbox /></div>
    {requestedUnavailable && <p role="alert">The requested sale is unavailable in your current access or scope.</p>}
    <div className={styles.controls}>
      <label className="field-label">Search<input className="field" type="search" value={filters.search} onChange={e => update({ search: e.target.value })} placeholder="Unit or building" /></label>
      <label className="field-label">Stage<select aria-label="Stage" className="field" value={filters.stage} onChange={e => update({ stage: e.target.value })}><option value="all">All sales</option>{SALES_ROUTE_STATUSES.map(stage => <option key={stage} value={stage}>{saleStatusLabel(stage)}</option>)}</select></label>
      <label className="field-label">Action with<select aria-label="Action with" className="field" value={filters.responsibility} disabled={!ready} onChange={e => update({ responsibility: e.target.value as RegisterFilters["responsibility"] })}><option value="all">All teams</option><option value="ours">Our team</option><option value="others">Other teams</option></select></label>
      {changed && <button className={styles.reset} onClick={() => onFilters(INITIAL_REGISTER_FILTERS)}>Reset filters</button>}
    </div>
    {(!ready || error) && <p className={styles.notice} role="status">{refreshing && !snapshot ? "Loading next steps…" : error || "Next steps unavailable. Use Refresh to retry."}{filters.responsibility !== "all" && " Showing base sales; the responsibility filter cannot be applied until next steps are available."}{snapshot && error && " Displayed dates and stages are from the last successful load."}</p>}
    <p className={styles.count} aria-live="polite">{revoked ? "Sales access unavailable" : `${filtered.length} ${filtered.length === 1 ? "sale / unit" : "sales / units"}`}{refreshing && snapshot ? " · Refreshing…" : ""}</p>
    <table className={styles.table} aria-label="Sales register">
      <thead><tr><th>Unit / building</th><th>Stage</th><th>Next step</th><th>Action with</th><th>Key date</th></tr></thead>
      <tbody>{visible.map(row => {
        const actions = ready ? prominentActions(row, filters.responsibility) : [];
        return <tr key={row.unitId}>
          <td data-label="Unit / building"><a className={styles.unit} href={href(row.destination)} onClick={e => open(e, row.destination)}>Unit {row.unitNumber}</a><span className={styles.secondary}>{row.buildingName}</span></td>
          <td data-label="Stage"><span className={styles.stage}>{saleStatusLabel(row.stage)}</span></td>
          <td data-label="Next step">{actions.length ? actions.map((action, index) => <div className={index ? styles.secondary : undefined} key={action.id}>{action.destination ? <a href={href(action.destination)} onClick={e => open(e, action.destination!)}>{action.label}</a> : action.label}</div>) : <span>{ready ? row.neutral : "Next steps unavailable"}</span>}{row.warning && <span className={styles.warning}>{row.warning}</span>}</td>
          <td data-label="Action with">{actions.length ? [...new Set(actions.map(action => action.party.label))].map(party => <div key={party}>{party}</div>) : "—"}</td>
          <td data-label="Key date">{row.keyDate ? <><span className={row.keyDate.warning ? styles.warning : undefined}>{row.keyDate.label}</span>{!row.keyDate.label.includes(row.keyDate.actual) && <span className={styles.secondary}>{row.keyDate.actual}</span>}</> : "—"}</td>
        </tr>;
      })}</tbody>
    </table>
    {!visible.length && <p className={styles.empty}>{revoked ? "Reload the portal to verify your access." : "No sales match these filters."}</p>}
    <SalesPagination total={filtered.length} currentPage={page} onPageChange={page => onFilters({ ...filters, page })} />
  </section>;
}
