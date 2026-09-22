import { legalSql, legalActionSql } from "./helpers/legal-sql.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const legalSource = readFileSync("src/components/portal/sales/SalesLegalWorkflow.tsx", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("exchange panel contains legal-readiness activities only", () => {
  assert.match(workflowSource, /<SalesLegalWorkflow/);
  assert.match(legalSource, /1\. Authority requested/);
  assert.match(legalSource, /2\. Authority issued/);
  assert.match(legalSource, /3\. Exchange confirmed/);
  assert.doesNotMatch(legalSource, /Agent invoice|invoice approval|invoice payment/i);
  assert.doesNotMatch(workflowSource, /exchangeProcessStep/);
});

test("sale stages and selected stage workspace have distinct hierarchy", () => {
  assert.match(workflowSource, />Sales stages</);
  assert.match(workflowSource, /sm:grid-cols-2 lg:grid-cols-4/);
  assert.match(workflowSource, /min-w-0 flex-wrap items-center justify-between/);
  assert.match(workflowSource, /max-w-full shrink-0 whitespace-normal break-words/);
  assert.match(workflowSource, />Selected sales stage</);
  assert.match(legalSource, /aria-label="Exchange tasks"/);
  assert.match(workflowSource, /taskLabel = "Current task"/);
  assert.match(workflowSource, /title="Reservation"/);
  assert.match(legalSource, /aria-label="Completion tasks"/);
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
  const commercialApprovalBody = legalSql.slice(legalSql.indexOf("create function public.sales_legal_dispatch"), legalSql.indexOf("create function public.sales_legal_action"));

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
  const clientExchangeBody = legalSource;
  const routeExchangeBody = legalActionSql("confirm_exchange");
  const paymentBody = functionBody(workflowSource, "recordAgentFeePayment");

  assert.match(clientExchangeBody, /depositConfirmed: deposit/);
  assert.match(routeExchangeBody, /p_payload->>'depositConfirmed' is distinct from 'true'/);
  assert.match(routeExchangeBody, /e\.expires_at<=now\(\)/);
  assert.match(paymentBody, /action: "record_agent_fee_payment"/);
  assert.match(paymentBody, /paymentClientReference/);
  assert.match(workflowSource, />Outstanding</);
  assert.match(workflowSource, /id="agent-fees"/);
});
