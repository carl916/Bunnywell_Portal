import { expect, test, type Page } from "@playwright/test";

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
  await expect(navigation.getByRole("button", { name: "Setup", exact: true })).toBeVisible();
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
  await expect(page.getByText("Working building", { exact: true })).toBeVisible();

  const selectedBuilding = page.getByLabel("Selected building");
  const buildingNames = (await selectedBuilding.locator("option").allTextContents()).map((name) => name.trim()).filter(Boolean);
  test.skip(buildingNames.length < 2, "At least two buildings are required to verify selected-building switching.");

  const targetBuilding = buildingNames[1];
  await selectedBuilding.selectOption({ label: targetBuilding });

  await expect(page.getByTestId("working-building-context")).toContainText(targetBuilding);
  await expect(page.getByTestId("building-overview-section")).toContainText(targetBuilding);
  await expect(page.getByTestId("building-structure-section")).toHaveAttribute("data-building-name", targetBuilding);
});

test("contractor can sign in and see contractor navigation", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
    requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
  );

  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Snags", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Sales", exact: true })).toHaveCount(0);
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
  await expect(navigation.getByRole("button", { name: "Sales", exact: true })).toHaveCount(0);
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
