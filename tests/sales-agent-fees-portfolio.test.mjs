import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveAgentFeePortfolioRow,
  filterAgentFeePortfolioRows,
  summariseAgentFeePortfolio,
} from "../src/lib/sales/agent-fees-portfolio.ts";
import { canPerformSalesAction } from "../src/lib/sales/permissions.ts";

const componentSource = readFileSync("src/components/portal/sales/AgentFeesPortfolio.tsx", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260825c_agent_fee_portfolio.sql", "utf8");

function portfolioInput(overrides = {}) {
  return {
    saleAttemptId: "sale-1",
    buildingId: "building-1",
    buildingName: "Forum House",
    unitId: "unit-1",
    unitNumber: "101",
    unitSaleStatus: "reserved",
    workflowStatus: "reservation_approved",
    agentOrganisationId: "agent-1",
    agentName: "Bunnywell Sales",
    salePrice: 100_000,
    exchangeFeePercent: 10,
    completionFeePercent: 1,
    vatRate: 20,
    ...overrides,
  };
}

function invoice(id, expectedPayableAmount, overrides = {}) {
  return {
    id,
    status: "approved",
    approved_at: "2026-08-25T09:00:00Z",
    gross_amount: expectedPayableAmount,
    expected_payable_amount: expectedPayableAmount,
    reservation_fee_deduction: 0,
    agent_contribution_deduction: 0,
    ...overrides,
  };
}

test("Exchange invoice Paid is one combined portfolio status", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 12_000 }],
  }));
  assert.equal(row.exchange.kind, "paid");
  assert.match(componentSource, /return "Paid"/);
  assert.doesNotMatch(componentSource, /Exchange payment status/);
});

test("approved unpaid Exchange invoice exposes the correct amount due", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({ exchangeInvoice: invoice("exchange-1", 12_000) }));
  assert.equal(row.exchange.kind, "approved_unpaid");
  assert.equal(row.exchange.outstandingBalance, 12_000);
});

test("part-paid Exchange invoice exposes only the remaining amount", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 8_000 }],
  }));
  assert.equal(row.exchange.kind, "part_paid");
  assert.equal(row.exchange.outstandingBalance, 4_000);
});

test("Completion invoice uses the same combined invoice and payment state", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    workflowStatus: "exchanged",
    unitSaleStatus: "exchanged",
    completionInvoice: invoice("completion-1", 1_200),
    completionPayments: [{ payer_type: "developer", amount: 300 }],
  }));
  assert.equal(row.completion.kind, "part_paid");
  assert.equal(row.completion.outstandingBalance, 900);
});

test("future uninvoiced Completion fee is not current outstanding", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 12_000 }],
  }));
  assert.equal(row.currentOutstanding, 0);
  assert.equal(row.futureCompletionFeeNet, 1_000);
});

test("current outstanding sums approved balances across both milestones", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    workflowStatus: "exchanged",
    unitSaleStatus: "exchanged",
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 10_000 }],
    completionInvoice: invoice("completion-1", 1_200),
    completionPayments: [{ payer_type: "developer", amount: 300 }],
  }));
  assert.equal(row.currentOutstanding, 2_900);
});

test("current outstanding includes submitted invoices awaiting approval", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    workflowStatus: "exchanged",
    exchangeInvoice: invoice("exchange-1", 12_000, { status: "uploaded", approved_at: null }),
    completionInvoice: invoice("completion-1", 1_200, { status: "under_review", approved_at: null }),
  }));
  assert.equal(row.currentOutstanding, 13_200);
});

test("voided payments are excluded through the shared active-payment helper", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [
      { payer_type: "solicitor", amount: 12_000, voided_at: "2026-08-25T10:00:00Z" },
      { payer_type: "solicitor", amount: 8_000, voided_at: null },
    ],
  }));
  assert.equal(row.exchange.kind, "part_paid");
  assert.equal(row.exchange.outstandingBalance, 4_000);
  assert.match(migrationSource, /payment\.voided_at is null/g);
});

test("historical rejected or superseded invoices cannot create duplicate balances", () => {
  assert.match(migrationSource, /invoice\.status not in \('superseded', 'redacted'\)/);
  assert.match(migrationSource, /order by invoice\.created_at desc\s+limit 1/g);
  assert.equal((migrationSource.match(/fee_milestone = 'exchange'/g) ?? []).length, 1);
  assert.equal((migrationSource.match(/fee_milestone = 'completion'/g) ?? []).length, 1);
});

test("Needs attention is derived from current invoice action", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({ exchangeInvoice: invoice("exchange-1", 12_000) }));
  assert.equal(row.overallStatus, "needs_attention");
});

test("Up to date means no current action while the fee journey remains open", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({ workflowStatus: "draft", unitSaleStatus: "for_sale" }));
  assert.equal(row.overallStatus, "up_to_date");
});

test("Complete requires legal completion and every expected invoice settled", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    workflowStatus: "completed",
    unitSaleStatus: "completed",
    exchangeInvoice: invoice("exchange-1", 12_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 12_000 }],
    completionInvoice: invoice("completion-1", 1_200),
    completionPayments: [{ payer_type: "developer", amount: 1_200 }],
  }));
  assert.equal(row.overallStatus, "complete");
});

test("Awaiting approval summary counts active invoices, not sales", () => {
  const row = deriveAgentFeePortfolioRow(portfolioInput({
    workflowStatus: "exchanged",
    exchangeInvoice: invoice("exchange-1", 12_000, { status: "uploaded", approved_at: null }),
    completionInvoice: invoice("completion-1", 1_200, { status: "under_review", approved_at: null }),
  }));
  assert.equal(summariseAgentFeePortfolio([row]).awaitingApprovalInvoices, 2);
});

test("Outstanding payments summary totals current approved balances", () => {
  const first = deriveAgentFeePortfolioRow(portfolioInput({ exchangeInvoice: invoice("exchange-1", 12_000) }));
  const second = deriveAgentFeePortfolioRow(portfolioInput({
    saleAttemptId: "sale-2",
    unitId: "unit-2",
    unitNumber: "102",
    exchangeInvoice: invoice("exchange-2", 6_000),
    exchangePayments: [{ payer_type: "solicitor", amount: 1_000 }],
  }));
  assert.equal(summariseAgentFeePortfolio([first, second]).outstandingPayments, 17_000);
});

test("Future completion fees exclude sales with a current Completion invoice", () => {
  const uninvoiced = deriveAgentFeePortfolioRow(portfolioInput());
  const invoiced = deriveAgentFeePortfolioRow(portfolioInput({
    saleAttemptId: "sale-2",
    completionInvoice: invoice("completion-2", 1_200, { status: "uploaded", approved_at: null }),
  }));
  assert.equal(summariseAgentFeePortfolio([uninvoiced, invoiced]).futureCompletionFeesNet, 1_000);
});

test("Building filter returns only the selected building", () => {
  const first = deriveAgentFeePortfolioRow(portfolioInput());
  const second = deriveAgentFeePortfolioRow(portfolioInput({ saleAttemptId: "sale-2", unitId: "unit-2", buildingId: "building-2", buildingName: "Mill House" }));
  assert.deepEqual(filterAgentFeePortfolioRows([first, second], { buildingId: "building-2" }).map((row) => row.saleAttemptId), ["sale-2"]);
});

test("Agent filter includes assigned and unassigned positions", () => {
  const assigned = deriveAgentFeePortfolioRow(portfolioInput());
  const unassigned = deriveAgentFeePortfolioRow(portfolioInput({ saleAttemptId: "sale-2", unitId: "unit-2", agentOrganisationId: null, agentName: null }));
  assert.deepEqual(filterAgentFeePortfolioRows([assigned, unassigned], { agentOrganisationId: "agent-1" }).map((row) => row.saleAttemptId), ["sale-1"]);
  assert.deepEqual(filterAgentFeePortfolioRows([assigned, unassigned], { agentOrganisationId: "unassigned" }).map((row) => row.saleAttemptId), ["sale-2"]);
});

test("Status filter uses the central derived portfolio status", () => {
  const attention = deriveAgentFeePortfolioRow(portfolioInput({ exchangeInvoice: invoice("exchange-1", 12_000) }));
  const current = deriveAgentFeePortfolioRow(portfolioInput({ saleAttemptId: "sale-2", unitId: "unit-2", workflowStatus: "draft", unitSaleStatus: "for_sale" }));
  assert.deepEqual(filterAgentFeePortfolioRows([attention, current], { status: "needs_attention" }).map((row) => row.saleAttemptId), ["sale-1"]);
  assert.deepEqual(filterAgentFeePortfolioRows([attention, current], { status: "up_to_date" }).map((row) => row.saleAttemptId), ["sale-2"]);
});

test("Milestone filter selects sales with a relevant milestone position", () => {
  const exchange = deriveAgentFeePortfolioRow(portfolioInput());
  const completion = deriveAgentFeePortfolioRow(portfolioInput({ saleAttemptId: "sale-2", unitId: "unit-2", workflowStatus: "exchanged", unitSaleStatus: "exchanged" }));
  assert.deepEqual(filterAgentFeePortfolioRows([exchange, completion], { milestone: "completion" }).map((row) => row.saleAttemptId), ["sale-2"]);
  assert.deepEqual(filterAgentFeePortfolioRows([exchange, completion], { milestone: "exchange" }).map((row) => row.saleAttemptId), ["sale-1", "sale-2"]);
});

test("portfolio access is developer/admin-only and building scoped in the RPC", () => {
  assert.equal(canPerformSalesAction("developer", "view_agent_fees_portfolio"), true);
  assert.equal(canPerformSalesAction("admin", "view_agent_fees_portfolio"), true);
  assert.equal(canPerformSalesAction("sales_agent", "view_agent_fees_portfolio"), false);
  assert.equal(canPerformSalesAction("conveyancer", "view_agent_fees_portfolio"), false);
  assert.match(migrationSource, /not in \('admin', 'developer'\)/);
  assert.match(migrationSource, /public\.can_access_sales_building\(attempt\.building_id\)/);
  assert.match(componentSource, /get_agent_fee_portfolio/);
});

test("clicking a portfolio row opens the matching unit Agent Fees workspace", () => {
  assert.match(componentSource, /onClick=\{\(\) => onOpenSale\(row\.unitId, row\.buildingId\)\}/);
  assert.match(workflowSource, /openSaleFile\(nextUnitId, nextBuildingId, true\)/);
  assert.match(workflowSource, /section: focusAgentFees \? "financials" : "progression"/);
  assert.match(workflowSource, /hash: focusAgentFees \? "exchange-fee" : null/);
  assert.match(workflowSource, /scrollToPortalSection\(`\$\{milestone\}-fee`\)/);
});
