import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { legalFixture } from "./helpers/legal-ui-fixture";
import { deriveSalesRegister } from "../src/lib/sales/register";
import { deriveDashboard } from "../src/lib/dashboard/model";
const { fixture } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");

async function registerFixture(page: Page) {
  const f = await legalFixture(page);
  f.rows.buildings[0].conveyancer_organisation_id = "legal-org";
  f.profile.role = "conveyancer"; f.profile.organisation_id = "legal-org" as never;
  Object.assign(f.attempt, { workflow_status: "exchanged", exchanged_at: "2026-10-01", conveyancer_organisation_id: "legal-org", completion_arrangements_confirmed_at: "2026-10-02T12:00:00Z", contractual_completion_date: "2026-10-12" });
  f.unit.sale_status = "exchanged"; f.documents(true);
  Object.assign(f.rows.unit_sale_documents[0], { status: "approved", approved_version_id: "version-0", approved_at: "2026-10-03T12:00:00Z" });
  Object.assign(f.rows.unit_sale_documents[1], { status: "query_raised", query_note: "Please correct the account." });
  let reads = 0, failed = 0;
  let nextGate: Promise<void> | undefined;
  const input = () => fixture({ viewer: f.profile, buildings: f.rows.buildings, units: f.rows.units, sales: [f.attempt], authorities: f.emails,
    documents: f.rows.unit_sale_documents.map(d => ({ ...d, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter(v => v.document_id === d.id) })) });
  await page.route("**/api/dashboard?*", route => route.fulfill({ json: deriveDashboard(input()) }));
  await page.route("**/api/sales/register?*", async route => {
    reads++;
    const status = failed;
    const building = new URL(route.request().url()).searchParams.get("building");
    const json = status ? { error: "Synthetic source unavailable." } : deriveSalesRegister({ ...input(), buildingId: building === "all" ? "" : building ?? "" });
    const gate = nextGate; nextGate = undefined;
    await gate;
    return route.fulfill({ status: status || 200, json });
  });
  return { ...f, reads: () => reads, fail: (status: number) => { failed = status; }, holdNext: () => {
    let release!: () => void;
    nextGate = new Promise<void>(resolve => { release = resolve; });
    return release;
  } };
}
async function landing(page: Page) {
  await page.goto("/?screen=sales&building=all");
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
}
async function refresh(page: Page) {
  if (!await page.getByRole("button", { name: "Refresh", exact: true }).isVisible()) await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
}

test("one direct Sales register; no dashboard, finance, duplicate stage or broad data requests", async ({ page }) => {
  await registerFixture(page);
  const paths: string[]=[];page.on("request", request => paths.push(new URL(request.url()).pathname));
  await landing(page);await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toHaveCount(1);
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /@ Mentions/ })).toHaveCount(1);
  await expect(page.getByLabel("Stage", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Action with", { exact: true })).toHaveValue("all");
  for(const heading of ["Financial overview","Forecasting","Sales results","Sales pipeline","Your team’s sales work"])await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
  expect(paths.filter(path => /dashboard|unit_sale_(?:documents|document_versions|terms|invoices|invoice_payments|attempts)|snags|tenancies|sale_workflow_context/.test(path))).toEqual([]);
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
});

test("our team journey reaches the current document and both back paths preserve filters", async ({ page }) => {
  const f = await registerFixture(page);await landing(page);
  const initialReads = f.reads();
  await page.getByLabel("Search", { exact: true }).fill("101");
  await page.getByLabel("Stage", { exact: true }).selectOption("exchanged");
  await page.getByLabel("Action with", { exact: true }).selectOption("ours");
  await page.getByRole("link", { name: "Upload revised statement of account", exact: true }).click();
  await expect(page).toHaveURL(/workVersion=version-1.*#completion-document-draft_statement_of_account/);
  await expect(page.getByRole("article", { name: "Statement of account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Sales", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByLabel("Action with", { exact: true })).toHaveValue("ours");
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("101");
  await expect(page.getByLabel("Stage", { exact: true })).toHaveValue("exchanged");
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await expect(page.getByRole("button", { name: /Back to sales overview/ })).toBeVisible();
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByLabel("Action with", { exact: true })).toHaveValue("ours");
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();await page.goBack();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("101");
  await page.waitForLoadState("networkidle");
  console.log(`Register navigation requests: initial=${initialReads}, after three returns=${f.reads()}`);
  expect(f.reads()).toBe(initialReads);
});

test("other team journey shows developer review and the saved due date", async ({ page }) => {
  const f=await registerFixture(page);
  Object.assign(f.rows.unit_sale_documents[0],{status:"uploaded",approved_version_id:null});
  await landing(page);
  await page.getByLabel("Action with", { exact: true }).selectOption("others");
  await expect(page.getByRole("table")).toContainText("Developer team");
  await expect(page.getByText("Completion due 12 Oct 2026", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByRole("link", { name: "Completion statement awaiting Developer team approval", exact: true }).click();
  await expect(page).toHaveURL(/#completion-document-completion_statement/);
  await expect(page.getByRole("article", { name: "Completion statement", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("a second colleague's fixture replacement appears on manual refresh; mentions do not clear work", async ({ page }) => {
  const f=await registerFixture(page);await landing(page);
  await page.getByLabel("Action with", { exact: true }).selectOption("ours");
  await page.getByRole("button", { name: /@ Mentions/ }).click();await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toBeVisible();
  // Independent authorised colleague result; underlying mutation/version rules are covered by the PostgreSQL handoff suite.
  Object.assign(f.rows.unit_sale_documents[1],{status:"uploaded",query_note:null,updated_by_user_id:"second-legal-colleague"});
  f.rows.unit_sale_document_versions[1].is_current=false;
  f.rows.unit_sale_document_versions.push({...f.rows.unit_sale_document_versions[1],id:"account-v2",is_current:true,version_number:2,uploaded_by_user_id:"second-legal-colleague"});
  const before=f.reads();await refresh(page);await expect.poll(f.reads).toBeGreaterThan(before);
  await expect(page.getByText("No sales match these filters.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Action with", { exact: true })).toHaveValue("ours");
  await page.getByLabel("Action with", { exact: true }).selectOption("others");
  const action=page.getByRole("link", { name: "Statement of account awaiting Developer team approval", exact: true });
  await expect(action).toHaveAttribute("href",/workVersion=account-v2/);
  await expect(page.getByRole("table")).not.toContainText("Completion statement awaiting");
});

test("search, stage, building and pagination use the full inventory with neutral records", async ({ page }) => {
  const f=await registerFixture(page);
  f.rows.buildings.push({...f.rows.buildings[0],id:"10000000-0000-4000-8000-000000000002",name:"Second House"});
  f.rows.user_building_access.push({user_id:f.profile.id,building_id:f.rows.buildings[1].id});
  for(let i=1;i<=27;i++)f.rows.units.push({...f.unit,id:`synthetic-unit-${i}`,unit_number:String(i),sale_status:"for_sale",building_id:i===27?f.rows.buildings[1].id:f.unit.building_id});
  await landing(page);await expect(page.getByText("28 sales / units", { exact:true })).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(13);
  await page.getByRole("button", {name:"Next",exact:true}).click();await expect(page.getByRole("navigation", {name:"Results pagination"})).toContainText("13–24 of 28");
  await page.getByLabel("Search", {exact:true}).fill("Second");await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table")).toContainText("No active sale");
  await page.getByLabel("Stage", {exact:true}).selectOption("exchanged");await expect(page.getByText("No sales match these filters.")).toBeVisible();
  await page.getByRole("button", {name:"Reset filters",exact:true}).click();
  await page.getByLabel("Current building", {exact:true}).selectOption(String(f.rows.buildings[1].id));
  await expect(page.getByText("1 sale / unit", {exact:true})).toBeVisible();
  await page.getByLabel("Action with", {exact:true}).selectOption("ours");await expect(page.getByText("No sales match these filters.")).toBeVisible();
});

test("unavailable action data retains base sales and disables incomplete filtering; revocation clears rows", async ({ page }) => {
  const f=await registerFixture(page);await landing(page);
  await page.getByLabel("Action with", {exact:true}).selectOption("ours");f.fail(503);await refresh(page);
  await expect(page.getByLabel("Action with", {exact:true})).toBeDisabled();
  await expect(page.getByRole("link",{name:"Unit 101",exact:true})).toBeVisible();
  await expect(page.getByText(/responsibility filter cannot be applied/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Next steps unavailable");
  f.fail(0);await refresh(page);await expect(page.getByLabel("Action with", {exact:true})).toBeEnabled();
  f.fail(403);await refresh(page);await expect(page.getByRole("link",{name:"Unit 101",exact:true})).toHaveCount(0);
});

test("phone and desktop retain readable rows, focus and navigation clearance", async ({ page }) => {
  await registerFixture(page);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:960});await landing(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const action=page.getByRole("link",{name:"Upload revised statement of account",exact:true});
    await action.focus();await expect(action).toBeFocused();await expect(action).toBeInViewport();
    await expect(page.getByText("Synthetic Legal Team",{exact:true})).toBeVisible();
    await expect(page.getByText("Completion due 12 Oct 2026",{exact:true})).toBeVisible();
    if(width<700){const row=await page.getByRole("table").getByRole("row").last().boundingBox();const nav=await page.getByRole("navigation",{name:"Primary mobile navigation"}).boundingBox();expect(row!.y+row!.height).toBeLessThan(nav!.y);}
  }
});

test("fresh visit resets responsibility; developer and agent layouts retain their workspaces", async ({ page }) => {
  const f=await registerFixture(page);await landing(page);
  await page.getByLabel("Action with",{exact:true}).selectOption("ours");await page.reload();await expect(page.getByLabel("Action with",{exact:true})).toHaveValue("all");
  for(const role of ["developer","admin","sales_agent"]){
    f.profile.role=role;await page.reload();
    await expect(page.getByRole("heading",{name:"Sales results",exact:true})).toBeVisible();
    await expect(page.getByLabel("Action with",{exact:true})).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"Financial overview",exact:true})).toHaveCount(role==="sales_agent"?0:1);
    await expect(page.getByRole("region",{name:"Sales organisation worklist"})).toHaveCount(role==="sales_agent"?1:0);
  }
});

test("focus refresh keeps filters, skips fresh reads and adds no register polling", async ({ page }) => {
  const f=await registerFixture(page);await page.clock.install();await landing(page);
  await page.getByLabel("Action with",{exact:true}).selectOption("ours");
  const before=f.reads();await page.clock.fastForward(60_000);
  expect(f.reads()).toBe(before);
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect.poll(f.reads).toBe(before+1);
  await expect(page.getByLabel("Action with",{exact:true})).toBeEnabled();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  expect(f.reads()).toBe(before+1);
  await expect(page.getByLabel("Action with",{exact:true})).toHaveValue("ours");
});

test("60-second navigation expiry displays the complete cached register during a delayed refresh", async ({ page }) => {
  const f = await registerFixture(page);
  const now = Date.now(); await page.clock.setFixedTime(now); await landing(page);
  const before = f.reads();
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await page.clock.setFixedTime(now + 59_000);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toBeVisible();
  expect(f.reads()).toBe(before);
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await page.clock.setFixedTime(now + 60_001);
  const release = f.holdNext();
  await page.goBack();
  await expect.poll(f.reads).toBe(before + 1);
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await expect(page.getByText(/Refreshing…/)).toBeVisible();
  await expect(page.getByText("Loading next steps…", { exact: true })).toHaveCount(0);
  release(); await expect(page.getByText(/Refreshing…/)).toHaveCount(0);
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await expect(page.getByRole("button", { name: /Back to sales overview/ })).toBeVisible();
  const elapsed = await page.evaluate(async () => {
    const start = performance.now();
    const painted = new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('table[aria-label="Sales register"] a') && document.body.textContent?.includes("Upload revised statement of account")) {
          observer.disconnect(); requestAnimationFrame(() => resolve());
        }
      });
      observer.observe(document.body, { subtree: true, childList: true });
    });
    (Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("Back to sales overview")) as HTMLButtonElement).click();
    await painted; return performance.now() - start;
  });
  console.log(`Cached register return to populated frame: ${elapsed.toFixed(1)}ms (200ms measurement target)`);
  expect(f.reads()).toBe(before + 1);
});

test("focus and visibility use 15 seconds separately from navigation; connectivity revalidates", async ({ page }) => {
  const f = await registerFixture(page); const now = Date.now(); await page.clock.setFixedTime(now); await landing(page);
  const before = f.reads();
  await page.clock.setFixedTime(now + 14_999);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before);
  await page.clock.setFixedTime(now + 15_001);
  const release = f.holdNext();
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(f.reads).toBe(before + 1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  release(); await expect(page.getByText(/Refreshing…/)).toHaveCount(0);
  await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before + 1);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(f.reads).toBe(before + 2);
});

test("a mutation during a register request is followed by exactly one fresh request", async ({ page }) => {
  const f = await registerFixture(page); await landing(page); const before = f.reads();
  const release = f.holdNext();
  await page.evaluate(() => window.dispatchEvent(new Event("portal-work-changed")));
  await expect.poll(f.reads).toBe(before + 1);
  Object.assign(f.rows.unit_sale_documents[1], { status: "uploaded", query_note: null });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("sale-activity-changed"));
    window.dispatchEvent(new Event("portal-work-changed"));
    window.dispatchEvent(new Event("sale-activity-changed"));
  });
  release();
  await expect.poll(f.reads).toBe(before + 2);
  await expect(page.getByRole("link", { name: "Statement of account awaiting Developer team approval", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before + 2);
});

test("failed navigation refresh retains dates but disables actions and safely suspends responsibility filtering", async ({ page }) => {
  const f = await registerFixture(page); const now = Date.now(); await page.clock.setFixedTime(now); await landing(page);
  await page.getByLabel("Action with", { exact: true }).selectOption("ours");
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  f.fail(503); const release = f.holdNext(); await page.clock.setFixedTime(now + 61_000);
  await page.goBack();
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toBeVisible();
  release(); await expect(page.getByLabel("Action with", { exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Unit 101", exact: true })).toBeVisible();
  await expect(page.getByText("Completion due 12 Oct 2026", { exact: true })).toBeVisible();
  await expect(page.getByText(/responsibility filter cannot be applied/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toHaveCount(0);
  f.fail(0); await refresh(page); await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Action with", { exact: true })).toHaveValue("ours");
});

for (const status of [401, 403]) test(`${status} without JSON clears the retained snapshot and returning cannot resurrect it`, async ({ page }) => {
  await registerFixture(page); await landing(page);
  await page.route("**/api/sales/register?*", route => route.fulfill({ status, contentType: "text/plain", body: "Access denied" }));
  await refresh(page);
  await expect(page.getByText("Sales access unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unit 101", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("portal-work-changed")));
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(1);
});

test("pagination survives both return paths with zero additional register requests", async ({ page }) => {
  const f = await registerFixture(page);
  for (let i = 1; i <= 13; i++) f.rows.units.push({ ...f.unit, id: `pagination-${i}`, unit_number: String(i), sale_status: "for_sale" });
  await landing(page); const before = f.reads();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (const browserBack of [false, true]) {
    await page.getByRole("link", { name: "Unit 101", exact: true }).click();
    if (browserBack) await page.goBack(); else await page.getByRole("button", { name: /Back to sales overview/ }).click();
    await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText("13–14 of 14");
  }
  await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before);
});

for (const outcome of ["success", "reconciliation-fails", "uncertain-response", "leave-before-reconciliation"]) {
  test(`workflow ${outcome} invalidates the unmounted register before reconciliation`, async ({ page }) => {
    const f = await registerFixture(page);
    Object.assign(f.attempt, { completion_authority_given_at: "2026-10-01T12:00:00Z", completion_notice_issued_at: "2026-10-02" });
    await landing(page); const before = f.reads();
    await page.getByRole("link", { name: "Unit 101", exact: true }).click();
    await page.getByRole("button", { name: /^Completion\b/ }).click();
    await page.getByRole("button", { name: "Correct recorded dates", exact: true }).click();
    await page.getByLabel("Completion due date", { exact: true }).fill("2026-10-20");
    let mutated = false, reconciliationStarted = false;
    let releaseRead!: () => void;
    const reconciliationGate = new Promise<void>(resolve => { releaseRead = resolve; });
    await page.route("**/api/sales/legal", async route => {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("correct_completion_dates");
      f.attempt.contractual_completion_date = body.date; mutated = true;
      if (outcome === "uncertain-response") await route.abort("failed");
      else await route.fulfill({ json: { saleAttemptId: f.attempt.id } });
    });
    if (outcome !== "success") await page.route("**/rest/v1/unit_sale_attempts?*", async route => {
      reconciliationStarted = true;
      if (outcome === "leave-before-reconciliation") await reconciliationGate;
      await route.fulfill({ status: 400, json: { message: "Synthetic reconciliation unavailable" } });
    });
    await page.getByRole("button", { name: "Save corrected dates", exact: true }).click();
    await expect.poll(() => mutated).toBe(true);
    if (outcome === "success") await expect(page.getByText("Recorded dates corrected. The previous dates remain in activity history.", { exact: true })).toBeVisible();
    else {
      await expect.poll(() => reconciliationStarted).toBe(true);
      if (outcome !== "leave-before-reconciliation") await expect(page.getByText(/updated data could not be loaded/i)).toBeVisible();
    }
    expect(f.reads()).toBe(before);
    await page.getByRole("button", { name: /Back to sales overview/ }).click();
    await expect(page.getByText("Completion due 20 Oct 2026", { exact: true })).toBeVisible();
    expect(f.reads()).toBe(before + 1);
    releaseRead(); await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before + 1);
  });
}

test("All buildings membership changes discard the cache before the replacement response", async ({ page }) => {
  const f = await registerFixture(page);
  const second = { ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second House" };
  f.rows.buildings.push(second);
  f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second.id });
  f.rows.units.push({ ...f.unit, id: "second-unit", unit_number: "202", building_id: second.id });
  await landing(page);
  await expect(page.getByRole("link", { name: "Unit 202", exact: true })).toBeVisible();
  // Keep identity, selected building and accessible buildings fixed; remove one accessible unit.
  f.rows.units = [f.unit]; const release = f.holdNext(); await refresh(page);
  await expect(page.getByRole("link", { name: "Unit 202", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Current building", { exact: true })).toHaveValue("");
  release(); await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
});

test("building switch cancels an old response and never displays the previous building's snapshot", async ({ page }) => {
  const f = await registerFixture(page);
  const second = { ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second House" };
  f.rows.buildings.push(second); f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second.id });
  f.rows.units.push({ ...f.unit, id: "second-unit", unit_number: "202", building_id: second.id, sale_status: "for_sale" });
  await landing(page);
  const releaseOld = f.holdNext();
  await page.evaluate(() => window.dispatchEvent(new Event("portal-work-changed")));
  await expect(page.getByText(/Refreshing…/)).toBeVisible();
  const releaseNew = f.holdNext();
  await page.getByLabel("Current building", { exact: true }).selectOption(second.id);
  await expect(page.getByRole("link", { name: "Unit 101", exact: true })).toHaveCount(0);
  releaseOld(); releaseNew();
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Unit 202", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unit 101", exact: true })).toHaveCount(0);
});

test("organisation and role changes clear retained register data", async ({ page }) => {
  const f = await registerFixture(page); await landing(page);
  f.profile.organisation_id = "replacement-legal-org" as never;
  const release = f.holdNext(); await refresh(page);
  await expect(page.getByRole("link", { name: "Upload revised statement of account", exact: true })).toHaveCount(0);
  release(); await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  f.profile.role = "developer"; await refresh(page);
  await expect(page.getByRole("heading", { name: "Sales results", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sales register", exact: true })).toHaveCount(0);
});

test("explicit portal Refresh while a sale is open refreshes the retained register regardless of age", async ({ page }) => {
  const f = await registerFixture(page); await landing(page); const before = f.reads();
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await refresh(page); await expect.poll(f.reads).toBe(before + 1);
  await page.getByRole("button", { name: /Back to sales overview/ }).click();
  await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
  await page.waitForLoadState("networkidle"); expect(f.reads()).toBe(before + 1);
});

test("logout from a sale discards its retained register and pending response", async ({ page }) => {
  const f = await registerFixture(page); await landing(page);
  const before = f.reads(), release = f.holdNext();
  await page.evaluate(() => window.dispatchEvent(new Event("portal-work-changed")));
  await expect.poll(f.reads).toBe(before + 1);
  await page.getByRole("link", { name: "Unit 101", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  release(); await page.goBack();
  await expect(page.getByRole("link", { name: "Unit 101", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("repeated navigation keeps one set of refresh listeners and removes them on logout", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const events = new Set(["focus", "online", "visibilitychange", "sale-activity-changed", "portal-work-changed"]);
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (listener && events.has(type) && (this === window || this === document)) {
        const group = tracked.get(type) ?? new Set(); group.add(listener); tracked.set(type, group);
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (listener && (this === window || this === document)) tracked.get(type)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    Object.assign(window, { registerListenerCounts: () => Object.fromEntries([...tracked].map(([event, listeners]) => [event, listeners.size])) });
  });
  const counts = () => page.evaluate(() => (window as unknown as { registerListenerCounts: () => Record<string, number> }).registerListenerCounts());
  const f = await registerFixture(page); await landing(page); const before = await counts(); const reads = f.reads();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("link", { name: "Unit 101", exact: true }).click();
    await page.getByRole("button", { name: /Back to sales overview/ }).click();
    await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
    expect(await counts()).toEqual(before);
  }
  expect(f.reads()).toBe(reads);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect((await counts())["portal-work-changed"]).toBe(0);
  expect((await counts())["sale-activity-changed"]).toBe(0);
});
