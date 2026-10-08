import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardInput, WorkViewer } from "./types";
import { canOpenSalesPipeline, isSalesInternalRole } from "../sales/permissions";
import { portalAccessKey } from "../portal-access-snapshot";

import { readComplete, DASHBOARD_SOURCE_LIMIT } from "./pagination";
export { readComplete, DASHBOARD_PAGE_SIZE, DASHBOARD_SOURCE_LIMIT } from "./pagination";
type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

export class DashboardAccessError extends Error {}
export async function dashboardAccessKey(client: SupabaseClient, viewer: WorkViewer) {
  const read = async <T,>(table: string, columns: string) => readComplete<T>(async (from, to) => {
    const query = client.from(table).select(columns, { count: "exact" }).order("id").range(from, to);
    return await (table === "building_organisations" ? query : query.eq("user_id", viewer.id)) as unknown as Page<T>;
  });
  const [units, buildings, links] = await Promise.all([
    read<{ unit_id: string }>("user_unit_access", "id,unit_id"),
    read<{ building_id: string }>("user_building_access", "id,building_id"),
    read<{ building_id: string; organisation_id: string; role_on_project: string; active: boolean }>("building_organisations", "id,building_id,organisation_id,role_on_project,active"),
  ]);
  return portalAccessKey(viewer, units, buildings, links);
}
// A deliberately small read-only builder surface; no mutations are accepted here.
type ReadQuery = PromiseLike<Page<unknown>> & {
  eq(column: string, value: unknown): ReadQuery;
  is(column: string, value: null): ReadQuery;
  in(column: string, values: unknown[]): ReadQuery;
  not(column: string, operator: string, value: string): ReadQuery;
  order(column: string, options?: { referencedTable?: string; ascending?: boolean }): ReadQuery;
  limit(count: number, options?: { referencedTable?: string }): ReadQuery;
};

export async function loadDashboardInput(client: SupabaseClient, viewer: WorkViewer, buildingId: string, now = Date.now(), mode: "dashboard" | "sales-register" = "dashboard"): Promise<DashboardInput> {
  const register = mode === "sales-register";
  const rows = async <T,>(table: string, columns: string, filter?: (query: ReadQuery) => ReadQuery): Promise<T[]> => {
    return readComplete<T>(async (from, to) => {
      // The builder is reconstructed per page so filters/order/range cannot bleed between modules.
      const query = client.from(table).select(columns, { count: "exact" }).order("id").range(from, to);
      const response = await (filter ? filter(query as unknown as ReadQuery) : query) as unknown as Page<T>;
      return response;
    });
  };
  // All table reads use the caller's JWT and existing RLS. No service-role portfolio scan.
  const buildings = await rows<DashboardInput["buildings"][number]>("buildings", "id,name,status,pc_date,pc_confirmed,practical_completion_date");
  if (buildingId && !buildings.some(b => b.id === buildingId)) throw new DashboardAccessError("This building is unavailable or outside your access.");
  const scopedBuildings = buildings.filter(b => !buildingId || b.id === buildingId);
  const ids = scopedBuildings.map(b => b.id);
  const input: DashboardInput = { viewer, now, buildingId, buildings: scopedBuildings, units: [], floors: [], organisations: [], buildingOrganisations: [], sales: [], documents: [], authorities: [], saleEvents: [], deposits: [], depositSources: [], invoices: [], terms: [], payments: [], snags: [], handovers: [], tenancies: [], arrears: [], rentalImports: [], accessRequests: [], sources: [] };
  const internal = !register && isSalesInternalRole(viewer.role);
  const operational = !register && (internal || ["developer_representative", "contractor"].includes(viewer.role));
  async function source(key: string, label: string, permitted: boolean, read: () => Promise<void>) {
    if (!permitted) { input.sources.push({ key, label, state: "not_permitted", asOf: null }); return; }
    try { if (ids.length) await read(); input.sources.push({ key, label, state: "ready", asOf: new Date(now).toISOString() }); }
    catch { input.sources.push({ key, label, state: "unavailable", asOf: null, detail: `${label} could not be loaded completely. Refresh to retry; no zero total is implied.` }); }
  }
  // Common authorised dimensions must be complete before any module is counted.
  if (ids.length) {
    const [units, floors, organisations, relationships] = await Promise.all([
      rows<DashboardInput["units"][number]>("units", "id,building_id,unit_number,floor,sale_status,rental_portfolio_status,completion_date,handover_date", q => q.in("building_id", ids)),
      rows<DashboardInput["floors"][number]>("building_floors", "id,building_id,name,sort_order", q => q.in("building_id", ids)),
      rows<DashboardInput["organisations"][number]>("organisations", "id,name"),
      rows<DashboardInput["buildingOrganisations"][number]>("building_organisations", "id,building_id,organisation_id,role_on_project,active", q => q.in("building_id", ids)),
    ]);
    Object.assign(input, { units, floors, organisations, buildingOrganisations: relationships });
  }
  await Promise.all([
    source("sales", "Sales progression", canOpenSalesPipeline(viewer.role), async () => {
      input.sales = await rows("unit_sale_attempts", "id,building_id,unit_id,is_active,workflow_status,sales_agent_organisation_id,conveyancer_organisation_id,reservation_submitted_at,reservation_rejected_at,reservation_rejection_reason,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at,legal_completed_at,redacted_at,authority_requested_at,completion_authority_requested_at,completion_authority_given_at,completion_arrangements_confirmed_at,completion_legacy_stage,completion_notice_issued_at,contractual_completion_date,created_at", q => q.in("building_id", ids).eq("is_active", true).is("redacted_at", null));
    }),
    source("snags", "Snags and resident defects", operational, async () => {
      input.snags = await rows("snags", "id,building_id,unit_id,source_type,title,status,trade_id,assigned_to_organisation_id,assigned_to_user_id,priority_code,sla_due_date,created_at,closed_at,snag_events(id,snag_id,event_type,old_value,new_value,comment,created_by_user_id,created_at)", q => q.in("building_id", ids).in("source_type", ["developer_snag", "leaseholder_defect"]).not("status", "in", "(closed,resolved)").in("snag_events.event_type", ["status_change", "triage"]).order("created_at", { referencedTable: "snag_events", ascending: false }).order("id", { referencedTable: "snag_events", ascending: false }).limit(1, { referencedTable: "snag_events" }));
    }),
    source("handovers", "Handover eligibility", !register && (internal || viewer.role === "developer_representative"), async () => {
      const unitIds = input.units.filter(u => u.sale_status === "completed").map(u => u.id);
      input.handovers = await byIds("handovers", "id,unit_id", "unit_id", unitIds);
    }),
    source("rentals", "Rental position", internal, async () => {
      input.tenancies = await rows("unit_tenancies", "id,building_id,unit_id,tenancy_start_date,fixed_term_end_date,tenancy_end_date,created_at", q => q.in("building_id", ids));
    }),
    source("access", "Pending resident access", !register && viewer.role === "admin", async () => {
      input.accessRequests = await rows("resident_access_requests", "id,created_at,requested_units", q => q.eq("status", "pending"));
    }),
  ]);
  async function byIds<T>(table: string, columns: string, column: string, values: string[], filter?: (query: ReadQuery) => ReadQuery) {
    const all: T[] = [];
    for (let start = 0; start < values.length; start += 150) {
      all.push(...await rows<T>(table, columns, q => { const scoped = q.in(column, values.slice(start, start + 150)); return filter ? filter(scoped) : scoped; }));
      if (all.length > DASHBOARD_SOURCE_LIMIT) throw new Error("Related source exceeds the bounded dashboard read.");
    }
    return all;
  }
  const salesIds = input.sales.map(s => s.id);
  await Promise.all([
    source("legal", "Authorities and completion documents", canOpenSalesPipeline(viewer.role), async () => {
      if (input.sources.find(s => s.key === "sales")?.state !== "ready") throw new Error("Sales source unavailable.");
      const [documents, authorities, deposits, depositSources] = await Promise.all([
        byIds<DashboardInput["documents"][number]>("unit_sale_documents", "id,sale_attempt_id,document_type,status,query_note,approved_version_id,approved_at,updated_at,updated_by_user_id,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current,redacted_at,uploaded_at)", "sale_attempt_id", salesIds, q => q.is("redacted_at", null).is("superseded_at", null).in("document_type", ["completion_statement", "draft_statement_of_account", "completion_correspondence"]).eq("unit_sale_document_versions.is_current", true).is("unit_sale_document_versions.redacted_at", null)),
        byIds<DashboardInput["authorities"][number]>("sale_legal_emails", "id,sale_attempt_id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,resend_message_id", "sale_attempt_id", salesIds),
        register ? [] : byIds<DashboardInput["deposits"][number]>("sale_exchange_deposit_receipts", "id,sale_attempt_id,source_id,expected_amount,received_amount", "sale_attempt_id", salesIds),
        register ? [] : byIds<DashboardInput["depositSources"][number]>("sale_exchange_deposit_sources", "id,sale_attempt_id,source_kind,expected_amount", "sale_attempt_id", salesIds),
      ]);
      Object.assign(input, { documents, authorities, deposits, depositSources });
    }),
    source("history", "Recent sales business activity", !register && canOpenSalesPipeline(viewer.role), async () => {
      if (input.sources.find(s => s.key === "sales")?.state !== "ready") throw new Error("Sales source unavailable.");
      const events: DashboardInput["saleEvents"] = [];
      const actors: NonNullable<DashboardInput["saleActors"]> = [];
      for (let start = 0; start < salesIds.length; start += 150) {
        const [result, names] = await Promise.all([client.rpc("sale_workflow_context", { p_sales: salesIds.slice(start, start + 150) }), client.rpc("sale_actor_names", { p_sales: salesIds.slice(start, start + 150) })]);
        if (result.error) throw result.error;
        if (names.error) throw names.error;
        actors.push(...names.data ?? []);
        events.push(...result.data ?? []);
      }
      input.saleEvents = events; input.saleActors = actors;
    }),
    source("fees", "Agent invoice position", internal, async () => {
      if (input.sources.find(s => s.key === "sales")?.state !== "ready") throw new Error("Sales source unavailable.");
      const [invoices, payments, terms] = await Promise.all([
        byIds<DashboardInput["invoices"][number]>("unit_sale_invoices", "id,sale_attempt_id,status,fee_milestone,gross_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction,approved_at,created_at", "sale_attempt_id", salesIds),
        byIds<DashboardInput["payments"][number]>("unit_sale_invoice_payments", "id,invoice_id,amount,voided_at", "sale_attempt_id", salesIds),
        byIds<DashboardInput["terms"][number]>("unit_sale_terms", "id,sale_attempt_id,contract_price,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate", "sale_attempt_id", salesIds, q => q.eq("is_current", true)),
      ]);
      Object.assign(input, { invoices, payments, terms });
    }),
    source("rent_risk", "Reported rental arrears", internal, async () => {
      if (input.sources.find(s => s.key === "rentals")?.state !== "ready") throw new Error("Rental source unavailable.");
      const [arrears, rentalImports] = await Promise.all([
        byIds<DashboardInput["arrears"][number]>("rental_arrears_episodes", "id,tenancy_id,first_reported_at,last_reported_at,cleared_at,initial_reported_amount,maximum_reported_amount,latest_reported_amount,status,intervention_level,owner_action_required,resolution_basis,management_summary", "tenancy_id", input.tenancies.map(t => t.id), q => q.eq("attribution_status", "matched")),
        rows<DashboardInput["rentalImports"][number]>("rental_import_runs", "id,building_id,status,data_as_of,started_at,completed_at,error_count,data_quality_issue_count", q => q.in("building_id", ids)),
      ]);
      Object.assign(input, { arrears, rentalImports });
    }),
  ]);
  return input;
}
