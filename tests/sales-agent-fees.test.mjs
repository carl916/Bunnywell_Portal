import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  calculateMilestoneFee,
  deriveAgentFeeSummary,
  deriveInvoicePaymentPosition,
  validateAgentFeeStructure,
} from "../src/lib/sales/agent-fees.ts";
import { canPerformSalesAction } from "../src/lib/sales/permissions.ts";
import { calculateAgentInvoicePreview } from "../src/lib/sales/commercial-model.ts";

const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const setupSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");
const gbpInputSource = readFileSync("src/components/portal/sales/GbpInput.tsx", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260825_agent_fees_workspace.sql", "utf8");
const coreSchemaSource = readFileSync("supabase/migrations/20260722_sales_pipeline_core_schema.sql", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("Exchange lifecycle completes independently of agent fee payment", () => {
  const recordExchangeBody = functionBody(routeSource, "recordExchange");
  assert.match(recordExchangeBody, /workflow_status: "exchanged"/);
  assert.match(recordExchangeBody, /sale_status: "exchanged"/);
  assert.doesNotMatch(recordExchangeBody, /unit_sale_invoice_payments/);
  assert.match(workflowSource, /status: completionRecorded \? "Completed" : exchangeRecorded \? "Documents required" : "Locked"/);
  assert.doesNotMatch(workflowSource, /label: "Invoice payment"/);
});

test("Agent Fees contains the migrated Exchange invoice and Completion readiness", () => {
  assert.match(workflowSource, /id="agent-fees"/);
  assert.match(workflowSource, />Agent fee summary</);
  assert.match(workflowSource, />Exchange fee</);
  assert.match(workflowSource, />Completion fee</);
  assert.match(workflowSource, /fee_milestone === "exchange"/);
  assert.match(workflowSource, /fee_milestone === "completion"/);
  assert.match(workflowSource, /Its submission, approval and payment do not block Completion\./);
});

test("milestone expected fees use their own percentages", () => {
  const exchange = calculateMilestoneFee({ salePrice: 323_500, feePercent: 9.5, vatRate: 20 });
  const completion = calculateMilestoneFee({ salePrice: 323_500, feePercent: 0.5, vatRate: 20 });

  assert.deepEqual(exchange, { netAmount: 30_732.5, vatAmount: 6_146.5, grossAmount: 36_879 });
  assert.deepEqual(completion, { netAmount: 1_617.5, vatAmount: 323.5, grossAmount: 1_941 });
  assert.equal(exchange.netAmount + completion.netAmount, 32_350);
});

test("fee split validation requires Exchange plus Completion to equal Total", () => {
  assert.equal(validateAgentFeeStructure({ totalFeePercent: 10, exchangeFeePercent: 9.5, completionFeePercent: 0.5 }).isValid, true);
  assert.equal(validateAgentFeeStructure({ totalFeePercent: 10, exchangeFeePercent: 9.5, completionFeePercent: 1 }).isValid, false);
  assert.match(setupSource, /!agentFeeStructure\.isValid/);
  assert.match(migrationSource, /default_exchange_agent_fee_percent \+ default_completion_agent_fee_percent/);
});

test("sale terms snapshot building milestone defaults", () => {
  assert.match(routeSource, /defaults\?\.default_exchange_agent_fee_percent/);
  assert.match(routeSource, /exchange_agent_fee_percent: exchangeAgentFeePercent/);
  assert.match(routeSource, /completion_agent_fee_percent: completionAgentFeePercent/);
  assert.match(routeSource, /save_unit_commercial_model_with_agent_fees/);
  assert.match(migrationSource, /update public\.unit_sale_terms[\s\S]*exchange_agent_fee_percent/);
});

test("payment position derives payer totals and Paid state from persisted rows", () => {
  const first = deriveInvoicePaymentPosition({
    cashAmountPayable: 28_820,
    reservationFeeHeld: 5_000,
    payments: [{ payer_type: "solicitor", amount: 20_000 }],
  });
  assert.equal(first.paymentStatus, "Part paid");
  assert.equal(first.totalReceivedByAgent, 25_000);
  assert.equal(first.outstandingBalance, 8_820);

  const second = deriveInvoicePaymentPosition({
    cashAmountPayable: 28_820,
    reservationFeeHeld: 5_000,
    payments: [
      { payer_type: "solicitor", amount: 20_000 },
      { payer_type: "developer", amount: 8_820 },
    ],
  });
  assert.equal(second.developerPayments, 8_820);
  assert.equal(second.outstandingBalance, 0);
  assert.equal(second.paymentStatus, "Paid");
});

test("the blank next-payment form cannot alter historical totals", () => {
  const persisted = [{ payer_type: "solicitor", amount: 20_000 }];
  const before = deriveInvoicePaymentPosition({ cashAmountPayable: 28_820, reservationFeeHeld: 5_000, payments: persisted });
  const afterClearingForm = deriveInvoicePaymentPosition({ cashAmountPayable: 28_820, reservationFeeHeld: 5_000, payments: persisted });
  assert.deepEqual(afterClearingForm, before);
  assert.match(workflowSource, /payments: activeInvoicePayments/);
  assert.doesNotMatch(workflowSource, /payments:.*solicitorPaymentAmount/);
  assert.match(workflowSource, /setSolicitorPaymentAmount\(""\)/);
});

test("Payment position presents cash due, receipts and outstanding without deducting the reservation fee twice", () => {
  assert.match(workflowSource, />Cash amount due</);
  assert.match(workflowSource, />Payments received</);
  assert.match(workflowSource, />Outstanding</);
  assert.doesNotMatch(workflowSource, />Reservation fee already held</);
  assert.match(workflowSource, /money\(position\.cashAmountPayable\)/);
  assert.match(workflowSource, /money\(position\.cashReceived\)/);
  assert.match(workflowSource, /money\(position\.outstandingBalance\)/);

  const position = deriveInvoicePaymentPosition({
    cashAmountPayable: 46_072,
    reservationFeeHeld: 5_000,
    payments: [{ amount: 44_021 }],
  });
  assert.equal(position.outstandingBalance, 2_051);
});

test("shared financial number styles enable tabular lining figures", () => {
  assert.match(globalStylesSource, /\.numeric-value\s*\{[\s\S]*font-variant-numeric: lining-nums tabular-nums/);
  assert.match(globalStylesSource, /font-feature-settings: "lnum" 1, "tnum" 1/);
  assert.match(gbpInputSource, /gbp-input numeric-value/);
  assert.match(workflowSource, /className="numeric-value"/);
});

test("reservation credit is deducted once from cash due", () => {
  const preview = calculateAgentInvoicePreview({
    contractPrice: 323_500,
    agentFeePercent: 10,
    vatRate: 20,
    reservationFee: 5_000,
    reservationFeeHolder: "sales_agent",
    agentContribution: 5_000,
  });
  assert.equal(preview.grossAmount, 38_820);
  assert.equal(preview.expectedPayableAmount, 28_820);
  assert.equal(preview.expectedPayableAmount + preview.reservationFeeDeduction + preview.agentContributionDeduction, preview.grossAmount);
  assert.match(routeSource, /expected_payable_amount: expected\.expectedPayableAmount/);
  assert.doesNotMatch(functionBody(routeSource, "uploadAgentInvoice"), /invoiceGrossAmount - expected\.reservationFeeDeduction/);
});

test("payments append transactionally and survive client reload", () => {
  const paymentBody = functionBody(routeSource, "recordAgentFeePayment");
  assert.match(paymentBody, /record_unit_sale_invoice_payment/);
  assert.match(migrationSource, /insert into public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /for update/);
  assert.match(migrationSource, /p_amount > v_outstanding/);
  assert.match(migrationSource, /client_reference = p_client_reference/);
  assert.match(migrationSource, /unit_sale_invoice_payments_client_reference_idx/);
  assert.match(migrationSource, /drop policy if exists "commercial admins manage sale invoice payments"/);
  assert.match(workflowSource, /unit_sale_invoice_payments"\)\.select\("\*"\)/);
  assert.match(workflowSource, /await Promise\.all\(\[loadSalesData\(\), reloadPortalData\(\)\]\)/);
});

test("migration preserves existing sales and invoices while classifying legacy invoices as Exchange", () => {
  assert.match(migrationSource, /set fee_milestone = 'exchange'/);
  assert.match(migrationSource, /where invoice_type = 'sales_agent'/);
  assert.doesNotMatch(migrationSource, /delete from public\.unit_sale_invoices/);
  assert.doesNotMatch(migrationSource, /delete from public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /status in \('part_paid', 'paid', 'reconciled'\)/);
});

test("only internal developer/admin roles can create payment records", () => {
  assert.match(migrationSource, /not in \('admin', 'developer'\)/);
  assert.match(coreSchemaSource, /commercial admins manage sale invoice payments/);
  assert.match(coreSchemaSource, /with check \(public\.can_manage_sale_attempt\(sale_attempt_id\)\)/);
  assert.match(paymentBodyForPermission(), /record_agent_fee_payment/);
});

function paymentBodyForPermission() {
  return functionBody(routeSource, "recordAgentFeePayment");
}

test("10 percent total fee is explicitly split 9.5 percent Exchange and 0.5 percent Completion", () => {
  assert.equal(validateAgentFeeStructure({ totalFeePercent: 10, exchangeFeePercent: 9.5, completionFeePercent: 0.5 }).isValid, true);
  assert.match(workflowSource, /previewExchangeAgentFeePercent/);
  assert.match(workflowSource, /previewCompletionAgentFeePercent/);
});

test("Completion expected fee is calculated only from the 0.5 percent tranche", () => {
  assert.deepEqual(
    calculateMilestoneFee({ salePrice: 323_500, feePercent: 0.5, vatRate: 20 }),
    { netAmount: 1_617.5, vatAmount: 323.5, grossAmount: 1_941 },
  );
  const uploadBody = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(uploadBody, /currentTerms\?\.completion_agent_fee_percent/);
});

test("Exchange expected fee continues to use the 9.5 percent tranche", () => {
  assert.deepEqual(
    calculateMilestoneFee({ salePrice: 323_500, feePercent: 9.5, vatRate: 20 }),
    { netAmount: 30_732.5, vatAmount: 6_146.5, grossAmount: 36_879 },
  );
  assert.match(functionBody(routeSource, "uploadAgentInvoice"), /currentTerms\?\.exchange_agent_fee_percent/);
});

test("Completion invoice submission is allowed after Exchange and before or after legal Completion", () => {
  const uploadBody = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(uploadBody, /\["exchanged", "completion_pending", "completed"\]/);
  assert.match(uploadBody, /Record Exchange before uploading the Completion agent invoice/);
  assert.match(workflowSource, /completionInvoiceSubmissionAvailable = exchangeRecorded/);
});

test("legal Completion can be recorded with no Completion invoice", () => {
  const completionBody = functionBody(routeSource, "recordCompletion");
  assert.match(completionBody, /workflow_status === "completed"/);
  assert.match(completionBody, /workflow_status !== "completion_pending"/);
  assert.doesNotMatch(completionBody, /unit_sale_invoices/);
  assert.doesNotMatch(completionBody, /completion_agent_invoice/);
});

test("legal Completion can be recorded while a Completion invoice is unpaid", () => {
  const completionBody = functionBody(routeSource, "recordCompletion");
  assert.doesNotMatch(completionBody, /unit_sale_invoice_payments/);
  assert.doesNotMatch(completionBody, /outstanding/);
  assert.match(completionBody, /workflow_status: "completed"/);
});

test("Completion invoice approval changes invoice and document state but not legal Completion state", () => {
  const approvalBody = functionBody(routeSource, "approveAgentInvoice");
  assert.match(approvalBody, /markMilestoneInvoiceApproved/);
  assert.match(approvalBody, /completion_agent_invoice_approved/);
  assert.doesNotMatch(approvalBody, /from\("unit_sale_attempts"\)\.update/);
  assert.doesNotMatch(approvalBody, /workflow_status:/);
});

test("Completion payment uses the persisted generic invoice payment RPC", () => {
  const paymentBody = functionBody(routeSource, "recordAgentFeePayment");
  assert.match(paymentBody, /record_unit_sale_invoice_payment/);
  assert.match(paymentBody, /p_invoice_id: invoice\.id/);
  assert.match(paymentBody, /invoice\.fee_milestone === "completion"/);
  assert.doesNotMatch(migrationSource, /completion_payment_amount/);
});

test("multiple persisted payments can settle a Completion invoice", () => {
  const position = deriveInvoicePaymentPosition({
    cashAmountPayable: 1_941,
    payments: [
      { payer_type: "solicitor", amount: 1_000 },
      { payer_type: "developer", amount: 941 },
    ],
  });
  assert.equal(position.cashReceived, 1_941);
  assert.equal(position.outstandingBalance, 0);
});

test("Completion invoice becomes Paid when its persisted outstanding balance reaches zero", () => {
  const partPaid = deriveInvoicePaymentPosition({ cashAmountPayable: 1_941, payments: [{ payer_type: "solicitor", amount: 1_000 }] });
  const paid = deriveInvoicePaymentPosition({ cashAmountPayable: 1_941, payments: [{ payer_type: "solicitor", amount: 1_941 }] });
  assert.equal(partPaid.paymentStatus, "Part paid");
  assert.equal(paid.paymentStatus, "Paid");
  assert.match(routeSource, /type: "agent_fee_invoice_paid"/);
});

test("Agent Fees summary totals both independently rounded milestone fees", () => {
  const summary = deriveAgentFeeSummary({
    milestones: [
      { expectedNetAmount: 30_732.5, expectedVatAmount: 6_146.5, expectedGrossAmount: 36_879 },
      { expectedNetAmount: 1_617.5, expectedVatAmount: 323.5, expectedGrossAmount: 1_941 },
    ],
  });
  assert.equal(summary.expectedNetAmount, 32_350);
  assert.equal(summary.expectedVatAmount, 6_470);
  assert.equal(summary.expectedGrossAmount, 38_820);
  assert.match(workflowSource, /independently penny-rounded Exchange and Completion tranches/);
});

test("submitted invoice outstanding and remaining uninvoiced fee are separate summary values", () => {
  assert.match(workflowSource, /Outstanding submitted invoices/);
  assert.match(workflowSource, /Remaining uninvoiced fee/);
  assert.match(workflowSource, /agentFeeSummary\.submittedInvoiceOutstanding/);
  assert.match(workflowSource, /agentFeeSummary\.uninvoicedNetAmount/);
});

test("paid Exchange plus no Completion invoice has zero submitted outstanding and future Completion fee", () => {
  const summary = deriveAgentFeeSummary({
    milestones: [
      {
        expectedNetAmount: 30_732.5,
        expectedVatAmount: 6_146.5,
        expectedGrossAmount: 36_879,
        invoice: {
          gross_amount: 36_879,
          expected_payable_amount: 31_879,
          reservation_fee_deduction: 5_000,
          agent_contribution_deduction: 0,
        },
        payments: [{ payer_type: "solicitor", amount: 31_879 }],
      },
      { expectedNetAmount: 1_617.5, expectedVatAmount: 323.5, expectedGrossAmount: 1_941 },
    ],
  });
  assert.equal(summary.submittedInvoiceOutstanding, 0);
  assert.equal(summary.uninvoicedNetAmount, 1_617.5);
  assert.equal(summary.uninvoicedGrossAmount, 1_941);
});

test("sales agent can submit milestone invoices but cannot use developer payment controls", () => {
  assert.equal(canPerformSalesAction("sales_agent", "submit_agent_invoice"), true);
  assert.equal(canPerformSalesAction("sales_agent", "approve_agent_invoice"), false);
  assert.equal(canPerformSalesAction("sales_agent", "record_agent_fee_payment"), false);
  assert.match(workflowSource, /canRecord=\{canRecordAgentFeePayment\}/);
  assert.match(workflowSource, /milestone="completion"/);
});

test("milestone is explicit and duplicate active Completion invoices are rejected", () => {
  const uploadBody = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(uploadBody, /formData\.get\("feeMilestone"\)/);
  assert.match(uploadBody, /fee_milestone: feeMilestone/);
  assert.match(uploadBody, /An active .* invoice already exists/);
  assert.match(migrationSource, /unique index if not exists unit_sale_invoices_current_agent_milestone_idx/);
});

test("rejected invoice replacement retains document version audit history", () => {
  const uploadDocumentBody = functionBody(routeSource, "uploadSaleDocument");
  const uploadInvoiceBody = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(uploadInvoiceBody, /existingInvoice\.data\.status !== "query_raised"/);
  assert.match(uploadDocumentBody, /versionNumber = .* \+ 1/);
  assert.match(uploadDocumentBody, /is_current: false/);
  assert.match(uploadDocumentBody, /agent_invoice.*replaced|documentType}_replaced/);
  assert.match(workflowSource, />Document history</);
});

test("an approved Completion invoice cannot be rejected after approval or payment", () => {
  const rejectionBody = functionBody(routeSource, "rejectAgentInvoice");
  assert.match(rejectionBody, /\["approved", "part_paid", "paid", "reconciled"\]\.includes\(invoice\.status\)/);
  assert.match(rejectionBody, /approved \$\{milestoneLabel\} agent invoice cannot be rejected/);
});

test("reservation fee and agent contribution credits are never applied to Completion invoice", () => {
  const uploadBody = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(uploadBody, /reservationFeeDeduction: 0/);
  assert.match(uploadBody, /agentContributionDeduction: 0/);
  assert.match(uploadBody, /expectedPayableAmount: milestoneFee\.grossAmount/);
});

test("existing Exchange invoice and payment behavior remains milestone-aware", () => {
  const uploadBody = functionBody(routeSource, "uploadAgentInvoice");
  const paymentBody = functionBody(routeSource, "recordAgentFeePayment");
  assert.match(uploadBody, /calculateAgentInvoiceValues/);
  assert.match(uploadBody, /reservation_fee_deduction: expected\.reservationFeeDeduction/);
  assert.match(paymentBody, /fee_milestone/);
  assert.match(workflowSource, /onRecord=\{\(\) => recordAgentFeePayment\("exchange"\)\}/);
});

test("no Agent Fees status or balance gates legal Completion", () => {
  const completionBody = functionBody(routeSource, "recordCompletion");
  for (const forbidden of ["agent_invoice", "invoiceId", "paymentStatus", "outstandingBalance", "fee_milestone"]) {
    assert.doesNotMatch(completionBody, new RegExp(forbidden));
  }
  assert.match(workflowSource, /Sales-agent invoicing and payments are tracked independently from the legal sale lifecycle/);
});

test("RLS and server permissions keep Completion review and payments developer-only", () => {
  const approvalBody = functionBody(routeSource, "approveAgentInvoice");
  const paymentBody = functionBody(routeSource, "recordAgentFeePayment");
  assert.match(approvalBody, /canPerformSalesAction\(requester\.role, "approve_agent_invoice"\)/);
  assert.match(paymentBody, /canPerformSalesAction\(requester\.role, "record_agent_fee_payment"\)/);
  assert.match(migrationSource, /not in \('admin', 'developer'\)/);
  assert.match(migrationSource, /drop policy if exists "commercial admins manage sale invoice payments"/);
  assert.match(migrationSource, /grant execute on function public\.record_unit_sale_invoice_payment.*authenticated, service_role/s);
});

test("Completion invoice activity covers submit, replacement, reject, approve, payment and fully paid", () => {
  assert.match(routeSource, /documentTitle: `\$\{milestoneLabel\} agent invoice`/);
  assert.match(routeSource, /type: isReplacement \? `\$\{documentType\}_replaced` : `\$\{documentType\}_uploaded`/);
  assert.match(routeSource, /completion_agent_invoice_rejected/);
  assert.match(routeSource, /completion_agent_invoice_approved/);
  assert.match(routeSource, /agent_fee_payment_recorded/);
  assert.match(routeSource, /agent_fee_invoice_paid/);
});

test("agent invoice form is shared and clearly identifies its milestone and expected tax values", () => {
  assert.match(workflowSource, /function AgentInvoiceSubmissionForm/);
  assert.match(workflowSource, /milestone: AgentFeeMilestone/);
  assert.match(workflowSource, />Expected net fee</);
  assert.match(workflowSource, />Expected VAT</);
  assert.match(workflowSource, />Expected gross fee</);
  assert.match(workflowSource, />Expected cash amount payable</);
  assert.match(workflowSource, /onSubmit=\{\(\) => void uploadAgentInvoice\("completion"\)\}/);
});

test("Exchange and Completion share one persisted payment component", () => {
  assert.match(workflowSource, /function AgentInvoicePaymentSection/);
  const uses = workflowSource.match(/<AgentInvoicePaymentSection/g) ?? [];
  assert.equal(uses.length, 2);
  assert.match(workflowSource, /<details className="group/);
});
