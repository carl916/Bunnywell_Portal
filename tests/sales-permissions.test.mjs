import test from "node:test";
import assert from "node:assert/strict";

import {
  canOpenSalesPipeline,
  canPerformSalesAction,
  canViewApprovedCommercialPackage,
  canViewDeveloperCommercials,
  canViewSalesBuilding,
  canViewSalesForecasting,
} from "../src/lib/sales/permissions.ts";

const buildingA = "building-a";
const buildingB = "building-b";

test("developer roles can see and manage the full sales pipeline", () => {
  for (const role of ["admin", "developer"]) {
    assert.equal(canOpenSalesPipeline(role), true);
    assert.equal(canViewSalesBuilding({ role, buildingId: buildingA }), true);
    assert.equal(canViewDeveloperCommercials(role), true);
    assert.equal(canViewApprovedCommercialPackage(role), true);
    assert.equal(canViewSalesForecasting(role), true);
    assert.equal(canPerformSalesAction(role, "manage_building_defaults"), true);
    assert.equal(canPerformSalesAction(role, "manage_commercial_terms"), true);
    assert.equal(canPerformSalesAction(role, "approve_reservation"), true);
    assert.equal(canPerformSalesAction(role, "approve_commercial_package"), true);
    assert.equal(canPerformSalesAction(role, "approve_exchange"), true);
    assert.equal(canPerformSalesAction(role, "approve_completion_documents"), true);
    assert.equal(canPerformSalesAction(role, "record_developer_shortfall"), true);
  }
});

test("sales agents are building scoped and limited to reservation and invoice submission", () => {
  const role = "sales_agent";

  assert.equal(canOpenSalesPipeline(role), true);
  assert.equal(canViewSalesBuilding({ role, buildingId: buildingA, accessibleBuildingIds: [buildingA] }), true);
  assert.equal(canViewSalesBuilding({ role, buildingId: buildingB, accessibleBuildingIds: [buildingA] }), false);
  assert.equal(canViewDeveloperCommercials(role), false);
  assert.equal(canViewApprovedCommercialPackage(role), true);
  assert.equal(canViewSalesForecasting(role), false);
  assert.equal(canPerformSalesAction(role, "submit_reservation"), true);
  assert.equal(canPerformSalesAction(role, "submit_agent_invoice"), true);
  assert.equal(canPerformSalesAction(role, "approve_commercial_package"), false);
  assert.equal(canPerformSalesAction(role, "record_exchange"), false);
  assert.equal(canPerformSalesAction(role, "approve_exchange"), false);
  assert.equal(canPerformSalesAction(role, "record_developer_shortfall"), false);
  assert.equal(canPerformSalesAction(role, "record_completion"), false);
});

test("conveyancers are building scoped and limited to exchange/completion recording", () => {
  const role = "conveyancer";

  assert.equal(canOpenSalesPipeline(role), true);
  assert.equal(canViewSalesBuilding({ role, buildingId: buildingA, accessibleBuildingIds: [buildingA] }), true);
  assert.equal(canViewSalesBuilding({ role, buildingId: buildingB, accessibleBuildingIds: [buildingA] }), false);
  assert.equal(canViewDeveloperCommercials(role), false);
  assert.equal(canViewApprovedCommercialPackage(role), true);
  assert.equal(canViewSalesForecasting(role), false);
  assert.equal(canPerformSalesAction(role, "submit_reservation"), false);
  assert.equal(canPerformSalesAction(role, "request_exchange_approval"), true);
  assert.equal(canPerformSalesAction(role, "approve_commercial_package"), false);
  assert.equal(canPerformSalesAction(role, "record_exchange"), true);
  assert.equal(canPerformSalesAction(role, "record_solicitor_payment"), true);
  assert.equal(canPerformSalesAction(role, "record_developer_shortfall"), false);
  assert.equal(canPerformSalesAction(role, "submit_completion_documents"), true);
  assert.equal(canPerformSalesAction(role, "record_completion"), true);
  assert.equal(canPerformSalesAction(role, "approve_completion_documents"), false);
});

test("residents and contractors are blocked from sales pipeline data and actions", () => {
  for (const role of ["resident", "contractor"]) {
    assert.equal(canOpenSalesPipeline(role), false);
    assert.equal(canViewSalesBuilding({ role, buildingId: buildingA, accessibleBuildingIds: [buildingA] }), false);
    assert.equal(canViewDeveloperCommercials(role), false);
    assert.equal(canViewApprovedCommercialPackage(role), false);
    assert.equal(canViewSalesForecasting(role), false);
    assert.equal(canPerformSalesAction(role, "submit_reservation"), false);
    assert.equal(canPerformSalesAction(role, "approve_commercial_package"), false);
    assert.equal(canPerformSalesAction(role, "record_exchange"), false);
    assert.equal(canPerformSalesAction(role, "record_completion"), false);
  }
});

test("unknown or inactive role values have no sales access", () => {
  for (const role of ["user", "developer_representative", "", null, undefined]) {
    assert.equal(canOpenSalesPipeline(role), false);
    assert.equal(canViewSalesBuilding({ role, buildingId: buildingA, accessibleBuildingIds: [buildingA] }), false);
    assert.equal(canPerformSalesAction(role, "view_pipeline"), false);
  }
});
