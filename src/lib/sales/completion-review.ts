export const completionDocumentTypes = ["completion_statement", "draft_statement_of_account"] as const;
export type CompletionDocumentType = typeof completionDocumentTypes[number];
export const completionDocumentLabels: Record<CompletionDocumentType, string> = {
  completion_statement: "Completion statement",
  draft_statement_of_account: "Statement of account",
};

type Version = { id: string; is_current: boolean; redacted_at: string | null };
type Document = { document_type: string; status: string; approved_version_id: string | null; unit_sale_document_versions: Version[] };
export type CompletionReviewEvent = {
  id?: string;
  event_type: string;
  actor_name?: string | null;
  created_by_user_id: string | null;
  created_at: string;
  metadata?: { versionId?: string; queryNote?: string; documents?: { versionId: string }[] } | null;
};

export const currentCompletionVersion = <T extends Version>(document?: { unit_sale_document_versions: T[] }) =>
  document?.unit_sale_document_versions.find(version => version.is_current && !version.redacted_at);

export function completionDocumentApproved(document?: Document) {
  const version = currentCompletionVersion(document);
  return Boolean(version && document?.status === "approved" && document.approved_version_id === version.id);
}

export const completionDocumentsApproved = (documents: Document[]) =>
  completionDocumentTypes.every(type => completionDocumentApproved(documents.find(document => document.document_type === type)));

export function completionVersionEvents(events: CompletionReviewEvent[], versionId: string) {
  // Package approvals used an array; per-document actions use a single versionId.
  return events.filter(event => event.metadata?.versionId === versionId || event.metadata?.documents?.some(document => document.versionId === versionId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
