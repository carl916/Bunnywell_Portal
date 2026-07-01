import { expect, test } from "@playwright/test";

test("request access page explains the resident access journey", async ({ page }) => {
  await page.goto("/request-access");

  await expect(page.getByRole("heading", { name: "Request access" })).toBeVisible();
  await expect(page.getByText("Submit the flat details linked to your Bunnywell portal account.")).toBeVisible();
  await expect(page.getByText("Add the flat you need access to. Most residents only need to add one flat.")).toBeVisible();
  await expect(page.getByText("The Bunnywell portal is used for handover records, useful documents and initial snag reporting where available.")).toBeVisible();
});
