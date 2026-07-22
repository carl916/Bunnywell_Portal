import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function signInAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Email").fill(requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"));
  await page.getByLabel("Password").fill(requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("admin can move between scheme Sales overview and unit sale file", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await signInAsAdmin(page);
  await page.goto("/?screen=units");

  const navigation = page.locator("header nav").first();
  await expect(navigation.getByRole("button", { name: "Sales", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Financial overview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales pipeline", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales results", exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve("test-results/sales-workspace-desktop.png"), fullPage: true });

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  test.skip(rowCount === 0, "Sales workspace needs at least one unit row to verify unit mode.");

  await rows.first().click();
  await expect(page.getByText("Back to sales overview", { exact: true })).toBeVisible();
  await expect(page.getByText("Selected sale file", { exact: true })).toBeVisible();
  await expect(page.getByText("Current action", { exact: true })).toBeVisible();
  await expect(page.getByText("Deal / incentive modelling", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reservation pack", { exact: true })).toBeVisible();
  await expect(page.getByText("Notes & activity", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve("test-results/sales-unit-desktop.png"), fullPage: true });

  await page.getByText("Back to sales overview", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales results", exact: true })).toBeVisible();

  const lockedRowIndexes: number[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const text = await rows.nth(index).innerText();
    if (/\b(Reserved|Exchanged|Completed)\b/.test(text)) lockedRowIndexes.push(index);
  }

  if (lockedRowIndexes.length > 0) {
    await rows.nth(lockedRowIndexes[0]).click();
    await expect(page.getByText("Commercial position locked from reservation", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Model incentive" })).toHaveCount(0);
  }

  await page.setViewportSize({ width: 900, height: 1100 });
  await page.goto("/?screen=units");
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales pipeline", exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve("test-results/sales-workspace-tablet.png"), fullPage: true });
});
