import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import ts from "typescript";

const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const setupSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260723_sales_stage_timestamp_and_commercial_model_rpc.sql", "utf8");
const buyerIncentivesMigrationSource = readFileSync("supabase/migrations/20260725_sales_buyer_incentives_and_identity.sql", "utf8");
const reservationApprovalMigrationSource = readFileSync("supabase/migrations/20260804_reservation_approval_workflow.sql", "utf8");
const commercialModelSource = readFileSync("src/lib/sales/commercial-model.ts", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

function plainFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const candidates = [
    source.indexOf("\nfunction ", start + 1),
    source.indexOf("\nasync function ", start + 1),
  ].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function loadCommercialModelModule() {
  const compiled = ts.transpileModule(commercialModelSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const testModule = new Module("commercial-model-test");
  testModule.paths = Module._nodeModulePaths(process.cwd());
  testModule._compile(compiled, "commercial-model-test.js");
  return testModule.exports;
}

test("commercial model saves use the dedicated action name from setup and sales UI", () => {
  assert.match(setupSource, /action:\s*"save_commercial_model"/);
  assert.match(workflowSource, /action:\s*"save_commercial_model"/);
});

test("commercial model API uses the transactional RPC and avoids reservation progression side effects", () => {
  const body = functionBody(routeSource, "saveCommercialModel");

  assert.match(body, /\.rpc\("save_unit_commercial_model"/);
  assert.doesNotMatch(body, /insertEvent\(/);
  assert.doesNotMatch(body, /workflow_status:\s*"awaiting_commercial_approval"/);
  assert.doesNotMatch(body, /from\("unit_sale_invoices"\)/);
});

test("stage timestamp schema is dedicated and commercial model RPC does not overwrite it", () => {
  assert.match(migrationSource, /add column if not exists stage_entered_at timestamptz/);
  assert.match(migrationSource, /create trigger set_unit_sale_attempts_stage_entered_at/);
  assert.match(migrationSource, /create or replace function public.save_unit_commercial_model/);

  const rpcBody = migrationSource.slice(migrationSource.indexOf("create or replace function public.save_unit_commercial_model"));
  assert.doesNotMatch(rpcBody, /update public\.unit_sale_attempts/);
  assert.doesNotMatch(rpcBody, /unit_sale_workflow_events/);
});

test("commercial model preview keeps developer net and agent invoice deductions separated", () => {
  const { calculateAgentInvoicePreview, calculateDeveloperNet } = loadCommercialModelModule();
  const current = {
    contractPrice: 385_000,
    parkingValue: 0,
    developerContribution: 0,
    solicitorFee: 882,
    agentFeePercent: 10,
    vatRate: 20,
    reservationFee: 5_000,
    reservationFeeHolder: "sales_agent",
    agentContribution: 0,
  };

  const developerBefore = calculateDeveloperNet(current);
  const agentInvoiceBefore = calculateAgentInvoicePreview(current);
  assert.equal(developerBefore, 345_618);
  assert.equal(calculateDeveloperNet(current) - developerBefore, 0);
  assert.equal(calculateAgentInvoicePreview(current).expectedPayableAmount - agentInvoiceBefore.expectedPayableAmount, 0);
  assert.equal(agentInvoiceBefore.netAmount, 38_500);

  assert.equal(calculateDeveloperNet({ ...current, developerContribution: 5_000 }), developerBefore - 5_000);

  const agentContributionInvoice = calculateAgentInvoicePreview({ ...current, agentContribution: 2_500 });
  const baselineInvoice = calculateAgentInvoicePreview(current);
  assert.equal(agentContributionInvoice.expectedPayableAmount, baselineInvoice.expectedPayableAmount - 2_500);
  assert.equal(calculateDeveloperNet({ ...current, agentContribution: 2_500 }), developerBefore);

  assert.equal(calculateDeveloperNet({ ...current, contractPrice: 400_000 }), 400_000 - 882 - 40_000);
  assert.equal(calculateDeveloperNet({ ...current, parkingValue: 12_000 }), developerBefore + 12_000);
});

test("blank commercial model percentage input does not override saved agent fee", () => {
  assert.match(workflowSource, /function normaliseNumberInput\(value: string\) \{\s+if \(value\.trim\(\) === ""\) return null;/);
});

test("sale file includes buyer view and advanced deal setup friction", () => {
  assert.match(workflowSource, />Buyer view</);
  assert.match(workflowSource, /Payment schedule and buyer-facing contributions/);
  assert.match(workflowSource, /<span>Contract price<\/span>/);
  assert.match(workflowSource, /Net cost to buyer/);
  assert.doesNotMatch(workflowSource, /Total buyer contributions/);
  assert.match(workflowSource, />Advanced deal setup</);
  assert.match(workflowSource, /Buyer incentives and special conditions/);
  assert.match(workflowSource, /Additional conditions/);
  assert.match(workflowSource, /Developer-approved commercial terms/);
  assert.match(workflowSource, /I have checked that the reservation form reflects the developer-approved commercial terms\./);
  assert.doesNotMatch(workflowSource, /Additional special conditions/);
  assert.doesNotMatch(workflowSource, /Parking space or location details/);
  assert.match(workflowSource, /These values normally come from the building defaults\. Only change them for unit-specific exceptions\./);
  assert.match(workflowSource, /showAdvancedDealSetup \? "Hide setup" : "Edit deal setup"/);
});

test("commercial model opening scrolls to the close button and top cards show contribution types", () => {
  assert.match(workflowSource, /commercialModelControlRef/);
  assert.match(workflowSource, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(workflowSource, /activeDeveloperContributionDeductionLabel/);
  assert.match(workflowSource, /activeAgentContributionDeductionLabel/);
  assert.match(workflowSource, /contributionDeductionLabel/);
});

test("commercial model preserves contribution input types and calculates pound values", () => {
  assert.match(routeSource, /developerContributionValueType/);
  assert.match(routeSource, /calculateContributionAmount\(developerContributionValue, developerContributionValueType, contractPrice\)/);
  assert.match(routeSource, /p_developer_contribution_value_type: termsPatch\.developer_contribution_value_type/);
  assert.match(routeSource, /p_agent_contribution_value_type: termsPatch\.agent_contribution_value_type/);
  assert.match(buyerIncentivesMigrationSource, /developer_contribution_value_type text not null default 'amount'/);
  assert.match(buyerIncentivesMigrationSource, /agent_contribution_value_type text not null default 'amount'/);
});

test("reservation submission requires checked terms and split buyer identity", () => {
  const body = functionBody(routeSource, "saveReservation");
  assert.match(body, /buyerPersonName/);
  assert.match(body, /buyerCompanyName/);
  assert.match(body, /reservationDate/);
  assert.match(body, /workflow_status:\s*"awaiting_approval"/);
  assert.match(body, /sale_status:\s*"for_sale"/);
  assert.match(body, /reservationTermsChecked !== true/);
  assert.match(body, /reservation_submitted_by_name: requester\.name/);
  assert.match(body, /reservation_submitted_by_email: requester\.email/);
  assert.match(workflowSource, /Personal buyer name/);
  assert.match(workflowSource, /Company buyer name/);
  assert.match(workflowSource, /Reservation date/);
  assert.match(workflowSource, /Submitted by/);
  assert.doesNotMatch(workflowSource, /Submitter email/);
});

test("reservation approval uses the form date and developer reject action", () => {
  const approveBody = functionBody(routeSource, "approveReservation");
  const rejectBody = functionBody(routeSource, "rejectReservation");

  assert.match(reservationApprovalMigrationSource, /reservation_date date/);
  assert.match(reservationApprovalMigrationSource, /'awaiting_approval'/);
  assert.match(reservationApprovalMigrationSource, /'approved'/);
  assert.match(reservationApprovalMigrationSource, /'rejected'/);
  assert.match(approveBody, /workflow_status:\s*"approved"/);
  assert.match(approveBody, /reservation_date:\s*reservationDate/);
  assert.match(approveBody, /reservationDateTimestamp\(reservationDate\)/);
  assert.match(approveBody, /sale_status:\s*"reserved", reservation_date:\s*reservationDate/);
  assert.match(rejectBody, /workflow_status:\s*"rejected"/);
  assert.match(rejectBody, /reservation_rejection_reason:\s*rejectionReason/);
  assert.match(workflowSource, /Reject reservation/);
  assert.match(workflowSource, /Awaiting developer approval/);
  assert.doesNotMatch(workflowSource, /Query reservation/);
  assert.doesNotMatch(workflowSource, /Mark reservation as failed/);
});

test("reservation UI keeps document and activity history visible", () => {
  assert.match(workflowSource, /DocumentVersionHistory/);
  assert.match(workflowSource, /unit_sale_document_versions"\)\s+\.select\("\*"\)\s+\.in\("document_id", documentIds\)\s+\.order\("version_number"/);
  assert.match(workflowSource, /unit_sale_workflow_events/);
  assert.match(workflowSource, /Activity \{activeWorkflowEvents\.length\}/);
});

test("buyer identity migration backfills legacy buyer name without concatenating fields", () => {
  assert.match(buyerIncentivesMigrationSource, /set buyer_person_name = buyer_name/);
  assert.match(buyerIncentivesMigrationSource, /buyer_company_name text/);
  assert.match(buyerIncentivesMigrationSource, /unit_sale_attempts_buyer_identity_check/);
  assert.doesNotMatch(routeSource, /buyer_name:\s*`\$\{buyerPersonName\}/);
});

test("company-only buyer display does not reuse legacy buyer name as a personal name", () => {
  const buyerDisplayBody = plainFunctionBody(workflowSource, "buyerDisplay");
  assert.match(buyerDisplayBody, /const legacyPerson = company \? "" : attempt\?\.buyer_name\?\.trim\(\) \|\| "";/);
  assert.match(workflowSource, /setBuyerPersonName\(storedPersonName \|\| \(storedCompanyName \? "" : activeAttempt\.buyer_name \?\? ""\)\)/);
});

test("commercial model seeds deal setup from saved terms then building defaults", () => {
  assert.match(workflowSource, /setReservationFee\(activeTerms\?\.reservation_fee\?\.toString\(\) \?\? selectedBuildingDefault\?\.reservation_fee\?\.toString\(\) \?\? ""\)/);
  assert.match(workflowSource, /setReservationFeeHolder\(activeTerms\?\.reservation_fee_holder \?\? selectedBuildingDefault\?\.reservation_fee_holder_default \?\? "sales_agent"\)/);
  assert.match(workflowSource, /setAgentFeePercent\(activeTerms\?\.agent_fee_percent\?\.toString\(\) \?\? selectedBuildingDefault\?\.default_agent_fee_percent\?\.toString\(\) \?\? ""\)/);
});

test("commercial model omits advanced setup fields unless the section is opened", () => {
  const body = functionBody(workflowSource, "saveCommercialPackage");
  const advancedBlockStart = body.indexOf("if (showAdvancedDealSetup)");
  assert.notEqual(advancedBlockStart, -1, "saveCommercialPackage should gate advanced deal setup fields");
  const advancedBlock = body.slice(advancedBlockStart);

  assert.match(advancedBlock, /reservationFee/);
  assert.match(advancedBlock, /reservationFeeHolder/);
  assert.match(advancedBlock, /agentFeePercent/);
  assert.match(advancedBlock, /exchangeDepositPercent/);
  assert.doesNotMatch(body.slice(0, advancedBlockStart), /reservationFee|agentFeePercent|exchangeDepositPercent/);
});
