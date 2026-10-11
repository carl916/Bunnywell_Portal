import { deriveDeveloperSalesRows, INITIAL_SALES_OVERVIEW, salesOverviewDestination, selectDeveloperSalesRows } from "../sales/developer-overview";
import { feeViewDestination } from "../sales/fee-workspace";
import { isSalesInternalRole } from "../sales/permissions";
import { SALES_ROUTE_STATUSES, saleStatusLabel } from "../units/commercial-allocation";
import { deadlineState, EXPANDED_DEADLINE_DAYS } from "./dates";
import { isUnallocatedWork, isWorkObservation, matchesWorkTeam } from "./work-classification";
import { destinationUrl } from "./presentation";
import type { DashboardInput, DashboardSnapshot, WorkItem } from "./types";

export type AttentionCount = { value: number | null; unit: string; href?: string };
export type AttentionRow = { key: string; label: string; href: string; ours: AttentionCount; others: AttentionCount; unallocated?: AttentionCount; note?: string };
export type InternalOverview = {
  sales: { key: string; label: string; value: number | null }[];
  attention: AttentionRow[];
  additional: { key: string; label: string; count: number; href?: string; linkLabel?: string; detail?: string }[];
};

export function moduleDestination(screen: string, buildingId: string, extra: Record<string, string> = {}) {
  return `/?${new URLSearchParams({ screen, building: buildingId || "all", ...extra })}`;
}

/** Compose the authorised snapshot; no new workflow, ownership or deadline rules. */
export function deriveInternalOverview(input: DashboardInput, snapshot: DashboardSnapshot): InternalOverview | undefined {
  if (!isSalesInternalRole(input.viewer.role)) return undefined;
  const scope = snapshot.scope.buildingId;
  const ready = (...keys: string[]) => keys.every(key => snapshot.sources.some(s => s.key === key && s.state === "ready"));
  const rows = deriveDeveloperSalesRows(input, snapshot);
  const rowUnits = new Set(rows.map(row => row.unitId));
  const count = (items: WorkItem[], team: "ours" | "others", unit: string, available: boolean): AttentionCount => ({
    value: available ? new Set(items.filter(item => matchesWorkTeam(item, team)).map(item => item.recordKey)).size : null, unit,
  });
  const salesCount = (team: "ours" | "others"): AttentionCount => ({
    value: ready("sales", "legal", "fees", "appointments") ? selectDeveloperSalesRows(rows, { ...INITIAL_SALES_OVERVIEW, work: team }, input.now).length : null,
    unit: "unit rows", href: salesOverviewDestination(scope, "", team),
  });
  const feeItems = snapshot.items.filter(item => item.kind.startsWith("fee_"));
  const snagItems = snapshot.items.filter(item => item.module === "snags");
  const rentalItems = snapshot.items.filter(item => item.destination?.screen === "rentals");
  const rentalUnits = rentalItems.filter(item => item.unitId);
  const unallocated = (items: WorkItem[], unit: string, available: boolean): AttentionCount => ({
    value: available ? new Set(items.filter(isUnallocatedWork).map(item => item.recordKey)).size : null, unit,
  });
  const salesUnallocated: AttentionCount = { value: ready("sales", "legal", "fees", "appointments")
    ? rows.filter(row => row.work.some(isUnallocatedWork)).length : null, unit: "unit rows", href: salesOverviewDestination(scope, "unallocated") };
  const attention: AttentionRow[] = [
    { key: "sales", label: "Sales", href: salesOverviewDestination(scope), ours: salesCount("ours"), others: salesCount("others"), unallocated: salesUnallocated, note: "Unit rows; includes draft reservations and post-completion exceptions." },
    { key: "fees", label: "Agent Fees", href: feeViewDestination(scope, "all"),
      ours: count(feeItems, "ours", "sale attempts", ready("fees")), others: count(feeItems, "others", "sale attempts", ready("fees")),
      unallocated: unallocated(feeItems, "sale attempts", ready("fees")),
      note: "Eligible current and historical sale attempts. Missing submissions are not approved debt." },
    { key: "snags", label: "Snags & defects", href: moduleDestination("snags", scope),
      ours: count(snagItems, "ours", "snag records", ready("snags")), others: count(snagItems, "others", "snag records", ready("snags")), unallocated: unallocated(snagItems, "snag records", ready("snags")) },
    { key: "rentals", label: "Rentals", href: moduleDestination("rentals", scope),
      ours: count(rentalUnits, "ours", "rental units", ready("rentals", "rent_risk")), others: count(rentalUnits, "others", "rental units", ready("rentals", "rent_risk")) },
  ];
  // Work outside the four rows (including unallocated work) must not disappear.
  const additional = new Map<string, InternalOverview["additional"][number] & { records: Set<string>; buildings: Set<string> }>();
  for (const item of snapshot.items.filter(item => !isWorkObservation(item))) {
    const unallocated = isUnallocatedWork(item);
    if (item.kind.startsWith("fee_") || unallocated && (item.module === "snags" || rowUnits.has(item.unitId ?? ""))) continue;
    const outsideSales = item.module === "sales" && !rowUnits.has(item.unitId ?? "");
    if (!unallocated && !outsideSales && (item.module === "sales" || item.module === "snags" || rentalUnits.includes(item))) continue;
    const area = item.module === "sales" ? "Sales" : item.module === "snags" ? "Snags & defects" : item.source;
    const key = outsideSales ? `sales-outside-pipeline:${item.recordKey}` : unallocated ? `unallocated:${item.module}` : item.kind;
    const label = unallocated ? `${area}: responsible team unallocated` : outsideSales ? "Sales work outside the current pipeline" : item.kind === "rental_evidence" ? "Rental buildings without import evidence" : item.kind === "rental_import" ? "Rental buildings with source exceptions" : item.action;
    const screen = item.destination?.screen;
    const href = outsideSales && item.unitId ? destinationUrl({ screen: "units", buildingId: item.buildingId, unitId: item.unitId }, scope) : unallocated && item.module === "sales" && !outsideSales ? salesOverviewDestination(scope, "unallocated")
      : screen ? moduleDestination(screen, scope, screen === "setup_people" ? { accessReview: "pending" } : {}) : undefined;
    const group = additional.get(key) ?? { key, label, count: 0, href, linkLabel: outsideSales ? "Open unit" : "Open area", detail: outsideSales ? `${snapshot.buildings.find(building => building.id === item.buildingId)?.name ?? "Building unavailable"} · ${item.reference}. Outside the Sales register; the unit page is the available destination.` : undefined, records: new Set<string>(), buildings: new Set<string>() };
    group.records.add(item.recordKey); group.count = group.records.size;
    if (item.source === "Building lifecycle") group.buildings.add(snapshot.buildings.find(building => building.id === item.buildingId)?.name ?? "Building unavailable");
    additional.set(key, group);
  }
  return {
    sales: SALES_ROUTE_STATUSES.map(stage => ({ key: stage, label: saleStatusLabel(stage), value: ready("sales") ? rows.filter(row => row.stage === stage).length : null })),
    attention, additional: [...additional.values()].map(group => ({ key: group.key, label: group.label, count: group.count, href: group.href, linkLabel: group.linkLabel, detail: group.detail ?? ([...group.buildings].join(", ") || undefined) })),
  };
}

/** Keep the existing expanded review window accessible, in snapshot priority order. */
export function datesToReview(snapshot: DashboardSnapshot) {
  return snapshot.items.filter(item => isUnallocatedWork(item) || item.responsibility.allocation === "unavailable" || item.urgent || ["overdue", "today", "soon"].includes(deadlineState(item.deadline, Date.parse(snapshot.asOf), EXPANDED_DEADLINE_DAYS)));
}
