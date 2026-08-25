import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveAgentFeeSummary,
  deriveInvoicePaymentPosition,
  isActiveAgentFeePayment,
} from "../src/lib/sales/agent-fees.ts";
import { canPerformSalesAction } from "../src/lib/sales/permissions.ts";

const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260825b_agent_fee_payment_corrections.sql", "utf8");
const recorderMigrationSource = readFileSync("supabase/migrations/20260825d_agent_fee_payment_recorder_identity.sql", "utf8");
const agentFeesMigrationSource = readFileSync("supabase/migrations/20260825_agent_fees_workspace.sql", "utf8");
const migrationSchemaSource = migrationSource.slice(0, migrationSource.indexOf("create or replace function"));

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("active payment contributes to invoice totals", () => {
  const payment = { payer_type: "solicitor", amount: 18_000, voided_at: null };
  assert.equal(isActiveAgentFeePayment(payment), true);
  const position = deriveInvoicePaymentPosition({ cashAmountPayable: 28_820, payments: [payment] });
  assert.equal(position.cashReceived, 18_000);
  assert.equal(position.outstandingBalance, 10_820);
});

test("developer and admin can void an active payment", () => {
  assert.equal(canPerformSalesAction("developer", "void_agent_fee_payment"), true);
  assert.equal(canPerformSalesAction("admin", "void_agent_fee_payment"), true);
  assert.match(workflowSource, /canVoidAgentFeePayment/);
  assert.match(workflowSource, /!payment\.voided_at/);
});

test("void reason is required in the client, route and database", () => {
  const routeBody = functionBody(routeSource, "voidAgentFeePayment");
  assert.match(workflowSource, /disabled=\{isSaving \|\| !paymentVoidReason\.trim\(\)\}/);
  assert.match(routeBody, /if \(!voidReason\) throw new Error\("Add a reason for voiding the payment\."\)/);
  assert.match(migrationSource, /length\(trim\(coalesce\(p_reason, ''\)\)\) = 0/);
});

test("voided payment remains in the table and visible in history", () => {
  assert.doesNotMatch(migrationSource, /delete from public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /update public\.unit_sale_invoice_payments payment[\s\S]*voided_at = now\(\)/);
  assert.match(workflowSource, /payment\.voided_at && <span[\s\S]*>Voided<\/span>/);
  assert.match(workflowSource, /payment\.void_reason/);
});

test("voided payment no longer contributes to payment totals", () => {
  const position = deriveInvoicePaymentPosition({
    cashAmountPayable: 28_820,
    payments: [
      { payer_type: "solicitor", amount: 20_000, voided_at: "2026-08-25T12:00:00Z" },
      { payer_type: "solicitor", amount: 18_000, voided_at: null },
    ],
  });
  assert.equal(position.cashReceived, 18_000);
  assert.equal(position.solicitorPayments, 18_000);
});

test("invoice outstanding balance recalculates after a void", () => {
  const before = deriveInvoicePaymentPosition({ cashAmountPayable: 28_820, payments: [{ payer_type: "solicitor", amount: 28_820 }] });
  const after = deriveInvoicePaymentPosition({ cashAmountPayable: 28_820, payments: [{ payer_type: "solicitor", amount: 28_820, voided_at: "2026-08-25T12:00:00Z" }] });
  assert.equal(before.outstandingBalance, 0);
  assert.equal(after.outstandingBalance, 28_820);
});

test("Paid invoice can return to Part paid when one payment is voided", () => {
  const before = deriveInvoicePaymentPosition({
    cashAmountPayable: 28_820,
    payments: [{ payer_type: "solicitor", amount: 20_000 }, { payer_type: "developer", amount: 8_820 }],
  });
  const after = deriveInvoicePaymentPosition({
    cashAmountPayable: 28_820,
    payments: [{ payer_type: "solicitor", amount: 20_000 }, { payer_type: "developer", amount: 8_820, voided_at: "2026-08-25T12:00:00Z" }],
  });
  assert.equal(before.paymentStatus, "Paid");
  assert.equal(after.paymentStatus, "Part paid");
  assert.equal(after.outstandingBalance, 8_820);
});

test("replacement payment is recorded through the normal append-only RPC", () => {
  assert.match(functionBody(workflowSource, "voidAgentFeePayment"), /Record the corrected payment when ready/);
  assert.match(functionBody(workflowSource, "recordAgentFeePayment"), /action: "record_agent_fee_payment"/);
  assert.match(migrationSource, /insert into public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /and payment\.voided_at is null/);
});

test("already voided payment cannot be changed or voided again", () => {
  assert.match(migrationSource, /if v_payment\.voided_at is null then[\s\S]*voided := true;[\s\S]*else[\s\S]*voided := false;/);
  assert.match(workflowSource, /canVoid && !payment\.voided_at/);
});

test("sales agent and external roles cannot void payments", () => {
  for (const role of ["sales_agent", "conveyancer", "resident", "contractor", "user"]) {
    assert.equal(canPerformSalesAction(role, "void_agent_fee_payment"), false);
  }
});

test("direct API and RPC calls cannot bypass permission checks", () => {
  const routeBody = functionBody(routeSource, "voidAgentFeePayment");
  assert.match(routeBody, /canPerformSalesAction\(requester\.role, "void_agent_fee_payment"\)/);
  assert.match(migrationSource, /not in \('admin', 'developer'\)/);
  assert.match(migrationSource, /p_requester_id is distinct from auth\.uid\(\)/);
  assert.match(migrationSource, /security definer/);
  assert.match(agentFeesMigrationSource, /drop policy if exists "commercial admins manage sale invoice payments"/);
  assert.doesNotMatch(migrationSource, /create policy[\s\S]*sale invoice payments/);
});

test("duplicate and concurrent void submissions are handled safely", () => {
  assert.match(migrationSource, /from public\.unit_sale_invoices invoice[\s\S]*for update/);
  assert.match(migrationSource, /from public\.unit_sale_invoice_payments payment[\s\S]*for update/);
  assert.match(functionBody(routeSource, "voidAgentFeePayment"), /voided: Boolean\(result\?\.voided\)/);
  assert.match(migrationSource, /if v_payment\.voided_at is null then[\s\S]*else[\s\S]*voided := false/);
  assert.match(workflowSource, /voidPaymentSubmissionInFlightRef\.current/);
});

test("sale-level Agent Fees summary excludes voided payments", () => {
  const summary = deriveAgentFeeSummary({
    milestones: [{
      expectedNetAmount: 24_016.67,
      expectedVatAmount: 4_803.33,
      expectedGrossAmount: 28_820,
      invoice: { gross_amount: 28_820, expected_payable_amount: 28_820 },
      payments: [
        { payer_type: "solicitor", amount: 20_000 },
        { payer_type: "developer", amount: 8_820, voided_at: "2026-08-25T12:00:00Z" },
      ],
    }],
  });
  assert.equal(summary.cashPayments, 20_000);
  assert.equal(summary.submittedInvoiceOutstanding, 8_820);
});

test("payment correction never mutates Exchange, Completion or Handover state", () => {
  const routeBody = functionBody(routeSource, "voidAgentFeePayment");
  assert.doesNotMatch(routeBody, /unit_sale_attempts/);
  assert.doesNotMatch(routeBody, /units"\)\.update/);
  assert.doesNotMatch(routeBody, /workflow_status:/);
  assert.match(migrationSource, /v_attempt\.workflow_status,\s*\n\s*v_attempt\.workflow_status/);
});

test("existing payment records remain active after the additive migration", () => {
  assert.match(migrationSource, /add column if not exists voided_at timestamptz/);
  assert.match(migrationSource, /add column if not exists voided_by_user_id/);
  assert.match(migrationSource, /add column if not exists void_reason text/);
  assert.doesNotMatch(migrationSchemaSource, /update public\.unit_sale_invoice_payments/);
  assert.doesNotMatch(migrationSchemaSource, /default[^\n]*voided/);
});

test("void activity records the original transaction, actor and reason", () => {
  assert.match(migrationSource, /create trigger audit_unit_sale_invoice_payment_void/);
  assert.match(migrationSource, /old\.voided_at is null and new\.voided_at is not null/);
  assert.match(migrationSource, /'agent_fee_payment_voided'/);
  assert.match(migrationSource, /Agent payment voided/);
  assert.match(migrationSource, /'paymentId', new\.id/);
  assert.match(migrationSource, /'amount', new\.amount/);
  assert.match(migrationSource, /'voidReason', new\.void_reason/);
  assert.match(migrationSource, /'voidedByUserId', new\.voided_by_user_id/);
});

test("void mutation and activity event are atomic", () => {
  assert.match(migrationSource, /after update of voided_at on public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /insert into public\.unit_sale_workflow_events/);
  assert.doesNotMatch(functionBody(routeSource, "voidAgentFeePayment"), /insertEvent/);
});

test("amount, date, payer and notes are corrected only by void-and-re-record", () => {
  const routeBody = functionBody(routeSource, "voidAgentFeePayment");
  assert.doesNotMatch(routeBody, /from\("unit_sale_invoice_payments"\)\.update/);
  assert.doesNotMatch(migrationSource, /set\s+amount\s*=/);
  assert.doesNotMatch(migrationSource, /set\s+paid_at\s*=/);
  assert.doesNotMatch(migrationSource, /set\s+payer_type\s*=/);
  assert.doesNotMatch(migrationSource, /set\s+notes\s*=/);
  assert.match(migrationSource, /void_reason = trim\(p_reason\)/);
  assert.match(migrationSource, /Historical agent fee payment details cannot be edited/);
  assert.match(migrationSource, /Historical agent fee payments cannot be deleted/);
  assert.match(migrationSource, /before update on public\.unit_sale_invoice_payments/);
  assert.match(migrationSource, /before delete on public\.unit_sale_invoice_payments/);
});

test("payment panel stays expanded while its compact entry form is disclosed on demand", () => {
  assert.doesNotMatch(workflowSource.slice(workflowSource.indexOf("function AgentInvoicePaymentSection"), workflowSource.indexOf("function AdditionalConditionsEditor")), /<details/);
  assert.match(workflowSource, /const \[showPaymentForm, setShowPaymentForm\] = useState\(false\)/);
  assert.match(workflowSource, /!showPaymentForm && \([\s\S]*>Record payment<\/button>/);
  assert.match(workflowSource, /if \(await onRecord\(\)\) setShowPaymentForm\(false\)/);
  assert.match(workflowSource, />Amount<GbpInput/);
  assert.match(workflowSource, />Payment date<input/);
  assert.doesNotMatch(workflowSource, />Payer<select/);
  assert.doesNotMatch(workflowSource, />Note \(optional\)/);
});

test("the backend derives recorder identity and never accepts payer or note input", () => {
  const recordBody = functionBody(routeSource, "recordAgentFeePayment");
  assert.doesNotMatch(recordBody, /payload\.payerType/);
  assert.doesNotMatch(recordBody, /payload\.paymentNote/);
  assert.match(recordBody, /p_requester_id: requester\.id/);
  assert.match(recordBody, /recordedByUserId: requester\.id/);
  assert.match(recorderMigrationSource, /new\.recorded_by_user_id/);
  assert.match(recorderMigrationSource, /coalesce\(profile\.full_name, profile\.name, profile\.email\)/);
  assert.match(recorderMigrationSource, /organisation\.name/);
});

test("recorder identity is snapshotted and immutable with a legacy display fallback", () => {
  assert.match(recorderMigrationSource, /add column if not exists recorded_by_name text/);
  assert.match(recorderMigrationSource, /add column if not exists recorded_by_email text/);
  assert.match(recorderMigrationSource, /add column if not exists recorded_by_organisation_name text/);
  assert.match(recorderMigrationSource, /new\.recorded_by_name[\s\S]*new\.recorded_by_organisation_name/);
  assert.match(workflowSource, /payment\.recorded_by_name[\s\S]*statusLabel\(normalisePayerType\(payment\)\)/);
});

test("payment history is compact and summarises active receipts and voids", () => {
  assert.match(workflowSource, /receivedAmount = activeCashPayments\.reduce/);
  assert.match(workflowSource, /\{money\(receivedAmount\)\} received/);
  assert.match(workflowSource, /paymentRecorderLabel\(payment, profiles, organisations\)/);
  assert.match(workflowSource, />Void payment<\/button>/);
});
