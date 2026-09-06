import {
  calculateMilestoneFee,
  deriveInvoicePaymentPosition,
  type AgentFeeMilestone,
  type AgentFeePayment,
} from "./agent-fees.ts";
import { isSalesRouteStatus } from "../units/commercial-allocation.ts";

export type AgentFeePortfolioInvoice = {
  id: string;
  status: string;
  approved_at?: string | null;
  gross_amount?: number | null;
  expected_payable_amount?: number | null;
  reservation_fee_deduction?: number | null;
  agent_contribution_deduction?: number | null;
};

export type AgentFeePortfolioInput = {
  saleAttemptId: string;
  buildingId: string;
  buildingName: string;
  unitId: string;
  unitNumber: string;
  unitSaleStatus: string;
  workflowStatus: string;
  agentOrganisationId?: string | null;
  agentName?: string | null;
  salePrice?: number | null;
  exchangeFeePercent?: number | null;
  completionFeePercent?: number | null;
  vatRate?: number | null;
  exchangeInvoice?: AgentFeePortfolioInvoice | null;
  completionInvoice?: AgentFeePortfolioInvoice | null;
  exchangePayments?: AgentFeePayment[] | null;
  completionPayments?: AgentFeePayment[] | null;
};

export type AgentFeePortfolioInvoiceKind =
  | "not_submitted"
  | "not_due"
  | "invoice_required"
  | "awaiting_approval"
  | "rejected"
  | "approved_unpaid"
  | "part_paid"
  | "paid";

export type AgentFeePortfolioStatus = "needs_attention" | "up_to_date" | "complete";
export type AgentFeePortfolioStatusFilter =
  | "all"
  | "needs_attention"
  | "awaiting_approval"
  | "outstanding_payment"
  | "invoice_required"
  | "rejected"
  | "up_to_date"
  | "complete";
export type AgentFeePortfolioMilestoneFilter = "all" | AgentFeeMilestone;

export type AgentFeePortfolioInvoiceState = {
  milestone: AgentFeeMilestone;
  kind: AgentFeePortfolioInvoiceKind;
  outstandingBalance: number;
  needsAction: boolean;
  isRelevant: boolean;
};

export type AgentFeePortfolioRow = {
  saleAttemptId: string;
  buildingId: string;
  buildingName: string;
  unitId: string;
  unitNumber: string;
  agentOrganisationId: string | null;
  agentName: string;
  salePrice: number;
  exchange: AgentFeePortfolioInvoiceState;
  completion: AgentFeePortfolioInvoiceState;
  currentOutstanding: number;
  futureCompletionFeeNet: number;
  overallStatus: AgentFeePortfolioStatus;
  noLongerForSale: boolean;
};

const exchangeInvoiceDueStatuses = new Set([
  "approved",
  "reservation_approved",
  "awaiting_commercial_approval",
  "ready_for_exchange",
  "exchanged",
  "completion_pending",
  "completed",
]);
const completionInvoiceDueStatuses = new Set(["exchanged", "completion_pending", "completed"]);
const approvedInvoiceStatuses = new Set(["approved", "part_paid", "paid", "reconciled"]);

function numeric(value?: number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invoiceCashPayable(invoice: AgentFeePortfolioInvoice) {
  if (invoice.expected_payable_amount !== null && invoice.expected_payable_amount !== undefined) {
    return numeric(invoice.expected_payable_amount);
  }
  return Math.max(
    0,
    numeric(invoice.gross_amount)
      - numeric(invoice.reservation_fee_deduction)
      - numeric(invoice.agent_contribution_deduction),
  );
}

function derivePortfolioInvoiceState(input: {
  milestone: AgentFeeMilestone;
  workflowStatus: string;
  expectedGrossAmount: number;
  invoice?: AgentFeePortfolioInvoice | null;
  payments?: AgentFeePayment[] | null;
}): AgentFeePortfolioInvoiceState {
  const due = input.milestone === "exchange"
    ? exchangeInvoiceDueStatuses.has(input.workflowStatus)
    : completionInvoiceDueStatuses.has(input.workflowStatus);
  const feeExpected = input.expectedGrossAmount > 0;
  const isRelevant = feeExpected && (due || Boolean(input.invoice));

  if (!input.invoice) {
    if (input.milestone === "completion" && (!due || !feeExpected)) {
      return { milestone: input.milestone, kind: "not_due", outstandingBalance: 0, needsAction: false, isRelevant };
    }
    if (input.milestone === "completion") {
      return { milestone: input.milestone, kind: "invoice_required", outstandingBalance: 0, needsAction: true, isRelevant };
    }
    return {
      milestone: input.milestone,
      kind: "not_submitted",
      outstandingBalance: 0,
      needsAction: due && feeExpected,
      isRelevant,
    };
  }

  if (input.invoice.status === "query_raised") {
    return { milestone: input.milestone, kind: "rejected", outstandingBalance: 0, needsAction: true, isRelevant: true };
  }

  const approved = Boolean(input.invoice.approved_at) || approvedInvoiceStatuses.has(input.invoice.status);
  if (!approved) {
    return {
      milestone: input.milestone,
      kind: "awaiting_approval",
      outstandingBalance: invoiceCashPayable(input.invoice),
      needsAction: true,
      isRelevant: true,
    };
  }

  const position = deriveInvoicePaymentPosition({
    cashAmountPayable: invoiceCashPayable(input.invoice),
    reservationFeeHeld: input.invoice.reservation_fee_deduction,
    payments: input.payments,
  });
  if (position.paymentStatus === "Paid") {
    return { milestone: input.milestone, kind: "paid", outstandingBalance: 0, needsAction: false, isRelevant: true };
  }
  if (position.paymentStatus === "Part paid") {
    return {
      milestone: input.milestone,
      kind: "part_paid",
      outstandingBalance: position.outstandingBalance,
      needsAction: true,
      isRelevant: true,
    };
  }
  return {
    milestone: input.milestone,
    kind: "approved_unpaid",
    outstandingBalance: position.outstandingBalance,
    needsAction: true,
    isRelevant: true,
  };
}

export function deriveAgentFeePortfolioRow(input: AgentFeePortfolioInput): AgentFeePortfolioRow {
  const onSalesRoute = isSalesRouteStatus(input.unitSaleStatus);
  const salePrice = numeric(input.salePrice);
  const vatRate = numeric(input.vatRate ?? 20);
  const exchangeExpected = calculateMilestoneFee({ salePrice, feePercent: input.exchangeFeePercent, vatRate });
  const completionExpected = calculateMilestoneFee({ salePrice, feePercent: input.completionFeePercent, vatRate });
  const exchange = derivePortfolioInvoiceState({
    milestone: "exchange",
    workflowStatus: input.workflowStatus,
    expectedGrossAmount: onSalesRoute ? exchangeExpected.grossAmount : 0,
    invoice: input.exchangeInvoice,
    payments: input.exchangePayments,
  });
  const completion = derivePortfolioInvoiceState({
    milestone: "completion",
    workflowStatus: input.workflowStatus,
    expectedGrossAmount: onSalesRoute ? completionExpected.grossAmount : 0,
    invoice: input.completionInvoice,
    payments: input.completionPayments,
  });
  const currentOutstanding = exchange.outstandingBalance + completion.outstandingBalance;
  const needsAttention = exchange.needsAction || completion.needsAction;
  const legalJourneyComplete = input.workflowStatus === "completed"
    || input.unitSaleStatus === "completed"
    || input.unitSaleStatus === "handed_over";
  const exchangeSettled = exchangeExpected.grossAmount <= 0 || exchange.kind === "paid";
  const completionSettled = completionExpected.grossAmount <= 0 || completion.kind === "paid";
  const overallStatus: AgentFeePortfolioStatus = needsAttention
    ? "needs_attention"
    : legalJourneyComplete && exchangeSettled && completionSettled
      ? "complete"
      : "up_to_date";

  return {
    saleAttemptId: input.saleAttemptId,
    buildingId: input.buildingId,
    buildingName: input.buildingName,
    unitId: input.unitId,
    unitNumber: input.unitNumber,
    agentOrganisationId: input.agentOrganisationId ?? null,
    agentName: input.agentName?.trim() || "Unassigned",
    salePrice,
    exchange,
    completion,
    currentOutstanding,
    futureCompletionFeeNet: onSalesRoute && !input.completionInvoice ? completionExpected.netAmount : 0,
    overallStatus,
    noLongerForSale: !onSalesRoute,
  };
}

function milestoneStates(row: AgentFeePortfolioRow, milestone: AgentFeePortfolioMilestoneFilter) {
  if (milestone === "exchange") return [row.exchange];
  if (milestone === "completion") return [row.completion];
  return [row.exchange, row.completion];
}

export function filterAgentFeePortfolioRows(
  rows: AgentFeePortfolioRow[],
  filters: {
    buildingId?: string | null;
    agentOrganisationId?: string | null;
    status?: AgentFeePortfolioStatusFilter;
    milestone?: AgentFeePortfolioMilestoneFilter;
  },
) {
  const milestone = filters.milestone ?? "all";
  const status = filters.status ?? "all";
  return rows.filter((row) => {
    if (filters.buildingId && row.buildingId !== filters.buildingId) return false;
    if (filters.agentOrganisationId) {
      const rowAgent = row.agentOrganisationId ?? "unassigned";
      if (rowAgent !== filters.agentOrganisationId) return false;
    }
    const states = milestoneStates(row, milestone);
    if (milestone !== "all" && !states.some((state) => state.isRelevant)) return false;
    if (status === "all") return true;
    if (status === "needs_attention") return milestone === "all" ? row.overallStatus === "needs_attention" : states.some((state) => state.needsAction);
    if (status === "awaiting_approval") return states.some((state) => state.kind === "awaiting_approval");
    if (status === "outstanding_payment") return states.some((state) => state.kind === "approved_unpaid" || state.kind === "part_paid");
    if (status === "invoice_required") return states.some((state) => state.kind === "invoice_required" || (state.kind === "not_submitted" && state.needsAction));
    if (status === "rejected") return states.some((state) => state.kind === "rejected");
    return row.overallStatus === status;
  });
}

export function summariseAgentFeePortfolio(rows: AgentFeePortfolioRow[]) {
  return rows.reduce((summary, row) => {
    if (row.overallStatus === "needs_attention") summary.needsAttentionSales += 1;
    summary.awaitingApprovalInvoices += [row.exchange, row.completion]
      .filter((invoice) => invoice.kind === "awaiting_approval").length;
    summary.outstandingPayments += row.currentOutstanding;
    summary.futureCompletionFeesNet += row.futureCompletionFeeNet;
    return summary;
  }, {
    needsAttentionSales: 0,
    awaitingApprovalInvoices: 0,
    outstandingPayments: 0,
    futureCompletionFeesNet: 0,
  });
}
