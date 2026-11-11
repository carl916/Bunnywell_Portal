import { uploadUuid } from "@/lib/sales/completion-upload";
export const completionApiPath = "/dev/building-workspace/completion";
export const documentActions = ["prepare_completion_upload", "finalize_completion_upload", "approve_completion_document", "query_completion_document"] as const;
export type RecordScope = { buildingId: string; unitId: string; saleId: string };
export function recordScope(value: unknown): RecordScope {
  const v = value as Partial<RecordScope> | null;
  if (!v || !uploadUuid(v.buildingId) || !uploadUuid(v.unitId) || !uploadUuid(v.saleId)) throw Error("An exact building, unit and sale attempt are required.");
  return { buildingId: v.buildingId, unitId: v.unitId, saleId: v.saleId };
}
export function permittedCompletionAction(action: unknown) {
  return typeof action === "string" && (documentActions.includes(action as typeof documentActions[number]) || action === "comment");
}
