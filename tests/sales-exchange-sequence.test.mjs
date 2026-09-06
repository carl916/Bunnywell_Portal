import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const taskSource = readFileSync("src/lib/sales/stage-tasks.ts", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("exchange panel contains legal-readiness activities only", () => {
  const exchangeStart = workflowSource.indexOf('activeWorkflowStage === "exchange"');
  const completionStart = workflowSource.indexOf('activeWorkflowStage === "completion"', exchangeStart);
  const exchangePanel = workflowSource.slice(exchangeStart, completionStart);
  assert.match(exchangePanel, /<SalesStageTasks stage="Exchange" steps=\{exchangeTasks\}/);
  assert.match(taskSource, /title: "Confirm commercial terms"/);
  assert.match(taskSource, /title: "Record exchange"/);
  assert.match(exchangePanel, /label: "Exchange deposit due"/);
  assert.doesNotMatch(exchangePanel, /Agent invoice|invoice approval|invoice payment/i);
  assert.doesNotMatch(workflowSource, /exchangeProcessStep/);
});

test("sale stages and selected stage workspace have distinct hierarchy", () => {
  assert.match(workflowSource, />Sales stages</);
  assert.match(workflowSource, /sm:grid-cols-2 lg:grid-cols-4/);
  assert.match(workflowSource, /min-w-0 flex-wrap items-center justify-between/);
  assert.match(workflowSource, /max-w-full shrink-0 whitespace-normal break-words/);
  assert.match(workflowSource, />Selected sales stage</);
  assert.match(workflowSource, /<SalesStageTasks stage="Exchange"/);
  assert.match(workflowSource, /taskLabel = "Current task"/);
  assert.match(workflowSource, /title="Reservation"/);
  assert.match(workflowSource, /title="Exchange"/);
  assert.match(workflowSource, /title="Completion"/);
  assert.match(workflowSource, /title="Handover"/);
  assert.doesNotMatch(workflowSource, /Complete the next required activity/);
  assert.doesNotMatch(workflowSource, /Selected workflow step/);
});

test("agent invoice upload captures details before developer approval", () => {
  const clientBody = functionBody(workflowSource, "uploadAgentInvoice");
  const routeBody = functionBody(routeSource, "uploadAgentInvoice");

  assert.match(clientBody, /formData\.set\("invoiceReference"/);
  assert.match(clientBody, /formData\.set\("invoiceDate"/);
  assert.match(clientBody, /formData\.set\("invoiceGrossAmount"/);
  assert.match(routeBody, /Invoice reference, invoice date and total are required/);
  assert.match(routeBody, /invoice_reference: invoiceReference/);
  assert.match(routeBody, /invoice_date: invoiceDate/);
  assert.match(routeBody, /gross_amount: invoiceGrossAmount/);
});

test("agent sees expected invoice amounts alongside the upload form", () => {
  assert.match(workflowSource, />Expected Exchange invoice</);
  assert.match(workflowSource, />Agreed fee</);
  assert.match(workflowSource, />Expected net fee</);
  assert.match(workflowSource, />Expected VAT</);
  assert.match(workflowSource, />Expected gross fee</);
  assert.match(workflowSource, />Reservation fee credit already held</);
  assert.match(workflowSource, />Agent contribution deduction</);
  assert.match(workflowSource, />Expected cash amount payable</);
  assert.match(workflowSource, /expectedPayableAmount/);
});

test("developer can reject an agent invoice with a reason and request a replacement", () => {
  const clientBody = functionBody(workflowSource, "rejectAgentInvoice");
  const routeBody = functionBody(routeSource, "rejectAgentInvoice");
  const approvalBody = functionBody(routeSource, "approveAgentInvoice");
  const commercialApprovalBody = functionBody(routeSource, "approveCommercialPackage");

  assert.match(clientBody, /action: "reject_agent_invoice"/);
  assert.match(clientBody, /invoiceMilestone: milestone/);
  assert.match(clientBody, /invoiceRejectionReason: reason\.trim\(\)/);
  assert.match(routeBody, /canPerformSalesAction\(requester\.role, "reject_agent_invoice"\)/);
  assert.match(routeBody, /Add a reason for rejecting the sales agent invoice/);
  assert.match(routeBody, /markMilestoneInvoiceRejected/);
  assert.match(routeBody, /completion_agent_invoice_rejected/);
  assert.match(routeSource, /query_note: rejectionReason/);
  assert.match(routeSource, /status: "query_raised"/);
  assert.match(approvalBody, /invoice\.status === "query_raised"/);
  assert.doesNotMatch(commercialApprovalBody, /loadMilestoneInvoice|markMilestoneInvoiceApproved/);
  assert.match(workflowSource, /agentInvoiceNeedsCorrection/);
  assert.match(workflowSource, /Reject invoice/);
  assert.match(workflowSource, /Upload \$\{isReplacement \? "corrected " : ""\}\$\{label\} invoice PDF/);
});

test("exchange requires deposit confirmation and keeps agent fee payment separate", () => {
  const clientExchangeBody = functionBody(workflowSource, "recordExchange");
  const routeExchangeBody = functionBody(routeSource, "recordExchange");
  const paymentBody = functionBody(workflowSource, "recordAgentFeePayment");

  assert.match(clientExchangeBody, /exchangeDepositConfirmed/);
  assert.match(routeExchangeBody, /payload\.exchangeDepositConfirmed !== true/);
  assert.match(routeExchangeBody, /exchangeDepositConfirmed: true/);
  assert.match(paymentBody, /action: "record_agent_fee_payment"/);
  assert.match(paymentBody, /paymentClientReference/);
  assert.match(workflowSource, />Outstanding</);
  assert.match(workflowSource, /id="agent-fees"/);
});
