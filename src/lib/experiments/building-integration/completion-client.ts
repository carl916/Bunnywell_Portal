import { completionApiPath, type RecordScope } from "./completion-boundary";
import { approvedLocalEnvironment } from "./local-environment";
import { uploadCompletionFiles, type UploadProgress } from "@/lib/sales/completion-upload-client";
import type { CompletionUploadFile } from "@/lib/sales/completion-upload";
import type { Upload } from "tus-js-client";
import type { CommentPage, SaleActivity } from "@/lib/sales/discussion";
export function completionClient(token: string, anonKey: string) {
  async function request(scope: RecordScope, value: Record<string, unknown>, signal?: AbortSignal, method = "POST") {
    if (location.origin !== approvedLocalEnvironment.appOrigin) throw Error("Use the local review address.");
    const query = new URLSearchParams({ building: scope.buildingId, unit: scope.unitId, sale: scope.saleId });
    if (method === "GET") for (const [key, val] of Object.entries(value)) if (val != null) query.set(key, String(val));
    return fetch(completionApiPath + (method === "GET" ? "?" + query : ""), {
      method, signal, redirect: "error", cache: "no-store",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({ ...value, scope }),
    });
  }
  async function data<T>(scope: RecordScope, value: Record<string, unknown>, signal?: AbortSignal, method?: string): Promise<T> {
    const response = await request(scope, value, signal, method);
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Completion operation failed.");
    return result;
  }
  return {
    action: (scope: RecordScope, value: Record<string, unknown>, signal?: AbortSignal) => data(scope, value, signal),
    comments: (scope: RecordScope, before?: number, signal?: AbortSignal, after?: number, target?: string) => data<CommentPage>(scope, { kind: "comments", before, after, target }, signal, "GET"),
    activity: (scope: RecordScope, before?: SaleActivity, signal?: AbortSignal) => data<SaleActivity[]>(scope, { kind: "activity", beforeId: before?.id, beforeTime: before?.created_at }, signal, "GET"),
    document: (scope: RecordScope, version: string, signal?: AbortSignal) => data<{ url: string; fileName: string }>(scope, { kind: "document", version }, signal, "GET"),
    async upload(scope: RecordScope, requestId: string, file: File, metadata: CompletionUploadFile & {action?:string;expected?:string;payload?:Record<string,unknown>},
      progress: (value: UploadProgress) => void, signal: AbortSignal, attempts: Map<string, Upload>) {
      await uploadCompletionFiles(scope.saleId, requestId, [file], [metadata], progress, signal, attempts, {
        prepare: payload => request(scope, payload, signal), anonKey, allowedStorageOrigin: approvedLocalEnvironment.apiOrigin,
      });
      return data(scope, { action: "finalize_completion_upload", requestId }, signal);
    },
  };
}
