import { test, expect, type Page, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";
import { dashboardResponse } from "../src/lib/dashboard/response";
import type { DashboardInput } from "../src/lib/dashboard/types";
const { fixture, document } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");
const evidence = "docs/mobile-sales-layouts";
const sizes = [320, 360, 390, 430, 768, 1440];

async function noOverflow(region: Locator) {
  expect(await region.evaluate(root => [...root.querySelectorAll<HTMLElement>("table, tbody, tr, td, dl, dt, dd, a, button")].filter(el => el.getClientRects().length && getComputedStyle(el).position !== "absolute").flatMap(el => el.scrollWidth > el.clientWidth + 1 ? [`${el.tagName}: ${el.textContent?.slice(0, 90)} (${el.scrollWidth}/${el.clientWidth})`] : []))).toEqual([]);
}
async function links(region: Locator) {
  return region.locator("tbody a").evaluateAll(elements => elements.map(el => ({ text: el.textContent, href: el.getAttribute("href") })));
}
async function frames(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

// All network data is intercepted synthetic fixture data, never a live project.
test("mobile dashboard stages, dates, text reflow and desktop parity", async ({ page }) => {
  const f = await developerSalesFixture(page);
  const input = fixture({ viewer: f.profile, documents: [document("completion_statement")], sales: [{ ...fixture().sales[0], contractual_completion_date: "2026-10-06" }] }) as DashboardInput;
  const snapshot = dashboardResponse(input);
  snapshot.buildings[0].name = "The Very Long Riverside Building and Gardens — North Residential Wing";
  const dated = snapshot.items.find(item => item.deadline)!;
  snapshot.items = Array.from({ length: 8 }, (_, i) => ({ ...dated, id: `mobile-date-${i}`, reference: `Unit ${101 + i}`, action: `${dated.action} — confirm the recorded position with the appointed team` }));
  snapshot.overview!.sales.forEach((stage, i) => { stage.value = [12, 345, 67, 89, 10][i]; });
  let reads = 0;
  await page.route("**/api/dashboard?*", async route => { reads++; const building = new URL(route.request().url()).searchParams.get("building"); await route.fulfill({ json: { ...snapshot, scope: { ...snapshot.scope, buildingId: building === "all" ? "" : building } } }); });
  await page.goto("/?screen=dashboard&building=all");
  const dashboard = page.getByRole("region", { name: "Dashboard", exact: true });
  const pipeline = dashboard.getByRole("region", { name: "Sales pipeline", exact: true });
  const dates = dashboard.getByRole("region", { name: "Dates to review", exact: true });
  await expect(pipeline.locator("dd").first()).toHaveText("12");
  await mkdir(`${evidence}/screenshots`, { recursive: true });
  const baseline = await links(dates);
  const measurements = [];
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 960 }); await frames(page);
    await expect(pipeline.locator("dt")).toHaveCount(5);
    const tops = await pipeline.locator("dl > div").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await noOverflow(pipeline);
    if (width < 768) {
      await noOverflow(dates);
      const rows = dates.locator("tbody tr");
      await expect(rows).toHaveCount(8);
      await expect(rows.first()).toContainText("Passed date");
      await expect(rows.first()).toContainText("Recorded contractual date");
      expect(await dates.locator("table").first().evaluate(el => getComputedStyle(el).display)).toBe("block");
    } else {
      expect(await dates.locator("table").first().evaluate(el => getComputedStyle(el).display)).toBe("table");
    }
    expect(await links(dates)).toEqual(baseline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pipeline.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/pipeline-${width}.png` });
    await dates.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/dates-${width}.png` });
    if (width === 1440) await dashboard.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/dashboard-desktop.png` });
    measurements.push({ width, stageRows: new Set(tops).size, dateLinks: baseline.length });
  }
  await page.setViewportSize({ width: 320, height: 960 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await noOverflow(pipeline); await noOverflow(dates);
  expect(new Set(await pipeline.locator("dl > div").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)))).size).toBeGreaterThan(1);
  await pipeline.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/pipeline-enlarged-text.png` });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  snapshot.overview!.sales.forEach(stage => { stage.value = 123456; });
  await dashboard.getByRole("button", { name: "Refresh work", exact: true }).click();
  await expect(pipeline.locator("dd").first()).toHaveText("123456"); await noOverflow(pipeline);
  await pipeline.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/pipeline-large-counts.png` });
  const summary = dates.locator("summary"); await summary.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await summary.evaluate(el => (el as HTMLElement).focus({ preventScroll: true })); await page.keyboard.press("Enter"); await frames(page);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await expect(dates.getByRole("link", { name: /^Open Unit/ })).toHaveCount(8);
  const target = dates.getByRole("link", { name: /^Open Unit/ }).first(); const href = await target.getAttribute("href");
  await target.click(); await expect.poll(() => new URL(page.url()).search + new URL(page.url()).hash).toBe(href!.slice(1));
  await writeFile(`${evidence}/dashboard-measurements.json`, JSON.stringify({ measurements, reads }, null, 2));
});

test("mobile sales preserves records, warnings, actions, pagination and filter stability", async ({ page }) => {
  const f = await developerSalesFixture(page);
  f.rows.buildings[0].name = "The Very Long Riverside Building and Gardens — North Residential Wing";
  f.emails.push({ id: "expired-mobile-authority", sale_attempt_id: f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units[4].id)!.id, snapshot: f.snapshot, issued_at: "2026-09-01T12:00:00Z", revoked_at: null, replaced_by: null, kind: "authority", version: 1, delivery_status: "sent", sent_at: "2026-09-01T12:00:00Z", expires_at: "2026-09-02T12:00:00Z", version_number: 1 });
  await page.goto(`/?screen=sales&building=${f.unit.building_id}`);
  const results = page.locator("#sales-results");
  await expect(results.locator("tbody tr")).toHaveCount(12);
  await expect(results.getByText("Authority expired", { exact: true })).toBeVisible();
  await frames(page);
  const baseline = await links(results);
  const requests: string[] = [];
  page.on("request", request => { if (/api\/|rest\/v1\//.test(request.url())) requests.push(request.url()); });
  await mkdir(`${evidence}/screenshots`, { recursive: true });
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 960 }); await frames(page);
    expect(await links(results)).toEqual(baseline);
    await expect(results.getByText("Scroll the table sideways", { exact: false })).toHaveCount(0);
    if (width < 768) {
      await noOverflow(results);
      await expect(results.locator("tbody tr").filter({ hasText: "Unit 103" })).toContainText("Completion date passed; completion not recorded");
      expect(await results.locator("table").evaluate(el => getComputedStyle(el).display)).toBe("block");
    } else expect(await results.locator("table").evaluate(el => getComputedStyle(el).display)).toBe("table");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await results.screenshot({ style: ".app-header, .mobile-bottom-nav, nextjs-portal { visibility: hidden !important; }", path: `${evidence}/screenshots/sales-${width}.png` });
  }
  await page.setViewportSize({ width: 320, height: 960 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; }); await noOverflow(results.locator("table"));
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await results.getByRole("button", { name: "Next", exact: true }).click();
  await expect(results.getByText("Showing 13–18 of 18", { exact: true })).toBeVisible(); await noOverflow(results);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const nav = await page.locator(".mobile-bottom-nav").boundingBox();
  const pagination = await results.getByRole("navigation", { name: "Results pagination" }).boundingBox();
  expect(pagination!.y + pagination!.height).toBeLessThanOrEqual(nav!.y);
  const search = results.getByRole("searchbox");
  await search.focus(); const before = await page.evaluate(() => scrollY);
  await search.fill("no matching unit"); await frames(page);
  await expect(results.getByText("No sales match this view. Try another team, category or filter.")).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await noOverflow(results);
  await results.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(results.locator("tbody tr")).toHaveCount(12);
  expect(requests).toEqual([]);
  await writeFile(`${evidence}/sales-requests.json`, JSON.stringify(requests));
  const row = results.locator("tbody tr").filter({ has: page.getByRole("link", { name: "Unit 103", exact: true }) });
  await row.getByRole("link", { name: /^Review/ }).click();
  await expect(page.locator("[data-sale-file]")).toBeVisible({ timeout: 15_000 });
});
