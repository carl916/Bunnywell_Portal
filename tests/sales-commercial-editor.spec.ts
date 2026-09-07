import { expect, test, type Page } from "@playwright/test";
import { salesFixture, userId } from "./helpers/sales-fixture";
import { loadTypescriptModule } from "./helpers/load-typescript-module.mjs";

const { saveCommercialModel } = loadTypescriptModule("src/app/api/sales/reservations/route.ts", {
  overrides: { "@/lib/supabase/admin": { createSupabaseServiceRoleClient() { throw new Error("Live database access is forbidden in this test"); } } },
  exports: ["saveCommercialModel"],
});

async function editorFixture(page: Page) {
  const f = await salesFixture(page);
  const terms = {
    id: "model-terms", sale_attempt_id: f.attempt.id, is_current: true, status: "draft",
    contract_price: 340500, list_price_at_offer: 340500, parking_value: 0,
    developer_contribution: 0, agent_contribution: 0, parking_contribution_value: 0,
    agent_fee_percent: 10, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5,
    reservation_fee: 5000, reservation_fee_holder: "sales_agent", solicitor_fee: 882, vat_rate: 20,
    exchange_deposit_percent: 10, second_deposit_enabled: true, second_deposit_percent: 5,
    second_deposit_months_after_exchange: 3, completion_balance_percent: 85,
    additional_special_conditions: ["Include parking space."],
  };
  f.rows.unit_sale_terms = [terms];
  f.rows.building_sale_defaults = [{ building_id: f.unit.building_id, default_agent_fee_percent: 12, default_exchange_agent_fee_percent: 11, default_completion_agent_fee_percent: 1, reservation_fee: 5000 }];
  const payloads: Record<string, unknown>[] = [];
  const rpcPayloads: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: f.rows[table]?.[0] ?? null, error: null }) };
      return query;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      if (name === "save_unit_commercial_model_with_agent_fees") {
        rpcPayloads.push(payload);
        for (const [key, value] of Object.entries(payload)) {
          if (key.startsWith("p_") && !["p_unit_id", "p_requester_id", "p_payment_schedule"].includes(key)) Object.assign(terms, { [key.slice(2)]: value });
        }
      }
      return { data: { sale_attempt_id: f.attempt.id, sale_terms_id: terms.id }, error: null };
    },
  };
  // Exercise the actual server save/validation code with an in-memory RPC adapter.
  await page.route("**/api/sales/reservations", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    try {
      const result = await saveCommercialModel(client, { id: userId, role: "developer" }, payload);
      await route.fulfill({ json: result });
    } catch (error) {
      await route.fulfill({ status: 400, json: { error: error instanceof Error ? error.message : "Save failed" } });
    }
  });
  await page.reload();
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  await page.getByRole("button", { name: "Edit commercial model", exact: true }).click();
  await expect(page.getByTestId("commercial-model-editor")).toBeVisible();
  return { ...f, terms, payloads, rpcPayloads };
}

test("valid saved fees allow unrelated changes, live previews and a save through server validation", async ({ page }) => {
  const f = await editorFixture(page);
  const rail = page.getByRole("complementary", { name: "Commercial preview" });
  const after = rail.getByText("Developer net after", { exact: true }).locator("..").locator("strong");
  await expect(after).toHaveText("£305,568");
  await page.getByRole("button", { name: "Edit deal setup", exact: true }).click();
  await expect(page.getByLabel("Total agent fee %", { exact: true })).toHaveValue("10");
  await expect(page.getByLabel("Exchange fee %", { exact: true })).toHaveValue("9.5");
  await expect(page.getByLabel("Completion fee %", { exact: true })).toHaveValue("0.5");
  await expect(page.getByTestId("agent-fee-validation")).toContainText("9.5% + 0.5% = 10%");
  await page.getByLabel("Proposed contract price", { exact: true }).fill("350500");
  await expect(after).toHaveText("£314,568");
  await expect(rail.getByText("Proposed GDV", { exact: true }).locator("..")).toContainText("£350,500");
  await page.getByLabel("Developer contribution amount").fill("2000");
  await expect(after).toHaveText("£312,568");
  await page.getByRole("button", { name: "Save commercial model", exact: true }).click();
  await expect(page.getByTestId("commercial-model-editor")).toHaveCount(0);
  expect(f.payloads[0]).toMatchObject({ agentFeePercent: 10, exchangeAgentFeePercent: 9.5, completionAgentFeePercent: 0.5 });
  expect(f.rpcPayloads[0]).toMatchObject({ p_agent_fee_percent: 10, p_exchange_agent_fee_percent: 9.5, p_completion_agent_fee_percent: 0.5, p_second_deposit_enabled: true });
  await page.reload();
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  await page.getByRole("button", { name: "Edit commercial model", exact: true }).click();
  await page.getByRole("button", { name: "Edit deal setup", exact: true }).click();
  await expect(page.getByLabel("Proposed contract price", { exact: true })).toHaveValue("350,500");
  await expect(page.getByLabel("Exchange fee %", { exact: true })).toHaveValue("9.5");
});

test("invalid splits are explained inline; collapsing advanced edits still saves the displayed split", async ({ page }) => {
  const f = await editorFixture(page);
  await page.getByRole("button", { name: "Edit deal setup", exact: true }).click();
  await page.getByLabel("Completion fee %", { exact: true }).fill("0.4");
  await expect(page.getByTestId("agent-fee-validation")).toContainText("9.5% + 0.4% = 9.9%");
  await expect(page.getByTestId("agent-fee-validation")).toContainText("Must equal total agent fee of 10%.");
  await expect(page.getByRole("button", { name: "Save commercial model", exact: true })).toBeDisabled();
  await page.getByLabel("Exchange fee %", { exact: true }).fill("9.6");
  await expect(page.getByRole("button", { name: "Save commercial model", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Hide setup", exact: true }).click();
  await page.getByRole("button", { name: "Save commercial model", exact: true }).click();
  await expect(page.getByTestId("commercial-model-editor")).toHaveCount(0);
  expect(f.rpcPayloads[0]).toMatchObject({ p_exchange_agent_fee_percent: 9.6, p_completion_agent_fee_percent: 0.4 });
});

test("untouched advanced settings remain inherited/preserved on an ordinary commercial save", async ({ page }) => {
  const f = await editorFixture(page);
  await expect(page.getByLabel("Parking contribution", { exact: true })).toHaveCount(0);
  await page.getByLabel("Parking value", { exact: true }).fill("500");
  await expect(page.getByRole("complementary", { name: "Commercial preview" }).getByText("Proposed GDV", { exact: true }).locator("..")).toContainText("£341,000");
  await page.getByRole("button", { name: "Save commercial model", exact: true }).click();
  await expect(page.getByTestId("commercial-model-editor")).toHaveCount(0);
  expect(f.payloads[0]).not.toHaveProperty("agentFeePercent");
  expect(f.payloads[0]).not.toHaveProperty("secondDepositEnabled");
  expect(f.payloads[0]).not.toHaveProperty("parkingContributionValue");
  expect(f.rpcPayloads[0]).toMatchObject({ p_parking_value: 500, p_exchange_agent_fee_percent: 9.5, p_completion_agent_fee_percent: 0.5, p_second_deposit_enabled: true, p_completion_balance_percent: 85 });
  await page.reload();
  await page.getByRole("tab", { name: /^Commercial/ }).click();
  await page.getByRole("button", { name: "Edit commercial model", exact: true }).click();
  await expect(page.getByLabel("Parking value", { exact: true })).toHaveValue("500");
});

test("commercial editor has a wide input area, stacked preview rail and responsive grouped fields", async ({ page }, testInfo) => {
  await editorFixture(page);
  await page.getByRole("button", { name: "Edit deal setup", exact: true }).click();
  const editor = page.getByTestId("commercial-model-editor");
  const rail = page.getByRole("complementary", { name: "Commercial preview" });
  for (const width of [1600, 1440, 1100, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    const inputBox = await editor.getByRole("heading", { name: "Deal inputs", exact: true }).locator("..").boundingBox();
    const railBox = await rail.boundingBox();
    if (width >= 1440) {
      expect(inputBox!.width / railBox!.width).toBeCloseTo(2, 1);
      expect(railBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width);
      await expect(rail).toHaveCSS("position", "sticky");
      const total = await page.getByLabel("Total agent fee %", { exact: true }).boundingBox();
      const exchange = await page.getByLabel("Exchange fee %", { exact: true }).boundingBox();
      expect(Math.abs(total!.y - exchange!.y)).toBeLessThan(2);
    }
    if (width <= 768) {
      expect(railBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
      await expect(rail).toHaveCSS("position", "static");
    }
    const panels = rail.locator(":scope > div");
    const live = await panels.nth(0).boundingBox();
    const scheme = await panels.nth(1).boundingBox();
    expect(scheme!.y).toBeGreaterThan(live!.y + live!.height);
    expect(Math.abs(live!.x - scheme!.x)).toBeLessThan(2);
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await editor.screenshot({ path: testInfo.outputPath(`commercial-editor-${width}.png`) });
  }
});
