import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { legalFixture } from "./legal-ui-fixture";
import { deriveSalesRegister } from "../../src/lib/sales/register";
const { fixture } = createRequire(__filename)("./dashboard-fixture.mjs");

// Complete multi-unit inventory; the PostgREST fixture applies eq/in filters.
// No request reaches Supabase or a real legal mutation/email handler.
export async function conveyancerFileFixture(page: Page, count = 3) {
  const f = await legalFixture(page);
  f.profile.role = "conveyancer";
  f.profile.organisation_id = "legal-org" as never;
  f.rows.buildings[0].conveyancer_organisation_id = "legal-org";
  f.unit.sale_status = "exchanged";
  Object.assign(f.attempt, { workflow_status: "exchanged", attempt_number: 2, reservation_approved_at: "2026-09-01", commercial_approved_at: "2026-09-01", exchanged_at: "2026-10-01", conveyancer_organisation_id: "legal-org" });
  f.rows.building_floors = [{ building_id: f.unit.building_id, name: "Ground", sort_order: 0 }, { building_id: f.unit.building_id, name: "First", sort_order: 1 }];
  f.rows.building_sale_defaults = [{ building_id: f.unit.building_id, reservation_fee: 2000, exchange_deposit_percent: 10 }];
  f.rows.sale_actor_names = [{ id: f.profile.id, display_name: "Historical Legal Actor" }];
  for (const table of ["unit_sale_terms", "unit_sale_payment_schedule", "unit_sale_invoices", "unit_sale_invoice_payments"]) f.rows[table] = [];
  for (let index = 0; index < count; index++) {
    const unit = index ? { ...f.unit, id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, unit_number: String(101 + index), floor: index % 2 ? "First" : "Ground" } : f.unit;
    const active = index ? { ...f.attempt, id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, unit_id: unit.id, buyer_name: `Buyer ${unit.unit_number}`, buyer_person_name: `Buyer ${unit.unit_number}` } : f.attempt;
    if (index) { f.rows.units.push(unit); f.rows.unit_sale_attempts.push(active); }
    const historical = { ...active, id: `history-${index}`, attempt_number: 1, is_active: false, workflow_status: "fallen_through", fall_through_reason: `Historic buyer ${unit.unit_number} withdrew`, fallen_through_at: "2026-08-03", exchanged_at: null };
    f.rows.unit_sale_attempts.push(historical);
    for (const attempt of [active, historical]) {
      f.rows.unit_sale_terms.push({ ...f.snapshot.terms, id: `terms-${attempt.id}`, sale_attempt_id: attempt.id, is_current: true, status: "approved", contract_price: 262500 + index * 1000, vat_rate: 20, agent_fee_percent: 2, commercial_summary: "Agreed terms and financial schedule." });
      for (const [sequence, stage, amount] of [[1, "exchange", 26250], [2, "completion", 236250]] as const) {
        f.rows.unit_sale_payment_schedule.push({ id: `${stage}-${attempt.id}`, sale_attempt_id: attempt.id, sequence_no: sequence, payment_stage: stage, due_event: stage, expected_amount: amount, label: `${stage} payment` });
      }
      for (const type of ["reservation_form", "completion_statement", "draft_statement_of_account"]) {
        const id = `${type}-${attempt.id}`;
        f.rows.unit_sale_documents.push({ id, sale_attempt_id: attempt.id, document_type: type, status: "uploaded", updated_at: "2026-10-01T12:00:00Z" });
        for (let version = 1; version <= 2; version++) f.rows.unit_sale_document_versions.push({ id: `${id}-v${version}`, document_id: id, version_number: version, is_current: version === 2, file_name: `${unit.unit_number}-${type}-v${version}.pdf`, file_size_bytes: 1024, uploaded_at: "2026-10-01T12:00:00Z", uploaded_by_user_id: f.profile.id, storage_path: `synthetic/${id}/v${version}.pdf` });
      }
      const invoice = { id: `invoice-${attempt.id}`, sale_attempt_id: attempt.id, invoice_type: "sales_agent", fee_milestone: "exchange", status: "approved", invoice_reference: `INV-${index}`, net_amount: 2500, vat_amount: 500, gross_amount: 3000 };
      f.rows.unit_sale_invoices.push(invoice);
      f.rows.unit_sale_invoice_payments.push({ id: `payment-${attempt.id}`, invoice_id: invoice.id, sale_attempt_id: attempt.id, paid_amount: 3000, amount: 3000, paid_at: "2026-10-01", payer_type: "developer" });
    }
  }
  let registerReads = 0;
  await page.route("**/api/sales/register?*", async route => {
    registerReads++;
    const building = new URL(route.request().url()).searchParams.get("building");
    const data = fixture({ viewer: f.profile, buildings: f.rows.buildings, units: f.rows.units, floors: f.rows.building_floors, sales: f.rows.unit_sale_attempts, documents: [], authorities: [] });
    await f.respond(route, deriveSalesRegister({ ...data, buildingId: building === "all" ? "" : building ?? "" }));
  });
  // Scope the legal context just like the real endpoint. Keep the existing POST
  // fixture for mutation tests on the first sale; never call the real handler.
  await page.route("**/api/sales/legal?*", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const sale = new URL(route.request().url()).searchParams.get("sale");
    const attempt = f.rows.unit_sale_attempts.find(row => row.id === sale)!;
    const unit = f.rows.units.find(row => row.id === attempt?.unit_id);
    await f.respond(route, { snapshot: { ...f.snapshot, sale_id: sale, unit_id: unit?.id, plot: unit?.unit_number, buyer: attempt?.buyer_name, terms: f.rows.unit_sale_terms.find(row => row.sale_attempt_id === sale) }, attempt, emails: f.emails, completionPackage: f.completionPackage, deposit: f.deposit,
      documents: f.rows.unit_sale_documents.filter(row => row.sale_attempt_id === sale).map(document => ({ ...document, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter(version => version.document_id === document.id) })), events: f.rows.unit_sale_workflow_events, actors: f.rows.sale_actor_names });
  });
  return { ...f, registerReads: () => registerReads };
}

export const detailedSalesPath = /\/rest\/v1\/(?:building_sale_defaults|unit_sale_(?:attempts|terms|payment_schedule|documents|document_versions|invoices|invoice_payments)|rpc\/sale_actor_names|sale_exchange_deposit_receipts)$/;
