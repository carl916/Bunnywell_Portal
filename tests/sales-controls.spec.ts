import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { salesFixture } from "./helpers/sales-fixture";

const artifacts = "artifacts/sales-controls";
const mentionsButton = (page: Page) => page.getByRole("button", { name: /^@ Mentions/ });
const popover = (page: Page) => page.getByRole("dialog", { name: "Unread mentions" });
const pagination = (page: Page) => page.getByRole("navigation", { name: "Results pagination" });
const feeRows = (page: Page) => page.getByRole("region", { name: "Agent fees", exact: true }).locator("tbody tr[tabindex]");

async function fixture(page: Page, mentionCount = 3) {
  const ui = await salesFixture(page);
  await mkdir(artifacts, { recursive: true });
  let mentions = Array.from({ length: mentionCount }, (_, index) => ({
    id: `mention-${index}`, sale_attempt_id: String(ui.attempt.id), comment_id: `comment-${index}`,
    unit_id: String(ui.unit.id), building_id: String(ui.unit.building_id), unit_number: "101", building_name: "Workflow Test House",
    author_name: index % 2 ? "Sam Taylor" : "Alex Morgan", created_at: "2026-09-22T10:30:00Z",
  }));
  let fees = Array.from({ length: 62 }, (_, index) => ({
    sale_attempt_id: index === 0 ? ui.attempt.id : `sale-${index}`, building_id: ui.unit.building_id, building_name: "Workflow Test House",
    unit_id: index === 0 ? ui.unit.id : `unit-${index}`, unit_number: String(101 + index),
    unit_sale_status: index < 20 ? "exchanged" : "reserved", workflow_status: index < 20 ? "exchanged" : "approved",
    sales_agent_organisation_id: index < 40 ? "agent-a" : "agent-b", sales_agent_name: index < 40 ? "Bunnywell Sales" : "River & Co",
    contract_price: 250000, exchange_fee_percent: 9.5, completion_fee_percent: 0.5, vat_rate: 20,
    exchange_invoice: { id: `invoice-${index}`, status: index < 31 ? "uploaded" : "approved", approved_at: index < 31 ? null : "2026-09-21T12:00:00Z", gross_amount: 1000, expected_payable_amount: 1000 },
    completion_invoice: null, exchange_active_payments: [], completion_active_payments: [],
  }));
  let reads = 0;
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio", route => route.fulfill({ json: fees }));
  await page.route("**/rest/v1/rpc/sale_mentions_inbox", route => route.fulfill({ json: mentions }));
  await page.route("**/rest/v1/rpc/sale_comment_page", route => route.fulfill({ json: {
    comments: [{ id: "comment-0", sale_attempt_id: ui.attempt.id, sequence: 1, author_id: "agent", author_name: "Alex Morgan", author_role: "sales_agent", author_organisation: "Bunnywell Sales", body: "Please review the sale update.", parent_id: null, mention_ids: [ui.profile.id], created_at: "2026-09-22T10:30:00Z", edited_at: null, version: 1, unread: true }], hasBefore: false, hasAfter: false,
  } }));
  await page.route("**/rest/v1/rpc/sale_comment_read", route => { reads += 1; mentions = []; return route.fulfill({ json: {} }); });
  // Populate the existing Sales table as well, so both consumers are exercised.
  ui.rows.units = fees.map(row => ({ ...ui.unit, id: row.unit_id, unit_number: row.unit_number, list_price: 250000 }));
  await page.goto(`/?screen=sales&building=${ui.unit.building_id}`);
  await expect(page.getByRole("tab", { name: "Sales overview", exact: true })).toBeVisible();
  await expect(mentionsButton(page)).toHaveAttribute("aria-expanded", "false");
  const openFees = async () => {
    await page.getByRole("tab", { name: "Agent Fees", exact: true }).click();
    await expect(pagination(page)).toContainText("Showing 1–12 of 62");
  };
  return { ...ui, openFees, reads: () => reads, shrink: (count: number) => { fees = fees.slice(0, count); } };
}

test("desktop Mentions stays beside the tabs and overlays Sales and Agent Fees without shifting content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const tabs = (await page.getByRole("tablist", { name: "Sales views" }).boundingBox())!;
    const trigger = (await mentionsButton(page).boundingBox())!;
    expect(Math.abs(tabs.y - trigger.y)).toBeLessThan(2);
    expect(trigger.x).toBeGreaterThan(tabs.x + tabs.width);
    expect(trigger.height).toBeGreaterThanOrEqual(44);
    expect(trigger.width).toBeLessThan(170);
  }
  await page.screenshot({ path: `${artifacts}/sales-desktop-mentions-closed.png` });
  const financial = page.getByRole("heading", { name: "Financial overview", exact: true });
  const before = (await financial.boundingBox())!.y;
  await mentionsButton(page).click();
  await expect(popover(page)).toBeVisible();
  expect((await financial.boundingBox())!.y).toBe(before);
  const bounds = (await popover(page).boundingBox())!;
  expect(bounds.width).toBe(400);
  expect(bounds.y).toBe((await mentionsButton(page).boundingBox())!.y + 52);
  await page.screenshot({ path: `${artifacts}/sales-desktop-mentions-open.png` });
  expect(f.reads()).toBe(0);
  await page.keyboard.press("Escape");
  await f.openFees();
  const heading = page.getByRole("heading", { name: "Agent Fees", exact: true });
  const feeTop = (await heading.boundingBox())!.y;
  await mentionsButton(page).click();
  await expect(popover(page)).toBeVisible();
  expect((await heading.boundingBox())!.y).toBe(feeTop);
});

test("Mentions supports trigger toggle, outside click, Escape, keyboard focus and a compact empty state", async ({ page }) => {
  await fixture(page, 0);
  const trigger = mentionsButton(page);
  await expect(trigger).toHaveText("@ Mentions");
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(popover(page)).toContainText("No unread mentions");
  await expect(popover(page)).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-controls", await popover(page).getAttribute("id") as string);
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(popover(page)).toBeVisible();
  await trigger.click(); await expect(popover(page)).toBeHidden();
  await trigger.click(); await page.getByRole("heading", { name: "Financial overview", exact: true }).click();
  await expect(popover(page)).toBeHidden(); await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("mobile Mentions is content-width, right aligned, bounded by the viewport and scrolls internally", async ({ page }) => {
  await fixture(page, 18);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 844 });
    const trigger = mentionsButton(page);
    await expect(trigger.getByLabel("18 unread mentions")).toBeVisible();
    const triggerBounds = (await trigger.boundingBox())!;
    const controls = (await page.getByRole("tablist", { name: "Sales views" }).locator("..").boundingBox())!;
    expect(triggerBounds.width).toBeLessThan(170); expect(triggerBounds.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(triggerBounds.x + triggerBounds.width - controls.x - controls.width)).toBeLessThan(2);
    const before = (await page.getByRole("heading", { name: "Financial overview", exact: true }).boundingBox())!.y;
    await trigger.click(); await expect(popover(page)).toBeVisible();
    const bounds = (await popover(page).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(832);
    expect(await popover(page).evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect((await page.getByRole("heading", { name: "Financial overview", exact: true }).boundingBox())!.y).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375) await page.screenshot({ path: `${artifacts}/sales-mobile-mentions-open.png` });
    await page.keyboard.press("Escape");
  }
});

test("mention links keep their sale and comment destination and only reading the comment clears unread state", async ({ page }) => {
  const f = await fixture(page, 1);
  await mentionsButton(page).focus(); await page.keyboard.press("Enter");
  const link = popover(page).getByRole("link");
  await expect(link).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(mentionsButton(page)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("href", new RegExp(`salesUnitId=${f.unit.id}&conversation=${f.attempt.id}&comment=comment-0`));
  expect(f.reads()).toBe(0);
  await page.keyboard.press("Escape"); await expect(mentionsButton(page)).toBeFocused();
  await mentionsButton(page).click(); await link.click();
  await expect(page).toHaveURL(/comment=comment-0/); await expect(popover(page)).toBeHidden();
  await expect(page.getByText("Please review the sale update.", { exact: true })).toBeVisible();
  await expect.poll(f.reads).toBeGreaterThan(0);
  await expect(mentionsButton(page)).toHaveText("@ Mentions");
});

test("Agent Fees paginates 62 sales in twelve-row pages without reducing summary totals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const f = await fixture(page); await f.openFees();
  await expect(feeRows(page)).toHaveCount(12);
  await expect(pagination(page).getByRole("button", { name: "Previous" })).toBeDisabled();
  const summary = page.getByText("Outstanding payments", { exact: true }).locator("..");
  await expect(summary).toContainText("£62,000");
  await expect(page.getByText("Future completion fees", { exact: true }).locator("..")).toContainText("£77,500");
  await page.screenshot({ path: `${artifacts}/agent-fees-first-page.png`, fullPage: true });
  await pagination(page).getByRole("button", { name: "Next" }).click();
  await expect(pagination(page)).toContainText("Showing 13–24 of 62");
  await expect(feeRows(page).first()).toContainText("Unit 113"); await expect(summary).toContainText("£62,000");
  await pagination(page).getByRole("button", { name: "Previous" }).click();
  await expect(pagination(page)).toContainText("Showing 1–12 of 62");
  for (let pageNumber = 1; pageNumber < 6; pageNumber++) await pagination(page).getByRole("button", { name: "Next" }).click();
  await expect(pagination(page)).toContainText("Showing 61–62 of 62"); await expect(feeRows(page)).toHaveCount(2);
  await expect(pagination(page).getByRole("button", { name: "Next" })).toBeDisabled(); await expect(summary).toContainText("£62,000");
  f.shrink(15); await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(pagination(page)).toContainText("Showing 13–15 of 15"); await expect(feeRows(page)).toHaveCount(3);
  await pagination(page).getByRole("button", { name: "Previous" }).click(); await expect(pagination(page)).toContainText("Showing 1–12 of 15");
});

test("Agent Fees filters reset pagination and remain selected while paging the filtered dataset", async ({ page }) => {
  const f = await fixture(page); await f.openFees();
  const next = pagination(page).getByRole("button", { name: "Next" });
  await next.click(); await page.getByRole("combobox", { name: "Agent", exact: true }).selectOption("agent-a");
  await expect(pagination(page)).toContainText("Showing 1–12 of 40");
  await next.click(); await expect(pagination(page)).toContainText("Showing 13–24 of 40");
  await expect(page.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue("agent-a");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("awaiting_approval");
  await expect(pagination(page)).toContainText("Showing 1–12 of 31");
  await next.click(); await page.getByRole("combobox", { name: "Milestone", exact: true }).selectOption("completion");
  await expect(pagination(page)).toContainText("Showing 0–0 of 0"); await expect(next).toBeDisabled();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("all");
  await expect(pagination(page)).toContainText("Showing 1–12 of 20");
  await next.click(); await expect(pagination(page)).toContainText("Showing 13–20 of 20"); await expect(feeRows(page)).toHaveCount(8);
  await expect(page.getByRole("combobox", { name: "Milestone", exact: true })).toHaveValue("completion");
  await expect(page.getByText("Outstanding payments", { exact: true }).locator("..")).toContainText("£20,000");
  await page.getByRole("combobox", { name: "Milestone", exact: true }).selectOption("exchange");
  await expect(pagination(page)).toContainText("Showing 1–12 of 40");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("rejected");
  await expect(page.getByText("No sales match the selected filters.")).toBeVisible();
  await expect(pagination(page)).toContainText("Showing 0–0 of 0"); await expect(pagination(page).getByRole("button", { name: "Previous" })).toBeDisabled();
});

test("shared Sales pagination and mobile Agent Fees keep horizontal scrolling and row navigation", async ({ page }) => {
  const f = await fixture(page);
  await expect(pagination(page)).toContainText("Showing 1–12 of 62");
  await pagination(page).getByRole("button", { name: "Next" }).click();
  await expect(pagination(page)).toContainText("Showing 13–24 of 62");
  await f.openFees(); await page.setViewportSize({ width: 375, height: 844 });
  await expect(feeRows(page)).toHaveCount(12);
  const table = page.getByRole("region", { name: "Agent fees", exact: true });
  expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pagination(page).getByRole("button", { name: "Next" }).click();
  await expect(pagination(page)).toContainText("Showing 13–24 of 62");
  await pagination(page).getByRole("button", { name: "Previous" }).click();
  await feeRows(page).first().press("Enter");
  await expect(page.getByRole("tab", { name: /^Financials/ })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`salesUnitId=${f.unit.id}.*section=financials`));
});
