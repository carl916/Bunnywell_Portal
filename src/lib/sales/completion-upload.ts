export const completionUploadLimit = 10 * 1024 * 1024;
export const completionUploadBucket = "completion-uploads";
export type CompletionUploadFile = { type: string; expectedVersionId: string | null; name: string; size: number; mime: string };
export type StoredCompletionUploadFile = CompletionUploadFile & { path: string };
export const uploadUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

// The server accepts metadata only. Never accept client-selected storage paths.
export function completionUploadFiles(value: unknown): CompletionUploadFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new Error("Choose one or two PDFs.");
  const files = value.map(file => {
    if (!file || !["completion_statement", "draft_statement_of_account"].includes(file.type) ||
      typeof file.name !== "string" || file.name.length > 200 || !/\.pdf$/i.test(file.name) || /[\x00-\x1f\\/]/.test(file.name) ||
      file.mime !== "application/pdf" || !Number.isSafeInteger(file.size) || file.size < 5 || file.size > completionUploadLimit ||
      (file.expectedVersionId !== null && !uploadUuid(file.expectedVersionId))) {
      throw new Error("Choose PDFs up to 10 MiB each and assign a document type. Reload if the current version changed.");
    }
    return { type: file.type, expectedVersionId: file.expectedVersionId, name: file.name, size: file.size, mime: file.mime } as CompletionUploadFile;
  });
  if (new Set(files.map(file => file.type)).size !== files.length) throw new Error("Assign each PDF a different document type.");
  return files;
}
