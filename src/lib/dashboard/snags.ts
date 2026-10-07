import type { ProductionSnag, SnagEvent } from "../data/production";

export const isActiveSnag = (snag: Pick<ProductionSnag, "status">) => !["closed", "resolved"].includes(snag.status);
export const needsTrade = (snag: Pick<ProductionSnag, "source_type" | "status" | "trade_id">) => snag.source_type === "developer_snag" && isActiveSnag(snag) && !snag.trade_id;
export function latestStatusTransition(events: SnagEvent[], snagId: string) {
  return events.filter(event => event.snag_id === snagId && ["status_change", "triage"].includes(event.event_type) && event.old_value !== event.new_value)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
}
export function currentInformationSupplied(snag: Pick<ProductionSnag, "id" | "status">, events: SnagEvent[]) {
  const event = latestStatusTransition(events, snag.id);
  return snag.status === "open" && event?.old_value === "needs_more_info" && event.new_value === "open" ? event : null;
}
