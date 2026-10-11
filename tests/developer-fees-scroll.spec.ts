import { test, expect, type Page } from "@playwright/test";
import { agentFeesFixture } from "./helpers/agent-fees-fixture";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";
import { mkdir, writeFile } from "node:fs/promises";

declare global { interface Window { scrollCalls: { method: string; target: string }[] } }
const panel = (page: Page) => page.locator("#fee-results");
const group = (page: Page) => panel(page).getByRole("group", { name: "Fee work view" });
const views = ["Our actions", "Awaiting approval", "Approved unpaid", "Invoices to submit/correct", "All records"];
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.scrollCalls = [];
    const into = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options) { window.scrollCalls.push({ method: "into", target: this.id }); return into.call(this, options); };
    const scroll = window.scrollTo.bind(window);
    window.scrollTo = ((...args: Parameters<typeof scroll>) => { window.scrollCalls.push({ method: "to", target: "window" }); return scroll(...args); }) as typeof scroll;
    const elementScroll = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function(this: Element, ...args: Parameters<typeof elementScroll>) { window.scrollCalls.push({ method: "to", target: this.id }); return elementScroll.apply(this, args); } as typeof elementScroll;
  });
}
async function open(page: Page, query = "") {
  await page.goto(`/?screen=sales&building=all&salesView=agent_fees${query}#fee-results`);
  await expect(panel(page).getByRole("status")).toContainText("in this filtered view");
  await frames(page);
}
async function selected(page: Page, name: string) {
  await expect(group(page).locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(group(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1280, height: 500 }]) {
  test(`single selection, keyboard, refinements and no filter scroll at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await instrument(page); await agentFeesFixture(page); await open(page);
    await selected(page, "Our actions");
    await expect(group(page)).toHaveCount(1);await expect(group(page).getByRole("button")).toHaveCount(5);
    await expect(panel(page)).not.toContainText("Action with Developer team");
    const samples = [];
    for (const top of [0, 120, 10000]) {
      for (const name of [...views, ...views.toReversed()]) {
        const button = group(page).getByRole("button", { name, exact: true });
        await button.evaluate(node => node.focus({ preventScroll: true }));
        await page.evaluate(y => { window.scrollTo({ top: y, behavior: "instant" }); window.scrollCalls = []; }, top);
        const before = await page.evaluate(() => ({ y: scrollY, control: document.querySelector('[aria-label="Fee work view"]')!.getBoundingClientRect().top }));
        await page.keyboard.press("Enter"); await selected(page, name); await frames(page);
        await expect(button).toBeFocused();
        const after = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight, control: document.querySelector('[aria-label="Fee work view"]')!.getBoundingClientRect().top, calls: window.scrollCalls }));
        samples.push({ name, requestedTop: top, before, after, clamped: before.y > after.max });
        expect(after.calls).toEqual([]);
        expect(Math.abs(after.y - Math.min(before.y, after.max)), JSON.stringify({ name, top, before, after })).toBeLessThanOrEqual(2);
        if (before.y <= after.max) expect(Math.abs(after.control - before.control)).toBeLessThanOrEqual(2);
        // Clicking the already selected control cannot clear it or reset refinements.
        await page.keyboard.press("Enter"); await selected(page, name);
      }
      // Type through long, one-row and zero-row results at each tested position.
      await group(page).getByRole("button", { name: "All records", exact: true }).evaluate(node => node.focus({ preventScroll: true }));
      await page.keyboard.press("Enter");
      const field = panel(page).getByRole("searchbox");
      await field.evaluate(node => node.focus({ preventScroll: true }));
      for (const key of ["1", "0", "1", "x", "Backspace", "Backspace", "Backspace", "Backspace"]) {
        // Keep the caret visible at three viewport positions. Typing into an
        // intentionally offscreen focused input triggers native caret reveal.
        await field.evaluate((node, index) => {
          const target = Math.min(200 + index * 80, innerHeight - 100);
          const requested = node.getBoundingClientRect().top + scrollY - target;
          const maximum = document.documentElement.scrollHeight - innerHeight;
          scrollTo({ top: Math.max(0, Math.min(requested, maximum)), behavior: "instant" });
          window.scrollCalls = [];
        }, [0, 120, 10000].indexOf(top));
        await frames(page);
        const previousY = await page.evaluate(() => scrollY);
        const beforeField = await field.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), value: (node as HTMLInputElement).value }));
        await page.keyboard.press(key);await frames(page);
        const position = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight, calls: window.scrollCalls }));
        const afterField = await field.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), value: (node as HTMLInputElement).value }));
        expect(position.calls).toEqual([]);expect(Math.abs(position.y - Math.min(previousY, position.max)), JSON.stringify({key,top,previousY,position,beforeField,afterField})).toBeLessThanOrEqual(2);
        await expect(field).toBeFocused();await selected(page, "All records");
      }
    }
    await group(page).getByRole("button", { name: "Approved unpaid", exact: true }).click();
    await panel(page).getByRole("combobox", { name: "Agent", exact: true }).selectOption("agent-org");
    await panel(page).getByRole("combobox", { name: "Milestone", exact: true }).selectOption("completion");
    await panel(page).getByRole("combobox", { name: "Sort", exact: true }).selectOption("unit");
    const search = panel(page).getByRole("searchbox"); await search.focus();
    await page.evaluate(() => { window.scrollCalls = []; });
    await search.pressSequentially("no-match"); await frames(page);
    await selected(page, "Approved unpaid");await expect(search).toBeFocused();
    expect(await page.evaluate(() => window.scrollCalls)).toEqual([]);
    await expect(panel(page)).toContainText("No positive approved unpaid balances");
    await expect(group(page).getByRole("button", { name: "Approved unpaid", exact: true })).toContainText("£11,000");
    await group(page).getByRole("button", { name: "Awaiting approval", exact: true }).click();
    await expect(search).toHaveValue("no-match");await expect(panel(page).getByRole("combobox", { name: "Milestone", exact: true })).toHaveValue("completion");
    await page.reload();await selected(page, "Awaiting approval");
    await panel(page).getByRole("button", { name: "Reset filters", exact: true }).click(); await selected(page, "Our actions");
    await expect(search).toHaveValue("");await expect(panel(page).getByRole("combobox", { name: "Milestone", exact: true })).toHaveValue("all");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await mkdir("docs/dashboard-sales-phase2-1", { recursive: true });
    await writeFile(`docs/dashboard-sales-phase2-1/scroll-${viewport.width}x${viewport.height}.json`, JSON.stringify({ viewport, samples }, null, 2));
  });
}

test("legacy others scope is visible, removable and remains honest across views and unassigned links", async ({ page }) => {
  await agentFeesFixture(page);await open(page, "&feeWork=others");
  await selected(page, "Invoices to submit/correct");await expect(panel(page)).toContainText("Assigned agents only");
  await expect(panel(page).getByRole("status")).toHaveText("22 sales in this filtered view");
  await group(page).getByRole("button", { name: "All records", exact: true }).click();
  await expect(panel(page)).toContainText("Assigned agents only");await expect(panel(page).getByRole("status")).toHaveText("23 sales in this filtered view");
  await panel(page).getByRole("combobox", { name: "Agent", exact: true }).selectOption("unassigned");
  await expect(panel(page).getByRole("status")).toHaveText("0 sales in this filtered view");
  await panel(page).getByRole("button", { name: "Remove assigned-agent scope" }).click();
  await expect(panel(page).getByText("Unit 124", { exact: true })).toBeVisible();
  await open(page, "&feeCategory=invoice-submission&feeAgent=unassigned");
  await expect(panel(page).getByRole("status")).toHaveText("1 sale in this filtered view");
  await expect(panel(page)).toContainText("Unallocated");
});

test("arrival reveals once; refresh and clamping do not replay it; record Back/Forward and visible return restore once", async ({ page }) => {
  await instrument(page);const f = await agentFeesFixture(page);await open(page, "&feeView=all&feeSort=unit&feePage=2");
  expect(await page.evaluate(() => window.scrollCalls.filter(c => c.target === "fee-results"))).toHaveLength(1);
  const link = panel(page).getByRole("row").filter({ has: page.getByText("Unit 113", { exact: true }) }).getByRole("link");
  await link.scrollIntoViewIfNeeded();const y = await page.evaluate(() => scrollY);
  await link.click();await expect(page.locator("#agent-fees")).toBeVisible();
  await page.evaluate(() => { window.scrollCalls = []; });await page.goBack();await frames(page);
  await expect(link).toBeVisible();await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([{ method: "to", target: "window" }]);
  await page.goForward();await expect(page.locator("#agent-fees")).toBeVisible();
  await page.reload();await expect(page.locator("#agent-fees")).toBeVisible();
  await page.evaluate(() => { window.scrollCalls = []; });await page.getByRole("button", { name: "Back to Agent Fees" }).click();await expect(link).toBeVisible();await frames(page);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([{ method: "to", target: "window" }]);
  let release = () => {};const gate = new Promise<void>(r => { release = r; });
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio", async route => { await gate; await route.fallback(); });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();await expect(panel(page).getByText("Refreshing…", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.scrollCalls = []; });
  f.rows.unit_sale_attempts = f.rows.unit_sale_attempts.slice(0, 2);release();
  await expect(panel(page).getByText("Refreshing…", { exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toHaveText("2 sales in this filtered view");await expect(page).toHaveURL(/feePage=1/);await frames(page);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([]);
});

test("empty fixture retains every explicit view and default on reset", async ({ page }) => {
  const f = await agentFeesFixture(page);f.rows.unit_sale_attempts = [];await open(page);
  for (const name of views) { await group(page).getByRole("button", { name, exact: true }).click();await selected(page, name);await expect(panel(page).getByRole("status")).toHaveText("0 sales in this filtered view"); }
  await panel(page).getByRole("button", { name: "Reset filters", exact: true }).click();await selected(page, "Our actions");
});

test("shared Sales hook preserves focus and does not replay deep-link reveal on refinements", async ({ page }) => {
  await instrument(page);await developerSalesFixture(page);await page.goto("/?screen=sales&building=all&salesWork=ours#sales-results");
  const results = page.locator("#sales-results");await expect(results.getByRole("link", { name: "Unit 103", exact: true })).toBeVisible();await frames(page);
  const search = results.getByLabel("Search", { exact: true });await search.focus();await page.evaluate(() => { window.scrollCalls = []; });
  await search.pressSequentially("104");await frames(page);await expect(search).toBeFocused();expect(await page.evaluate(() => window.scrollCalls)).toEqual([]);
});

test("embedded preview has independent document scrolling, focus and one-time arrival", async ({ page }) => {
  await instrument(page);await agentFeesFixture(page);
  await page.setContent('<main style="height:1400px"><h1>Local embedded preview harness</h1><iframe id="preview" title="Portal preview" style="width:100%;height:550px;border:0" src="/?screen=sales&amp;building=all&amp;salesView=agent_fees&amp;feeView=all#fee-results"></iframe></main>');
  const preview = page.frameLocator("#preview"), list = preview.locator("#fee-results");
  await expect(list.getByRole("status")).toHaveText("24 sales in this filtered view");
  const frame = page.frames().find(f => f.parentFrame())!;
  await frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await frame.evaluate(() => window.scrollCalls.filter(c => c.target === "fee-results"))).toHaveLength(1);
  const outerY = await page.evaluate(() => scrollY);
  const button = list.getByRole("button", { name: "Awaiting approval", exact: true });
  await button.evaluate(node => node.focus({ preventScroll: true }));
  await frame.evaluate(() => { scrollTo({ top: 100, behavior: "instant" }); window.scrollCalls = []; });
  await page.keyboard.press("Enter");await expect(button).toHaveAttribute("aria-pressed", "true");await expect(button).toBeFocused();
  await frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await frame.evaluate(() => window.scrollCalls)).toEqual([]);
  expect(await frame.evaluate(() => scrollY)).toBe(100);expect(await page.evaluate(() => scrollY)).toBe(outerY);
});

test("explicit pagination reveals once, and subsequent search including zero results never scrolls", async ({ page }) => {
  await instrument(page);await agentFeesFixture(page);await open(page, "&feeView=all");
  await page.evaluate(() => { window.scrollCalls = []; });await panel(page).getByRole("button", { name: "Next", exact: true }).click();await frames(page);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([{ method: "into", target: "fee-results" }]);
  await panel(page).getByRole("searchbox").focus();await page.evaluate(() => { window.scrollCalls = []; });
  await page.keyboard.type("124");await frames(page);await expect(page).toHaveURL(/feePage=1/);
  await page.keyboard.type("absent");await expect(panel(page).getByRole("status")).toHaveText("0 sales in this filtered view");await frames(page);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([]);
});

test("filtering during first load cancels arrival; direct record entry returns without saved history", async ({ page }) => {
  await instrument(page);await agentFeesFixture(page);
  let release = () => {};const gate = new Promise<void>(r => { release = r; });
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio", async route => { await gate; await route.fallback(); });
  await page.goto("/?screen=sales&building=all&salesView=agent_fees&feeCategory=invoice-review#fee-results");
  await expect(panel(page)).toHaveAttribute("aria-busy", "true");
  await group(page).getByRole("button", { name: "Approved unpaid", exact: true }).click();
  await page.evaluate(() => { window.scrollCalls = []; });release();
  await expect(panel(page).getByRole("status")).toHaveText("4 sales in this filtered view");await frames(page);
  expect(await page.evaluate(() => window.scrollCalls)).toEqual([]);
  const href = await panel(page).getByRole("row").filter({ has: page.getByText("Unit 101", { exact: true }) }).getByRole("link").getAttribute("href");
  await page.goto(href!);await expect(page.locator("#exchange-fee")).toBeVisible();
  expect(await page.evaluate(() => history.state?.salesOverviewReturn)).toBeUndefined();
  await page.getByRole("button", { name: "Back to Agent Fees" }).click();await selected(page, "Approved unpaid");
  await expect(panel(page).getByRole("status")).toHaveText("4 sales in this filtered view");
});

test("summary explanation is keyboard accessible and stays inside the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });await agentFeesFixture(page);await open(page, "&feeWork=others");
  const info = panel(page).getByLabel("About fee totals", { exact: true });await info.focus();await page.keyboard.press("Enter");
  const explanation = panel(page).getByText("Totals cover both milestones in this scope.", { exact: false });await expect(explanation).toBeVisible();
  const box = (await explanation.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x + box.width).toBeLessThanOrEqual(390);
});
