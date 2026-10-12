import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardInput } from "../dashboard/types";
import { isSalesRouteStatus } from "../units/commercial-allocation";
import { deriveAgentFeePortfolioRow, type AgentFeePortfolioInvoice, type AgentFeePortfolioRow } from "./agent-fees-portfolio";
import type { AgentFeePayment } from "./agent-fees";
import { buildingSalesResponsibility, type SalesAppointment } from "./responsibility";

export type FeePortfolioRecord = {
  sale_attempt_id: string; building_id: string; building_name: string; unit_id: string; unit_number: string;
  unit_sale_status: string; workflow_status: string;
  contract_price: number | null; exchange_fee_percent: number | null; completion_fee_percent: number | null; vat_rate: number | null;
  exchange_invoice: AgentFeePortfolioInvoice | null; completion_invoice: AgentFeePortfolioInvoice | null;
  exchange_active_payments: AgentFeePayment[]; completion_active_payments: AgentFeePayment[];
};
type AppointmentBuilding = SalesAppointment & { id: string };

export function deriveFeePortfolio(records: FeePortfolioRecord[], buildings: readonly AppointmentBuilding[], organisations: readonly { id: string; name: string }[]) {
  const ids = new Set<string>();
  const byBuilding = new Map(buildings.map(building => [building.id, building]));
  return records.map(row => {
    // Same completeness contract for the RPC and already-loaded Sales inputs.
    if (!row.sale_attempt_id || ids.has(row.sale_attempt_id) || !row.unit_id || !row.building_id ||
      [row.contract_price, row.exchange_fee_percent, row.completion_fee_percent, row.vat_rate].some(n => n === null || n === undefined || !Number.isFinite(Number(n))) ||
      row.exchange_invoice === undefined || row.completion_invoice === undefined ||
      !Array.isArray(row.exchange_active_payments) || !Array.isArray(row.completion_active_payments) ||
      [...(row.exchange_active_payments ?? []), ...(row.completion_active_payments ?? [])].some(payment =>
        payment.payment_source === undefined || payment.payer_type === undefined || payment.amount == null || !Number.isFinite(Number(payment.amount))))
      throw new Error("Agent Fees data is incomplete. A sale is missing fee terms or payment inputs.");
    ids.add(row.sale_attempt_id);
    const owner = buildingSalesResponsibility(byBuilding.get(row.building_id), "sales_agent", organisations);
    if (owner.allocation === "unavailable") throw new Error("Agent Fees data is incomplete. Building appointments are unavailable.");
    return deriveAgentFeePortfolioRow({
      saleAttemptId: row.sale_attempt_id, buildingId: row.building_id, buildingName: row.building_name, unitId: row.unit_id, unitNumber: row.unit_number,
      unitSaleStatus: row.unit_sale_status, workflowStatus: row.workflow_status, agentOrganisationId: owner.organisationId, agentName: owner.label,
      salePrice: row.contract_price, exchangeFeePercent: row.exchange_fee_percent, completionFeePercent: row.completion_fee_percent, vatRate: row.vat_rate,
      exchangeInvoice: row.exchange_invoice, completionInvoice: row.completion_invoice,
      exchangePayments: row.exchange_active_payments, completionPayments: row.completion_active_payments,
    });
  });
}

/** Caller JWT; the deployed RPC owns portfolio/invoice eligibility and terms fallback.
 * Validate the complete response before applying the selected building scope.
 */
export async function readAgentFeePortfolio(client: SupabaseClient, requesterId: string,
  buildings: readonly AppointmentBuilding[], organisations: readonly { id: string; name: string }[], buildingId = ""): Promise<AgentFeePortfolioRow[]> {
  const { data, error, count } = await client.rpc("get_agent_fee_portfolio", { p_requester_id: requesterId }, { count: "exact" });
  if (error) throw error;
  if (!Array.isArray(data) || count === null || count !== data.length)
    throw new Error("Agent Fees data is incomplete. Retry before treating the workload as clear.");
  return deriveFeePortfolio(data as FeePortfolioRecord[], buildings, organisations).filter(row => !buildingId || row.buildingId === buildingId);
}

/** Adapter for the Sales workspace's existing complete reads; no second fee fetch.
 * Mirrors get_agent_fee_portfolio (20260828): active Sales-route attempts OR a
 * current eligible sales-agent invoice; latest current terms, then latest version.
 * Its SQL parity is exercised by isolated portfolio tests.
 */
export function feePortfolioFromSales(input: Pick<DashboardInput, "sales" | "units" | "buildings" | "organisations" | "invoices" | "terms" | "payments">) {
  const units = new Map(input.units.map(unit => [unit.id, unit]));
  const buildings = new Map(input.buildings.map(building => [building.id, building]));
  const records: FeePortfolioRecord[] = [];
  for (const sale of input.sales) {
    const unit = units.get(sale.unit_id), building = buildings.get(sale.building_id);
    if (!unit || !building) continue;
    const invoiceFor = (milestone: string) => input.invoices.filter(invoice => invoice.sale_attempt_id === sale.id &&
      invoice.invoice_type === "sales_agent" && invoice.fee_milestone === milestone && !["superseded", "redacted"].includes(invoice.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const exchange = invoiceFor("exchange"), completion = invoiceFor("completion");
    if (!(sale.is_active && !["fallen_through", "superseded"].includes(sale.workflow_status) && isSalesRouteStatus(unit.sale_status)) && !exchange && !completion) continue;
    const terms = input.terms.filter(term => term.sale_attempt_id === sale.id)
      .sort((a, b) => Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)) || (b.version_number ?? 0) - (a.version_number ?? 0))[0];
    const paymentsFor = (invoice: AgentFeePortfolioInvoice | null) => {
      const payments = input.payments.filter(payment => invoice && payment.invoice_id === invoice.id);
      if (payments.some(payment => payment.payment_source === undefined)) throw new Error("Agent Fees payment sources are incomplete.");
      return payments.filter(payment => !payment.voided_at && payment.payment_source != null && payment.payment_source !== "reservation_fee");
    };
    records.push({ sale_attempt_id: sale.id, building_id: sale.building_id, building_name: building.name, unit_id: unit.id, unit_number: unit.unit_number,
      unit_sale_status: unit.sale_status, workflow_status: sale.workflow_status,
      contract_price: terms?.contract_price ?? null, exchange_fee_percent: terms?.exchange_agent_fee_percent ?? null,
      completion_fee_percent: terms?.completion_agent_fee_percent ?? null, vat_rate: terms?.vat_rate ?? null,
      exchange_invoice: exchange, completion_invoice: completion, exchange_active_payments: paymentsFor(exchange), completion_active_payments: paymentsFor(completion) });
  }
  return deriveFeePortfolio(records, input.buildings, input.organisations);
}
