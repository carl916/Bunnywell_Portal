import type { Page } from "@playwright/test";
import { legalFixture } from "./legal-ui-fixture";

export async function developerSalesFixture(page: Page) {
  const f = await legalFixture(page);
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  Object.assign(f.rows.buildings[0], { sales_agent_organisation_id: "agent-org", conveyancer_organisation_id: "legal-org" });
  f.rows.organisations = [{ id: "agent-org", name: "Synthetic Agency", type: "sales_agent" }, { id: "legal-org", name: "Synthetic Legal", type: "conveyancer" }];
  f.rows.building_floors = [{ id: "floor-ground", building_id: f.unit.building_id, name: "Ground", sort_order: 0 }, { id: "floor-first", building_id: f.unit.building_id, name: "First", sort_order: 1 }];
  f.rows.unit_sale_terms = []; f.rows.unit_sale_documents = []; f.rows.unit_sale_document_versions = [];
  f.rows.unit_sale_invoices = []; f.rows.unit_sale_invoice_payments = [];
  f.rows.sale_legal_emails = f.emails;
  f.rows.sale_exchange_deposit_sources = []; f.rows.sale_exchange_deposit_receipts = [];
  for (let index = 0; index < 18; index++) {
    const unit = index ? { ...f.unit, id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, unit_number: String(101 + index) } : f.unit;
    Object.assign(unit, { sale_status: index === 5 ? "for_sale" : index === 6 ? "completed" : index === 2 || index === 3 ? "exchanged" : "reserved", floor: index >= 12 ? "First" : "Ground" });
    if (index) f.rows.units.push(unit);
    if ([5, 6, 7].includes(index)) continue;
    const attempt = index ? { ...f.attempt, id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, unit_id: unit.id } : f.attempt;
    Object.assign(attempt, { workflow_status: index === 1 ? "reservation_query_raised" : index === 2 || index === 3 ? "exchanged" : index === 4 ? "approved" : "reservation_submitted",
      sales_agent_organisation_id: "agent-org", conveyancer_organisation_id: "legal-org",
      reservation_submitted_at: "2026-09-01T12:00:00Z", reservation_approved_at: index >= 2 && index <= 4 ? "2026-09-02T12:00:00Z" : null,
      commercial_approved_at: index === 2 || index === 3 ? "2026-09-03T12:00:00Z" : null,
      exchanged_at: index === 2 || index === 3 ? "2026-09-04" : null,
      completion_arrangements_confirmed_at: index === 2 || index === 3 ? "2026-09-25T12:00:00Z" : null,
      contractual_completion_date: index === 2 ? "2026-10-06" : index === 3 ? "2026-10-12" : null });
    if (index) f.rows.unit_sale_attempts.push(attempt);
    f.rows.unit_sale_terms.push({ id: `terms-${index}`, sale_attempt_id: attempt.id, is_current: true, contract_price: 250000 + index * 1000,
      list_price_at_offer: 260000, exchange_agent_fee_percent: 1, completion_agent_fee_percent: 1, agent_fee_percent: 2, vat_rate: 20 });
    if (index === 2 || index === 3) {
      for (const type of ["completion_statement", "draft_statement_of_account"]) {
        const id = `${type}-${index}`;
        f.rows.unit_sale_documents.push({ id, sale_attempt_id: attempt.id, document_type: type, status: index === 3 ? "query_raised" : "uploaded", query_note: index === 3 ? "Please revise the current version." : null, updated_at: "2026-10-01T12:00:00Z" });
        f.rows.unit_sale_document_versions.push({ id: `${id}-v2`, document_id: id, version_number: 2, is_current: true, uploaded_at: "2026-10-01T12:00:00Z", file_name: `${id}.pdf` });
      }
      const source = `deposit-${index}`;
      f.rows.sale_exchange_deposit_sources.push({ id: source, sale_attempt_id: attempt.id, source_kind: "executed_authority", expected_amount: 25000 });
      f.rows.sale_exchange_deposit_receipts.push({ id: source, sale_attempt_id: attempt.id, source_id: source, expected_amount: 25000, received_amount: 25000 });
    }
    if (index === 3) f.rows.unit_sale_invoices.push({ id: "approved-invoice", sale_attempt_id: attempt.id, invoice_type: "sales_agent", fee_milestone: "exchange", status: "approved", gross_amount: 3000, expected_payable_amount: 3000, approved_at: "2026-10-01T12:00:00Z", created_at: "2026-09-30T12:00:00Z" });
  }
  return f;
}
