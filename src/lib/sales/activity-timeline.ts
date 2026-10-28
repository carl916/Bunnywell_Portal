import type { SaleActivity } from "./discussion";

export type ActivityItem = { event: SaleActivity; supporting: SaleActivity[]; title?: string };

const reservationOutcomes = new Set(["reservation_submitted", "reservation_resubmitted"]);
const issuedEmails = new Set(["authority_issued", "authority_reissued", "authority_notice_given", "completion_instruction_sent"]);
const packageUploads = new Set(["completion_statement_uploaded", "completion_statement_replaced", "completion_draft_statement_of_account_uploaded", "completion_draft_statement_of_account_replaced"]);
const compare = (a: SaleActivity, b: SaleActivity) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
const sameActor = (a: SaleActivity, b: SaleActivity) => Boolean(a.created_by_user_id && a.created_by_user_id === b.created_by_user_id);
const sameReference = (a: SaleActivity, b: SaleActivity, key: string) => typeof a.metadata[key] === "string" && a.metadata[key] !== "" && a.metadata[key] === b.metadata[key];
const elapsed = (a: SaleActivity, b: SaleActivity) => Date.parse(a.created_at) - Date.parse(b.created_at);

/** Presentation only: retain every already-authorised row, without changing the
 * audit log, the workflow context or the raw pagination cursor. Unknown events
 * and uncertain matches remain visible. Never use names as actor identities. */
export function buildActivityTimeline(events: SaleActivity[]) {
  const rows = [...new Map(events.map(event => [event.id, event])).values()].sort(compare);
  const parents = new Map<string, string>();
  const titles = new Map<string, string>();
  const peers = (event: SaleActivity) => rows.filter(candidate => candidate.id !== event.id && candidate.sale_attempt_id === event.sale_attempt_id);

  for (const event of rows) {
    let candidates: SaleActivity[] = [];
    if (["reservation_draft_saved", "reservation_form_uploaded", "reservation_form_replaced"].includes(event.event_type)) {
      // Legacy submit is three HTTP requests (draft, upload, submit). Only fold
      // a short, uninterrupted sequence into its next reservation outcome.
      const nextDecision = peers(event).filter(candidate => /^reservation_(submitted|resubmitted|approved|rejected|query_raised)$/.test(candidate.event_type)
        && elapsed(candidate, event) >= 0).sort((a, b) => -compare(a, b))[0];
      if (nextDecision && reservationOutcomes.has(nextDecision.event_type) && sameActor(event, nextDecision) && elapsed(nextDecision, event) <= 120_000) candidates = [nextDecision];
    } else if (event.event_type === "legal_email_prepared" || (event.event_type === "legal_email_delivery" && ["sent", "delivered"].includes(String(event.metadata.deliveryStatus)))) {
      // Exact email identity survives slow delivery and different sending actors.
      // Failed, unknown and pending delivery events are deliberately not folded.
      candidates = peers(event).filter(candidate => issuedEmails.has(candidate.event_type) && sameReference(event, candidate, "emailId"));
    } else if (/^completion_correspondence_(uploaded|replaced)$/.test(event.event_type)) {
      candidates = peers(event).filter(candidate => candidate.event_type === "completion_arrangements_confirmed" && sameReference(event, candidate, "versionId"));
    } else if (/^completion_(statement|draft_statement_of_account)_superseded$/.test(event.event_type)) {
      candidates = peers(event).filter(candidate => candidate.event_type === event.event_type.replace(/superseded$/, "replaced")
        && candidate.created_at === event.created_at && sameActor(event, candidate) && sameReference(event, candidate, "documentId"));
    } else if (event.event_type === "agent_fee_invoice_paid") {
      candidates = peers(event).filter(candidate => candidate.event_type === "agent_fee_payment_recorded" && candidate.created_at === event.created_at
        && sameActor(event, candidate) && sameReference(event, candidate, "invoiceId"));
    }
    if (candidates.length === 1) parents.set(event.id, candidates[0].id);
  }

  // Two completion PDFs saved in one database transaction are one upload action.
  // Equal timestamps alone never combine unrelated event types or repeat files.
  for (const event of rows) {
    if (!packageUploads.has(event.event_type) || !event.metadata.packageWorkflow || parents.has(event.id)) continue;
    const batch = [event, ...peers(event).filter(candidate => packageUploads.has(candidate.event_type) && candidate.metadata.packageWorkflow
      && candidate.created_at === event.created_at && sameActor(event, candidate))].sort(compare);
    if (batch.length !== 2 || !batch.every(candidate => typeof candidate.metadata.documentType === "string")
      || batch[0].metadata.documentType === batch[1].metadata.documentType) continue;
    parents.set(batch[1].id, batch[0].id);
    titles.set(batch[0].id, batch.some(candidate => candidate.event_type.endsWith("replaced")) ? "Completion documents updated" : "Completion documents uploaded");
  }

  const root = (id: string): string => parents.has(id) ? root(parents.get(id)!) : id;
  const primary = rows.filter(event => event.event_type !== "sale_record_changed" && !parents.has(event.id));
  const recordUpdates: SaleActivity[] = [];
  for (const event of rows.filter(event => event.event_type === "sale_record_changed")) {
    // Audit triggers often run just before/after the semantic event. Do not
    // guess when several independent actions could account for the change.
    const candidates = primary.filter(candidate => candidate.sale_attempt_id === event.sale_attempt_id && sameActor(event, candidate)
      && Math.abs(elapsed(event, candidate)) <= 30_000);
    if (candidates.length === 1) parents.set(event.id, candidates[0].id);
    else recordUpdates.push(event);
  }

  const items: ActivityItem[] = primary.map(event => ({ event, supporting: [], title: titles.get(event.id) }));
  const byId = new Map(items.map(item => [item.event.id, item]));
  for (const event of rows) {
    if (parents.has(event.id)) byId.get(root(event.id))?.supporting.push(event);
  }
  return { items, recordUpdates };
}
