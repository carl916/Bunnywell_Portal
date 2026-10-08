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
  const input = () => fixture({ viewer: f.profile, buildings: f.rows.buildings, units: f.rows.units, sales: [f.attempt], authorities: f.emails,
    documents: f.rows.unit_sale_documents.map(d => ({ ...d, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter(v => v.document_id === d.id) })) });
  await page.route("**/api/dashboard?*", route => route.fulfill({ json: deriveDashboard(input()) }));
  await page.route("**/api/sales/register?*", route => {
    reads++;
    if (failed) return route.fulfill({ status: failed, json: { error: "Synthetic source unavailable." } });
    const building = new URL(route.request().url()).searchParams.get("building");
    return route.fulfill({ json: deriveSalesRegister({ ...input(), buildingId: building === "all" ? "" : building ?? "" }) });
  });
  return { ...f, reads: () => reads, fail: (status: number) => { failed = status; } };
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
  await registerFixture(page);await landing(page);
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
