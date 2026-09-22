import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/supabase/admin";
import { completionUploadBucket, completionUploadFiles, uploadUuid, type StoredCompletionUploadFile } from "./completion-upload";

type UploadSession = { id: string; sale_id: string; actor_id: string; files: StoredCompletionUploadFile[]; state: string; result: unknown; expires_at: string };

async function verifyObject(client: SupabaseClient, bucket: string, file: StoredCompletionUploadFile) {
  const info = await client.storage.from(bucket).info(file.path);
  if (info.error) throw new Error("A PDF has not finished uploading. Retry to resume the transfer.");
  if (info.data.size !== file.size || info.data.contentType !== "application/pdf") throw new Error("The uploaded PDF has the wrong size or type. Remove it and choose the correct PDF again.");
  // Read only the signature, never buffer or proxy the PDF through Next.js.
  const response = await fetch(`${requiredEnv("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/authenticated/${bucket}/${file.path}`, {
    headers: { Authorization: `Bearer ${requiredEnv("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), Range: "bytes=0-4" },
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const reader = response.body?.getReader();
  if (!response.ok || !reader) { await reader?.cancel(); throw new Error("Could not verify the PDF. Retry when your connection is available."); }
  const prefix: number[] = [];
  try {
    while (prefix.length < 5) {
      const chunk = await reader.read(); if (chunk.done) break;
      prefix.push(...chunk.value.subarray(0, 5 - prefix.length));
    }
  } finally { await reader.cancel(); }
  if (new TextDecoder().decode(new Uint8Array(prefix)) !== "%PDF-") throw new Error("The uploaded file is not a PDF. Remove it and choose a PDF again.");
}

export async function completionUploadAction(client: SupabaseClient, actor: string, payload: Record<string, unknown>) {
  const sale = payload.sale, request = payload.requestId;
  if (!uploadUuid(sale) || !uploadUuid(request)) throw new Error("Select a sale and a valid submission reference.");
  const begin = payload.action === "prepare_completion_upload";
  const found = await client.rpc("sales_completion_upload_session", { p_sale: sale, p_actor: actor, p_request: request,
    p_action: begin ? "begin" : "get", p_files: begin ? completionUploadFiles(payload.files) : null });
  if (found.error) throw found.error;
  const session = found.data as UploadSession;
  if (session.state === "finalized") return { completed: true, documents: session.result, files: [] };
  if (begin) {
    const files = await Promise.all(session.files.map(async file => {
      const existing = await client.storage.from(completionUploadBucket).info(file.path);
      if (!existing.error) return { path: file.path, ready: true };
      if (!["404", "400"].includes(String(existing.error.statusCode)) || !/not.found|does.not.exist/i.test(existing.error.message)) throw existing.error;
      const signed = await client.storage.from(completionUploadBucket).createSignedUploadUrl(file.path, { upsert: false });
      if (signed.error) throw signed.error;
      return { path: file.path, token: signed.data.token, ready: false };
    }));
    const base = new URL(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"));
    if (base.hostname.endsWith(".supabase.co")) base.hostname = base.hostname.replace(".supabase.co", ".storage.supabase.co");
    return { completed: false, files, bucket: completionUploadBucket, endpoint: `${base.origin}/storage/v1/upload/resumable/sign`, expiresAt: session.expires_at };
  }
  for (const file of session.files) {
    await verifyObject(client, completionUploadBucket, file);
    // Storage performs the copy internally. Signed upload capabilities never
    // address a published document, even while their tokens remain valid.
    const copy = await client.storage.from(completionUploadBucket).copy(file.path, file.path, { destinationBucket: "sale-documents" });
    if (copy.error && !/already exists|duplicate/i.test(copy.error.message)) throw copy.error;
    await verifyObject(client, "sale-documents", file);
  }
  const result = await client.rpc("sales_completion_upload_session", { p_sale: sale, p_actor: actor, p_request: request, p_action: "finalize" });
  if (result.error) throw result.error;
  // Keep quarantine until upload capabilities expire. A lost response simply
  // retries this transaction; no speculative cleanup can delete a saved version.
  return { completed: true, documents: result.data.result };
}

export async function cleanCompletionUploads(client: SupabaseClient) {
  const found = await client.rpc("sales_completion_upload_cleanup");
  if (found.error) throw found.error;
  let cleaned = 0;
  for (const session of found.data as UploadSession[]) {
    const paths = session.files.map(file => file.path);
    const quarantine = await client.storage.from(completionUploadBucket).remove(paths);
    if (quarantine.error) continue;
    if (session.state === "expired") {
      const saved = await client.from("unit_sale_document_versions").select("storage_path").in("storage_path", paths);
      if (saved.error) continue;
      const unregistered = paths.filter(path => !saved.data.some(version => version.storage_path === path));
      if (unregistered.length && (await client.storage.from("sale-documents").remove(unregistered)).error) continue;
    }
    const marked = await client.from("sale_completion_uploads").update({ cleaned_at: new Date().toISOString() }).eq("id", session.id);
    if (!marked.error) cleaned++;
  }
  return { cleaned };
}
