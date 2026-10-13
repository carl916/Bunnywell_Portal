import { test, expect, type Page } from "@playwright/test";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

const actions = (page: Page) => page.getByRole("navigation", { name: "Matching actions" });
const warning = (page: Page) => page.getByText(/The sale attempt has changed/);
const drawer = (page: Page) => page.locator("#sale-conversation");
const comments = (page: Page) => page.getByRole("button", { name: /^Comments/ }).first();
const composer = (page: Page) => page.getByRole("textbox", { name: "Write an update", exact: true });

test("compact actions keep ordering, complete labels, URLs and expansion across workspaces", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await developerSalesFixture(page);
  const sale = f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units.find(u => u.unit_number === "103")!.id)!;
  sale.contractual_completion_date = null;
  f.rows.sale_exchange_deposit_receipts = [];
  sale.buyer_person_name = "Alexandra Montgomery-Worthington and Christopher Montgomery-Worthington";
  await page.goto(`/?screen=sales&building=all&salesUnitId=${sale.unit_id}&workSale=${sale.id}&workReturn=sales#sales-matching-actions`);
  await expect(actions(page).getByRole("heading", { name: /Actions requiring attention/ })).toBeVisible();
  await expect(actions(page).getByRole("link")).toHaveCount(3);
  expect(await actions(page).evaluate(node => node.closest("section")?.querySelector("h3")?.textContent)).toBe("Unit 103");
  const firstThree = await actions(page).getByRole("link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  await actions(page).getByRole("button", { name: "Show all", exact: true }).click();
  const expanded = await actions(page).getByRole("link").evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute("href")!, name: node.getAttribute("aria-label")! })));
  expect(expanded.length).toBeGreaterThan(3);
  expect(expanded.slice(0, 3).map(item => item.href)).toEqual(firstThree);
  await expect(actions(page).getByRole("heading")).toHaveText(`Actions requiring attention (${expanded.length})`);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`actions-expanded-${width}.png`) });
  }
  await actions(page).getByRole("button", { name: "Show fewer" }).click();
  await expect(actions(page).getByRole("link")).toHaveCount(3);
  await actions(page).getByRole("button", { name: "Show all", exact: true }).click();
  // Every existing action target, including document versions and financial
  // anchors, still uses the original navigation handler and URL builder.
  for (const item of expanded) {
    await actions(page).getByRole("link", { name: item.name, exact: true }).click();
    const expected = new URL(item.href, page.url());
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(Object.fromEntries(expected.searchParams));
    expect(new URL(page.url()).hash).toBe(expected.hash);
    expect(expected.searchParams.get("workSale")).toBe(sale.id);
    const id = decodeURIComponent(expected.hash.slice(1));
    if (id) await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  }
  await page.getByRole("tab", { name: /^Financials/ }).click();
  await page.getByRole("tab", { name: "Deposits", exact: true }).click();
  await expect(page.locator("#sale-deposits")).toBeVisible();
  await page.getByRole("tab", { name: "Agent fees", exact: true }).click();
  await expect(page.locator("#agent-fees")).toBeVisible();
});

test("reserved sale shows one matching action and a sale without matching actions has no empty panel", async ({ page }) => {
  const f = await developerSalesFixture(page);
  await page.goto(`/?screen=sales&building=all&salesUnitId=${f.unit.id}&workSale=${f.attempt.id}&workReturn=sales&salesWork=ours`);
  await expect(actions(page).getByRole("link", { name: "Review submitted reservation", exact: true })).toBeVisible();
  await expect(actions(page).getByRole("link")).toHaveCount(1);
  await expect(actions(page).getByRole("button")).toHaveCount(0);
  await page.getByRole("combobox", { name: /^Open unit/ }).selectOption(String(f.rows.units.find(u => u.unit_number === "105")!.id));
  await actions(page).getByRole("link", { name: "Approve commercial terms", exact: true }).click();
  await expect(page.locator("#sales-stage-exchange")).toBeVisible();
  await page.getByRole("combobox", { name: /^Open unit/ }).selectOption(String(f.rows.units.find(u => u.unit_number === "106")!.id));
  await expect(page.getByRole("heading", { name: "Unit 106", exact: true })).toBeVisible();
  await expect(actions(page)).toHaveCount(0);
});

test("unit switching clears inherited context while explicit stale attempts and document links remain protected", async ({ page }) => {
  const f = await developerSalesFixture(page);
  const sale = f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units.find(u => u.unit_number === "103")!.id)!;
  const path = `/?screen=sales&building=all&salesUnitId=${sale.unit_id}&workReturn=sales`;
  await page.goto(`${path}&workSale=${sale.id}&workVersion=completion_statement-2-v2`);
  await expect(actions(page)).toBeVisible();
  await expect(warning(page)).toHaveCount(0);
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  expect(new URL(page.url()).searchParams.get("workSale")).toBe(sale.id);
  expect(new URL(page.url()).searchParams.get("workVersion")).toBe("completion_statement-2-v2");
  await page.getByRole("combobox", { name: /^Open unit/ }).selectOption(String(f.unit.id));
  await expect(page.getByRole("heading", { name: "Unit 101", exact: true })).toBeVisible();
  await expect(warning(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("workSale")).toBe(false);
  expect(new URL(page.url()).searchParams.has("workVersion")).toBe(false);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Unit 103", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workSale")).toBe(sale.id);
  const historicalId = "40000000-0000-4000-8000-000000000099";
  f.rows.unit_sale_attempts.push({ ...sale, id: historicalId, is_active: false, workflow_status: "fallen_through" });
  for (const staleId of [historicalId, "unknown-explicit-attempt"]) {
    await page.goto(`${path}&workSale=${staleId}`);
    await expect(warning(page)).toBeVisible();
    await page.getByRole("tab", { name: /^Commercial/ }).click();
    expect(new URL(page.url()).searchParams.get("workSale")).toBe(staleId);
    await expect(warning(page)).toBeVisible();
  }
  await page.goto(path);
  await expect(actions(page)).toBeVisible();
  await expect(warning(page)).toHaveCount(0);
});

test("browser unit navigation while the drawer is open isolates history and drafts", async ({ page }) => {
  const f = await developerSalesFixture(page);
  const other = f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units.find(u => u.unit_number === "103")!.id)!;
  const reads: Array<{ p_sale: string; p_unit?: string }> = [];
  await page.route("**/rest/v1/rpc/sale_comment_page", async route => {
    const args = route.request().postDataJSON(); reads.push(args);
    await route.fulfill({ json: { comments: [{ id: crypto.randomUUID(), sale_attempt_id: args.p_sale, sequence: 1, author_id: "agent", author_name: "Alex Morgan", author_role: "sales_agent", author_organisation: "Fixture Agency", body: args.p_sale === f.attempt.id ? "First unit history" : "Other unit history", parent_id: null, mention_ids: [], created_at: "2026-10-01T10:00:00Z", edited_at: null, version: 1, unread: false }], hasBefore: false, hasAfter: false } });
  });
  await page.goto(`/?screen=sales&building=all&salesUnitId=${f.unit.id}`);
  await comments(page).click(); await composer(page).fill("First unit draft");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: /^Open unit/ }).selectOption(String(other.unit_id));
  await comments(page).click();
  await expect(drawer(page).getByText("Other unit history", { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue(""); await composer(page).fill("Other unit draft");
  await page.goBack();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText("First unit history", { exact: true })).toBeVisible();
  await expect(drawer(page).getByText("Other unit history", { exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue("First unit draft");
  expect(reads.at(-1)).toMatchObject({ p_sale: f.attempt.id, p_unit: f.unit.id });
  await page.goForward();
  await expect(drawer(page).getByText("Other unit history", { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue("Other unit draft");
});
