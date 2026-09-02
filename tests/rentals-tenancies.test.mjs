import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adjacentRentalUnits,
  currentVoidDays,
  rentChange,
  rentalOccupancy,
  summariseRentals,
  tenancyHistoryMetrics,
  tenancyState,
  tenanciesOverlap,
  voidDaysBetween,
} from "../src/lib/rentals/tenancies.ts";

const migration = readFileSync("supabase/migrations/20260831_rentals_tenancies.sql", "utf8");
const route = readFileSync("src/app/api/rentals/tenancies/route.ts", "utf8");
const workspace = readFileSync("src/components/portal/rentals/RentalsWorkspace.tsx", "utf8");
const app = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const fees = readFileSync("src/components/portal/sales/AgentFeesPortfolio.tsx", "utf8");

function tenancy(overrides = {}) {
  return {
    id: "t-1", building_id: "b-1", unit_id: "u-1", tenant_name: "A Smith",
    tenancy_start_date: "2026-01-01", fixed_term_end_date: "2026-12-31", tenancy_end_date: null,
    monthly_rent: 1200, rent_due_day: 1, deposit_amount: 1200, letting_agent_organisation_id: null,
    notes: null, source_type: "manual", source_reference: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function unit(overrides = {}) {
  return { id: "u-1", building_id: "b-1", unit_number: "69", floor: "First", rental_portfolio_status: "active", sale_status: "not_for_sale", ...overrides };
}

test("historical, current and future tenancy states derive from dates", () => {
  assert.equal(tenancyState(tenancy({ tenancy_end_date: "2026-05-15" }), "2026-08-30"), "ended");
  assert.equal(tenancyState(tenancy(), "2026-08-30"), "active");
  assert.equal(tenancyState(tenancy({ tenancy_start_date: "2026-09-01" }), "2026-08-30"), "scheduled");
});

test("fixed-term expiry alone does not end a tenancy but actual end does", () => {
  assert.equal(tenancyState(tenancy({ fixed_term_end_date: "2026-06-01", tenancy_end_date: null }), "2026-08-30"), "active");
  assert.equal(tenancyState(tenancy({ fixed_term_end_date: "2026-12-01", tenancy_end_date: "2026-08-29" }), "2026-08-30"), "ended");
});

test("overlapping occupancy is detected and database exclusion is authoritative", () => {
  assert.equal(tenanciesOverlap(tenancy({ tenancy_end_date: null }), tenancy({ tenancy_start_date: "2026-09-01" })), true);
  assert.equal(tenanciesOverlap(tenancy({ tenancy_end_date: "2026-05-15" }), tenancy({ tenancy_start_date: "2026-05-16" })), false);
  assert.match(migration, /exclude using gist/);
  assert.match(migration, /unit_tenancies_no_overlapping_occupancy/);
  assert.match(route, /error\.code === "23P01"/);
});

test("occupancy derives from rental allocation plus an active tenancy", () => {
  assert.equal(rentalOccupancy(unit(), [tenancy()], "2026-08-30"), "occupied");
  assert.equal(rentalOccupancy(unit(), [], "2026-08-30"), "void");
  assert.equal(rentalOccupancy(unit({ rental_portfolio_status: "not_in_portfolio" }), [tenancy()], "2026-08-30"), "not_in_portfolio");
});

test("void calculations handle consecutive, historical gap, current gap and no first tenancy", () => {
  assert.equal(voidDaysBetween("2026-05-15", "2026-05-16"), 0);
  assert.equal(voidDaysBetween("2026-05-15", "2026-05-28"), 12);
  assert.equal(currentVoidDays("2026-08-20", "2026-08-30"), 10);
  assert.equal(tenancyHistoryMetrics([tenancy()])[0].voidDaysBefore, null);
  assert.match(workspace, /No tenancy recorded/);
});

test("rent changes support increases, reductions and no prior tenancy", () => {
  assert.deepEqual(rentChange(1200, 1000), { amount: 200, percentage: 0.2 });
  assert.deepEqual(rentChange(1100, 1225), { amount: -125, percentage: -125 / 1225 });
  assert.equal(rentChange(1200, null), null);
});

test("rental file navigation follows the visible unit order and stops at each edge", () => {
  const units = [unit({ id: "u-1" }), unit({ id: "u-2" }), unit({ id: "u-3" })];
  assert.deepEqual(adjacentRentalUnits(units, "u-1"), { previousUnit: null, nextUnit: units[1] });
  assert.deepEqual(adjacentRentalUnits(units, "u-2"), { previousUnit: units[0], nextUnit: units[2] });
  assert.deepEqual(adjacentRentalUnits(units, "u-3"), { previousUnit: units[1], nextUnit: null });
  assert.deepEqual(adjacentRentalUnits(units, "missing"), { previousUnit: null, nextUnit: null });
});

test("rent roll includes only active tenancies and annualises monthly rent", () => {
  const units = [unit(), unit({ id: "u-2", unit_number: "70" }), unit({ id: "u-3", unit_number: "71" })];
  const tenancies = [tenancy(), tenancy({ id: "t-2", unit_id: "u-2", monthly_rent: 1000, tenancy_end_date: "2026-08-29" }), tenancy({ id: "t-3", unit_id: "u-3", monthly_rent: 900, tenancy_start_date: "2026-09-01" })];
  const summary = summariseRentals(units, tenancies, "2026-08-30");
  assert.equal(summary.monthlyRentRoll, 1200);
  assert.equal(summary.annualisedRentRoll, 14400);
  assert.equal(summary.occupied, 1);
  assert.equal(summary.void, 2);
});

test("Rentals UI contains only active portfolio units and dedicated Rental Files", () => {
  assert.match(workspace, /rental_portfolio_status === "active"/);
  assert.match(workspace, /Current tenancy/);
  assert.match(workspace, /Tenancy history/);
  assert.match(workspace, /Next tenancy/);
  assert.match(workspace, /Open sale file/);
  assert.match(app, /label: "Rentals"/);
  assert.match(app, /roles: \["admin", "developer"\]/);
});

test("tenancy permissions, RLS, protected CRUD and audit events are enforced", () => {
  assert.match(migration, /current_app_role\(\) in \('admin', 'developer'\)/);
  assert.match(migration, /revoke insert, update, delete/);
  assert.match(migration, /assert_tenancy_manager/);
  assert.match(migration, /'tenancy_created'/);
  assert.match(migration, /'tenancy_updated'/);
  assert.match(migration, /'tenancy_deleted'/);
  assert.match(route, /Only administrators or developers can manage tenancies/);
  assert.match(route, /Only administrators can delete tenancies/);
});

test("allocation integration retains history while active Rentals follows portfolio status", () => {
  assert.match(workspace, /units\.filter\(\(unit\) => unit\.rental_portfolio_status === "active"\)/);
  assert.doesNotMatch(migration, /references public\.units\(id\) on delete cascade/);
  assert.match(migration, /rental_portfolio_status not in \('active', 'exited'\)/);
});

test("Agent Fees applies the shared global building scope", () => {
  assert.match(fees, /Scope: \{scopeLabel\}/);
  assert.match(fees, /buildingContextId/);
  assert.doesNotMatch(fees, /initialBuildingId/);
  assert.doesNotMatch(fees, />Building<select/);
  assert.match(fees, /summariseAgentFeePortfolio\(filteredRows\)/);
});
