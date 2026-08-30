import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canCreateSaleAttempt,
  isBlockingSaleWorkflow,
  isSalesRouteStatus,
  saleWorkflowLabel,
  sortUnitsByBuildingFloorOrder,
  summariseUnitAllocation,
  unitAllocationActionAvailability,
  validateRentalPortfolioChange,
  validateSalesAvailabilityChange,
} from "../src/lib/units/commercial-allocation.ts";
import { parseUnitAllocationMutation } from "../src/lib/units/allocation-mutation.ts";
import { deriveAgentFeePortfolioRow } from "../src/lib/sales/agent-fees-portfolio.ts";

const migration = readFileSync("supabase/migrations/20260828_commercial_unit_allocation.sql", "utf8");
const refinementMigration = readFileSync("supabase/migrations/20260829_unit_allocation_pristine_drafts.sql", "utf8");
const runtimeRefinementMigration = readFileSync("supabase/migrations/20260830_unit_allocation_runtime_refinement.sql", "utf8");
const portal = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const allocationUi = readFileSync("src/components/portal/UnitAllocationWorkspace.tsx", "utf8");
const allocationRoute = readFileSync("src/app/api/units/allocation/route.ts", "utf8");
const salesUi = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const forecastingUi = readFileSync("src/components/portal/sales/SalesForecastingModule.tsx", "utf8");
const salesRoute = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const agentFeesUi = readFileSync("src/components/portal/sales/AgentFeesPortfolio.tsx", "utf8");
const importScript = readFileSync("scripts/import-cleanup-template.mjs", "utf8");
const seedScript = readFileSync("scripts/seed-staging.mjs", "utf8");

function unit(overrides = {}) {
  return {
    id: "unit-1",
    unit_number: "LG03",
    sale_status: "for_sale",
    rental_portfolio_status: "not_in_portfolio",
    ...overrides,
  };
}

function feeInput(overrides = {}) {
  return {
    saleAttemptId: "attempt-1",
    buildingId: "building-1",
    buildingName: "Forum House",
    unitId: "unit-1",
    unitNumber: "LG03",
    unitSaleStatus: "for_sale",
    workflowStatus: "exchanged",
    salePrice: 300_000,
    exchangeFeePercent: 1,
    completionFeePercent: 0.5,
    vatRate: 20,
    ...overrides,
  };
}

test("foundation migration extends valid positions and backfills rental allocation without changing its contemporary default", () => {
  for (const status of ["not_released", "not_for_sale", "for_sale", "reserved", "exchanged", "completed", "handed_over"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.doesNotMatch(migration, /alter column sale_status set default/);
  assert.match(migration, /set rental_portfolio_status = 'not_in_portfolio'[\s\S]*where rental_portfolio_status is null/);
  assert.match(migration, /alter column rental_portfolio_status set default 'not_in_portfolio'/);
  assert.match(migration, /check \(rental_portfolio_status in \('not_in_portfolio', 'active', 'exited'\)\)/);
  assert.doesNotMatch(migration, /'occupied'|'void'/i);
});

test("organisation and building-role constraints accept letting and managing agents without changing profile roles", () => {
  assert.match(migration, /organisations_type_check[\s\S]*'letting_agent'[\s\S]*'managing_agent'/);
  assert.match(migration, /building_organisations_role_on_project_check[\s\S]*'letting_agent'[\s\S]*'managing_agent'/);
  assert.doesNotMatch(migration, /profiles_role_final_check/);
  assert.match(portal, /value: "letting_agent", label: "Letting agent"/);
  assert.match(portal, /value: "managing_agent", label: "Managing agent"/);
  assert.match(portal, /value: "leaseholder", label: "Leaseholder"/);
  assert.match(portal, /value: "tenant", label: "Tenant"/);
  assert.match(portal, /value: "letting_agent", label: "Letting Agent"/);
  assert.match(portal, /value: "managing_agent", label: "Managing Agent"/);
});

test("generic authenticated updates are closed while narrow service-only functions remain", () => {
  assert.match(migration, /drop policy if exists "admins manage units"/);
  assert.match(migration, /revoke update on table public\.units from authenticated/);
  assert.match(migration, /prevent_direct_unit_commercial_status_change/);
  assert.match(migration, /old\.sale_status is distinct from new\.sale_status/);
  assert.match(migration, /old\.rental_portfolio_status is distinct from new\.rental_portfolio_status/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /grant execute on function public\.set_unit_sales_availability[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.set_unit_rental_portfolio_status[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.set_unit_(?:sales_availability|rental_portfolio_status)[^;]*to authenticated/);
});

test("allocation API accepts only named administrative and rental responsibilities", () => {
  assert.deepEqual(parseUnitAllocationMutation({ action: "set_sales_availability", unitIds: ["unit-1"], target: "not_for_sale" }), {
    action: "set_sales_availability", unitIds: ["unit-1"], target: "not_for_sale",
  });
  assert.deepEqual(parseUnitAllocationMutation({ action: "set_rental_portfolio", unitIds: ["unit-1"], target: "active" }), {
    action: "set_rental_portfolio", unitIds: ["unit-1"], target: "active",
  });
  assert.throws(() => parseUnitAllocationMutation({ action: "set_sales_availability", unitIds: ["unit-1"], target: "reserved" }));
  assert.throws(() => parseUnitAllocationMutation({ action: "set_rental_portfolio", unitIds: ["unit-1"], target: "not_in_portfolio" }));
  assert.throws(() => parseUnitAllocationMutation({ action: "set_sales_availability", unitIds: ["unit-1", "unit-1"], target: "for_sale" }));
  assert.match(allocationRoute, /\["admin", "developer"\]\.includes/);
  assert.match(allocationRoute, /set_unit_sales_availability/);
  assert.match(allocationRoute, /set_unit_rental_portfolio_status/);
  assert.match(allocationRoute, /allocationErrorMessage/);
  assert.match(allocationRoute, /"message" in error/);
});

test("sales availability validation blocks formal stages and active sale files", () => {
  assert.equal(validateSalesAvailabilityChange(unit(), undefined, "not_for_sale"), null);
  assert.equal(validateSalesAvailabilityChange(unit({ sale_status: "not_for_sale" }), undefined, "for_sale"), null);
  assert.equal(validateSalesAvailabilityChange(unit(), undefined, "not_released"), null);
  assert.match(validateSalesAvailabilityChange(unit({ sale_status: "reserved" }), undefined, "for_sale"), /formal sales workflow/);
  assert.match(validateSalesAvailabilityChange(unit({ sale_status: "exchanged" }), undefined, "for_sale"), /formal sales workflow/);
  assert.equal(
    validateSalesAvailabilityChange(unit(), { id: "attempt-1", unit_id: "unit-1", workflow_status: "draft", is_active: true, blocks_allocation: true }, "not_for_sale"),
    "Unit LG03 has a sales workflow in progress. Resolve the sales workflow before changing its sales availability.",
  );
  assert.doesNotMatch(migration, /delete from public\.unit_sale_attempts|delete from public\.unit_sale_invoices|delete from public\.unit_sale_documents/);
});

test("pristine active drafts do not block allocation, but substantive and progressed workflows do", () => {
  const pristine = { id: "attempt-1", unit_id: "unit-1", workflow_status: "draft", is_active: true, blocks_allocation: false };
  const substantive = { ...pristine, blocks_allocation: true };
  assert.equal(isBlockingSaleWorkflow(pristine), false);
  assert.equal(saleWorkflowLabel(pristine), "Not started");
  assert.equal(validateSalesAvailabilityChange(unit(), pristine, "not_for_sale"), null);
  assert.equal(validateSalesAvailabilityChange(unit(), pristine, "not_released"), null);
  assert.equal(validateSalesAvailabilityChange(unit({ sale_status: "not_for_sale" }), pristine, "for_sale"), null);
  assert.equal(isBlockingSaleWorkflow(substantive), true);
  assert.equal(saleWorkflowLabel(substantive), "Sale preparation");
  assert.match(validateSalesAvailabilityChange(unit(), substantive, "not_for_sale"), /sales workflow in progress/);

  const progressedLabels = new Map([
    ["reservation_submitted", "Reservation submitted"],
    ["reservation_query_raised", "Reservation query"],
    ["reservation_approved", "Reservation approved"],
    ["awaiting_commercial_approval", "Commercial approval"],
    ["ready_for_exchange", "Ready for exchange"],
    ["exchanged", "Exchanged"],
    ["completion_pending", "Completion pending"],
    ["completed", "Completed"],
  ]);
  for (const [workflow_status, label] of progressedLabels) {
    const attempt = { ...pristine, workflow_status, blocks_allocation: true };
    assert.equal(isBlockingSaleWorkflow(attempt), true);
    assert.equal(saleWorkflowLabel(attempt), label);
  }
  for (const workflow_status of ["fallen_through", "superseded"]) {
    assert.equal(saleWorkflowLabel({ ...pristine, workflow_status, blocks_allocation: false }), "Not started");
  }

  assert.doesNotMatch(refinementMigration, /delete from public\.unit_sale_attempts/);
});

test("database helper treats persisted buyer, commercial, document and financial work as substantive", () => {
  assert.match(runtimeRefinementMigration, /sale_attempt_has_meaningful_activity/);
  assert.match(runtimeRefinementMigration, /sale_attempt_blocks_unit_allocation/);
  assert.match(runtimeRefinementMigration, /workflow_status in \('fallen_through', 'superseded'\) then false/);
  assert.match(runtimeRefinementMigration, /workflow_status <> 'draft' then true/);
  for (const signal of [
    "buyer_person_name",
    "reservation_terms_checked",
    "unit_sale_terms",
    "unit_sale_documents",
    "unit_sale_document_versions",
    "unit_sale_invoices",
    "unit_sale_invoice_payments",
    "unit_sale_notes",
    "unit_sale_workflow_events",
  ]) assert.match(runtimeRefinementMigration, new RegExp(signal));
  assert.doesNotMatch(runtimeRefinementMigration.slice(runtimeRefinementMigration.indexOf("sale_attempt_has_meaningful_activity"), runtimeRefinementMigration.indexOf("update public.unit_sale_attempts attempt")), /terms\.(?:created|updated)_by_user_id|schedule\.(?:created|updated)_by_user_id/);
  assert.match(runtimeRefinementMigration, /is_system_baseline/);
  assert.match(runtimeRefinementMigration, /prepare_unit_baseline_sale_record/);
  assert.match(runtimeRefinementMigration, /mark_sale_attempt_substantive/);
  assert.match(refinementMigration, /get_unit_allocation_sale_workflows/);
  assert.match(refinementMigration, /and public\.sale_attempt_blocks_unit_allocation\(attempt\.id\)/);
  assert.match(refinementMigration, /for update[\s\S]*sales workflows in progress/);
  assert.match(runtimeRefinementMigration, /before insert or update of is_active, unit_id, workflow_status/);
  assert.match(runtimeRefinementMigration, /validate_sale_draft_substantive_write/);
  assert.match(runtimeRefinementMigration, /validate_sale_draft_terms_write/);
  assert.match(runtimeRefinementMigration, /validate_sale_draft_schedule_write/);
  assert.match(runtimeRefinementMigration, /validate_sale_draft_document_write/);
});

test("bulk allocation actions are contextual across current, blocked, rental and mixed selections", () => {
  const attempts = new Map();
  assert.deepEqual(unitAllocationActionAvailability([], attempts, { kind: "sales", target: "for_sale" }), {
    enabled: false,
    reason: "Select at least one unit.",
  });

  const notReleased = unit({ id: "not-released", sale_status: "not_released" });
  const forSale = unit({ id: "for-sale", sale_status: "for_sale" });
  const retained = unit({ id: "retained", sale_status: "not_for_sale" });
  assert.equal(unitAllocationActionAvailability([notReleased], attempts, { kind: "sales", target: "not_released" }).enabled, false);
  assert.equal(unitAllocationActionAvailability([notReleased], attempts, { kind: "sales", target: "for_sale" }).enabled, true);
  assert.equal(unitAllocationActionAvailability([forSale, retained], attempts, { kind: "sales", target: "for_sale" }).enabled, true);

  const blockingAttempts = new Map([[forSale.id, {
    id: "attempt-1", unit_id: forSale.id, workflow_status: "draft", is_active: true, blocks_allocation: true,
  }]]);
  assert.deepEqual(unitAllocationActionAvailability([forSale], blockingAttempts, { kind: "sales", target: "not_for_sale" }), {
    enabled: false,
    reason: "Sales workflow in progress.",
  });

  const activeRental = unit({ id: "rental", rental_portfolio_status: "active" });
  assert.match(unitAllocationActionAvailability([activeRental], attempts, { kind: "rental", target: "active" }).reason, /Already in rental/);
  assert.equal(unitAllocationActionAvailability([activeRental], attempts, { kind: "rental", target: "exited" }).enabled, true);
  assert.equal(unitAllocationActionAvailability([forSale], attempts, { kind: "rental", target: "exited" }).enabled, false);
  assert.match(unitAllocationActionAvailability([activeRental, forSale], attempts, { kind: "rental", target: "active" }).reason, /already in the rental/);
  assert.match(unitAllocationActionAvailability([activeRental, forSale], attempts, { kind: "rental", target: "exited" }).reason, /not in the rental/);
  assert.match(unitAllocationActionAvailability([notReleased], attempts, { kind: "rental", target: "active" }).reason, /Not eligible/);
});

test("rental allocation is independent of the sales position and follows the permitted matrix", () => {
  for (const saleStatus of ["not_for_sale", "for_sale", "reserved", "exchanged"]) {
    assert.equal(validateRentalPortfolioChange(unit({ sale_status: saleStatus }), "active"), null);
  }
  for (const saleStatus of ["not_released", "completed", "handed_over"]) {
    assert.match(validateRentalPortfolioChange(unit({ sale_status: saleStatus }), "active"), /cannot enter the rental portfolio/);
  }
  assert.equal(validateRentalPortfolioChange(unit({ rental_portfolio_status: "active" }), "exited"), null);
  assert.equal(validateRentalPortfolioChange(unit({ rental_portfolio_status: "exited", sale_status: "for_sale" }), "active"), null);
  assert.match(migration, /set rental_portfolio_status = p_target_status/);
  assert.doesNotMatch(migration.slice(migration.indexOf("set_unit_rental_portfolio_status"), migration.indexOf("sales_workflow_mark_unit_for_sale")), /set sale_status =/);
});

test("completion exits active rental stock in the same protected function and handover does not repeat it", () => {
  const completionStart = migration.indexOf("sales_workflow_mark_unit_completed");
  const completionEnd = migration.indexOf("initialize_imported_unit_sale_status", completionStart);
  const completion = migration.slice(completionStart, completionEnd);
  assert.match(completion, /set sale_status = 'completed'/);
  assert.match(completion, /rental_portfolio_status = case when rental_portfolio_status = 'active' then 'exited'/);
  assert.match(completion, /'unit_exited_rental_portfolio'/);
  assert.match(completion, /'related_sale_attempt', p_sale_attempt_id/);
  assert.match(migration, /current_setting\('app\.handover_completion'/);
  assert.equal((completion.match(/'unit_exited_rental_portfolio'/g) ?? []).length, 1);
});

test("new sale files require For sale while legitimate route writers use named protected RPCs", () => {
  assert.equal(canCreateSaleAttempt("for_sale"), true);
  for (const status of ["not_released", "not_for_sale", "reserved", "exchanged", "completed", "handed_over"]) {
    assert.equal(canCreateSaleAttempt(status), false);
  }
  assert.match(salesRoute, /if \(!canCreateSaleAttempt\(unit\.sale_status\)\)/);
  assert.match(runtimeRefinementMigration, /validate_active_sale_attempt_entry[\s\S]*for update[\s\S]*v_sale_status <> 'for_sale'/);
  assert.match(runtimeRefinementMigration, /app\.unit_baseline_initialization/);
  for (const rpc of ["sales_workflow_mark_unit_for_sale", "sales_workflow_mark_unit_reserved", "sales_workflow_mark_unit_exchanged", "sales_workflow_mark_unit_completed"]) {
    assert.match(salesRoute, new RegExp(rpc));
  }
  assert.doesNotMatch(salesRoute, /from\("units"\)\.update\(\{ sale_status:/);
  assert.match(importScript, /initialize_imported_unit_sale_status/);
  assert.match(seedScript, /initialize_imported_unit_sale_status/);
});

test("Unit allocation is a gated Setup workspace with filters, summaries, selection, pagination and confirmation", () => {
  assert.match(portal, /setup_allocation:[\s\S]*roles: \["admin", "developer"\]/);
  assert.match(portal, /label: "Unit allocation"/);
  assert.match(allocationUi, /Total units/);
  assert.match(allocationUi, /Not released/);
  assert.match(allocationUi, /Sales route/);
  assert.match(allocationUi, /Sale and rental/);
  assert.match(allocationUi, /salesFilters/);
  assert.match(allocationUi, /rentalFilters/);
  assert.match(allocationUi, /PAGE_SIZE = 12/);
  assert.match(allocationUi, /Select units on this page/);
  assert.match(allocationUi, /role="dialog" aria-modal="true"/);
  assert.match(allocationUi, /transactional, all-or-nothing/);
  assert.match(allocationUi, /Sale workflow/);
  assert.match(allocationUi, /Not started/);
  assert.match(allocationUi, /Sales availability/);
  assert.match(allocationUi, /unitAllocationActionAvailability/);
  assert.match(allocationUi, /title=\{availability\.reason\}/);
  assert.match(allocationUi, /setValidationError\(""\)/);
  assert.match(allocationUi, /sortUnitsByBuildingFloorOrder/);
  assert.doesNotMatch(allocationUi, /Active sale file/);
  assert.doesNotMatch(allocationUi, />Sales action</);
  assert.match(portal, /params\.set\("salesUnitId", unit\.id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /'batch_identifier'/);
  assert.match(migration, /insert into public\.audit_events/);
});

test("unit allocation follows each building's configured floor order before natural unit number order", () => {
  const buildings = [{ id: "building-b" }, { id: "building-a" }];
  const floors = [
    { building_id: "building-a", name: "First", sort_order: 20 },
    { building_id: "building-a", name: "Ground", sort_order: 10 },
    { building_id: "building-b", name: "Ground", sort_order: 20 },
    { building_id: "building-b", name: "First", sort_order: 10 },
  ];
  const units = [
    { building_id: "building-a", floor: "First", unit_number: "A2" },
    { building_id: "building-b", floor: "Ground", unit_number: "B1" },
    { building_id: "building-a", floor: "Ground", unit_number: "A10" },
    { building_id: "building-b", floor: "First", unit_number: "B10" },
    { building_id: "building-b", floor: "First", unit_number: "B2" },
  ];

  assert.deepEqual(
    sortUnitsByBuildingFloorOrder(units, floors, buildings).map((item) => item.unit_number),
    ["B2", "B10", "B1", "A10", "A2"],
  );
});

test("rental confirmations preserve the sales position and exited is operationally not in portfolio", () => {
  assert.match(allocationUi, /Its sales position will remain/);
  assert.match(allocationUi, /Every unit will keep its current sales position/);
  assert.match(allocationUi, /Remove Unit/);
  assert.match(allocationUi, /operationalRentalStatusLabel/);
  assert.match(allocationUi, /status === "active" \? "Rental portfolio" : "Not in rental portfolio"/);
  const rentalFunction = migration.slice(migration.indexOf("set_unit_rental_portfolio_status"), migration.indexOf("sales_workflow_mark_unit_for_sale"));
  assert.doesNotMatch(rentalFunction, /set sale_status =/);
});

test("new units default to Not released and enter sales only after allocation", () => {
  assert.match(refinementMigration, /alter column sale_status set default 'not_released'/);
  assert.match(refinementMigration, /sale_status = 'not_released'/);
  assert.match(refinementMigration, /rental_portfolio_status = 'not_in_portfolio'/);
  assert.match(portal, /sale_status: "not_released"/);
  assert.match(portal, /rental_portfolio_status: "not_in_portfolio"/);
  assert.match(portal, /action: "save_setup_unit_price"/);
  assert.equal(isSalesRouteStatus("not_released"), false);
  assert.equal(canCreateSaleAttempt("not_released"), false);
  assert.equal(isSalesRouteStatus("for_sale"), true);
  assert.equal(canCreateSaleAttempt("for_sale"), true);
  assert.match(allocationUi, /units\.filter/);
  assert.match(migration, /unit\.sale_status in \('for_sale', 'reserved', 'exchanged', 'completed', 'handed_over'\)/);
});

test("allocation summaries are calculated over the current filtered scope", () => {
  const summary = summariseUnitAllocation([
    unit({ sale_status: "not_released" }),
    unit({ sale_status: "not_for_sale", rental_portfolio_status: "active" }),
    unit({ sale_status: "for_sale", rental_portfolio_status: "active" }),
    unit({ sale_status: "completed", rental_portfolio_status: "exited" }),
    unit({ sale_status: "handed_over", rental_portfolio_status: "exited" }),
  ]);
  assert.deepEqual(summary, { total: 5, notReleased: 1, salesRoute: 3, rentalPortfolio: 2, saleAndRental: 1, soldOrHandedOver: 2 });
});

test("one shared sales-route definition scopes results, counts and forecast value inputs", () => {
  for (const status of ["for_sale", "reserved", "exchanged", "completed", "handed_over"]) assert.equal(isSalesRouteStatus(status), true);
  assert.equal(isSalesRouteStatus("not_released"), false);
  assert.equal(isSalesRouteStatus("not_for_sale"), false);
  assert.match(salesUi, /units\.filter\(\(unit\) => unit\.building_id === buildingId && isSalesRouteUnit\(unit\)\)/);
  assert.match(salesUi, /const pipelineSummary = SALES_ROUTE_STATUSES\.map/);
  assert.match(salesUi, /in the sales route/);
  assert.match(salesUi, /Units with sale values/);
  assert.match(forecastingUi, /const salesRouteUnits = useMemo\(\(\) => buildingUnits\.filter\(isSalesRouteUnit\)/);
  assert.match(forecastingUi, /current sales route/);
});

test("Agent Fees suppresses prospective fees after withdrawal but retains actual financial positions", () => {
  const prospective = deriveAgentFeePortfolioRow(feeInput());
  assert.equal(prospective.noLongerForSale, false);
  assert.equal(prospective.futureCompletionFeeNet, 1_500);

  const withdrawn = deriveAgentFeePortfolioRow(feeInput({ unitSaleStatus: "not_for_sale", workflowStatus: "fallen_through" }));
  assert.equal(withdrawn.noLongerForSale, true);
  assert.equal(withdrawn.futureCompletionFeeNet, 0);
  assert.equal(withdrawn.completion.kind, "not_due");

  const actual = deriveAgentFeePortfolioRow(feeInput({
    unitSaleStatus: "not_released",
    workflowStatus: "fallen_through",
    exchangeInvoice: { id: "invoice-1", status: "submitted", gross_amount: 3_600, expected_payable_amount: 3_600 },
  }));
  assert.equal(actual.exchange.kind, "awaiting_approval");
  assert.equal(actual.currentOutstanding, 3_600);
  assert.equal(actual.futureCompletionFeeNet, 0);
  assert.match(migration, /unit\.sale_status in \('for_sale', 'reserved', 'exchanged', 'completed', 'handed_over'\)/);
  assert.match(migration, /or exchange_invoice\.id is not null[\s\S]*or completion_invoice\.id is not null/);
  assert.match(agentFeesUi, /No longer for sale/);
  assert.match(agentFeesUi, /filteredRows\.length/);
  assert.doesNotMatch(migration, /delete from public\.unit_sale_invoices|delete from public\.unit_sale_invoice_payments/);
});
