import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveBuildingContext } from "../src/hooks/usePortalBuildingContext.ts";

const portal = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const sales = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const fees = readFileSync("src/components/portal/sales/AgentFeesPortfolio.tsx", "utf8");
const rentals = readFileSync("src/components/portal/rentals/RentalsWorkspace.tsx", "utf8");
const allocation = readFileSync("src/components/portal/UnitAllocationWorkspace.tsx", "utf8");
const audit = readFileSync("src/components/portal/audit/AuditLog.tsx", "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("building context defaults to All buildings and restores valid saved or legacy choices", () => {
  const accessibleBuildingIds = ["forum", "trinity"];
  assert.equal(resolveBuildingContext({ accessibleBuildingIds }), "");
  assert.equal(resolveBuildingContext({ accessibleBuildingIds, savedValue: "trinity" }), "trinity");
  assert.equal(resolveBuildingContext({ accessibleBuildingIds, legacyValues: ["forum"] }), "forum");
  assert.equal(resolveBuildingContext({ accessibleBuildingIds, canonicalValue: "all", savedValue: "trinity" }), "");
});

test("building context never substitutes a different specific building", () => {
  assert.equal(resolveBuildingContext({ accessibleBuildingIds: ["forum", "trinity"], savedValue: "deleted" }), "");
  assert.equal(resolveBuildingContext({ accessibleBuildingIds: [], canonicalValue: "forum" }), "");
  assert.equal(resolveBuildingContext({ accessibleBuildingIds: ["trinity"], canonicalValue: "all" }), "trinity");
});

test("the shell owns the accessible desktop and mobile building controls", () => {
  const shell = functionBody(portal, "Shell", "notificationVariantClasses");
  assert.match(shell, /aria-label="Current building"/);
  assert.match(shell, /<option value="">All buildings<\/option>/);
  assert.match(shell, /buildings\.length === 1/);
  assert.match(shell, /mobile-menu-panel[\s\S]*Building[\s\S]*onBuildingContextChange/);
});

test("operational pages inherit global context instead of owning building filters", () => {
  const snagList = functionBody(portal, "SnagList", "PhotoThumb");
  const reports = functionBody(portal, "ReportsPanel", "SnagList");
  assert.doesNotMatch(snagList, /aria-label="Building filter"/);
  assert.doesNotMatch(reports, /setBuildingId/);
  assert.doesNotMatch(sales, /setBuildingId/);
  assert.doesNotMatch(fees, /initialBuildingId|onBuildingChange/);
  assert.doesNotMatch(rentals, /setBuildingId|rentalsBuildingId/);
  assert.doesNotMatch(allocation, /allocationBuildingId|aria-label="Building context"/);
  assert.doesNotMatch(audit, /setBuildingId|<FilterSelect label="Building"/);
});

test("All buildings keeps unit and building identity visible", () => {
  assert.match(sales, /!buildingId && <th[^>]*>Building<\/th>/);
  assert.match(fees, />Building<\/th>/);
  assert.match(rentals, /!buildingId && <th[^>]*>Building<\/th>/);
  assert.match(allocation, /!buildingFilter && <th[^>]*>Building<\/th>/);
  assert.match(portal, /contextIsAll && <th[^>]*>Building<\/th>/);
  assert.match(portal, /Forum House|buildingName/);
});

test("Setup order and system-wide Users & access exception are explicit", () => {
  const allocationIndex = portal.indexOf("setup_allocation:");
  const auditIndex = portal.indexOf("setup_activity:");
  const usersIndex = portal.indexOf("setup_people:");
  assert.ok(allocationIndex < auditIndex && auditIndex < usersIndex);
  assert.match(portal, /label: "Users & access"/);
  assert.match(portal, />System-wide<\/span>/);
  assert.match(portal, /This page is not filtered by the selected building/);
});
