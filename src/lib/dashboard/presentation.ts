import type { DashboardSnapshot, WorkDestination, WorkItem, WorkRow } from "./types";

export function destinationUrl(destination: WorkDestination, scope: string, returnTo = "dashboard") {
  const params = new URLSearchParams({ screen: destination.screen, building: (destination.screen === "setup_buildings" || destination.screen === "rentals" ? destination.buildingId : scope) || "all", workReturn: returnTo, workScope: scope || "all" });
  if (destination.screen === "sales") {
    if (destination.unitId) params.set("salesUnitId", destination.unitId);
    if (destination.saleId) params.set("workSale", destination.saleId);
    if (destination.section === "activity" && destination.saleId) {
      params.set("section", "progression"); params.set("conversation", destination.saleId); params.set("workActivity", "1");
    } else if (destination.section) params.set("section", destination.section);
    if (destination.filter) params.set("salesFilter", destination.filter);
    if (destination.versionId) params.set("workVersion", destination.versionId);
  }
  if (destination.screen === "snags") {
    if (destination.snagId) params.set("snagId", destination.snagId);
    if (destination.source) params.set("snagSource", destination.source);
    if (destination.filter) params.set("snagWork", destination.filter);
  }
  if (destination.screen === "units" && destination.unitId) params.set("unitId", destination.unitId);
  if (destination.screen === "rentals" && destination.unitId) params.set("rentalUnitId", destination.unitId);
  if (destination.screen === "setup_people") {
    params.set("accessReview", "pending");
    if (destination.requestId) params.set("accessRequestId", destination.requestId);
  }
  return `/?${params.toString()}${destination.anchor ? `#${encodeURIComponent(destination.anchor)}` : ""}`;
}

export function groupWorkItems(items: WorkItem[], buildings: ReadonlyMap<string, { name: string }>): WorkRow[] {
  const groups = new Map<string, WorkRow>();
  for (const item of items) {
    const row = groups.get(item.recordKey) ?? { key: item.recordKey, buildingName: buildings.get(item.buildingId)?.name ?? "Building unavailable", reference: item.reference, items: [] };
    row.items.push(item); groups.set(item.recordKey, row);
  }
  return [...groups.values()];
}

export function filterWork(snapshot: DashboardSnapshot, queue: "ours" | "others", module: "all" | "sales" | "snags" | "other", kind = "") {
  const items = snapshot.items.filter(item => item.ours === (queue === "ours") && (module === "all" || item.module === module) && (!kind || item.kind === kind));
  return { items, rows: groupWorkItems(items, new Map(snapshot.buildings.map(b => [b.id, b]))), tasks: items.length, records: new Set(items.map(item => item.recordKey)).size };
}
