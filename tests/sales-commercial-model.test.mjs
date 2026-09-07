import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import ts from "typescript";
import { parsePercentInput } from "../src/lib/sales/percentages.ts";
import { validateAgentFeeStructure } from "../src/lib/sales/agent-fees.ts";
import { loadTypescriptModule } from "./helpers/load-typescript-module.mjs";

const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const workflowStyles = readFileSync("src/components/portal/sales/SalesReservationWorkflow.module.css", "utf8");
const setupSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260723_sales_stage_timestamp_and_commercial_model_rpc.sql", "utf8");
const buyerIncentivesMigrationSource = readFileSync("supabase/migrations/20260725_sales_buyer_incentives_and_identity.sql", "utf8");
const reservationApprovalMigrationSource = readFileSync("supabase/migrations/20260804_reservation_approval_workflow.sql", "utf8");
const commercialModelSource = readFileSync("src/lib/sales/commercial-model.ts", "utf8");
const { saveCommercialModel } = loadTypescriptModule("src/app/api/sales/reservations/route.ts", {
  overrides: { "@/lib/supabase/admin": { createSupabaseServiceRoleClient() { throw new Error("Live database access is forbidden in this test"); } } },
  exports: ["saveCommercialModel"],
});

function commercialSaveFixture(terms = {}, defaults = {}) {
  const rpcCalls = [];
  const records = {
    units: { id: "unit", unit_number: "101", building_id: "building", sale_status: "for_sale" },
    unit_sale_attempts: { id: "attempt", unit_id: "unit", building_id: "building", is_active: true, workflow_status: "draft" },
    unit_sale_terms: { id: "terms", contract_price: 340500, agent_fee_percent: 10, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5, second_deposit_enabled: true, second_deposit_percent: 5, second_deposit_months_after_exchange: 3, exchange_deposit_percent: 10, ...terms },
    building_sale_defaults: { default_agent_fee_percent: 10, default_exchange_agent_fee_percent: 9.5, default_completion_agent_fee_percent: 0.5, ...defaults },
  };
  const client = {
    from(table) {
      assert.ok(records[table], `Unexpected table ${table}`);
      const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: records[table], error: null }) };
      return query;
    },
    rpc: async (name, payload) => { rpcCalls.push({ name, payload }); return { data: { sale_attempt_id: "attempt", sale_terms_id: "terms" }, error: null }; },
  };
  const save = (patch = {}) => saveCommercialModel(client, { id: "developer", role: "developer" }, { action: "save_commercial_model", unitId: "unit", saleAttemptId: "attempt", ...patch });
  return { save, rpcCalls };
}

test("percentages preserve fractional percentage points rather than using whole-pound parsing", () => {
  for (const value of [9.5, "9.5", " 9.5 "]) assert.equal(parsePercentInput(value), 9.5);
  assert.equal(parsePercentInput(".5"), 0.5);
  assert.equal(parsePercentInput("0.095"), 0.095);
  assert.equal(parsePercentInput("10"), 10);
  assert.equal(parsePercentInput("9.50004"), 9.5);
  for (const value of ["", null, undefined, "nine", -1, "-0.5", 101, Infinity, NaN]) assert.equal(parsePercentInput(value), null);
  assert.equal(validateAgentFeeStructure({ totalFeePercent: 10, exchangeFeePercent: parsePercentInput("9.1"), completionFeePercent: parsePercentInput(".9") }).isValid, true);
});

test("saving displayed 10 / 9.5 / 0.5 fees sends the exact decimal split to the transactional RPC", async () => {
  const { save, rpcCalls } = commercialSaveFixture();
  await save({ agentFeePercent: "10", exchangeAgentFeePercent: "9.5", completionAgentFeePercent: "0.5", contractPrice: "350500", developerContribution: "2000" });
  const saved = rpcCalls[0].payload;
  assert.equal(rpcCalls[0].name, "save_unit_commercial_model_with_agent_fees");
  assert.equal(saved.p_agent_fee_percent, 10);
  assert.equal(saved.p_exchange_agent_fee_percent, 9.5);
  assert.equal(saved.p_completion_agent_fee_percent, 0.5);
  assert.equal(saved.p_contract_price, 350500);
  assert.equal(saved.p_developer_contribution, 2000);
});

test("unrelated saves preserve fees and the enabled second deposit when advanced fields are omitted", async () => {
  const { save, rpcCalls } = commercialSaveFixture();
  await save({ parkingContributionValue: "500", additionalSpecialConditions: ["Include parking"] });
  const saved = rpcCalls[0].payload;
  assert.deepEqual([saved.p_agent_fee_percent, saved.p_exchange_agent_fee_percent, saved.p_completion_agent_fee_percent], [10, 9.5, 0.5]);
  assert.equal(saved.p_second_deposit_enabled, true);
  assert.equal(saved.p_second_deposit_percent, 5);
  assert.equal(saved.p_completion_balance_percent, 85);
  assert.equal(saved.p_payment_schedule.length, 3);
});

test("saved unit fee overrides take precedence, null overrides inherit defaults, and zero stays zero", async () => {
  for (const [terms, expected] of [
    [{ agent_fee_percent: 8, exchange_agent_fee_percent: 7.5, completion_agent_fee_percent: 0.5 }, [8, 7.5, 0.5]],
    [{ agent_fee_percent: null, exchange_agent_fee_percent: null, completion_agent_fee_percent: null }, [10, 9.5, 0.5]],
    [{ agent_fee_percent: 0, exchange_agent_fee_percent: 0, completion_agent_fee_percent: 0 }, [0, 0, 0]],
  ]) {
    const { save, rpcCalls } = commercialSaveFixture(terms);
    await save({ agentFeePercent: "", exchangeAgentFeePercent: null });
    const saved = rpcCalls[0].payload;
    assert.deepEqual([saved.p_agent_fee_percent, saved.p_exchange_agent_fee_percent, saved.p_completion_agent_fee_percent], expected);
  }
});

test("invalid splits and malformed explicit fee inputs are blocked before the save RPC", async () => {
  for (const values of [[10, 9.5, 0.4], [10, -1, 11], ["bad", 0, 0], [101, 101, 0]]) {
    const { save, rpcCalls } = commercialSaveFixture();
    await assert.rejects(save({ agentFeePercent: values[0], exchangeAgentFeePercent: values[1], completionAgentFeePercent: values[2] }), /fee percentages|must equal/);
    assert.equal(rpcCalls.length, 0);
  }
});

test("explicit second deposit disable remains supported and fractional deposit percentages are preserved", async () => {
  const { save, rpcCalls } = commercialSaveFixture();
  await save({ secondDepositEnabled: false, exchangeDepositPercent: "9.5" });
  assert.equal(rpcCalls[0].payload.p_second_deposit_enabled, false);
  assert.equal(rpcCalls[0].payload.p_exchange_deposit_percent, 9.5);
  assert.equal(rpcCalls[0].payload.p_completion_balance_percent, 90.5);
});

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
  assert.match(setupSource, /action:\s*"save_setup_unit_price"/);
  assert.match(workflowSource, /action:\s*"save_commercial_model"/);
});

test("financial overview uses deliberate container-width layouts", () => {
  assert.match(workflowSource, /styles\.financialOverview/);
  assert.match(workflowSource, /styles\.financialOverviewGrid/);
  assert.match(workflowSource, /styles\.profitCard/);
  assert.doesNotMatch(workflowSource, /mt-5 grid gap-4 xl:grid-cols-3/);
  assert.match(workflowStyles, /container-type:\s*inline-size/);
  assert.match(workflowStyles, /@container financial-overview \(min-width: 42rem\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(workflowStyles, /@container financial-overview \(min-width: 64rem\)[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[\s\S]*grid-column:\s*auto/);
});

test("commercial model API uses the transactional RPC and avoids reservation progression side effects", () => {
  const body = functionBody(routeSource, "saveCommercialModel");

  assert.match(body, /prepare_unit_baseline_sale_record/);
  assert.match(body, /\.rpc\("save_unit_commercial_model_with_agent_fees"/);
  assert.match(body, /mark_sale_attempt_substantive/);
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

test("sale file includes the Buyer commercial section and advanced deal setup friction", () => {
  assert.match(workflowSource, />Buyer</);
  assert.match(workflowSource, /activeUnitSection === "commercial"/);
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
  assert.match(body, /rpc: "sales_workflow_mark_unit_for_sale"/);
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
  assert.match(approveBody, /rpc: "sales_workflow_mark_unit_reserved"/);
  assert.match(approveBody, /update\(\{ reservation_date: reservationDate \}\)/);
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
  assert.match(workflowSource, /sale_workflow_context/);
  assert.match(workflowSource, /<SaleConversationLayout/);
  assert.match(readFileSync("src/components/portal/sales/SaleConversation.tsx", "utf8"), /Load older activity/);
  assert.doesNotMatch(workflowSource, /Activity \{activeWorkflowEvents\.length\}/);
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
  const advancedBlockStart = body.indexOf("if (showAdvancedDealSetup || commercialSetupChanged)");
  assert.notEqual(advancedBlockStart, -1, "saveCommercialPackage should gate advanced deal setup fields");
  const advancedBlock = body.slice(advancedBlockStart);

  assert.match(advancedBlock, /reservationFee/);
  assert.match(advancedBlock, /reservationFeeHolder/);
  assert.match(advancedBlock, /agentFeePercent/);
  assert.match(advancedBlock, /exchangeDepositPercent/);
  assert.doesNotMatch(body.slice(0, advancedBlockStart), /reservationFee|agentFeePercent|exchangeDepositPercent/);
});
