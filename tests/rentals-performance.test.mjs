import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRentalPerformance,
  calculateUnitRentalPerformance,
  isRealTenantName,
  reportingPeriodStart,
} from "../src/lib/rentals/performance.ts";

const REPORTING_DATE = "2026-08-31";

function unit(id = "u-1", overrides = {}) {
  return { id, building_id: "b-1", unit_number: id.replace("u-", ""), sale_status: "not_for_sale", rental_portfolio_status: "active", ...overrides };
}

function tenancy(id = "t-1", overrides = {}) {
  return {
    id,
    building_id: "b-1",
    unit_id: "u-1",
    tenant_name: "A Smith",
    tenancy_start_date: "2026-01-01",
    fixed_term_end_date: null,
    tenancy_end_date: null,
    monthly_rent: 1200,
    rent_due_day: 1,
    deposit_amount: 1200,
    letting_agent_organisation_id: "agent-1",
    notes: null,
    source_type: "manual",
    source_reference: null,
    created_at: `${id}-created`,
    updated_at: `${id}-updated`,
    ...overrides,
  };
}

test("historical occupancy is 100% for continuous occupation and excludes pre-first-tenancy days", () => {
  const result = calculateUnitRentalPerformance(unit(), [tenancy()], REPORTING_DATE);
  assert.equal(result.measurementStart, "2026-01-01");
  assert.equal(result.measuredAvailableDays, 243);
  assert.equal(result.occupiedDays, 243);
  assert.equal(result.voidDays, 0);
  assert.equal(result.occupancyPercentage, 1);
});

test("historical occupancy handles one void and the consecutive-day convention", () => {
  const gap = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_end_date: "2026-01-31" }),
    tenancy("t-2", { tenancy_start_date: "2026-02-11", monthly_rent: 1250 }),
  ], REPORTING_DATE);
  assert.equal(gap.voidDays, 10);
  assert.equal(gap.voidPeriods[0].startDate, "2026-02-01");
  assert.equal(gap.voidPeriods[0].endDate, "2026-02-10");

  const consecutive = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_end_date: "2026-05-15" }),
    tenancy("t-2", { tenancy_start_date: "2026-05-16" }),
  ], REPORTING_DATE);
  assert.equal(consecutive.voidDays, 0);
  assert.equal(consecutive.voidPeriods.length, 0);
});

test("multiple historical voids and a current void are measured through the reporting date", () => {
  const result = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_start_date: "2026-01-01", tenancy_end_date: "2026-01-31" }),
    tenancy("t-2", { tenancy_start_date: "2026-02-06", tenancy_end_date: "2026-08-20" }),
  ], REPORTING_DATE);
  assert.deepEqual(result.voidPeriods.map((period) => period.days), [5, 11]);
  assert.equal(result.voidDays, 16);
  assert.equal(result.currentVoid?.days, 11);
  assert.equal(result.currentVoid?.startDate, "2026-08-21");
});

test("future tenancy days are excluded and no pre-first-tenancy void is invented", () => {
  const result = calculateUnitRentalPerformance(unit(), [tenancy("future", { tenancy_start_date: "2026-09-10" })], REPORTING_DATE);
  assert.equal(result.measurementStart, null);
  assert.equal(result.measuredAvailableDays, 0);
  assert.equal(result.occupiedDays, 0);
  assert.equal(result.voidDays, 0);
  assert.equal(result.estimatedVoidLoss, 0);
  assert.equal(result.currentTenancy, null);
  assert.equal(result.nextTenancy?.id, "future");
});

test("YTD and last-12-month reporting periods clip measurement and occupancy intervals", () => {
  const history = [tenancy("old", { tenancy_start_date: "2025-01-01" })];
  const ytd = calculateUnitRentalPerformance(unit(), history, REPORTING_DATE, "ytd");
  assert.equal(ytd.measurementStart, "2026-01-01");
  assert.equal(ytd.measuredAvailableDays, 243);
  assert.equal(ytd.occupiedDays, 243);

  const last12 = calculateUnitRentalPerformance(unit(), history, REPORTING_DATE, "last_12_months");
  assert.equal(reportingPeriodStart("last_12_months", REPORTING_DATE), "2025-09-01");
  assert.equal(last12.measurementStart, "2025-09-01");
  assert.equal(last12.measuredAvailableDays, 365);
});

test("void loss uses previous monthly rent times 12 divided by 365 without intermediate rounding", () => {
  const result = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_end_date: "2026-01-31", monthly_rent: 1200 }),
    tenancy("t-2", { tenancy_start_date: "2026-02-11" }),
  ], REPORTING_DATE);
  assert.equal(result.voidPeriods[0].estimatedLoss, 1200 * 12 / 365 * 10);
  assert.equal(result.estimatedVoidLoss, 1200 * 12 / 365 * 10);
});

test("void loss sums multiple gaps and handles current void", () => {
  const result = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_end_date: "2026-01-10", monthly_rent: 1000 }),
    tenancy("t-2", { tenancy_start_date: "2026-01-16", tenancy_end_date: "2026-08-28", monthly_rent: 1200 }),
  ], REPORTING_DATE);
  assert.equal(result.estimatedVoidLoss, 1000 * 12 / 365 * 5 + 1200 * 12 / 365 * 3);
  assert.equal(result.currentVoid?.estimatedLoss, 1200 * 12 / 365 * 3);
});

test("unknown previous rent produces unknown loss rather than zero", () => {
  const result = calculateUnitRentalPerformance(unit(), [tenancy("t-1", { tenancy_end_date: "2026-08-20", monthly_rent: null })], REPORTING_DATE);
  assert.equal(result.voidDays, 11);
  assert.equal(result.voidPeriods[0].estimatedLoss, null);
  assert.equal(result.estimatedVoidLoss, null);
  assert.equal(result.hasUnknownVoidLoss, true);
});

test("one unknown void makes the unit and portfolio loss unknown rather than silently partial", () => {
  const tenancies = [
    tenancy("t1", { tenancy_start_date: "2025-01-01", tenancy_end_date: "2025-01-31", monthly_rent: null }),
    tenancy("t2", { tenancy_start_date: "2025-02-11", tenancy_end_date: "2025-02-28", monthly_rent: 1_000 }),
    tenancy("t3", { tenancy_start_date: "2025-03-11", monthly_rent: 1_100 }),
  ];
  const unitResult = calculateUnitRentalPerformance(unit(), tenancies, "2025-03-31", "lifetime");
  const portfolioResult = calculateRentalPerformance([unit()], tenancies, { reportingDate: "2025-03-31" });

  assert.equal(unitResult.voidPeriods.length, 2);
  assert.equal(unitResult.estimatedVoidLoss, null);
  assert.equal(unitResult.hasUnknownVoidLoss, true);
  assert.equal(portfolioResult.performance.estimatedVoidLoss, null);
});

test("Last 12 months handles a leap-day reporting date as a calendar period", () => {
  assert.equal(reportingPeriodStart("last_12_months", "2024-02-29"), "2023-03-01");
});

test("void periods and loss are clipped to the selected reporting period", () => {
  const result = calculateUnitRentalPerformance(unit(), [
    tenancy("t-1", { tenancy_start_date: "2025-01-01", tenancy_end_date: "2025-12-20", monthly_rent: 1200 }),
    tenancy("t-2", { tenancy_start_date: "2026-01-11" }),
  ], REPORTING_DATE, "ytd");
  assert.equal(result.voidPeriods[0].startDate, "2026-01-01");
  assert.equal(result.voidPeriods[0].days, 10);
  assert.equal(result.voidPeriods[0].estimatedLoss, 1200 * 12 / 365 * 10);
});

test("rent performance covers equal, increased, reduced and zero first rent safely", () => {
  const equal = calculateUnitRentalPerformance(unit(), [tenancy()], REPORTING_DATE);
  assert.deepEqual(equal.currentVsFirstRent, { amount: 0, percentage: 0 });
  const higher = calculateUnitRentalPerformance(unit(), [tenancy("t-1", { tenancy_end_date: "2026-01-31", monthly_rent: 1000 }), tenancy("t-2", { tenancy_start_date: "2026-02-01", monthly_rent: 1200 })], REPORTING_DATE);
  assert.deepEqual(higher.currentVsFirstRent, { amount: 200, percentage: 0.2 });
  const lower = calculateUnitRentalPerformance(unit(), [tenancy("t-1", { tenancy_end_date: "2026-01-31", monthly_rent: 1225 }), tenancy("t-2", { tenancy_start_date: "2026-02-01", monthly_rent: 1100 })], REPORTING_DATE);
  assert.equal(lower.currentVsFirstRent?.amount, -125);
  assert.equal(lower.currentVsFirstRent?.percentage, -125 / 1225);
  const zero = calculateUnitRentalPerformance(unit(), [tenancy("t-1", { tenancy_end_date: "2026-01-31", monthly_rent: 0 }), tenancy("t-2", { tenancy_start_date: "2026-02-01", monthly_rent: 100 })], REPORTING_DATE);
  assert.deepEqual(zero.currentVsFirstRent, { amount: 100, percentage: null });
});

test("turnover is tenancy count minus one", () => {
  assert.equal(calculateUnitRentalPerformance(unit(), [tenancy()], REPORTING_DATE).tenancyChanges, 0);
  assert.equal(calculateUnitRentalPerformance(unit(), [tenancy("a", { tenancy_end_date: "2026-01-31" }), tenancy("b", { tenancy_start_date: "2026-02-01" })], REPORTING_DATE).tenancyChanges, 1);
  assert.equal(calculateUnitRentalPerformance(unit(), [tenancy("a", { tenancy_end_date: "2026-01-31" }), tenancy("b", { tenancy_start_date: "2026-02-01", tenancy_end_date: "2026-02-28" }), tenancy("c", { tenancy_start_date: "2026-03-01" })], REPORTING_DATE).tenancyChanges, 2);
});

test("portfolio aggregation weights occupied and available days instead of averaging unit percentages", () => {
  const units = [unit("u-1"), unit("u-2")];
  const tenancies = [
    tenancy("a", { unit_id: "u-1", tenancy_start_date: "2026-01-01", tenancy_end_date: "2026-01-09" }),
    tenancy("b", { unit_id: "u-2", tenancy_start_date: "2026-01-10" }),
  ];
  const result = calculateRentalPerformance(units, tenancies, { reportingDate: "2026-01-10" });
  assert.equal(result.performance.occupiedDays, 10);
  assert.equal(result.performance.measuredAvailableDays, 11);
  assert.equal(result.performance.occupancyPercentage, 10 / 11);
  assert.notEqual(result.performance.occupancyPercentage, 0.95);
});

test("portfolio rent roll and like-for-like movement use only currently occupied comparable units", () => {
  const units = [unit("u-1"), unit("u-2"), unit("u-3")];
  const tenancies = [
    tenancy("a1", { unit_id: "u-1", tenancy_end_date: "2026-01-31", monthly_rent: 1000 }),
    tenancy("a2", { unit_id: "u-1", tenancy_start_date: "2026-02-01", monthly_rent: 1100 }),
    tenancy("b1", { unit_id: "u-2", tenancy_end_date: "2026-01-31", monthly_rent: 1200 }),
    tenancy("b2", { unit_id: "u-2", tenancy_start_date: "2026-02-01", monthly_rent: 1100 }),
    tenancy("c1", { unit_id: "u-3", tenancy_end_date: "2026-08-20", monthly_rent: 900 }),
  ];
  const result = calculateRentalPerformance(units, tenancies, { reportingDate: REPORTING_DATE });
  assert.equal(result.currentPosition.monthlyRentRoll, 2200);
  assert.equal(result.currentPosition.annualisedRentRoll, 26400);
  assert.equal(result.performance.rentMovement?.amount, 0);
  assert.equal(result.performance.rentMovement?.percentage, 0);
  assert.equal(result.performance.comparableUnits, 2);
});

test("attention metrics find the longest void, largest reduction, current voids and fixed-term windows", () => {
  const units = [unit("u-1"), unit("u-2"), unit("u-3"), unit("u-4")];
  const tenancies = [
    tenancy("a1", { unit_id: "u-1", tenancy_end_date: "2026-01-01", monthly_rent: 1300 }),
    tenancy("a2", { unit_id: "u-1", tenancy_start_date: "2026-01-22", monthly_rent: 1100, fixed_term_end_date: "2026-09-20" }),
    tenancy("b1", { unit_id: "u-2", tenancy_end_date: "2026-08-20", monthly_rent: 1200 }),
    tenancy("c1", { unit_id: "u-3", monthly_rent: 1200, fixed_term_end_date: "2026-10-15" }),
    tenancy("d1", { unit_id: "u-4", monthly_rent: 1200, fixed_term_end_date: "2026-11-14" }),
  ];
  const result = calculateRentalPerformance(units, tenancies, { reportingDate: REPORTING_DATE });
  assert.equal(result.attention.longestVoid?.unit.id, "u-1");
  assert.equal(result.attention.longestVoid?.period.days, 20);
  assert.equal(result.attention.largestRentReduction?.unit.id, "u-1");
  assert.equal(result.attention.largestRentReduction?.movement.amount, -200);
  assert.equal(result.attention.currentVoids.length, 1);
  assert.equal(result.attention.currentVoids[0].unit.id, "u-2");
  assert.deepEqual(result.attention.upcomingFixedTerms, { within30Days: 1, within60Days: 2, within90Days: 3, recorded: 3 });
});

test("coverage counts real names and current-tenancy fields within active building scope", () => {
  assert.equal(isRealTenantName("Tenant 1 (name not supplied)"), false);
  assert.equal(isRealTenantName("A Smith"), true);
  const units = [unit("u-1"), unit("u-2"), unit("u-3", { rental_portfolio_status: "exited" })];
  const tenancies = [
    tenancy("a", { unit_id: "u-1" }),
    tenancy("b", { unit_id: "u-2", tenant_name: "Tenant 2 (name not supplied)", fixed_term_end_date: null, rent_due_day: null, letting_agent_organisation_id: null }),
    tenancy("c", { unit_id: "u-3" }),
  ];
  const result = calculateRentalPerformance(units, tenancies, { reportingDate: REPORTING_DATE });
  assert.equal(result.coverage.total, 2);
  assert.equal(result.coverage.realTenantName, 1);
  assert.equal(result.coverage.tenancyStart, 2);
  assert.equal(result.coverage.currentRent, 2);
  assert.equal(result.coverage.fixedTermEnd, 0);
  assert.equal(result.coverage.rentDueDay, 1);
  assert.equal(result.coverage.lettingAgent, 1);
});
