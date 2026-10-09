import { test, expect, type Page } from "@playwright/test";
import { conveyancerFileFixture, detailedSalesPath } from "./helpers/conveyancer-file-fixture";

async function landing(page: Page) {
  await page.goto("/?screen=sales&building=all");
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
}
const ready = (page: Page) => expect(page.getByRole("button", { name: "Request authority to serve notice", exact: true })).toBeEnabled();
function detailedRequests(page: Page) {
  const calls: { url: URL; body: Record<string, unknown> | null }[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (detailedSalesPath.test(url.pathname)) calls.push({ url, body: request.postDataJSON() }); });
  return calls;
}

test("first reads select the requested authorised unit, every attempt and all dependent rows", async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  const calls = detailedRequests(page), unit = f.rows.units[2], sale = f.rows.unit_sale_attempts.find(row => row.unit_id === unit.id && row.is_active)!;
  await page.getByRole("link", { name: "Unit 103", exact: true }).click(); await ready(page);
  expect(calls).toHaveLength(10);
  expect(calls.find(row => row.url.pathname.endsWith("unit_sale_attempts"))!.url.searchParams.get("unit_id")).toBe(`in.(${unit.id})`);
  expect(calls.find(row => row.url.pathname.endsWith("building_sale_defaults"))!.url.searchParams.get("building_id")).toBe(`eq.${unit.building_id}`);
  const attempts = [String(sale.id), "history-2"];
  for (const call of calls.filter(row => row.url.searchParams.has("sale_attempt_id"))) expect(call.url.searchParams.get("sale_attempt_id")!.slice(4, -1).split(",").sort()).toEqual([...attempts].sort());
  expect(calls.find(row => row.url.pathname.endsWith("sale_actor_names"))!.body?.p_sales).toEqual(attempts);
  const documentIds = f.rows.unit_sale_documents.filter(row => attempts.includes(String(row.sale_attempt_id))).map(row => row.id).sort();
  expect(calls.find(row => row.url.pathname.endsWith("unit_sale_document_versions"))!.url.searchParams.get("document_id")!.slice(4, -1).split(",").sort()).toEqual(documentIds);
  await expect(page.getByText("Historic buyer 103 withdrew", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "103-reservation_form-v2.pdf", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  await expect(page.getByTestId("commercial-summary-cards")).toContainText("£264,500");
  await page.getByRole("tab", { name: /^Financials/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("£3,000");
  expect(calls).toHaveLength(10); // Sections reuse the same complete unit snapshot.
  expect(f.registerReads()).toBe(1);
});

test("unit selector and browser Back load the new unit and retain the register owner", async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  await page.getByLabel("Search", { exact: true }).fill("10");
  await page.getByRole("link", { name: "Unit 103", exact: true }).click(); await ready(page);
  const calls = detailedRequests(page);
  await page.getByRole("combobox", { name: "Open unit", exact: true }).selectOption(String(f.unit.id)); await ready(page);
  await expect(page.getByRole("heading", { name: "Unit 101", exact: true })).toBeVisible();
  await expect(page.getByText("Historic buyer 103 withdrew", { exact: true })).toHaveCount(0);
  await page.goBack(); await ready(page);
  await expect(page.getByRole("heading", { name: "Unit 103", exact: true })).toBeVisible();
  expect(calls.filter(row => row.url.pathname.endsWith("unit_sale_attempts")).map(row => row.url.searchParams.get("unit_id"))).toEqual([`in.(${f.unit.id})`, `in.(${f.rows.units[2].id})`]);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("10");
  expect(f.registerReads()).toBe(1);
});

for (const lateFailure of [false, true]) test(`superseded file ${lateFailure ? "failure" : "response"} cannot publish under the next selection`, async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  let release!: () => void, arrived = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/unit_sale_document_versions?*", async route => {
    if (!route.request().url().includes(encodeURIComponent(String(f.attempt.id)))) return route.fallback();
    arrived = true; await gate;
    if (lateFailure) await route.fulfill({ status: 403, json: { message: "Old file denied" } });
    else await route.fallback();
  });
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await expect.poll(() => arrived).toBe(true);
  await expect(page.getByRole("region", { name: "Sales loading" })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Unit 103", exact: true }).click(); await ready(page);
  release(); await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Unit 103", exact: true })).toBeVisible();
  await expect(page.getByText("Historic buyer 101 withdrew", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Old file denied", { exact: true })).toHaveCount(0);
  expect(f.registerReads()).toBe(1);
});

for (const status of [401, 403]) test(`required selected-unit read ${status} blocks controls and Refresh recovers`, async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  let failed = true;
  await page.route("**/rest/v1/unit_sale_document_versions?*", route => failed ? route.fulfill({ status, json: { code: "42501", message: "Selected versions denied" } }) : route.fallback());
  await page.getByRole("link", { name: "Unit 103", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sales loading" })).toContainText("could not be loaded");
  await expect(page.getByRole("button", { name: "Request authority to serve notice", exact: true })).toHaveCount(0);
  failed = false; const calls = detailedRequests(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await ready(page);
  expect(calls.filter(row => row.url.pathname.endsWith("unit_sale_attempts")).every(row => row.url.searchParams.get("unit_id") === `in.(${f.rows.units[2].id})`)).toBe(true);
});

test("direct URLs reject unknown and out-of-building units before detailed reads", async ({ page }) => {
  const f = await conveyancerFileFixture(page);
  const second = { ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second House" };
  f.rows.buildings.push(second); f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second.id });
  f.rows.units[2].building_id = second.id;
  const calls = detailedRequests(page);
  for (const id of ["unknown-unit", String(f.rows.units[2].id)]) {
    await page.goto(`/?screen=sales&building=${id === "unknown-unit" ? "all" : f.unit.building_id}&salesUnitId=${id}`);
    await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
    expect(calls).toHaveLength(0);
  }
});

test("direct file and cross-building selection use each building's defaults and canonical unit order", async ({ page }) => {
  const f = await conveyancerFileFixture(page, 5);
  const second = { ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second House" };
  f.rows.buildings.push(second); f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second.id });
  f.rows.building_sale_defaults.push({ building_id: second.id, reservation_fee: 4000 });
  f.rows.building_floors.push({ building_id: second.id, name: "Lower Ground", sort_order: 0 }, { building_id: second.id, name: "Ground", sort_order: 1 });
  Object.assign(f.rows.units[0], { unit_number: "10" }); Object.assign(f.rows.units[2], { unit_number: "2" });
  Object.assign(f.rows.units[3], { building_id: second.id, unit_number: "20", floor: "Lower Ground" });
  Object.assign(f.rows.units[4], { building_id: second.id, unit_number: "1", floor: "Unknown" });
  const calls = detailedRequests(page);
  await page.goto(`/?screen=sales&building=all&salesUnitId=${f.rows.units[3].id}`); await ready(page);
  expect(await page.getByRole("combobox", { name: "Open unit", exact: true }).locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([f.rows.units[2].id, f.rows.units[0].id, f.rows.units[1].id, f.rows.units[3].id, f.rows.units[4].id]);
  expect(calls.find(row => row.url.pathname.endsWith("building_sale_defaults"))!.url.searchParams.get("building_id")).toBe(`eq.${second.id}`);
  calls.length = 0;
  await page.getByRole("combobox", { name: "Open unit", exact: true }).selectOption(String(f.unit.id)); await ready(page);
  expect(calls.find(row => row.url.pathname.endsWith("building_sale_defaults"))!.url.searchParams.get("building_id")).toBe(`eq.${f.unit.building_id}`);
  await page.getByLabel("Current building", { exact: true }).selectOption(second.id);
  await expect(page.getByRole("heading", { name: "Unit 10", exact: true })).toHaveCount(0);
});

test("known unit-access revocation unmounts the file and excludes its controls", async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  await page.getByRole("link", { name: "Unit 103", exact: true }).click(); await ready(page);
  f.rows.units = f.rows.units.filter(row => row.unit_number !== "103");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Unit 103", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request authority to serve notice", exact: true })).toHaveCount(0);
});

test("legal mutation reconciles the selected attempt and invalidates the retained register once", async ({ page }) => {
  const f = await conveyancerFileFixture(page); await landing(page);
  await page.getByRole("link", { name: "Unit 101", exact: true }).click(); await ready(page);
  const calls = detailedRequests(page);
  await page.getByRole("button", { name: "Request authority to serve notice", exact: true }).click();
  await expect(page.getByText("Authority to serve notice requested. The developer has been notified.", { exact: true })).toBeVisible();
  expect(f.actions.at(-1)?.action).toBe("request_notice_authority");
  expect(calls.filter(row => row.url.pathname.endsWith("unit_sale_attempts")).map(row => row.url.searchParams.get("id"))).toEqual([`eq.${f.attempt.id}`]);
  expect(calls.some(row => row.url.searchParams.has("unit_id"))).toBe(false);
  expect(f.registerReads()).toBe(1);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect.poll(f.registerReads).toBe(2);
  await page.waitForLoadState("networkidle"); expect(f.registerReads()).toBe(2);
});

for (const role of ["developer", "admin"]) test(`${role} keeps building details and reuses them when opening another file`, async ({ page }) => {
  const f = await conveyancerFileFixture(page); f.profile.role = role;
  const calls = detailedRequests(page);
  await page.goto(`/?screen=sales&building=${f.unit.building_id}&salesUnitId=${f.unit.id}`);
  await expect(page.getByRole("list", { name: "Completion tasks", exact: true })).toBeVisible();
  expect(calls.find(row => row.url.pathname.endsWith("unit_sale_attempts"))!.url.searchParams.get("unit_id")!.slice(4, -1).split(",").sort()).toEqual(f.rows.units.map(row => row.id).sort());
  calls.length = 0;
  await page.getByRole("combobox", { name: "Open unit", exact: true }).selectOption(String(f.rows.units[2].id));
  await expect(page.getByRole("heading", { name: "Unit 103", exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
});
