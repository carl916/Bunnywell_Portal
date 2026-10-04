import type { SupabaseClient } from "@supabase/supabase-js";

// These scopes follow the legal RPCs, including their unit/document triggers.
// Preparation and Storage transfer never publish a document version.
export function legalRefreshScope(action: string) {
  return {
    documents: ["finalize_completion_upload", "upload_completion_documents", "approve_completion_package", "query_completion_package", "approve_statement", "query_statement", "confirm_notice", "replace_notice"].includes(action),
    unit: ["confirm_exchange", "confirm_completion"].includes(action),
    deposit: ["confirm_exchange_deposit", "correct_exchange_deposit_date"].includes(action),
  };
}

export function replaceSaleRows<T extends { sale_attempt_id: string }>(rows: T[], sale: string, fresh: T[]) {
  return [...rows.filter(row => row.sale_attempt_id !== sale), ...fresh];
}

export function replaceRowsById<T extends { id: string }>(rows: T[], fresh: T[]) {
  const ids = new Set(fresh.map(row => row.id));
  return [...rows.filter(row => !ids.has(row.id)), ...fresh];
}

export async function loadLegalSaleChanges(client: SupabaseClient, sale: string, action: string) {
  const scope = legalRefreshScope(action);
  const [attempt, actors, documents, deposit] = await Promise.all([
    client.from("unit_sale_attempts").select("*").eq("id", sale).single(),
    client.rpc("sale_actor_names", { p_sales: [sale] }),
    scope.documents ? client.from("unit_sale_documents").select("*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)").eq("sale_attempt_id", sale) : null,
    scope.deposit ? client.from("sale_exchange_deposit_receipts").select("sale_attempt_id").eq("sale_attempt_id", sale) : null,
  ]);
  // Publish the related rows together only after every required read succeeds.
  for (const result of [attempt, actors, documents, deposit]) if (result?.error) throw result.error;
  return { attempt: attempt.data, actors: actors.data ?? [], documents: documents?.data, deposit: deposit?.data };
}

// A rejected mutation can have committed before its response/email failed.
// Always reconcile, and retain the mutation failure even when reads succeed.
export async function runAndRefresh(mutate: () => Promise<void>, refresh: () => Promise<void>) {
  let mutationError: unknown;
  let refreshError: unknown;
  try { await mutate(); } catch (error) { mutationError = error; }
  try { await refresh(); } catch (error) { refreshError = error; }
  if (mutationError && refreshError) {
    const message = mutationError instanceof Error ? mutationError.message : "Legal action failed.";
    throw Object.assign(new Error(`${message} Updated data could not be loaded; refresh before continuing.`),
      typeof mutationError === "object" && mutationError ? mutationError : {});
  }
  if (mutationError) throw mutationError;
  if (refreshError) throw new Error("The action was saved, but updated data could not be loaded. Refresh before continuing.");
}

export async function settleRefreshes(reads: Promise<unknown>[]) {
  const results = await Promise.allSettled(reads);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
