import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
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
  await expect(navigation.getByRole("button", { name: "Admin", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Users", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Audit", exact: true })).toBeVisible();
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
  await expect(navigation.getByRole("button", { name: "Reports", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
});

test("resident can sign in and see resident area", async ({ page }) => {
  await signIn(
    page,
    requiredEnv("PLAYWRIGHT_RESIDENT_EMAIL"),
    requiredEnv("PLAYWRIGHT_RESIDENT_PASSWORD"),
  );

  const navigation = desktopNavigation(page);
  await expect(navigation.getByRole("button", { name: "Resident", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
});
