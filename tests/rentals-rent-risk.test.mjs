import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveTenancyRentRisk,
  deriveUnitRentRisk,
  summarisePortfolioRentRisk,
  tenancyHistoryStatusLabel,
} from "../src/lib/rentals/rent-risk.ts";
import { attributeArrearsEpisode } from "../scripts/lib/rent-risk-attribution.mjs";

const AS_OF = "2026-09-01";

function episode(id, tenancyId, overrides = {}) {
  return {
    id,
    tenancy_id: tenancyId,
    agent_tenancy_reference: "TY40832",
    first_reported_at: "2026-05-28T00:00:00.000Z",
    last_reported_at: "2026-05-29T00:00:00.000Z",
    cleared_at: "2026-05-29T00:00:00.000Z",
    initial_reported_amount: 1183.5,
    maximum_reported_amount: 1183.5,
    latest_reported_amount: 0,
    status: "cleared",
    intervention_level: "information",
    owner_action_required: false,
    resolution_basis: "statement_evidence",
    management_summary: "Material agent report and subsequent clearance evidence.",
    source_reference: `source-${id}`,
    created_at: "2026-09-01T18:00:00.000Z",
    updated_at: "2026-09-01T18:00:00.000Z",
    ...overrides,
  };
}

test("Flat 83-style repeat history reports the dated current balance without inventing a live ledger", () => {
  const episodes = [
    episode("83-may", "t-83"),
    episode("83-sep", "t-83", {
      first_reported_at: "2026-09-01T00:00:00.000Z",
      last_reported_at: "2026-09-01T00:00:00.000Z",
      cleared_at: null,
      latest_reported_amount: 1183.5,
      status: "open",
      intervention_level: "watch",
      resolution_basis: null,
    }),
  ];
  const result = deriveTenancyRentRisk("t-83", episodes, AS_OF);
  assert.equal(result.currentReportedArrears, 1183.5);
  assert.equal(result.latestReportDate, "2026-09-01T00:00:00.000Z");
  assert.equal(result.rolling12MonthEpisodes, 2);
  assert.equal(result.totalHistoricalEpisodes, 2);
  assert.equal(result.interventionLevel, "watch");
  assert.equal(result.hasCurrentArrears, true);
});

test("repeat episodes are Watch even when each individual episode was cleared", () => {
  const episodes = [episode("75-a", "t-75"), episode("75-b", "t-75", { first_reported_at: "2026-06-01T00:00:00.000Z", last_reported_at: "2026-06-02T00:00:00.000Z", cleared_at: "2026-06-02T00:00:00.000Z" })];
  const result = deriveTenancyRentRisk("t-75", episodes, AS_OF);
  assert.equal(result.repeatArrears, true);
  assert.equal(result.interventionLevel, "watch");
  assert.equal(result.currentReportedArrears, null);
});

test("an ended unreconciled former tenancy is Action required", () => {
  const result = deriveTenancyRentRisk("t-77", [episode("77", "t-77", {
    status: "ended_unreconciled",
    cleared_at: null,
    latest_reported_amount: null,
    owner_action_required: true,
    intervention_level: "action_required",
    resolution_basis: "tenancy_end_and_partial_statement_evidence",
  })], AS_OF);
  assert.equal(result.interventionLevel, "action_required");
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.hasCurrentArrears, false);
});

test("prolonged or worsening isolated episodes become Watch through explicit rules", () => {
  const prolonged = deriveTenancyRentRisk("long", [episode("long", "long", {
    first_reported_at: "2026-07-01T00:00:00.000Z",
    last_reported_at: "2026-09-01T00:00:00.000Z",
    cleared_at: null,
    status: "open",
    latest_reported_amount: 500,
  })], AS_OF);
  const worsening = deriveTenancyRentRisk("worse", [episode("worse", "worse", {
    initial_reported_amount: 500,
    maximum_reported_amount: 1000,
    latest_reported_amount: 1000,
    cleared_at: null,
    status: "open",
  })], AS_OF);
  assert.equal(prolonged.interventionLevel, "watch");
  assert.equal(worsening.interventionLevel, "watch");
});

test("portfolio summary is calculated from the supplied current tenancy ids only", () => {
  const episodes = [
    episode("one-off", "t-one"),
    episode("repeat-a", "t-repeat"),
    episode("repeat-b", "t-repeat", { first_reported_at: "2026-07-01T00:00:00.000Z", last_reported_at: "2026-07-02T00:00:00.000Z", cleared_at: "2026-07-02T00:00:00.000Z" }),
    episode("unreconciled", "t-ended", { status: "ended_unreconciled", cleared_at: null, latest_reported_amount: null, owner_action_required: true }),
    episode("open", "t-open", { status: "open", cleared_at: null, latest_reported_amount: 1183.5 }),
  ];
  const summary = summarisePortfolioRentRisk(episodes, ["t-one", "t-repeat", "t-open"], AS_OF);
  assert.deepEqual(summary, {
    currentReportedEpisodes: 1,
    repeatArrearsTenancies: 1,
    actionRequiredTenancies: 0,
  });
});

test("Unit 78 current tenant and intermediate tenant do not inherit the former tenancy episode", () => {
  const unit78Episodes = [episode("unit-78-2025-08", "gabriele-robert", {
    first_reported_at: "2025-08-07T00:00:00.000Z",
    last_reported_at: "2025-09-19T00:00:00.000Z",
    cleared_at: null,
    maximum_reported_amount: 1300,
    latest_reported_amount: 0,
    status: "closed_reconciliation_review",
    intervention_level: "watch",
  })];

  const sarah = deriveTenancyRentRisk("sarah-oyekola", unit78Episodes, AS_OF);
  assert.equal(sarah.totalHistoricalEpisodes, 0);
  assert.equal(sarah.currentReportedArrears, null);
  assert.equal(sarah.maximumReportedArrears, 0);
  assert.equal(sarah.longestEpisodeDays, null);
  assert.equal(sarah.repeatArrears, false);
  assert.equal(sarah.interventionLevel, "information");

  const zeynep = deriveTenancyRentRisk("zeynep-dila-aydin", unit78Episodes, AS_OF);
  assert.equal(zeynep.totalHistoricalEpisodes, 0);
  assert.equal(zeynep.hasCurrentArrears, false);

  assert.equal(tenancyHistoryStatusLabel("ended", true), "Ended · Arrears recorded");
  assert.equal(tenancyHistoryStatusLabel("ended", false), "Ended");
});

test("current portfolio attention ignores episodes linked to an ended tenancy", () => {
  const episodes = [episode("old", "former", { status: "ended_unreconciled", cleared_at: null, latest_reported_amount: null, owner_action_required: true })];
  const result = deriveUnitRentRisk("current", episodes, AS_OF);
  assert.equal(result.interventionLevel, "information");
  assert.equal(result.reconciliationRequired, false);
  assert.equal(result.hasCurrentArrears, false);
  assert.equal(result.repeatArrears, false);
  assert.equal("score" in result, false);
});

test("a genuine episode linked to the current tenancy still drives current reporting", () => {
  const episodes = [episode("current-open", "current", {
    status: "open",
    cleared_at: null,
    latest_reported_amount: 675,
    intervention_level: "watch",
  })];
  const result = deriveUnitRentRisk("current", episodes, AS_OF);
  assert.equal(result.hasCurrentArrears, true);
  assert.equal(result.interventionLevel, "watch");
});

test("ambiguous imported episodes are excluded and flagged for attribution review", () => {
  const episodeToMatch = {
    source_import_key: "ambiguous-78",
    unit_number: "78",
    first_reported_at: "2025-08-07T00:00:00.000Z",
    tenancy_import_key: null,
    agent_tenancy_reference: null,
    tenant_name_evidence: null,
  };
  const unit = { id: "unit-78" };
  const overlappingTenancies = [
    { id: "candidate-a", unit_id: "unit-78", tenant_name: "Tenant A", tenancy_start_date: "2025-05-31", tenancy_end_date: "2025-08-28", source_reference: "source-a" },
    { id: "candidate-b", unit_id: "unit-78", tenant_name: "Tenant B", tenancy_start_date: "2025-08-01", tenancy_end_date: "2025-08-31", source_reference: "source-b" },
  ];
  const result = attributeArrearsEpisode(episodeToMatch, unit, overlappingTenancies);
  assert.equal(result.status, "review_required");
  assert.equal(result.tenancy, null);
  assert.match(result.reason, /matched 2 tenancies/);
});

test("source evidence disambiguates overlapping tenancy date candidates", () => {
  const result = attributeArrearsEpisode({
    source_import_key: "evidence-78",
    unit_number: "78",
    first_reported_at: "2025-08-07T00:00:00.000Z",
    tenancy_import_key: "tenancy-b",
    agent_tenancy_reference: null,
    tenant_name_evidence: null,
  }, { id: "unit-78" }, [
    { id: "candidate-a", unit_id: "unit-78", tenant_name: "Tenant A", tenancy_start_date: "2025-05-31", tenancy_end_date: "2025-08-28", source_reference: "tenancy-a" },
    { id: "candidate-b", unit_id: "unit-78", tenant_name: "Tenant B", tenancy_start_date: "2025-08-01", tenancy_end_date: "2025-08-31", source_reference: "tenancy-b" },
  ]);
  assert.equal(result.status, "matched");
  assert.equal(result.tenancy.id, "candidate-b");
});
