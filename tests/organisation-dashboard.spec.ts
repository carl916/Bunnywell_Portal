import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { salesFixture } from "./helpers/sales-fixture";
import { deriveDashboard } from "../src/lib/dashboard/model";
import { deriveInternalOverview } from "../src/lib/dashboard/overview";
import type { DashboardInput } from "../src/lib/dashboard/types";
const { fixture, document, snag } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");

async function workFixture(page: Page, role = "developer") {
  const f = await salesFixture(page);
  f.profile.role = role;
  f.profile.organisation_id = "legal-org" as unknown as null;
  const input = fixture({ viewer: { id: f.profile.id, role, organisation_id: "legal-org" }, documents: [document("completion_statement"), document("draft_statement_of_account", "query_raised")], snags: [snag({ source_type: "leaseholder_defect", status: "new", priority_code: "P1", sla_due_date: "2026-10-07" })] }) as DashboardInput;
  input.buildings[0].name = "Workflow Test House";
  // Use the same records in the dashboard response and its Sales destination.
  Object.assign(f.unit, input.units[0]);
  Object.assign(f.attempt, input.sales[0]);
  Object.assign(f.rows.buildings[0], input.buildings[0]);
  f.rows.organisations = input.organisations;
  f.rows.unit_sale_terms = input.terms;
  f.rows.unit_sale_documents = input.documents.map(doc => ({ ...doc }));
  f.rows.unit_sale_document_versions = input.documents.flatMap(doc => doc.unit_sale_document_versions.map(version => ({ ...version, document_id: doc.id })));
  let reads = 0, failed = false, failureStatus = 503, delay = 0;
  await page.route("**/api/dashboard?*", async route => {
    reads++;
    if (failed) { await route.fulfill({ status: failureStatus, json: { error: "Worklist temporarily unavailable." } }); return; }
    const scope = new URL(route.request().url()).searchParams.get("building");
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const scoped = { ...input, buildingId: scope === "all" ? "" : scope ?? "", snags: input.snags.filter(snag => scope === "all" || snag.building_id === scope) };
    const snapshot = deriveDashboard(scoped);
    snapshot.overview = deriveInternalOverview(scoped, snapshot);
    await route.fulfill({ json: snapshot });
  });
  return { ...f, input, reads: () => reads, delay: (ms: number) => { delay = ms; }, fail: (value: boolean, status = 503) => { failed = value; failureStatus = status; } };
}

test("internal summary opens the canonical Sales responsibility view and refreshes in place", async ({ page }) => {
  const f = await workFixture(page);
  await page.goto("/?screen=dashboard&building=all");
  const dashboard = page.getByRole("region", { name: "Dashboard", exact: true });
  const attention = dashboard.getByRole("region", { name: "Work needing attention", exact: true });
  const sales = attention.getByRole("row").filter({ has: page.getByRole("link", { name: "Open Sales", exact: true }) });
  await expect(sales.getByRole("link", { name: "1 unit row", exact: true })).toHaveCount(2);
  await expect(dashboard.getByRole("button", { name: /^Our actions/ })).toHaveCount(0);
  await expect(dashboard.getByRole("navigation", { name: "Worklist pages" })).toHaveCount(0);
  await expect(dashboard.locator("details").filter({ has: page.locator("summary", { hasText: "Recent sales activity" }) })).not.toHaveAttribute("open");
  await page.evaluate(() => window.scrollTo(0, 250));
  const scroll = await page.evaluate(() => scrollY);
  const before = f.reads();
  await page.evaluate(() => window.dispatchEvent(new Event("portal-work-changed")));
  await expect.poll(f.reads).toBe(before + 1);
  await expect(dashboard.getByRole("button", { name: "Refresh work" })).toBeEnabled();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  const expectedScope = new URL(page.url()).searchParams.get("building");
  await sales.getByRole("link", { name: "1 unit row", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`screen=sales&building=${expectedScope}&salesWork=ours#sales-results`));
  await expect(page.getByRole("heading", { name: "Sales overview", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Action with", exact: true })).toHaveValue("ours");
  await expect(page.getByText("1 sale requiring your team’s attention", { exact: true })).toBeVisible();
});

test("outside-pipeline drafts show their record and the unsupported destination limitation", async ({ page }) => {
  const f = await workFixture(page);
  f.input.units[0].sale_status = "not_released";
  f.input.sales[0].workflow_status = "draft";
  f.input.sales[0].exchanged_at = null;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?screen=dashboard&building=all");
  const attention = page.getByRole("region", { name: "Work needing attention", exact: true });
  await expect(attention.getByText(/Workflow Test House · Unit 2\. Outside the Sales register\. Draft-work navigation is unavailable\./)).toBeVisible();
  await expect(attention.getByRole("link", { name: "Open unit", exact: true })).toHaveCount(0);
  await expect(attention.getByText("Review with an authorised colleague", { exact: true })).toBeVisible();
  await mkdir("docs/dashboard-stage2b/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/dashboard-stage2b/screenshots/dashboard-outside-pipeline.png", fullPage: true });
});

test("phone, tablet, desktop and narrow reflow retain readable controls with synthetic screenshots", async ({ page }) => {
  await workFixture(page);
  await mkdir("docs/dashboard-stage2b/screenshots", { recursive: true });
  for (const width of [360, 390, 768, 1280, 1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/?screen=dashboard&building=all");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: "Open Agent Fees", exact: true }) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh work" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if ([390, 1440].includes(width)) await page.screenshot({ path: `docs/dashboard-stage2b/screenshots/dashboard-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Refresh work" }).focus();
    await expect(page.getByRole("button", { name: "Refresh work" })).toBeFocused();
  }
});

test("a failed refresh retains an explicitly stale snapshot and does not announce all clear", async ({ page }) => {
  const f = await workFixture(page); await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "1 unit row", exact: true }).first()).toBeVisible();
  f.fail(true); await page.getByRole("button", { name: "Refresh work" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Displayed work may be stale" })).toBeVisible();
  await expect(page.getByText(/All clear —/)).toHaveCount(0);
});

test("sales-agent worklist remains on the Sales landing and direct task links select completion", async ({ page }) => {
  const f = await workFixture(page, "sales_agent");
  Object.assign(f.unit, { sale_status: "exchanged" });
  Object.assign(f.attempt, { workflow_status: "exchanged", exchanged_at: "2026-09-02", completion_legacy_stage: "arrangements" });
  await page.goto("/?screen=sales&building=all");
  const work = page.getByRole("region", { name: "Sales organisation worklist" });
  await expect(work).toHaveCount(1);
  await work.getByRole("button", { name: /^Waiting on others/ }).click();
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
  await work.getByRole("link", { name: "Review saved contractual completion date", exact: true }).first().click();
  await expect(work).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Completion tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to organisation work" })).toHaveCount(0);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByRole("region", { name: "Sales organisation worklist" })).toHaveCount(1);
});

test("full record counts remain compact without worklist pagination", async ({ page }) => {
  const f = await workFixture(page);
  f.input.snags = Array.from({ length: 23 }, (_, i) => snag({ id: `snag-${i}`, status: "resolved_by_contractor", created_at: "2026-10-01T12:00:00Z" }));
  f.input.sales = [];
  f.input.units.forEach(unit => { unit.sale_status = "for_sale"; });
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByText("23 snag records", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Worklist pages" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Work needing attention" }).getByRole("row")).toHaveCount(5);
});

test("visible work polls once per minute, pauses hidden or inactive, and clears a revoked snapshot", async ({ page }) => {
  const f = await workFixture(page);
  await page.clock.install();
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "1 unit row", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh work" })).toBeEnabled();
  const before = f.reads();
  await page.clock.runFor(60_001); await expect.poll(f.reads).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Refresh work" })).toBeEnabled();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(120_001); expect(f.reads()).toBe(before + 1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(f.reads).toBe(before + 2);
  await expect(page.getByRole("button", { name: "Refresh work" })).toBeEnabled();
  f.fail(true, 403); await page.getByRole("button", { name: "Refresh work" }).click();
  await expect(page.getByRole("link", { name: "1 unit row", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Worklist temporarily unavailable" })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Sales", exact: true }).click();
  const inactive = f.reads(); await page.clock.runFor(120_001); expect(f.reads()).toBe(inactive);
});

test("dashboard skips operational media/history and snag drill-through selects its exact authorised record", async ({ page }) => {
  const f = await workFixture(page);
  f.rows.snags = f.input.snags.map(snag => ({ ...snag, updated_at: snag.created_at })) as unknown as Record<string, unknown>[];
  const paths: string[] = []; page.on("request", request => paths.push(new URL(request.url()).pathname));
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "1 unit row", exact: true }).first()).toBeVisible();
  expect(paths.some(path => /snag_photos|snag_events|handover_photos|unit_sale_document_versions/.test(path))).toBe(false);
  await page.getByRole("link", { name: /Open .*Triage resident defect/ }).first().click();
  await expect(page.getByRole("heading", { name: "Synthetic snag", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to organisation work" })).toBeVisible();
  await page.getByRole("link", { name: "Back to organisation work" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("building changes withhold previous counts while all sections stay mounted", async ({ page }) => {
  const f = await workFixture(page);
  const second = "10000000-0000-4000-8000-000000000002";
  f.rows.buildings.push({ ...f.rows.buildings[0], id: second, name: "Empty House" });
  f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second });
  f.input.buildings.push({ ...f.input.buildings[0], id: second, name: "Empty House" });
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "1 unit row", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Portfolio position", exact: true })).toBeVisible();
  await mkdir("docs/dashboard-stage2b/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/dashboard-stage2b/screenshots/dashboard-all-buildings.png", fullPage: true });
  f.delay(1200);
  await page.getByLabel("Current building", { exact: true }).selectOption(second);
  await expect(page.getByRole("heading", { name: "Building position", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work needing attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dates to review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "1 unit row", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Work needing attention", exact: true })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("link", { name: "0 unit rows", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Dashboard", exact: true })).toContainText("Empty House · Developer team");
  f.delay(0);
  await page.getByLabel("Current building", { exact: true }).selectOption("");
  await page.getByRole("link", { name: "1 unit row", exact: true }).first().click();
  await expect(page).toHaveURL(/screen=sales&building=all&salesWork=ours#sales-results/);
});

test("additional date exceptions are accessible without a fabricated destination", async ({ page }) => {
  const f = await workFixture(page);
  f.input.snags = Array.from({ length: 7 }, (_, i) => snag({ id: `urgent-${i}`, title: `Urgent defect ${i}`, source_type: "leaseholder_defect", status: "new", priority_code: "P1" }));
  await page.goto("/?screen=dashboard&building=all");
  const dates = page.getByRole("region", { name: "Dates to review", exact: true });
  await expect(dates.getByRole("region", { name: "Priority dates to review" }).getByRole("row")).toHaveCount(6);
  await dates.locator("summary").filter({ hasText: "more dates and exceptions" }).click();
  await expect(dates.getByRole("region", { name: "Remaining dates to review" })).toBeVisible();
  await expect(dates.getByRole("link", { name: /Open / })).toHaveCount(8);
  await expect(dates.getByRole("link", { name: /View all/ })).toHaveCount(0);
});

for (const role of ["contractor", "developer_representative"]) test(`${role} keeps the existing operational dashboard`, async ({ page }) => {
  await workFixture(page, role);
  await page.goto("/?screen=dashboard&building=all");
  const legacy = page.getByRole("region", { name: "Portfolio overview", exact: true });
  await expect(legacy).toBeVisible();
  await expect(legacy.getByRole("button", { name: /^Our actions/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work needing attention" })).toHaveCount(0);
});
