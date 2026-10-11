import { deriveDashboard } from "../dashboard/model";
import { deadlineState } from "../dashboard/dates";
import { hasWorkOwner, isWorkObservation, matchesWorkTeam, SALES_CATEGORIES, salesWorkCategory, type SalesCategory } from "../dashboard/work-classification";
import type { DashboardInput, WorkDestination, WorkItem } from "../dashboard/types";
import { deriveSalesRegister, type SalesRegisterRow } from "./register";
import { SALES_ROUTE_STATUSES } from "../units/commercial-allocation";

export type SalesWorkView = "all" | "ours" | "others";
export type SalesOverviewFilters = { work: SalesWorkView; category: SalesCategory | ""; stage: string; search: string; page: number };
export const INITIAL_SALES_OVERVIEW: SalesOverviewFilters = { work: "all", category: "", stage: "all", search: "", page: 1 };
export type DeveloperSalesRow = SalesRegisterRow & { work: WorkItem[]; observations: WorkItem[] };

export function readSalesOverviewFilters(search: string): SalesOverviewFilters {
  const params = new URLSearchParams(search);
  const work = params.get("salesWork"), category = params.get("salesCategory"), stage = params.get("salesFilter");
  const page = Number(params.get("salesPage") ?? 1);
  return {
    work: work === "ours" || work === "others" ? work : "all",
    category: category && Object.hasOwn(SALES_CATEGORIES, category) ? category as SalesCategory : "",
    stage: SALES_ROUTE_STATUSES.some(s => s === stage) ? stage! : "all",
    search: (params.get("salesSearch") ?? "").slice(0, 200),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export function writeSalesOverviewFilters(params: URLSearchParams, filters: SalesOverviewFilters) {
  for (const [key, value] of Object.entries({ salesWork: filters.work === "all" ? "" : filters.work,
    salesCategory: filters.category, salesFilter: filters.stage === "all" ? "" : filters.stage,
    salesSearch: filters.search, salesPage: filters.page === 1 ? "" : String(filters.page) })) {
    if (value) params.set(key, value); else params.delete(key);
  }
}

/** A clean future Dashboard destination cannot inherit unrelated table filters. */
export function salesOverviewDestination(buildingId: string, category: SalesCategory | "" = "", work: SalesWorkView = "all") {
  const params = new URLSearchParams({ screen: "sales", building: buildingId || "all" });
  writeSalesOverviewFilters(params, readSalesOverviewFilters(new URLSearchParams({ salesCategory: category, salesWork: work }).toString()));
  return `/?${params}#sales-results`;
}

export function deriveDeveloperSalesRows(input: DashboardInput): DeveloperSalesRow[] {
  const snapshot = deriveDashboard(input);
  return deriveSalesRegister(input, snapshot).rows.map(row => {
    const items = snapshot.items.filter(item => item.module === "sales" && item.unitId === row.unitId);
    const work = items.filter(item => !isWorkObservation(item)).sort((a, b) => rank(row, [a], input.now).urgency - rank(row, [b], input.now).urgency);
    const hasSale = input.sales.some(s => s.unit_id === row.unitId && s.is_active && !s.redacted_at && !["fallen_through", "superseded", "failed", "withdrawn"].includes(s.workflow_status));
    return { ...row, work, observations: items.filter(isWorkObservation),
      neutral: !hasSale && row.stage === "for_sale" ? "Available for reservation" : !hasSale && ["completed", "handed_over"].includes(row.stage) ? "Legacy completed sale · no active sale file" : row.neutral };
  });
}

export function visibleSalesWork(row: DeveloperSalesRow, filters: SalesOverviewFilters) {
  return row.work.filter(item => (filters.work === "all" || matchesWorkTeam(item, filters.work)) && (!filters.category || salesWorkCategory(item) === filters.category));
}

function rank(row: SalesRegisterRow, items: WorkItem[], now: number) {
  const progression = items.some(item => !item.kind.startsWith("fee_") && item.kind !== "deposit_receipt");
  const dates = [...items.map(item => item.deadline), progression ? row.keyDate?.deadline ?? null : null].filter(d => d !== null);
  const states = dates.map(d => deadlineState(d, now));
  const urgency = items.some(item => item.urgent) || states.includes("overdue") ? 0 : states.some(s => s === "today" || s === "soon") ? 1 : 2;
  const deadline = Math.min(...dates.map(d => Date.parse(d.at)).filter(Number.isFinite));
  const waiting = Math.min(...items.filter(i => !i.waiting.fallback).map(i => Date.parse(i.waiting.since ?? "")).filter(Number.isFinite));
  return { urgency, deadline, waiting };
}

export function selectDeveloperSalesRows(rows: DeveloperSalesRow[], filters: SalesOverviewFilters, now: number) {
  const search = filters.search.trim().toLocaleLowerCase("en-GB");
  const selected = rows.filter(row => (filters.stage === "all" || row.stage === filters.stage) &&
    (!search || `${row.unitNumber} ${row.buildingName}`.toLocaleLowerCase("en-GB").includes(search)) &&
    (filters.work === "all" && !filters.category || visibleSalesWork(row, filters).length > 0));
  if (filters.work === "all") return selected;
  const canonical = new Map(rows.map((row, index) => [row.unitId, index]));
  return selected.sort((a, b) => {
    const left = rank(a, visibleSalesWork(a, filters), now), right = rank(b, visibleSalesWork(b, filters), now);
    return left.urgency - right.urgency || left.deadline - right.deadline || left.waiting - right.waiting || canonical.get(a.unitId)! - canonical.get(b.unitId)!;
  });
}

export function salesWorkSummary(items: WorkItem[]) {
  const first = items[0];
  return first ? `${first.action}${items.length > 1 ? ` · ${items.length - 1} more ${items.length === 2 ? "action" : "actions"}` : ""}${!hasWorkOwner(first) ? " · responsible team unallocated" : ""}` : "";
}

export function saleRecordUrl(destination: WorkDestination, search: string) {
  const params = new URLSearchParams(search);
  params.set("screen", "sales"); params.set("salesUnitId", destination.unitId!);
  params.delete("salesView"); params.delete("conversation"); params.delete("comment");
  params.delete("workVersion"); params.delete("workSale");
  if (destination.saleId) params.set("workSale", destination.saleId);
  if (destination.versionId) params.set("workVersion", destination.versionId);
  params.set("section", destination.section ?? "progression");
  params.set("workReturn", "sales");
  return `/?${params}${destination.anchor ? `#${encodeURIComponent(destination.anchor)}` : ""}`;
}
