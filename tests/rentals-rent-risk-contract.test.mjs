import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260901_rental_arrears_risk.sql", "utf8");
const attributionMigration = readFileSync("supabase/migrations/20260902_rental_arrears_tenancy_attribution.sql", "utf8");
const route = readFileSync("src/app/api/rentals/rent-risk/route.ts", "utf8");
const workspace = readFileSync("src/components/portal/rentals/RentalsWorkspace.tsx", "utf8");
const panels = readFileSync("src/components/portal/rentals/RentRiskPanels.tsx", "utf8");
const riskLibrary = readFileSync("src/lib/rentals/rent-risk.ts", "utf8");
const importer = readFileSync("scripts/import-trinity-point-rent-risk.mjs", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");

test("migration stores bounded episodes, append-only events and import health", () => {
  assert.match(migration, /create table if not exists public\.rental_arrears_episodes/);
  assert.match(migration, /references public\.unit_tenancies\(id\) on delete restrict/);
  for (const value of ["open", "cleared", "closed_reconciliation_review", "ended_unreconciled", "information", "watch", "action_required"]) {
    assert.match(migration, new RegExp(`'${value}'`));
  }
  assert.match(migration, /create table if not exists public\.rental_arrears_events/);
  assert.match(migration, /before update or delete on public\.rental_arrears_events/);
  assert.match(migration, /append-only/);
  assert.match(migration, /create table if not exists public\.rental_import_runs/);
  assert.match(migration, /data_quality_issues jsonb/);
  assert.doesNotMatch(migration, /statement_lines|payment_allocation|rent_ledger/i);
});

test("RLS and API preserve rental-manager and building access", () => {
  assert.match(migration, /public\.current_app_role\(\) in \('admin', 'developer'\)/);
  assert.match(migration, /public\.can_access_building\(tenancy\.building_id\)/);
  assert.match(migration, /revoke insert, update, delete on public\.rental_arrears_events from anon, authenticated/);
  assert.match(route, /role !== "admin" && role !== "developer"/);
  assert.match(route, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(route, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(route, /adminClient\.from\("rental_arrears_episodes"\)/);
  assert.match(route, /\.eq\("attribution_status", "matched"\)/);
  assert.match(route, /matchedEpisodeIds\.has\(event\.episode_id\)/);
});

test("attribution migration repairs unique date matches and quarantines ambiguous episodes", () => {
  assert.match(attributionMigration, /add column if not exists attribution_status/);
  assert.match(attributionMigration, /candidate\.unit_id = linked_tenancy\.unit_id/);
  assert.match(attributionMigration, /candidate\.tenancy_start_date <= episode\.first_reported_at::date/);
  assert.match(attributionMigration, /candidate\.tenancy_end_date >= episode\.first_reported_at::date/);
  assert.match(attributionMigration, /candidate_count = 1/);
  assert.match(attributionMigration, /attribution_status = 'review_required'/);
});

test("historical importer reads normalized domain tabs only and is guarded", () => {
  assert.match(importer, /getWorksheet\("Arrears Episodes"\)/);
  assert.match(importer, /getWorksheet\("Arrears Events"\)/);
  assert.doesNotMatch(importer, /getWorksheet\("Statement Lines"\)/);
  assert.doesNotMatch(importer, /getWorksheet\("Statements"\)/);
  assert.doesNotMatch(importer, /getWorksheet\("Arrears Emails"\)/);
  assert.doesNotMatch(importer, /getWorksheet\("Source Documents"\)/);
  assert.match(importer, /Coverage is read only to record import\/data-quality health/);
  assert.match(importer, /attributeArrearsEpisode/);
  assert.match(importer, /attribution_status: "review_required"/);
  assert.match(importer, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.match(importer, /--confirm-project=/);
  assert.match(importer, /Statement Lines, Statements, emails and source documents were not imported/);
  assert.doesNotMatch(importer, /C:\/Users\/carlg\/Downloads/);
  assert.match(gitignore, /Rent_Arrears_Import/);
});

test("portfolio UI adds compact risk attention and the three requested filters", () => {
  assert.match(workspace, /PortfolioRentRiskSection/);
  assert.match(workspace, /value="current_arrears">Current arrears/);
  assert.match(workspace, /value="repeat_arrears">Repeat arrears/);
  assert.match(workspace, /value="reconciliation_required">Reconciliation required/);
  assert.match(workspace, /"Attention"/);
  assert.match(workspace, /RentRiskAttentionBadge/);
  assert.doesNotMatch(workspace, /Arrears balance<\/th>|Amount overdue<\/th>/);
});

test("tenancy UI scopes current arrears and uses a compact no-arrears state", () => {
  for (const label of ["Rent performance", "Latest reported arrears", "Rolling 12 months", "Historic episodes", "Peak arrears", "Longest episode", "Arrears history"]) {
    assert.match(panels, new RegExp(label));
  }
  assert.match(panels, /Robinson Jackson’s rent account remains the definitive current position/);
  assert.match(panels, /episode\.tenancy_id === currentTenancyId/);
  assert.match(panels, /No reported arrears for this tenancy\./);
  assert.doesNotMatch(panels, /tenancyIdSet|unitEpisodes/);
  assert.match(panels, /<details key=\{episode\.id\}/);
  assert.match(panels, /grid gap-3 border-t[^\n]*sm:grid-cols-2/);
  assert.doesNotMatch(panels, /<table/);
});

test("tenancy history shows secondary arrears status in desktop rows and mobile cards", () => {
  assert.match(riskLibrary, /Ended · Arrears recorded/);
  assert.match(workspace, /tenancyHistoryStatusLabel\(state, hasArrears\)/);
  assert.match(workspace, /arrearsTenancyIds\.has\(tenancy\.id\)/);
  assert.match(workspace, /md:hidden/);
  assert.match(workspace, /hidden overflow-x-auto[^"]*md:block/);
  assert.doesNotMatch(workspace, /<th[^>]*>Arrears<\/th>/);
});

test("portfolio risk derives from each unit's current tenancy only", () => {
  assert.match(workspace, /metricsByUnitId\.get\(unit\.id\)\?\.currentTenancy\?\.id/);
  assert.match(workspace, /deriveUnitRentRisk\(currentTenancyId, scopedCurrentArrearsEpisodes/);
  assert.match(workspace, /currentTenancyIds=\{scopedCurrentTenancyIds\}/);
  assert.doesNotMatch(workspace, /deriveUnitRentRisk\(unitTenancyIds/);
});

test("missing coverage remains import health rather than an arrears episode", () => {
  assert.match(importer, /data_quality_flag/);
  assert.match(importer, /Coverage is read only/);
  assert.match(panels, /Missing or ambiguous coverage is excluded from current-tenancy reporting/);
});
