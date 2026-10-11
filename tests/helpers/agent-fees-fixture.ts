import type { Page } from "@playwright/test";
import { developerSalesFixture } from "./developer-sales-fixture";

export async function agentFeesFixture(page: Page) {
  const f = await developerSalesFixture(page);
  f.rows.unit_sale_invoices = []; f.rows.unit_sale_invoice_payments = [];
  const unappointedBuilding = "10000000-0000-4000-8000-000000000003";
  f.rows.buildings.push({ ...f.rows.buildings[0], id: unappointedBuilding, name: "Unappointed fee house", sales_agent_organisation_id: null });
  f.rows.user_building_access.push({ user_id: f.profile.id, building_id: unappointedBuilding });
  // 24 sales: many agent submissions, four approved balances, two reviews,
  // one sale in both developer categories, and two actionable milestones.
  for (let index = 0; index < 24; index++) {
    const id = String(index + 1).padStart(12, "0");
    let unit = f.rows.units.find(u => u.unit_number === String(101 + index));
    if (!unit) { unit = { ...f.unit, id: `20000000-0000-4000-8000-${id}`, unit_number: String(101 + index), floor: "First" }; f.rows.units.push(unit); }
    unit.sale_status = "exchanged";
    let sale = f.rows.unit_sale_attempts.find(s => s.unit_id === unit.id);
    if (!sale) { sale = { ...f.attempt, id: `40000000-0000-4000-8000-${id}`, unit_id: unit.id }; f.rows.unit_sale_attempts.push(sale); }
    // Blank legacy assignments must not unallocate an appointed building.
    Object.assign(sale, { workflow_status: "exchanged", sales_agent_organisation_id: null, reservation_approved_at: "2026-09-02T12:00:00Z" });
    if (index === 23) { unit.building_id = unappointedBuilding; sale.building_id = unappointedBuilding; }
    f.rows.unit_sale_terms = f.rows.unit_sale_terms.filter(t => t.sale_attempt_id !== sale!.id);
    f.rows.unit_sale_terms.push({id: `fee-terms-${index}`, sale_attempt_id: sale.id, is_current: true, contract_price: 250000, exchange_agent_fee_percent: 1, completion_agent_fee_percent: 1, agent_fee_percent: 2, vat_rate: 20});
    if (index < 4 || index === 4) {
      f.rows.unit_sale_invoices.push({ id: `fee-exchange-${index}`, sale_attempt_id: sale.id, invoice_type: "sales_agent", fee_milestone: "exchange", status: index === 4 ? "uploaded" : "approved", approved_at: index === 4 ? null : "2026-10-01T12:00:00Z", created_at: "2026-09-30T12:00:00Z", gross_amount: 3000, expected_payable_amount: 3000, reservation_fee_deduction: 0, agent_contribution_deduction: 0 });
    }
    if (index === 0) f.rows.unit_sale_invoices.push({ id: "fee-completion-0", sale_attempt_id: sale.id, invoice_type: "sales_agent", fee_milestone: "completion", status: "uploaded", approved_at: null, created_at: "2026-10-01T12:00:00Z", gross_amount: 3000, expected_payable_amount: 3000 });
    if (index === 1) f.rows.unit_sale_invoice_payments.push({id:"part-payment",invoice_id:"fee-exchange-1",payer_type:"developer",payment_source:"bank_transfer",amount:1000,voided_at:null});
  }
  const portfolio = () => f.rows.unit_sale_attempts.map(sale => {
    const unit = f.rows.units.find(u => u.id === sale.unit_id)!;
    const terms = f.rows.unit_sale_terms.find(t => t.sale_attempt_id === sale.id)!;
    const invoice = (milestone: string) => f.rows.unit_sale_invoices.filter(i => i.sale_attempt_id === sale.id && i.fee_milestone === milestone && !["superseded","redacted"].includes(String(i.status))).at(-1) ?? null;
    const exchange = invoice("exchange"), completion = invoice("completion");
    return { sale_attempt_id:sale.id, building_id:unit.building_id, building_name:f.rows.buildings.find(b=>b.id===unit.building_id)?.name,
      unit_id:unit.id,unit_number:unit.unit_number,unit_sale_status:unit.sale_status,workflow_status:sale.workflow_status,
      sales_agent_organisation_id:sale.sales_agent_organisation_id,sales_agent_name:sale.sales_agent_organisation_id ? "Synthetic Agency" : null,
      contract_price:terms.contract_price,exchange_fee_percent:terms.exchange_agent_fee_percent,completion_fee_percent:terms.completion_agent_fee_percent,vat_rate:terms.vat_rate,
      exchange_invoice:exchange,completion_invoice:completion,
      exchange_active_payments:f.rows.unit_sale_invoice_payments.filter(p=>p.invoice_id===exchange?.id),
      completion_active_payments:f.rows.unit_sale_invoice_payments.filter(p=>p.invoice_id===completion?.id) };
  });
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio", async route => {
    if (!["developer","admin"].includes(f.profile.role)) return route.fulfill({status:403,json:{code:"42501",message:"Only developers or admins can view the Agent Fees portfolio."}});
    const data = portfolio();
    await f.respond(route,data,{"access-control-expose-headers":"content-range","content-range":`0-${data.length-1}/${data.length}`});
  });
  return {...f,portfolio};
}
