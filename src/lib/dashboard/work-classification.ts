import type { WorkItem } from "./types";

/** Dates describe a record; they do not create another outstanding task. */
export function isWorkObservation(item: WorkItem) {
  return item.kind === "completion_date";
}

export function hasWorkOwner(item: WorkItem) {
  return item.responsibility.allocation !== "unavailable" && (item.responsibility.kind === "developer" ||
    item.responsibility.kind !== "unallocated" && Boolean(item.responsibility.organisationId));
}

export function isUnallocatedWork(item: WorkItem) {
  return !isWorkObservation(item) && item.responsibility.allocation !== "unavailable" && !hasWorkOwner(item);
}

export function matchesWorkTeam(item: WorkItem, team: "ours" | "others") {
  return !isWorkObservation(item) && hasWorkOwner(item) && item.ours === (team === "ours");
}

export const SALES_CATEGORIES = {
  reservation: "Reservations", commercial: "Commercial approvals", exchange: "Exchange authority",
  notice: "Notice arrangements", documents: "Completion documents", completion: "Legal completion",
  deposit: "Deposit confirmations", "invoice-review": "Invoice reviews", "invoice-submission": "Invoice submissions",
  "payment-position": "Payment position", "record-checks": "Record checks", unallocated: "Unallocated work",
} as const;
export type SalesCategory = keyof typeof SALES_CATEGORIES;

/** Shared fee category identity, fed by the existing invoice/payment derivation. */
export function feeWorkCategory(kind: string): "invoice-review" | "payment-position" | "invoice-submission" {
  if (kind === "awaiting_approval") return "invoice-review";
  if (kind === "approved_unpaid" || kind === "part_paid") return "payment-position";
  return "invoice-submission";
}

export function salesWorkCategory(item: WorkItem): SalesCategory {
  if (isUnallocatedWork(item)) return "unallocated";
  if (item.kind.startsWith("reservation_")) return "reservation";
  if (item.kind === "commercial_review") return "commercial";
  if (/^(authority_|exchange_progress|legal_delivery_)/.test(item.kind)) return "exchange";
  if (item.kind.startsWith("notice_")) return "notice";
  if (/^(missing_|replace_|review_)/.test(item.kind)) return "documents";
  if (item.kind === "legal_completion") return "completion";
  if (item.kind === "deposit_receipt") return "deposit";
  if (item.kind.startsWith("fee_")) return feeWorkCategory(item.kind.replace(/^fee_(exchange|completion)_/, ""));
  return "record-checks";
}
