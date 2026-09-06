import { expect, type Page } from "@playwright/test";

export async function selectBuildingContext(page: Page, buildingName: string) {
  const header = page.locator("header");
  const selector = header.getByRole("combobox", { name: "Current building", exact: true });
  const fixedBuilding = header.getByLabel(`Building: ${buildingName}`, { exact: true });

  await expect(selector.or(fixedBuilding)).toBeVisible();
  if (await selector.isVisible()) {
    await selector.selectOption({ label: buildingName });
    await expect(selector.locator("option:checked")).toHaveText(buildingName);
  } else {
    await expect(fixedBuilding).toContainText(buildingName);
  }
}
