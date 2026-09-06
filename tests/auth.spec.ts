import { expect, test, type Page } from "@playwright/test";
import { selectBuildingContext } from "./helpers/building-context";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalEnv(name: string) {
  return process.env[name] || "";
}

function desktopNavigation(page: Page) {
  return page.locator("header nav").first();
}

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("admin can sign in and see admin navigation", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Snags", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Sales", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Rentals", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Setup", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Units", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Users", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Audit", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Add snag", exact: true })).toHaveCount(0);
});

test("admin selected building updates overview and structure", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  await desktopNavigation(page).getByRole("button", { name: "Setup", exact: true }).click();
  const selectedBuilding = page.getByRole("combobox", { name: "Current building", exact: true });
  const buildingNames = (await selectedBuilding.locator('option:not([value=""])').allTextContents()).map((name) => name.trim()).filter(Boolean);
  test.skip(buildingNames.length < 2, "At least two buildings are required to verify selected-building switching.");

  for (const targetBuilding of buildingNames.slice(0, 2)) {
    await selectBuildingContext(page, targetBuilding);
    await expect(page.getByTestId("working-building-context")).toContainText(targetBuilding);
    await expect(page.getByTestId("building-overview-section")).toBeVisible();
    await expect(page.getByTestId("building-structure-section")).toHaveAttribute("data-building-name", targetBuilding);
  }
});

test("admin can open the Unit allocation Setup workspace", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  await desktopNavigation(page).getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("tab", { name: "Unit allocation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unit allocation", exact: true })).toBeVisible();
  await expect(page.getByText("Total units", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sales position")).toBeVisible();
  await expect(page.getByLabel("Rental position")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Sale workflow", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Active sale file", exact: true })).toHaveCount(0);
  await expect(page.getByText("Sales action", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "draft", exact: true })).toHaveCount(0);
  if (await page.getByLabel(/^Sales availability for unit /).count()) {
    await expect(page.getByRole("button", { name: /^Sales availability for unit / }).first()).toHaveAttribute("aria-haspopup", "menu");
  }
});

test("Building Structure keeps sale status read-only and rejects a tampered update", async ({ page, request }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  await desktopNavigation(page).getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("combobox", { name: "Current building", exact: true }).selectOption({ label: "Forum House" });
  const structure = page.getByTestId("building-structure-section");
  await expect(structure).toBeVisible();

  for (const expandButton of await structure.getByRole("button", { name: /^Expand / }).all()) {
    await expandButton.click();
    if (await structure.getByRole("button", { name: /^Edit unit / }).count()) break;
  }

  const editUnit = structure.getByRole("button", { name: /^Edit unit / }).first();
  test.skip(await editUnit.count() === 0, "A unit is required to verify the Building Structure editor.");

  const unitCard = editUnit.locator("xpath=ancestor::article[1]");
  await expect(unitCard.getByText(/^(Not released|Retained \/ not for sale|For sale|Reserved|Exchanged|Completed|Handed over)$/)).toBeVisible();

  const unitId = await unitCard.getAttribute("data-unit-id");
  if (!unitId) throw new Error("The Building Structure unit card is missing its unit identifier.");
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const authResponse = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: {
      email: requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
      password: requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
    },
  });
  expect(authResponse.ok()).toBe(true);
  const authPayload = await authResponse.json() as { access_token?: string };
  if (!authPayload.access_token) throw new Error("Supabase access token was not returned.");

  const tamperResult = await page.evaluate(async ({ targetUnitId, supabaseUrl, anonKey, accessToken }) => {

    const readSaleStatus = async () => {
      const response = await fetch(`${supabaseUrl}/rest/v1/units?id=eq.${encodeURIComponent(targetUnitId)}&select=sale_status`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const units = await response.json() as Array<{ sale_status?: string }>;
      if (!response.ok || !units[0]?.sale_status) throw new Error("Unit sale status could not be read.");
      return units[0].sale_status;
    };

    const beforeSaleStatus = await readSaleStatus();
    const tamperedResponse = await fetch(`/api/buildings/units/${encodeURIComponent(targetUnitId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sale_status: "completed" }),
    });
    const payload = await tamperedResponse.json() as { error?: string };
    const afterApiSaleStatus = await readSaleStatus();
    const rentalProbe = await fetch(`${supabaseUrl}/rest/v1/units?id=eq.${encodeURIComponent(targetUnitId)}&select=rental_portfolio_status`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!rentalProbe.ok) {
      return {
        beforeStatus: { sale_status: beforeSaleStatus },
        afterStatus: { sale_status: afterApiSaleStatus },
        status: tamperedResponse.status,
        error: payload.error,
        migrationMissing: true,
      };
    }
    const rentalRows = await rentalProbe.json() as Array<{ rental_portfolio_status?: string }>;
    const beforeStatus = { sale_status: beforeSaleStatus, rental_portfolio_status: rentalRows[0]?.rental_portfolio_status };
    const directSaleResponse = await fetch(`${supabaseUrl}/rest/v1/units?id=eq.${encodeURIComponent(targetUnitId)}`, {
      method: "PATCH",
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sale_status: beforeStatus.sale_status === "for_sale" ? "not_for_sale" : "for_sale" }),
    });
    const directRentalResponse = await fetch(`${supabaseUrl}/rest/v1/units?id=eq.${encodeURIComponent(targetUnitId)}`, {
      method: "PATCH",
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rental_portfolio_status: beforeStatus.rental_portfolio_status === "active" ? "exited" : "active" }),
    });
    const afterSaleStatus = await readSaleStatus();
    const afterRentalResponse = await fetch(`${supabaseUrl}/rest/v1/units?id=eq.${encodeURIComponent(targetUnitId)}&select=rental_portfolio_status`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
    const afterRentalRows = await afterRentalResponse.json() as Array<{ rental_portfolio_status?: string }>;
    const afterStatus = { sale_status: afterSaleStatus, rental_portfolio_status: afterRentalRows[0]?.rental_portfolio_status };
    return {
      beforeStatus,
      afterStatus,
      status: tamperedResponse.status,
      error: payload.error,
      directSaleStatus: directSaleResponse.status,
      directRentalStatus: directRentalResponse.status,
      migrationMissing: false,
    };
  }, {
    targetUnitId: unitId,
    supabaseUrl,
    anonKey,
    accessToken: authPayload.access_token,
  });

  expect(tamperResult.status).toBe(400);
  expect(tamperResult.error).toBe("Sale status can only be changed through the sales workflow.");
  expect(tamperResult.afterStatus.sale_status).toBe(tamperResult.beforeStatus.sale_status);
  test.skip(tamperResult.migrationMissing, "Apply 20260828_commercial_unit_allocation.sql before exercising database-level allocation protection.");
  expect(tamperResult.directSaleStatus).toBeGreaterThanOrEqual(400);
  expect(tamperResult.directRentalStatus).toBeGreaterThanOrEqual(400);
  expect(tamperResult.afterStatus).toEqual(tamperResult.beforeStatus);

  await editUnit.click();

  await expect(unitCard.locator('option[value="not_released"], option[value="not_for_sale"], option[value="for_sale"], option[value="reserved"], option[value="exchanged"], option[value="completed"], option[value="handed_over"]')).toHaveCount(0);
});

test("contractor can sign in and see contractor navigation", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
    requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
  );

  await selectBuildingContext(page, "Forum House");
  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Snags", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Units", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
});

test("resident can sign in and see resident area", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_RESIDENT_EMAIL"),
    requiredEnv("PLAYWRIGHT_RESIDENT_PASSWORD"),
  );

  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "My home", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Snags", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Documents", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Units", exact: true })).toHaveCount(0);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);
});

test("resident with a stale dashboard URL lands on My home", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/?screen=dashboard");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Email").fill(requiredEnv("PLAYWRIGHT_RESIDENT_EMAIL"));
  await page.getByLabel("Password").fill(requiredEnv("PLAYWRIGHT_RESIDENT_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();

  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "My home", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/screen=resident_home/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);
});

test("snag pagination resets when page size changes", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  await desktopNavigation(page).getByRole("button", { name: "Snags", exact: true }).click();

  const pageSize = page.getByLabel("Snags per page");
  test.skip(await pageSize.count() === 0, "Multiple pages of snags are required to verify pagination reset.");

  await pageSize.selectOption("25");
  const nextPage = page.getByRole("button", { name: "Next page" });
  test.skip(await nextPage.isDisabled(), "At least two snag pages are required to verify pagination reset.");

  await nextPage.click();
  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();

  await pageSize.selectOption("50");
  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
});

test("snag pagination resets when filters change", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
  );

  await desktopNavigation(page).getByRole("button", { name: "Snags", exact: true }).click();

  const pageSize = page.getByLabel("Snags per page");
  test.skip(await pageSize.count() === 0, "Multiple pages of snags are required to verify pagination reset.");

  await pageSize.selectOption("25");
  const nextPage = page.getByRole("button", { name: "Next page" });
  test.skip(await nextPage.isDisabled(), "At least two snag pages are required to verify pagination reset.");

  await nextPage.click();
  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();

  const statusFilter = page.getByLabel("Status filter");
  const filterValue = await statusFilter.locator("option").evaluateAll((options) => {
    const option = options.find((item) => item instanceof HTMLOptionElement && item.value);
    return option instanceof HTMLOptionElement ? option.value : "";
  });
  test.skip(!filterValue, "At least one status filter option is required to verify pagination reset.");

  await statusFilter.selectOption(filterValue);
  test.skip(await pageSize.count() === 0, "Filtered snags must still span multiple pages to verify the reset visibly.");
  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
});

test("contractor direct URL access redirects to permitted default", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
    requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
  );

  await page.goto("/?screen=setup_people");
  await expect(page).toHaveURL(/screen=snags/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);

  await page.goto("/?screen=units");
  await expect(page).toHaveURL(/screen=snags/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);
});

test("resident direct URL access redirects to My home", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_RESIDENT_EMAIL"),
    requiredEnv("PLAYWRIGHT_RESIDENT_PASSWORD"),
  );

  await page.goto("/?screen=snags");
  await expect(page).toHaveURL(/screen=resident_home/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);

  await page.goto("/?screen=setup_buildings");
  await expect(page).toHaveURL(/screen=resident_home/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);
});

test("developer representative direct URL access redirects to permitted default", async ({ page }) => {
  const email = optionalEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL");
  const password = optionalEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD");
  test.skip(!email || !password, "Developer Representative credentials are not configured for this environment.");

  await signIn(page, email, password);

  await page.goto("/?screen=setup_activity");
  await expect(page).toHaveURL(/screen=dashboard/);
  await expect(page.getByText("Not authorised", { exact: true })).toHaveCount(0);
});
