import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { salesFixture, at, userId } from "./helpers/sales-fixture";

// Capture both revisions against identical local data. No API or storage write
// escapes the browser fixtures, including actions used to open inline editors.
const baseline = process.env.PORTAL_VISUAL_BASELINE === "1";
const captureRoot = path.join(process.cwd(), "test-results", "portal-refinement", baseline ? "before" : "after");

async function capture(page: Page, name: string, target?: Locator) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    if (!baseline) {
      const overflow = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.right > innerWidth + 1 && getComputedStyle(element).position !== "fixed";
      }).slice(0, 8).map((element) => ({ className: element.className, width: element.getBoundingClientRect().width, text: element.textContent?.slice(0, 60) })));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width}: ${JSON.stringify(overflow)}`).toBe(true);
      for (const field of await page.locator(".portal-workspace .field, .portal-workspace .gbp-input").all()) {
        if (await field.isVisible()) await expect(field).toHaveCSS("border-radius", "4px");
      }
    }
    await (target ?? page.locator("main")).screenshot({ path: path.join(captureRoot, `${name}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
}

async function portalFixture(page: Page) {
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 404, body: "Fixture storage only" }));
  const f = await salesFixture(page);
  f.profile.role = "admin";
  Object.assign(f.unit, { size_sqm: 72, unit_type_id: "type-1" });
  f.rows.building_floors = [{ id: "floor-1", building_id: f.unit.building_id, name: "Ground", sort_order: 1 }];
  f.rows.unit_types = [{ id: "type-1", name: "Two bedroom", bedroom_count: 2 }];
  f.rows.areas = [
    { id: "room-1", building_id: f.unit.building_id, unit_id: f.unit.id, name: "Living room", area_type: "unit_room", floor: "Ground" },
    { id: "amenity-1", building_id: f.unit.building_id, unit_id: f.unit.id, name: "Terrace", area_type: "private_amenity", floor: "Ground" },
    { id: "communal-1", building_id: f.unit.building_id, unit_id: null, name: "Entrance lobby", area_type: "communal_area", floor: "Ground" },
  ];
  f.rows.trades = [{ id: "trade-1", name: "Decorating" }];
  f.rows.snags = [
    { id: "snag-1", building_id: f.unit.building_id, unit_id: f.unit.id, area_id: "room-1", title: "Paint finish to window reveal", description: "Touch up the paint by the window.", source_type: "developer_snag", status: "open", created_at: at(1), updated_at: at(1), created_by_user_id: userId },
    { id: "snag-2", building_id: f.unit.building_id, unit_id: null, area_id: "communal-1", title: "Entrance door finish", source_type: "developer_snag", status: "closed", created_at: at(1), updated_at: at(1), created_by_user_id: userId },
  ];
  f.rows.unit_sale_terms = [{ id: "terms-1", sale_attempt_id: f.attempt.id, is_current: true, status: "draft", contract_price: 340500, list_price_at_offer: 340500, agent_fee_percent: 10, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5, reservation_fee: 5000, reservation_fee_holder: "sales_agent", exchange_deposit_percent: 10, second_deposit_enabled: true, second_deposit_percent: 5, second_deposit_months_after_exchange: 3, completion_balance_percent: 85, additional_special_conditions: ["Include the allocated parking space and terrace access."] }];
  f.rows.audit_events = [{ id: "audit-1", building_id: f.unit.building_id, unit_id: f.unit.id, entity_type: "unit", entity_id: f.unit.id, event_type: "unit_updated", category: "setup", summary: "Unit details updated", created_at: at(1), created_by_user_id: userId, metadata: { changes: [{ field: "size_sqm", before: 70, after: 72 }] } }];
  const go = async (screen: string) => {
    await page.goto(`/?screen=${screen}&building=${f.unit.building_id}${screen === "sales" ? `&salesUnitId=${f.unit.id}` : ""}`);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  };
  return { ...f, go };
}

test("portal forms, grouped summaries and dialog remain usable across viewport sizes", async ({ page }) => {
  const f = await portalFixture(page);
  await f.go("dashboard");
  await expect(page.getByText("No developer snag movement today yet.")).toBeVisible();
  await capture(page, "dashboard");
  await f.go("snags");
  await page.getByRole("button", { name: "Add snag", exact: true }).click();
  const snagForm = page.getByRole("heading", { name: "Add developer snag" }).locator("..");
  await capture(page, "add-snag", snagForm);
  await page.getByRole("button", { name: "Communal", exact: true }).first().click();
  await expect(page.getByRole("combobox", { name: "Communal area", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unit", exact: true }).click();
  if (!baseline) {
    const selected = page.getByRole("button", { name: "Unit", exact: true });
    await selected.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(selected).toHaveCSS("outline-style", "solid");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
  }
  await f.go("snags");
  await capture(page, "snag-list");
  await page.getByRole("button", { name: "Snag report", exact: true }).click();
  const report = page.getByRole("heading", { name: "Snag report", exact: true }).locator("..");
  await capture(page, "snag-report", report);
  await page.getByLabel("Include photos", { exact: true }).uncheck();
  await page.getByLabel("Include closed snags", { exact: true }).check();
  await expect(page.getByLabel("Include closed snags", { exact: true })).toBeChecked();

  await f.go("setup_buildings");
  const structure = page.getByTestId("building-structure-section");
  await structure.getByRole("button", { name: /^Expand / }).first().click();
  await structure.getByRole("button", { name: "Edit unit 101", exact: true }).click();
  await capture(page, "building-structure", structure);
  await structure.getByPlaceholder("Add room", { exact: true }).fill("Study");
  await structure.getByRole("button", { name: "Add room", exact: true }).click();
  await expect(structure.getByRole("button", { name: "Remove pending Study" })).toBeVisible();
  await structure.getByRole("button", { name: "Remove pending Study" }).click();
  await structure.getByRole("button", { name: "Cancel", exact: true }).click();

  f.unit.rental_portfolio_status = "active";
  await f.go("rentals");
  await expect(page.getByRole("heading", { name: /Rental/ }).first()).toBeVisible();
  await capture(page, "rentals");
  await f.go("setup_activity");
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
  await capture(page, "audit");
  await f.go("setup_allocation");
  await page.getByRole("checkbox", { name: "Select unit 101", exact: true }).first().check();
  await page.getByRole("combobox", { name: "Change sales availability", exact: true }).selectOption({ label: "Not released" });
  const dialog = page.getByRole("dialog", { name: "Confirm allocation change" });
  await expect(dialog).toBeVisible();
  await capture(page, "allocation-dialog", dialog);
  if (!baseline) await expect(dialog).toHaveCSS("border-radius", "8px");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("sales refinement retains document history, payment entry, wide modelling and keyboard tabs", async ({ page }) => {
  const f = await portalFixture(page);
  await f.go("sales");
  await capture(page, "reservation-entry", page.locator("#sales-stage-reservation"));
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  await page.getByRole("button", { name: "Edit commercial model", exact: true }).click();
  const editor = page.getByTestId("commercial-model-editor");
  await capture(page, "commercial-collapsed", editor);
  await page.getByRole("button", { name: "Edit deal setup", exact: true }).click();
  await capture(page, "commercial-expanded", editor);
  if (!baseline) {
    await expect(editor).toHaveCSS("border-left-width", "0px");
    await page.getByLabel("Completion fee %", { exact: true }).fill("0.4");
    await expect(page.getByRole("button", { name: "Save commercial model", exact: true })).toBeDisabled();
    await expect(page.getByTestId("agent-fee-validation")).toContainText("Must equal total agent fee");
    await page.getByLabel("Completion fee %", { exact: true }).fill("0.5");
    await page.getByLabel("Proposed contract price", { exact: true }).focus();
    await expect(page.getByLabel("Proposed contract price", { exact: true }).locator("..")).toHaveCSS("border-color", "rgb(15, 61, 46)");
  }
  // Chromium page zoom equivalent: 200% at a 1440px physical viewport.
  // CSS zoom reduces layout space and enlarges controls/text together.
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  if (!baseline) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.screenshot({ path: path.join(captureRoot, "commercial-200-percent.png") });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.getByRole("tab", { name: /^Commercial/ }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /^Progression/ })).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Progression/ })).toHaveAttribute("aria-selected", "true");
  f.unit.sale_status = "completed";
  Object.assign(f.attempt, { workflow_status: "completed", reservation_approved_at: at(2), reservation_approved_by_user_id: userId, commercial_approved_at: at(3), exchanged_at: "2026-08-04", completed_at: "2026-08-06" });
  f.documents();
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "approved", approved_at: at(5), approved_by_user_id: userId }));
  f.rows.unit_sale_document_versions[0].file_name = `${"Long-completion-statement-reference-".repeat(5)}.pdf`;
  f.rows.unit_sale_workflow_events.push(f.event("completion_documents_approved", 5), f.event("completion_recorded", 6));
  for (const stage of ["Reservation", "Exchange", "Completion"]) {
    await f.reloadStage(stage);
    await capture(page, `${stage.toLowerCase()}-completed`, page.locator(`#sales-stage-${stage.toLowerCase()}`));
  }
  f.rows.unit_sale_invoices = [{ id: "invoice-1", sale_attempt_id: f.attempt.id, invoice_type: "sales_agent", fee_milestone: "exchange", status: "approved", gross_amount: 38817, vat_amount: 6469.5, net_amount: 32347.5, expected_payable_amount: 33817, reservation_fee_deduction: 5000, agent_contribution_deduction: 0, approved_at: at(3) }];
  await page.reload();
  await page.getByRole("tab", { name: /^Financials/ }).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).first().click();
  await capture(page, "payment-entry", page.locator("#exchange-fee"));
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Record payment", exact: true }).first()).toBeVisible();
});

test("radius roles, upload focus and intentional shape exceptions survive shared styling", async ({ page }) => {
  test.skip(baseline, "Computed geometry checks apply to the refined revision.");
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toHaveCSS("border-radius", "10px");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS("border-radius", "10px");
  await page.goto("/request-access");
  await expect(page.locator(".field").first()).toHaveCSS("border-radius", "10px");
  const f = await portalFixture(page);
  f.rows.buildings.push({ id: "10000000-0000-4000-8000-000000000002", name: "Second Test House", status: "active", lifecycle_status: "active" });
  await f.go("sales");
  const upload = page.locator('label[for^="reservation-form-"]').first();
  await expect(upload).toHaveCSS("border-radius", "6px");
  await upload.locator("input").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(upload).toHaveCSS("outline-style", "solid");
  await upload.locator("input").setInputFiles({ name: "Reservation form with a long descriptive filename.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(upload).toContainText("Reservation form with a long descriptive filename.pdf");
  await expect(upload.locator(".rounded-bw-inset")).toHaveCSS("border-radius", "4px");
  await page.getByRole("button", { name: "Remove selected PDF", exact: true }).click();
  await expect(upload.getByText("Reservation form with a long descriptive filename.pdf")).toHaveCount(0);
  const roles: Record<string, string> = {};
  for (const [name, locator, radius] of [
    ["workspace", page.locator(".panel").first(), "8px"],
    ["button", page.getByRole("button", { name: "Submit reservation", exact: true }), "6px"],
    ["field", page.getByLabel("Buyer email", { exact: true }), "4px"],
    ["stage", page.getByRole("button", { name: /^Reservation\s/ }), "6px"],
    ["substep", page.getByRole("list", { name: "Reservation tasks" }).getByRole("listitem").first(), "6px"],
    ["header navigation", page.locator("header .nav-pill").first(), "999px"],
  ] as const) {
    await expect(locator).toHaveCSS("border-radius", radius);
    roles[name] = await locator.evaluate((element) => getComputedStyle(element).borderRadius);
  }
  const scope = page.getByRole("combobox", { name: "Current building", exact: true }).locator("..");
  expect(await scope.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(100);
  for (const badge of await page.locator("#sales-stage-reservation span.rounded-full").all()) {
    expect(await badge.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(100);
  }
  await f.go("snags");
  await page.route("**/fixture-snag.jpg", (route) => route.fulfill({ contentType: "image/jpeg", body: readFileSync(path.join(process.cwd(), "tests/fixtures/snag-photos/63 bath door catching.jpg")) }));
  f.rows.snag_photos = [{ id: "photo-1", snag_id: "snag-1", file_url: "http://localhost:3000/fixture-snag.jpg", photo_type: "original", created_at: at(1) }];
  await page.reload();
  await page.getByRole("button", { name: "Add snag", exact: true }).click();
  const camera = page.locator(".camera-action").first();
  await expect(camera).toHaveCSS("border-radius", "6px");
  await expect(page.getByRole("combobox", { name: "Room or private area" })).toHaveCSS("background-color", "rgb(241, 238, 231)");
  await camera.locator("input").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(camera).toHaveCSS("outline-style", "solid");
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  const table = page.locator("table");
  await expect(table.locator("img").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Status filter", exact: true }).selectOption("closed");
  await expect(table.getByText("Entrance door finish", { exact: true })).toBeVisible();
  await expect(table.getByText("Paint finish to window reveal", { exact: true })).toHaveCount(0);
  mkdirSync(captureRoot, { recursive: true });
  writeFileSync(path.join(captureRoot, "computed-radii.json"), JSON.stringify(roles, null, 2));
});
