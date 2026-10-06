import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSaleActorNames } from "./load-errors";

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

// Broad refreshes remain authoritative for other users' changes. Read the
// complete snapshot before publishing it, so an interrupted load cannot expose
// a new attempt alongside old terms, versions or commercial rows.
export async function loadBuildingSalesData(client: SupabaseClient, units: string[], building: string) {
  let defaultsQuery = client.from("building_sale_defaults").select("*");
  if (building) defaultsQuery = defaultsQuery.eq("building_id", building);
  // Defaults and attempts share the already-authorised building context, but
  // neither consumes the other's rows. Keep publication behind both branches.
  const [defaults, fresh] = await Promise.all([defaultsQuery, loadSalesRows(client, units)]);
  if (defaults.error) throw defaults.error;
  return { defaults: defaults.data ?? [], ...fresh };
}

async function loadSalesRows(client: SupabaseClient, units: string[]) {
  const empty = { attempts: [], terms: [], schedule: [], documents: [], versions: [], invoices: [], payments: [], actors: [], deposits: [], namesUnavailable: false };
  if (!units.length) return empty;
  const attempts = await client.from("unit_sale_attempts").select("*").in("unit_id", units).order("attempt_number", { ascending: false });
  if (attempts.error) throw attempts.error;
  const sales = (attempts.data ?? []).map(row => row.id as string);
  if (!sales.length) return { ...empty, attempts: attempts.data ?? [] };
  const [terms, schedule, documentRows, invoices, payments, actors, deposits] = await Promise.all([
    client.from("unit_sale_terms").select("*").in("sale_attempt_id", sales),
    client.from("unit_sale_payment_schedule").select("*").in("sale_attempt_id", sales).order("sequence_no"),
    loadDocuments(),
    client.from("unit_sale_invoices").select("*").in("sale_attempt_id", sales),
    client.from("unit_sale_invoice_payments").select("*").in("sale_attempt_id", sales),
    client.rpc("sale_actor_names", { p_sales: sales }),
    client.from("sale_exchange_deposit_receipts").select("sale_attempt_id").in("sale_attempt_id", sales),
  ]);
  for (const result of [terms, schedule, invoices, payments, deposits]) if (result.error) throw result.error;
  if (actors.error && !isMissingSaleActorNames(actors.error)) throw actors.error;
  return { attempts: attempts.data ?? [], terms: terms.data ?? [], schedule: schedule.data ?? [], ...documentRows, invoices: invoices.data ?? [], payments: payments.data ?? [], actors: actors.data ?? [], deposits: deposits.data ?? [], namesUnavailable: Boolean(actors.error) };

  async function loadDocuments() {
    const documents = await client.from("unit_sale_documents").select("*").in("sale_attempt_id", sales);
    if (documents.error) throw documents.error;
    // Version IDs depend only on documents, not on the financial/name reads.
    const ids = (documents.data ?? []).map(row => row.id as string);
    const versions = ids.length ? await client.from("unit_sale_document_versions").select("*").in("document_id", ids).order("version_number", { ascending: false }) : { data: [], error: null };
    if (versions.error) throw versions.error;
    return { documents: documents.data ?? [], versions: versions.data ?? [] };
  }
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
