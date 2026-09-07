import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { historicalActorLabel } from "../src/lib/sales/actor-identity.ts";

const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const workflowStyles = readFileSync("src/components/portal/sales/SalesReservationWorkflow.module.css", "utf8");
const workspaceTabsSource = readFileSync("src/components/portal/sales/SaleFileWorkspaceTabs.tsx", "utf8");
const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test("Progression is the default unit sale section", () => {
  assert.match(workflowSource, /useState<UnitSaleSection>\("progression"\)/);
  assert.match(workspaceTabsSource, /key: "progression", label: "Progression"/);
  assert.match(workflowSource, /params\.delete\("section"\)/);
});

test("commercial audiences and editor render only in Commercial", () => {
  const commercialStart = workflowSource.indexOf('activeUnitSection === "commercial"');
  const progressionStart = workflowSource.indexOf('activeUnitSection === "progression"', commercialStart);
  const commercialPanel = workflowSource.slice(commercialStart, progressionStart);
  assert.match(commercialPanel, />Developer</);
  assert.match(commercialPanel, />Agent</);
  assert.match(commercialPanel, />Buyer</);
  assert.match(commercialPanel, /"Edit commercial model"/);
});

test("Agent fees render only in Financials and not in the legal stage selector", () => {
  assert.match(workflowSource, /activeUnitSection === "financials" && activeAttempt && reservationApproved/);
  const selectorStart = workflowSource.indexOf('id="unit-sale-progression"');
  const reservationStart = workflowSource.indexOf('activeWorkflowStage === "reservation"', selectorStart);
  const stageSelector = workflowSource.slice(selectorStart, reservationStart);
  assert.doesNotMatch(stageSelector, /Agent fees|Exchange fee|Completion fee/);
});

test("approved Reservation uses grouped key value lists", () => {
  const start = workflowSource.indexOf('{reservationState === "approved" && (');
  const end = workflowSource.indexOf("</StageWorkspace>", start);
  const approvedPanel = workflowSource.slice(start, end);
  assert.match(approvedPanel, />Reservation</);
  assert.match(approvedPanel, />Approval</);
  assert.match(approvedPanel, /<KeyValueList/);
  assert.match(approvedPanel, /Uploaded reservation form/);
  assert.doesNotMatch(approvedPanel, /<FieldValue/);
});

test("legal Exchange can be recorded with no Exchange invoice", () => {
  const body = functionBody(routeSource, "recordExchange");
  assert.match(body, /workflow_status: "exchanged"/);
  assert.doesNotMatch(body, /loadMilestoneInvoice|unit_sale_invoices|agent_invoice/);
});

test("legal Completion can be recorded with no Completion invoice", () => {
  const body = functionBody(routeSource, "recordCompletion");
  assert.match(body, /workflow_status: "completed"/);
  assert.doesNotMatch(body, /unit_sale_invoices|completion_agent_invoice|unit_sale_invoice_payments/);
});

test("Exchange invoice submission is financial and remains available after Reservation", () => {
  const body = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(body, /"approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange", "exchanged", "completion_pending", "completed"/);
  assert.match(body, /Approve the reservation before uploading the Exchange agent invoice/);
});

test("Completion invoice submission becomes available after legal Exchange", () => {
  const body = functionBody(routeSource, "uploadAgentInvoice");
  assert.match(body, /\["exchanged", "completion_pending", "completed"\]/);
  assert.match(workflowSource, /completionInvoiceSubmissionAvailable = exchangeRecorded/);
});

test("invoice approval and rejection do not change legal sale status", () => {
  const approvalBody = functionBody(routeSource, "approveAgentInvoice");
  const rejectionBody = functionBody(routeSource, "rejectAgentInvoice");
  assert.doesNotMatch(approvalBody, /from\("unit_sale_attempts"\)\.update|workflow_status:/);
  assert.doesNotMatch(rejectionBody, /from\("unit_sale_attempts"\)\.update|workflow_status:/);
  assert.match(rejectionBody, /toStatus: attempt\.workflow_status/);
});

test("commercial confirmation no longer requires or approves an invoice", () => {
  const body = functionBody(routeSource, "approveCommercialPackage");
  assert.match(body, /workflow_status: "ready_for_exchange"/);
  assert.doesNotMatch(body, /loadMilestoneInvoice|requireCurrentInvoiceVersion|markMilestoneInvoiceApproved/);
});

test("portfolio Agent Fees links can still focus a milestone", () => {
  const body = workflowSource.slice(workflowSource.indexOf("function openSaleFile"), workflowSource.indexOf("function closeSaleFile"));
  assert.match(body, /pendingAgentFeesScrollRef\.current = focusAgentFees \? "exchange" : null/);
  assert.match(body, /setActiveUnitSection\(focusAgentFees \? "financials" : "progression"\)/);
  assert.match(body, /hash: focusAgentFees \? "exchange-fee" : null/);
  assert.match(workflowSource, /focusAgentFees \? "financials" : "progression"/);
});

test("selecting the Financials tab does not scroll to a fee milestone", () => {
  const body = workflowSource.slice(workflowSource.indexOf("function changeUnitSection"), workflowSource.indexOf("function setReservationFormPdf"));
  assert.match(body, /setActiveUnitSection\(section\)/);
  assert.match(body, /pendingAgentFeesScrollRef\.current = null/);
  assert.doesNotMatch(body, /openAgentFees|scrollToPortalSection|hash:/);
});

test("sale file workspaces use a prominent three-column underline tab rail", () => {
  assert.match(workflowSource, /<SaleFileWorkspaceTabs activeWorkspace=/);
  assert.match(workspaceTabsSource, /min-w-\[24rem\] grid-cols-3 border-b/);
  assert.match(workspaceTabsSource, /min-h-\[3\.25rem\] min-w-0/);
  assert.match(workspaceTabsSource, /border-b-\[var\(--bw-primary\)\] bg-white/);
  assert.doesNotMatch(workspaceTabsSource, /rounded-t-|border-x-|border-t-\[3px\]/);
  assert.doesNotMatch(workspaceTabsSource, /shadow-|bg-\[var\(--bw-primary\)\] text-white|<Check/);
  assert.match(workspaceTabsSource, /description: "Sale lifecycle"/);
  assert.match(workspaceTabsSource, /text-\[0\.68rem\] font-medium/);
  assert.match(workspaceTabsSource, /overflow-x-auto overflow-y-hidden/);
  assert.match(workflowSource, /id="unit-sale-progression"[^\n]*border-t-0/);
  assert.match(workflowSource, /id="unit-sale-commercial"[^\n]*border-t-0/);
  assert.match(workflowSource, /id="agent-fees"[^\n]*border-t-0/);
});

test("sale file summary uses compact content-width metadata instead of thirds", () => {
  const summary = workflowSource.slice(workflowSource.indexOf('<p className="text-xs font-semibold uppercase tracking-[0.18em]'), workflowSource.indexOf("<SaleFileWorkspaceTabs"));
  assert.match(summary, /<SaleMetadataStrip items=/);
  assert.match(workflowSource, /function SaleMetadataStrip/);
  assert.match(workflowSource, /flex flex-wrap items-start gap-x-5/);
  assert.match(workflowSource, /sm:border-l sm:border-\[#e2ded3\] sm:pl-5/);
  assert.doesNotMatch(summary, /sm:grid-cols-3/);
  assert.match(workspaceTabsSource, /mt-3 overflow-x-auto/);
});

test("sale file workspace tabs expose selection and keyboard navigation", () => {
  assert.match(workspaceTabsSource, /role="tablist"/);
  assert.match(workspaceTabsSource, /role="tab"/);
  assert.match(workspaceTabsSource, /aria-selected=/);
  assert.match(workspaceTabsSource, /tabIndex=\{isActive \? 0 : -1\}/);
  assert.match(workspaceTabsSource, /event\.key === "ArrowRight"/);
  assert.match(workspaceTabsSource, /event\.key === "ArrowLeft"/);
  assert.match(workspaceTabsSource, /event\.key === "Home"/);
  assert.match(workspaceTabsSource, /event\.key === "End"/);
  assert.match(workflowSource, /aria-labelledby="sale-file-tab-progression"/);
  assert.match(workflowSource, /aria-labelledby="sale-file-tab-financials"/);
  assert.match(workflowSource, /aria-labelledby="sale-file-tab-commercial"/);
});

test("sale activity and legal milestone summaries identify their actors", () => {
  assert.match(workflowSource, /actorName\(event\.created_by_user_id\)/);
  assert.match(workflowSource, /label: "Confirmed by", value: commercialApprovedBy/);
  assert.match(workflowSource, /label: "Recorded by", value: exchangeRecordedBy/);
  assert.match(workflowSource, /label: "Approved by", value: completionDocumentsApprovedBy/);
  assert.match(workflowSource, /label: "Completed by", value: completionRecordedBy/);
});

test("approved Reservation uses a structured, responsive event history", () => {
  const approvedPanel = workflowSource.slice(workflowSource.indexOf('{reservationState === "approved" && ('), workflowSource.indexOf("</StageWorkspace>", workflowSource.indexOf('{reservationState === "approved" && (')));
  const eventHistory = workflowSource.slice(workflowSource.indexOf("function ApprovalEventHistory"), workflowSource.indexOf("function SaleActivity"));
  assert.match(approvedPanel, /<ApprovalEventHistory events=\{approvalHistoryEvents\}/);
  assert.match(workflowSource, /label: "Reservation submitted"[\s\S]*label: "Approved"/);
  assert.match(eventHistory, /<ol[\s\S]*events\.map/);
  assert.match(eventHistory, /divide-y divide-\[#eef0eb\]/);
  assert.match(approvedPanel, /styles\.approvalHistoryCard/);
  assert.match(eventHistory, /styles\.approvalEventRow/);
  assert.match(eventHistory, /styles\.approvalEventName/);
  assert.match(eventHistory, /<time[^>]*>\{formatDateTime\(event\.occurredAt\)\}<\/time>/);
  assert.match(eventHistory, /styles\.approvalEventSeparator[^>]*aria-hidden="true">·<\/span>\{event\.actor\}/);
  assert.match(workflowStyles, /@container approval-history \(min-width: 30rem\)[\s\S]*grid-template-columns:\s*minmax\(8rem, 0\.9fr\) minmax\(8\.25rem, 1fr\) minmax\(0, 1\.1fr\)/);
  assert.doesNotMatch(approvedPanel, /Reservation submitted on|approved on|formatNarrativeDateTime/);
});

test("legacy reservation actor IDs resolve to profile names and never render as UUIDs", () => {
  const userId = "c2b72e82-b43f-48a7-b5f9-57e16b80c245";
  const profiles = [{ id: userId, full_name: "Carl Gilbert", email: "carl@example.com" }];

  assert.equal(historicalActorLabel({ userId, profiles }), "Carl Gilbert");
  assert.equal(historicalActorLabel({ snapshotName: userId, userId, profiles }), "Carl Gilbert");
  assert.equal(historicalActorLabel({ snapshotName: userId, userId, profiles: [] }), "Not recorded");
  assert.doesNotMatch(workflowSource, /reservation_approved_by_user_id \?\? "-"/);
  assert.match(workflowSource, /const approvedByName = historicalActorLabel/);
});

test("completion uses styled PDF pickers and replaces completed controls with summaries", () => {
  const completionPanel = workflowSource.slice(workflowSource.indexOf('id="sales-stage-completion"'), workflowSource.indexOf('id="sales-stage-handover"'));
  assert.match(completionPanel, /<PdfUploadBox/);
  assert.match(completionPanel, /Completion documents approved/);
  assert.match(completionPanel, /Sale completed/);
  assert.doesNotMatch(completionPanel, /className="field" type="file"/);
});

test("completion review and completion recording are idempotent", () => {
  const approvalBody = functionBody(routeSource, "approveCompletionDocuments");
  const completionBody = functionBody(routeSource, "recordCompletion");
  assert.match(approvalBody, /alreadyApproved: true/);
  assert.match(completionBody, /alreadyCompleted: true/);
  assert.match(workflowSource, /completionReviewSubmissionInFlightRef\.current/);
  assert.match(workflowSource, /completionRecordSubmissionInFlightRef\.current/);
});

test("tabs and key value lists collapse without ordinary horizontal overflow", () => {
  assert.match(workflowSource, /sm:grid-cols-\[minmax\(8rem,0\.8fr\)_minmax\(0,1\.2fr\)\]/);
  assert.doesNotMatch(workflowSource, /unit-sale-(?:progression|financials|commercial)[^\n]*overflow-x/);
  assert.match(workspaceTabsSource, /overflow-x-auto/);
  assert.doesNotMatch(workspaceTabsSource, /sm:grid-cols-[12]|md:grid-cols-[12]/);
});
