import type { Upload } from "tus-js-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { completionUploadFiles, type CompletionUploadFile } from "./completion-upload";

type Prepared = { completed: boolean; bucket: string; endpoint: string; files: { path: string; token?: string; ready: boolean }[] };
export type UploadProgress = { loaded: number; total: number; phase: "preparing" | "uploading" | "verifying" };

export async function uploadCompletionFiles(sale: string, requestId: string, files: File[], metadata: CompletionUploadFile[],
  progress: (value: UploadProgress) => void, signal: AbortSignal, attempts: Map<string, Upload>) {
  completionUploadFiles(metadata); // Reject unsupported selections before ANY transfer.
  const total = files.reduce((sum, file) => sum + file.size, 0);
  progress({ loaded: 0, total, phase: "preparing" });
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error || !data.session) throw new Error("Sign in again, then retry the upload.");
  const response = await fetch("/api/sales/legal", { method: "POST", signal,
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare_completion_upload", sale, requestId, files: metadata }),
  });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "Could not prepare the upload. Reload the page and retry; no files were sent."); }
  const prepared = await response.json() as Prepared;
  if (prepared.completed) return;
  const { Upload: ResumableUpload } = await import("tus-js-client");
  const loaded = files.map(() => 0);
  // Sequential files give a clear progress indicator and avoid saturating mobile
  // uplinks. TUS resumes the interrupted file; completed files are skipped.
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const target = prepared.files[index];
    if (!target) throw new Error("The upload selection changed. Remove the files and select them again.");
    if (!target.ready) await new Promise<void>((resolve, reject) => {
      const key = `${requestId}:${index}`;
      const upload = attempts.get(key) ?? new ResumableUpload(file, {
        endpoint: prepared.endpoint, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-signature": target.token!, "x-upsert": "false" },
        metadata: { bucketName: prepared.bucket, objectName: target.path, contentType: "application/pdf", cacheControl: "0" },
        chunkSize: 6 * 1024 * 1024, uploadDataDuringCreation: true, storeFingerprintForResuming: false,
        retryDelays: [0, 1000, 3000, 5000],
      });
      attempts.set(key, upload);
      const abort = () => {
        const paused = () => reject(new Error("Upload paused. Select Upload again to resume; completed files will be kept."));
        void upload.abort().then(paused, paused);
      };
      const finish = () => signal.removeEventListener("abort", abort);
      upload.options.onError = () => { finish(); reject(new Error("Transfer interrupted. Check your connection, then select Upload again to resume. Your selected files are still here.")); };
      upload.options.onSuccess = () => { finish(); attempts.delete(key); resolve(); };
      upload.options.onProgress = bytes => { loaded[index] = bytes; progress({ loaded: loaded.reduce((sum, value) => sum + value, 0), total, phase: "uploading" }); };
      signal.addEventListener("abort", abort, { once: true });
      upload.start();
    });
    loaded[index] = file.size;
    progress({ loaded: loaded.reduce((sum, value) => sum + value, 0), total, phase: "uploading" });
  }
  progress({ loaded: total, total, phase: "verifying" });
}
