import { test, expect } from "@playwright/test";
import { salesFixture } from "./helpers/sales-fixture";

const muted = "rgb(97, 113, 105)";

test("sale read-only fields use muted dashes while zero, workflow state and approval validation remain visible", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const f = await salesFixture(page);
  Object.assign(f.attempt, { workflow_status: "reservation_submitted", buyer_name: null, buyer_person_name: "  ", buyer_company_name: null, buyer_email: null, buyer_phone: "", buyer_solicitor_name: null, reservation_date: null });
  Object.assign(f.unit, { sale_status: "reserved", list_price: 0 });
  f.rows.unit_sale_terms = [{ id: "zero-terms", sale_attempt_id: f.attempt.id, is_current: true, contract_price: 0, reservation_fee: 0 }];
  await page.reload();
  await page.getByRole("button", { name: /^Reservation Awaiting developer approval/ }).click();
  const stage = page.locator("#sales-stage-reservation");
  for (const label of ["Buyer", "Buyer email", "Buyer phone", "Buyer solicitor", "Reservation date"]) {
    const value = stage.getByText(label, { exact: true }).first().locator("..").locator("strong");
    await expect(value).toHaveText("—");
    await expect(value.locator("[data-empty-value]")).toHaveCSS("color", muted);
  }
  await expect(stage.getByRole("button", { name: "Approve reservation", exact: true })).toBeDisabled();
  await expect(stage.getByText("Complete the buyer details, reservation date and uploaded reservation form before approving.")).toBeVisible();
  await expect(stage.getByText("Awaiting developer approval", { exact: true }).first()).toBeVisible();
  await expect(stage.getByLabel("Reservation date", { exact: true })).toHaveValue("");
  await expect(stage.getByText("£0", { exact: true }).first()).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sale-empty-values-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("building read-only contacts use dashes while edit controls and required setup guidance remain", async ({ page }, testInfo) => {
  const f = await salesFixture(page);
  await page.goto(`/?screen=setup_buildings&building=${f.unit.building_id}`);
  const contacts = page.locator("#sales-contacts");
  await expect(contacts.locator("[data-empty-value]")).toHaveCount(4);
  for (const dash of await contacts.locator("[data-empty-value]").all()) await expect(dash).toHaveCSS("color", muted);
  await expect(contacts.getByText("Required before instructions can be sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting PC confirmation", { exact: true })).toBeVisible();
  await contacts.screenshot({ path: testInfo.outputPath("building-empty-values.png") });
  await contacts.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(contacts.getByRole("combobox", { name: "Conveyancer organisation", exact: true }).locator("option")).toHaveText(["Not selected"]);
  await expect(contacts.getByLabel("Seller/SPV", { exact: true })).toHaveValue("");
});

test("populated sale fields retain their values and primary text colour", async ({ page }) => {
  const f = await salesFixture(page);
  Object.assign(f.attempt, { workflow_status: "reservation_submitted" });
  Object.assign(f.unit, { sale_status: "reserved" });
  await page.reload();
  await page.getByRole("button", { name: /^Reservation Awaiting developer approval/ }).click();
  const stage = page.locator("#sales-stage-reservation");
  const buyer = stage.getByText("Buyer", { exact: true }).first().locator("..").locator("strong");
  await expect(buyer).toHaveText("Example Buyer");
  await expect(buyer).toHaveCSS("color", "rgb(15, 61, 46)");
  await expect(buyer.locator("[data-empty-value]")).toHaveCount(0);
  await expect(stage.getByText("Example Solicitors", { exact: true })).toBeVisible();
  await expect(stage.getByText("01 Aug 2026", { exact: true })).toBeVisible();
});

test("legal terms render missing subfields without altering authority status or zero amounts", async ({ page }, testInfo) => {
  const f = await salesFixture(page);
  f.unit.sale_status = "reserved";
  f.attempt.workflow_status = "approved";
  f.rows.unit_sale_terms = [{ id: "terms", sale_attempt_id: f.attempt.id, is_current: true, contract_price: 0, reservation_fee: 0 }];
  await page.reload();
  await page.getByRole("button", { name: /^Exchange / }).click();
  const terms = page.getByRole("list", { name: "Exchange tasks", exact: true }).getByRole("term").filter({ hasText: /^Contract price$/ }).locator("..").locator("dd");
  await expect(terms).toHaveText("£0.00");
  const parking = page.getByRole("term").filter({ hasText: /^Parking$/ }).locator("..").locator("dd");
  await expect(parking).toHaveText("—; value —; contribution —");
  await expect(parking.locator("[data-empty-value]")).toHaveCount(3);
  await expect(page.getByText("Authority not requested", { exact: true })).toBeVisible();
  await expect(page.getByText("Select a conveyancer organisation in the building’s Sales contacts before sending.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("legal-empty-values.png"), fullPage: true });
});

test("rental read-only fields retain zero deposits and meaningful occupancy status", async ({ page }) => {
  const f = await salesFixture(page);
  f.unit.rental_portfolio_status = "active";
  const tenancy = { id: "tenancy", unit_id: f.unit.id, tenant_name: "Example Tenant", tenancy_start_date: "2026-01-01", tenancy_end_date: null, fixed_term_end_date: null, monthly_rent: 1200, deposit_amount: 0, rent_due_day: null, letting_agent_organisation_id: null, source_type: "manual", source_reference: null, notes: null };
  await page.route("**/api/rentals/tenancies**", route => route.fulfill({ json: { tenancies: [tenancy] } }));
  await page.route("**/api/rentals/rent-risk**", route => route.fulfill({ json: { episodes: [], events: [], imports: [] } }));
  await page.goto(`/?screen=rentals&building=${f.unit.building_id}&rentalUnitId=${f.unit.id}`);
  await expect(page.getByRole("heading", { name: "Current tenancy", exact: true })).toBeVisible();
  const deposit = page.getByRole("term").filter({ hasText: /^Deposit$/ }).locator("..").locator("dd");
  await expect(deposit).toHaveText("£0");
  const agent = page.getByRole("term").filter({ hasText: /^Letting agent$/ }).locator("..").locator("dd");
  await expect(agent).toHaveText("—");
  await expect(agent.locator("[data-empty-value]")).toHaveCSS("color", muted);
  await expect(page.getByText("Occupied", { exact: true })).toBeVisible();
});

test("snag fields use dashes while status and the trade assignment action remain clear", async ({ page }) => {
  const f = await salesFixture(page);
  f.rows.snags = [{ id: "snag-empty-values", building_id: f.unit.building_id, unit_id: f.unit.id, area_id: null, source_type: "developer_snag", title: "Fixture snag", description: null, trade_id: null, priority_code: "P2", status: "open", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z", created_by_user_id: f.profile.id }];
  await page.goto(`/?screen=snags&building=${f.unit.building_id}`);
  const row = page.getByRole("row").filter({ hasText: "Fixture snag" });
  await expect(row.locator("[data-empty-value]")).toHaveCount(1);
  await expect(row.locator("[data-empty-value]")).toHaveCSS("color", muted);
  await expect(row.getByRole("button", { name: "No trade", exact: true })).toBeVisible();
  await expect(row.getByText("Open", { exact: true })).toBeVisible();
});
