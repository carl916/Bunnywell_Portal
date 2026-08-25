export type AgentFeeMilestone = "exchange" | "completion";
export type AgentFeePayerType = "solicitor" | "developer" | "other";

export type AgentFeeStructureInput = {
  totalFeePercent?: number | null;
  exchangeFeePercent?: number | null;
  completionFeePercent?: number | null;
};

export type AgentFeePayment = {
  payer_type?: string | null;
  payment_source?: string | null;
  amount?: number | null;
  voided_at?: string | null;
};

export type AgentFeeInvoiceSummaryInput = {
  expectedNetAmount?: number | null;
  expectedVatAmount?: number | null;
  expectedGrossAmount?: number | null;
  invoice?: {
    gross_amount?: number | null;
    expected_payable_amount?: number | null;
    reservation_fee_deduction?: number | null;
    agent_contribution_deduction?: number | null;
  } | null;
  payments?: AgentFeePayment[] | null;
};

function finiteNumber(value?: number | null) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toPence(value?: number | null) {
  return Math.round(finiteNumber(value) * 100);
}

export function fromPence(value: number) {
  return value / 100;
}

function percentUnits(value?: number | null) {
  return Math.round(finiteNumber(value) * 10_000);
}

export function validateAgentFeeStructure(input: AgentFeeStructureInput) {
  const total = percentUnits(input.totalFeePercent);
  const exchange = percentUnits(input.exchangeFeePercent);
  const completion = percentUnits(input.completionFeePercent);

  if ([total, exchange, completion].some((value) => value < 0 || value > 1_000_000)) {
    return { isValid: false, error: "Agent fee percentages must be between 0% and 100%." };
  }
  if (exchange + completion !== total) {
    return { isValid: false, error: "Exchange fee plus Completion fee must equal the total agent fee." };
  }
  return { isValid: true, error: null };
}

export function calculateMilestoneFee(input: {
  salePrice?: number | null;
  feePercent?: number | null;
  vatRate?: number | null;
}) {
  const salePricePence = toPence(input.salePrice);
  const feePercentUnits = percentUnits(input.feePercent);
  const vatPercentUnits = percentUnits(input.vatRate ?? 20);
  const netPence = Math.round((salePricePence * feePercentUnits) / 1_000_000);
  const vatPence = Math.round((netPence * vatPercentUnits) / 1_000_000);

  return {
    netAmount: fromPence(netPence),
    vatAmount: fromPence(vatPence),
    grossAmount: fromPence(netPence + vatPence),
  };
}

export function normalisePayerType(payment: AgentFeePayment): AgentFeePayerType {
  if (payment.payer_type === "developer" || payment.payment_source === "developer_shortfall") return "developer";
  if (payment.payer_type === "other" || payment.payment_source === "other") return "other";
  return "solicitor";
}

export function isActiveAgentFeePayment(payment: AgentFeePayment) {
  return !payment.voided_at;
}

export function deriveInvoicePaymentPosition(input: {
  cashAmountPayable?: number | null;
  reservationFeeHeld?: number | null;
  payments?: AgentFeePayment[] | null;
}) {
  const cashAmountPayablePence = toPence(input.cashAmountPayable);
  const reservationFeeHeldPence = toPence(input.reservationFeeHeld);
  const payerPence: Record<AgentFeePayerType, number> = { solicitor: 0, developer: 0, other: 0 };

  for (const payment of input.payments ?? []) {
    if (!isActiveAgentFeePayment(payment) || payment.payment_source === "reservation_fee") continue;
    payerPence[normalisePayerType(payment)] += toPence(payment.amount);
  }

  const cashReceivedPence = payerPence.solicitor + payerPence.developer + payerPence.other;
  const outstandingPence = Math.max(0, cashAmountPayablePence - cashReceivedPence);
  const paymentStatus = outstandingPence === 0 && cashAmountPayablePence > 0
    ? "Paid"
    : cashReceivedPence > 0
      ? "Part paid"
      : "Unpaid";

  return {
    cashAmountPayable: fromPence(cashAmountPayablePence),
    reservationFeeHeld: fromPence(reservationFeeHeldPence),
    solicitorPayments: fromPence(payerPence.solicitor),
    developerPayments: fromPence(payerPence.developer),
    otherPayments: fromPence(payerPence.other),
    cashReceived: fromPence(cashReceivedPence),
    totalReceivedByAgent: fromPence(cashReceivedPence + reservationFeeHeldPence),
    outstandingBalance: fromPence(outstandingPence),
    paymentStatus,
  } as const;
}

/**
 * Sale-level totals deliberately sum the independently rounded milestone
 * values. This keeps the summary identical to the Exchange and Completion
 * cards even when a direct total-percentage calculation differs by a penny.
 */
export function deriveAgentFeeSummary(input: {
  milestones: AgentFeeInvoiceSummaryInput[];
}) {
  let expectedNetPence = 0;
  let expectedVatPence = 0;
  let expectedGrossPence = 0;
  let invoicedGrossPence = 0;
  let reservationCreditsPence = 0;
  let agentContributionCreditsPence = 0;
  let cashPaymentsPence = 0;
  let submittedOutstandingPence = 0;
  let uninvoicedNetPence = 0;
  let uninvoicedGrossPence = 0;

  for (const milestone of input.milestones) {
    expectedNetPence += toPence(milestone.expectedNetAmount);
    expectedVatPence += toPence(milestone.expectedVatAmount);
    expectedGrossPence += toPence(milestone.expectedGrossAmount);

    if (!milestone.invoice) {
      uninvoicedNetPence += toPence(milestone.expectedNetAmount);
      uninvoicedGrossPence += toPence(milestone.expectedGrossAmount);
      continue;
    }

    const reservationCredit = toPence(milestone.invoice.reservation_fee_deduction);
    const contributionCredit = toPence(milestone.invoice.agent_contribution_deduction);
    const cashAmountPayable = milestone.invoice.expected_payable_amount
      ?? fromPence(Math.max(0, toPence(milestone.expectedGrossAmount) - reservationCredit - contributionCredit));
    const position = deriveInvoicePaymentPosition({
      cashAmountPayable,
      reservationFeeHeld: milestone.invoice.reservation_fee_deduction,
      payments: milestone.payments,
    });

    invoicedGrossPence += toPence(milestone.invoice.gross_amount);
    reservationCreditsPence += reservationCredit;
    agentContributionCreditsPence += contributionCredit;
    cashPaymentsPence += toPence(position.cashReceived);
    submittedOutstandingPence += toPence(position.outstandingBalance);
  }

  const totalCreditsPence = reservationCreditsPence + agentContributionCreditsPence;

  return {
    expectedNetAmount: fromPence(expectedNetPence),
    expectedVatAmount: fromPence(expectedVatPence),
    expectedGrossAmount: fromPence(expectedGrossPence),
    invoicedGrossAmount: fromPence(invoicedGrossPence),
    reservationCredits: fromPence(reservationCreditsPence),
    agentContributionCredits: fromPence(agentContributionCreditsPence),
    totalCredits: fromPence(totalCreditsPence),
    cashPayments: fromPence(cashPaymentsPence),
    totalPaidOrCredited: fromPence(totalCreditsPence + cashPaymentsPence),
    submittedInvoiceOutstanding: fromPence(submittedOutstandingPence),
    uninvoicedNetAmount: fromPence(uninvoicedNetPence),
    uninvoicedGrossAmount: fromPence(uninvoicedGrossPence),
  };
}
