import { test, expect } from "@playwright/test";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

for (const width of [1440, 390, 320]) {
  test(`Financials tabs retain alignment, focus, URL and scroll position at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const f = await developerSalesFixture(page);
    await page.route("**/rest/v1/rpc/sales_deposit_context", async route => {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fallback();
    });
    for (const receipt of f.rows.sale_exchange_deposit_receipts) {
      Object.assign(receipt, { received_date: "2026-09-04", recorded_at: "2026-09-04T12:00:00Z", recorded_by_name: "Fixture Conveyancer", revision: 1 });
    }
    for (const source of f.rows.sale_exchange_deposit_sources) {
      Object.assign(source, { authority_version: 1, terms_version: 1 });
    }
    const sale = f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units.find(u => u.unit_number === "104")!.id)!;
    const path = `/?screen=sales&building=all&salesUnitId=${sale.unit_id}&workSale=${sale.id}&section=financials`;
    await page.goto(`${path}&financialView=deposits`);
    const tabs = page.getByRole("tablist", { name: "Financials view" });
    const deposits = tabs.getByRole("tab", { name: "Deposits", exact: true });
    const fees = tabs.getByRole("tab", { name: "Agent fees", exact: true });
    await expect(page.locator("#sale-deposits")).toContainText("Deposit received");
    await expect(deposits).toHaveAttribute("aria-selected", "true");
    await tabs.evaluate(node => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 160, behavior: "instant" }));
    const scrollY = await page.evaluate(() => window.scrollY);
    const rail = (await tabs.boundingBox())!;
    for (const tab of [deposits, fees]) {
      const bounds = (await tab.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.y).toBe(rail.y);
    }
    expect(await tabs.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const panelIntro = page.locator("#sale-deposits > p").first();
    expect((await panelIntro.boundingBox())!.x).toBe((await deposits.boundingBox())!.x);
    await page.screenshot({ path: testInfo.outputPath(`deposits-${width}.png`) });

    await fees.click();
    await expect(fees).toHaveAttribute("aria-selected", "true");
    await expect(fees).toHaveCSS("border-bottom-color", "rgb(15, 61, 46)");
    await expect(fees.locator("span")).toHaveCSS("font-weight", "600");
    await expect(deposits.locator("span")).toHaveCSS("font-weight", "500");
    await expect(fees).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator("#agent-fees")).toContainText("Exchange: Unpaid");
    await expect(page.locator("#agent-fees")).toContainText("Completion:");
    await expect(page.locator("#agent-fees").getByRole("heading", { name: "Agent fees", exact: true })).toHaveCount(0);
    await expect(page.locator("#agent-fees")).not.toContainText("Sale workspace");
    expect((await page.locator("#agent-fees p").first().boundingBox())!.x).toBe(rail.x);
    expect((await tabs.boundingBox())!.y).toBe(rail.y);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    expect(new URL(page.url()).searchParams.get("financialView")).toBe("agent_fees");
    await page.screenshot({ path: testInfo.outputPath(`agent-fees-${width}.png`) });

    for (const [key, selected] of [["ArrowLeft", deposits], ["End", fees], ["Home", deposits], ["ArrowLeft", fees], ["ArrowRight", deposits]] as const) {
      await page.keyboard.press(key);
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect(selected).toHaveCSS("outline-style", "solid");
      await expect(selected).toHaveCSS("outline-width", "2px");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      if (selected === deposits) {
        await expect(page.locator("#sale-deposits")).toContainText("Deposit received");
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      }
    }
    await page.keyboard.press("Tab");
    await expect(page.locator("#sale-deposits")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(deposits).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(deposits).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(deposits).toHaveAttribute("aria-selected", "true");
    await fees.click();
    await page.goBack();
    await expect(deposits).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(fees).toHaveAttribute("aria-selected", "true");

    for (const anchor of ["exchange-fee", "completion-fee"]) {
      await page.goto(`${path}#${anchor}`);
      await expect(fees).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#${anchor}`)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const exchangeFee = page.locator("#exchange-fee");
    await exchangeFee.getByRole("button", { name: "Record payment", exact: true }).click();
    await exchangeFee.getByLabel("Agent fee payment amount", { exact: true }).fill("100");
    await exchangeFee.getByLabel("Payment date", { exact: true }).fill("2026-10-07");
    await expect(exchangeFee.getByRole("button", { name: "Save payment", exact: true })).toBeEnabled();
    await exchangeFee.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(exchangeFee.getByRole("button", { name: "Record payment", exact: true })).toBeVisible();
  });
}

test("Financials tabs label both unavailable panels for an unreserved unit", async ({ page }) => {
  const f = await developerSalesFixture(page);
  const unit = f.rows.units.find(u => u.unit_number === "106")!;
  await page.goto(`/?screen=sales&building=all&salesUnitId=${unit.id}&section=financials&financialView=deposits`);
  await expect(page.getByRole("tabpanel", { name: "Deposits", exact: true })).toContainText("No purchaser collection is required");
  await page.getByRole("tab", { name: "Agent fees", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: /Agent fees/ })).toContainText("after the reservation is approved");
});

for (const width of [1440, 390]) {
  test(`both invoice submissions remain available through Agent fees at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await developerSalesFixture(page);
    const sale = f.rows.unit_sale_attempts.find(s => s.unit_id === f.rows.units.find(u => u.unit_number === "103")!.id)!;
    await page.goto(`/?screen=sales&building=all&salesUnitId=${sale.unit_id}&section=financials&financialView=agent_fees`);
    for (const milestone of ["exchange", "completion"]) {
      const panel = page.locator(`#${milestone}-fee`);
      await panel.getByLabel("Invoice reference", { exact: true }).fill(`TEST-${milestone}`);
      await panel.getByLabel("Invoice date", { exact: true }).fill("2026-10-07");
      await panel.getByLabel(/invoice total$/).fill("3024");
      await panel.locator('input[type="file"]').setInputFiles({ name: `${milestone}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic test invoice\n%%EOF") });
      const request = page.waitForRequest(request => request.url().includes("/api/sales/reservations") && request.method() === "POST");
      await panel.getByRole("button", { name: "Submit invoice", exact: true }).click();
      const body = (await request).postData()!;
      expect(body).toContain("upload_agent_invoice");
      expect(body).toContain(`name="feeMilestone"\r\n\r\n${milestone}`);
      expect(body).toContain(String(sale.id));
      await expect(panel.getByRole("button", { name: "Submit invoice", exact: true })).toBeDisabled();
    }
  });
}
