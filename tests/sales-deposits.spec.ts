import { test, expect } from "@playwright/test";
import { legalFixture } from "./helpers/legal-ui-fixture";
import { salesFixture } from "./helpers/sales-fixture";
import { furtherDepositDatabase } from "./helpers/further-deposit-database.mjs";

test("building fixed default saves and persists through the shared configuration surface", async ({ page }, testInfo) => {
  const f=await salesFixture(page);
  const writes: {table:string;body:Record<string,unknown>}[]=[];
  f.rows.building_sale_defaults=[{building_id:f.unit.building_id,exchange_deposit_percent:10,default_agent_fee_percent:3,default_exchange_agent_fee_percent:2,default_completion_agent_fee_percent:1,second_deposit_enabled:false}];
  await page.route("**/rest/v1/**",async route=>{
    if(["GET","HEAD"].includes(route.request().method())) {await route.fallback();return;}
    const table=new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body=route.request().postDataJSON();writes.push({table,body});
    if(table==="building_sale_defaults") Object.assign(f.rows.building_sale_defaults[0],body);
    await route.fulfill({json:null});
  });
  await page.goto(`/?screen=setup_buildings&building=${f.unit.building_id}`);
  const section=page.locator("section").filter({has:page.getByRole("heading",{name:"Sales setup",exact:true})}).last();
  await section.getByRole("button",{name:"Edit",exact:true}).click();
  await page.getByLabel("Optional further deposit").check();
  await page.getByLabel("Further deposit %",{exact:true}).fill("5");
  await page.getByRole("combobox",{name:"Timing basis",exact:true}).selectOption("fixed");
  await page.getByLabel("Deadline date",{exact:true}).fill("2027-04-01");
  await page.getByLabel("Deadline time — UK (Europe/London)",{exact:true}).fill("17:00");
  await section.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(section.getByRole("button",{name:"Save changes",exact:true})).toHaveCount(0);
  expect(writes.find(w=>w.table==="building_sale_defaults")?.body).toMatchObject({second_deposit_percent:5,further_deposit_timing:{basis:"fixed",date:"2027-04-01",time:"17:00"}});
  expect(writes.filter(w=>w.table==="unit_sale_terms")).toHaveLength(0);
  await page.reload();await expect(section).toContainText("17:00 UK time");await expect(section).toContainText("85% completion");
  await section.screenshot({path:testInfo.outputPath("building-defaults.png")});
});

test("Financials receipts use real disposable SQL: early partial/full, failure, corrections, links and mobile", async ({ page }, testInfo) => {
  const database = await furtherDepositDatabase();
  try {
    await database.exchange();
    const f = await legalFixture(page);
    f.profile.role = "conveyancer";
    f.unit.sale_status = "exchanged";
    Object.assign(f.attempt, { workflow_status: "exchanged", exchanged_at: "2026-09-01" });
    f.rows.unit_sale_terms = [{ id: "terms", sale_attempt_id: f.attempt.id, is_current: true, contract_price: 300000, exchange_deposit_percent: 10, second_deposit_enabled: true, second_deposit_percent: 5, completion_balance_percent: 85, further_deposit_timing: { basis: "fixed", date: "2027-04-01", time: "17:00" } }];
    let fail = false;
    let calls = 0;
    await page.route("**/rest/v1/rpc/sales_deposit_context", async route => route.fulfill({ json: await database.context(f.profile.role === "developer" ? "developer" : "solicitor") }));
    await page.route("**/rest/v1/rpc/sales_further_deposit_action", async route => {
      calls++;
      if (fail) { await route.fulfill({ status: 400, json: { message: "Synthetic save failure. Your input is retained." } }); return; }
      const body = route.request().postDataJSON();
      try { await route.fulfill({ json: await database.depositAction(body.p_action, body.p_payload, f.profile.role === "developer" ? "developer" : "solicitor") }); }
      catch (e) { await route.fulfill({ status: 400, json: { message: e instanceof Error ? e.message : "Save failed" } }); }
    });
    await f.reloadStage("Exchange");
    await expect(page.locator("#sales-stage-exchange")).toContainText("Receipt confirmation outstanding");
    await expect(page.locator("#sales-stage-exchange").getByLabel("Date deposit received")).toHaveCount(0);
    await page.getByRole("button", { name: "Manage deposits", exact: true }).click();
    const card = page.locator("#further-deposit");
    await expect(card).toContainText("£15,000.00");
    await expect(card).toContainText("17:00 UK time");
    await expect(page.locator("#agent-fees")).toHaveCount(0);
    await card.getByRole("button", { name: "Record receipt", exact: true }).click();
    await card.getByLabel("Amount received (£)").fill("10000");
    await card.getByLabel("Actual date received", { exact: true }).fill("2026-09-01");
    fail = true;
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic save failure" })).toBeVisible();
    await expect(card.getByLabel("Amount received (£)")).toHaveValue("10000");
    fail = false;
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).toContainText("Part received");
    await expect(card).toContainText("£5,000.00");
    expect(new URL(page.url()).searchParams.get("financialView")).toBe("deposits");
    await page.reload(); await expect(card).toContainText("Part received");
    await page.setViewportSize({ width: 1365, height: 1000 });
    await page.locator("#sale-deposits").screenshot({ path: testInfo.outputPath("deposits-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Capture the complete card at mobile width without fixed portal navigation
    // obscuring the middle of a stitched element screenshot.
    await page.setViewportSize({ width: 390, height: 1600 });
    await page.locator("#sale-deposits").evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 100));
    await page.locator("#sale-deposits").screenshot({ path: testInfo.outputPath("deposits-mobile.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole("button", { name: "Record receipt", exact: true }).click();
    await expect(card.getByLabel("Amount received (£)")).toHaveValue("5000");
    await card.getByLabel("Actual date received", { exact: true }).fill("2026-09-02");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByText("Received", { exact: true })).toBeVisible();
    expect((await database.context()).further.received_amount).toBe(15000);
    await card.getByRole("button", { name: "Correct", exact: true }).last().click();
    await card.getByLabel("Amount received (£)").fill("4000");
    await card.getByLabel("Reason for correction").fill("Synthetic ledger correction");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).toContainText("£1,000.00");await expect(card).toContainText("Superseded");
    await page.getByRole("tab", { name: "Agent fees", exact: true }).click();
    await expect(page.locator("#agent-fees").getByRole("heading", { name: "Agent fee summary", exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.goBack(); await expect(card).toContainText("Part received");
    const legacy = new URL(page.url());legacy.searchParams.delete("financialView");legacy.searchParams.set("section", "progression");legacy.hash = "exchange-deposit-task";
    await page.goto(legacy.toString());await expect(page.locator("#exchange-deposit-task")).toBeVisible();await expect(card).toBeVisible();
    await page.getByRole("tab", { name: /^Progression/ }).click();
    await page.getByRole("button", { name: /^Exchange\b/ }).click();
    await expect(page.locator("#sales-stage-exchange")).toContainText("Exchanged");
    expect(calls).toBe(4);
  } finally { await database.db.close(); }
});
