import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const COMMENT_LIMIT = 5000;
export type SalePerson = { id: string; name: string; role: string; organisation: string | null; assigned: boolean };
export type SaleComment = {
  id: string; sale_attempt_id: string; sequence: number; author_id: string; author_name: string;
  author_role: string | null; author_organisation: string | null; body: string; stage: string | null;
  parent_id: string | null; mention_ids: string[]; created_at: string; edited_at: string | null; version: number; unread: boolean;
};
export type CommentPage = { comments: SaleComment[]; hasBefore: boolean; hasAfter: boolean };
export type Revision = { version: number; body: string; recorded_at: string; replaced_at: string };
export type MentionNotification = { id: string; sale_attempt_id: string; comment_id: string; unit_id: string; building_id: string; unit_number: string; building_name: string; author_name: string; created_at: string };
export type SaleActivity = {
  id: string; sale_attempt_id: string; event_type: string; summary: string; created_at: string;
  actor_name: string | null; actor_role: string | null; actor_organisation: string | null;
  metadata: Record<string, unknown>; version_id: string | null;
};

export async function discussionRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function mergeComments(existing: SaleComment[], incoming: SaleComment[]) {
  const byId = new Map(existing.map((comment) => [comment.id, comment]));
  incoming.forEach((comment) => {
    const previous = byId.get(comment.id);
    if (!previous || comment.version >= previous.version) byId.set(comment.id, { ...comment, unread: previous?.unread === false ? false : comment.unread });
  });
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

export function discussionDraftKey(userId: string, saleId: string) { return `bunnywell:discussion:${userId}:${saleId}`; }
export function personRole(role?: string | null) { return role === "conveyancer" ? "Solicitor" : role === "sales_agent" ? "Agent" : role ? role.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : ""; }
export function activityPresentation(event: SaleActivity) {
  const type = event.event_type;
  const meta = event.metadata ?? {};
  const subject = meta.documentType === "completion_statement" ? "Completion statement" : meta.documentType === "statement_of_account" ? "Statement of account" : null;
  const outcome = type.endsWith("approved") ? "approved" : /rejected|query_raised/.test(type) ? "rejected" : type.endsWith("replaced") ? "replaced" : type.endsWith("uploaded") ? "uploaded" : null;
  const title = subject && outcome ? `${subject} ${outcome}` : type === "completion_recorded" ? "Sale completed" : type === "exchange_recorded" ? "Exchange recorded" : event.summary;
  const stage = /completion|statement_of_account/.test(type) ? "completion" : /exchange/.test(type) ? "exchange" : /reservation/.test(type) ? "reservation" : null;
  const details: string[] = [];
  if (typeof meta.fileName === "string") details.push(meta.fileName + (typeof meta.versionNumber === "number" ? ` · Version ${meta.versionNumber}` : ""));
  if (typeof meta.queryNote === "string") details.push(`Reason: ${meta.queryNote}`);
  if (typeof meta.rejectionReason === "string") details.push(`Reason: ${meta.rejectionReason}`);
  if (typeof meta.exchangeDate === "string") details.push(`Actual exchange date: ${meta.exchangeDate}`);
  if (typeof meta.completionDate === "string") details.push(`Actual completion date: ${meta.completionDate}`);
  return { title, stage, details, kind: outcome === "rejected" ? "rejected" : /document|statement|invoice|form/.test(type) ? "document" : "event" };
}

export function mentionLink(item: MentionNotification) {
  return `/?${new URLSearchParams({ screen: "sales", building: item.building_id, salesUnitId: item.unit_id, conversation: item.sale_attempt_id, comment: item.comment_id })}`;
}
