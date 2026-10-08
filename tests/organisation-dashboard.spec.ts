import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { salesFixture } from "./helpers/sales-fixture";
import { deriveDashboard } from "../src/lib/dashboard/model";
import type { DashboardInput } from "../src/lib/dashboard/types";
const { fixture, document, snag } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");

async function workFixture(page: Page, role = "developer") {
  const f = await salesFixture(page);
  f.profile.role = role;
  f.profile.organisation_id = "legal-org" as unknown as null;
  const input = fixture({ viewer: { id: f.profile.id, role, organisation_id: "legal-org" }, documents: [document("completion_statement"), document("draft_statement_of_account", "query_raised")], snags: [snag({ source_type: "leaseholder_defect", status: "new", priority_code: "P1", sla_due_date: "2026-10-07" })] }) as DashboardInput;
  input.buildings[0].name = "Workflow Test House";
  let reads = 0, failed = false, failureStatus = 503;
  await page.route("**/api/dashboard?*", async route => {
    reads++;
    if (failed) { await route.fulfill({ status: failureStatus, json: { error: "Worklist temporarily unavailable." } }); return; }
    const scope = new URL(route.request().url()).searchParams.get("building");
    await route.fulfill({ json: deriveDashboard({ ...input, buildingId: scope === "all" ? "" : scope ?? "" }) });
  });
  return { ...f, input, reads: () => reads, fail: (value: boolean, status = 503) => { failed = value; failureStatus = status; } };
}

test("organisation work groups multiple tasks, keeps query context and refreshes without clearing team work", async ({ page }) => {
  const f = await workFixture(page);
  await page.goto("/?screen=dashboard&building=all");
  const dashboard = page.getByRole("region", { name: "Portfolio overview" });
  await expect(dashboard.getByRole("button", { name: /^Our actions/ })).toBeVisible();
  await expect(dashboard.getByText("Triage resident defect", { exact: true }).first()).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "Review completion statement", exact: true })).toBeVisible();
  await dashboard.getByRole("button", { name: /^Waiting on others/ }).click();
  await expect(dashboard.getByText(/Statement: awaiting approval; Account: queried/).first()).toBeVisible();
  await dashboard.locator("summary").filter({ hasText: /outstanding action/ }).first().click();
  await expect(dashboard.locator("blockquote").filter({ hasText: "Please correct the statement." })).toBeVisible();
  const before = f.reads();
  await dashboard.getByRole("button", { name: "Refresh work" }).click();
  await expect.poll(f.reads).toBe(before + 1);
  await expect(dashboard.locator("blockquote").filter({ hasText: "Please correct the statement." })).toBeVisible();
  await dashboard.getByRole("button", { name: "Reset filters" }).click();
  await expect(dashboard.getByRole("button", { name: /^Our actions/ })).toHaveAttribute("aria-pressed", "true");
});

test("phone, tablet, desktop and narrow reflow retain readable controls with synthetic screenshots", async ({ page }) => {
  await workFixture(page);
  await mkdir("docs/organisation-dashboard/screenshots", { recursive: true });
  for (const width of [360, 390, 768, 1280, 1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/?screen=dashboard&building=all");
    await expect(page.getByRole("heading", { name: "Portfolio overview", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review completion statement", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if ([390, 1440].includes(width)) await page.screenshot({ path: `docs/organisation-dashboard/screenshots/dashboard-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Refresh work" }).focus();
    await expect(page.getByRole("button", { name: "Refresh work" })).toBeFocused();
  }
});

test("a failed refresh retains an explicitly stale snapshot and does not announce all clear", async ({ page }) => {
  const f = await workFixture(page); await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "Review completion statement", exact: true })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Back to organisation work" })).toBeVisible();
  await page.getByRole("link", { name: "Back to organisation work" }).click();
  await expect(page.getByRole("region", { name: "Sales organisation worklist" })).toHaveCount(1);
});

test("pagination counts the full snapshot and scope resets filters", async ({ page }) => {
  const f = await workFixture(page);
  f.input.snags = Array.from({ length: 23 }, (_, i) => snag({ id: `snag-${i}`, status: "resolved_by_contractor", created_at: "2026-10-01T12:00:00Z" }));
  f.input.sales = [];
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByText("23 affected records · 23 outstanding tasks.", { exact: false })).toBeVisible();
  const pages = page.getByRole("navigation", { name: "Worklist pages" });
  await expect(pages).toContainText("1–10 of 23");
  await pages.getByRole("button", { name: "Next" }).click(); await expect(pages).toContainText("11–20 of 23");
  await pages.getByRole("button", { name: "Next" }).click(); await expect(pages).toContainText("21–23 of 23");
  await page.getByRole("button", { name: "Reset filters" }).click(); await expect(pages).toContainText("1–10 of 23");
});

test("visible work polls once per minute, pauses hidden or inactive, and clears a revoked snapshot", async ({ page }) => {
  const f = await workFixture(page);
  await page.clock.install();
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "Review completion statement", exact: true })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Review completion statement", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Worklist temporarily unavailable" })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Sales", exact: true }).click();
  const inactive = f.reads(); await page.clock.runFor(120_001); expect(f.reads()).toBe(inactive);
});

test("dashboard skips operational media/history and snag drill-through selects its exact authorised record", async ({ page }) => {
  const f = await workFixture(page);
  f.rows.snags = f.input.snags.map(snag => ({ ...snag, updated_at: snag.created_at })) as unknown as Record<string, unknown>[];
  const paths: string[] = []; page.on("request", request => paths.push(new URL(request.url()).pathname));
  await page.goto("/?screen=dashboard&building=all");
  await expect(page.getByRole("link", { name: "Review completion statement", exact: true })).toBeVisible();
  expect(paths.some(path => /snag_photos|snag_events|handover_photos|unit_sale_document_versions/.test(path))).toBe(false);
  await page.getByRole("link", { name: "Triage resident defect", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Synthetic snag", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to organisation work" })).toBeVisible();
  await page.getByRole("link", { name: "Back to organisation work" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio overview", exact: true })).toBeVisible();
});
