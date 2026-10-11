import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

const results = (page: Page) => page.locator("#sales-results");
const screenshotsRoot = process.env.SALES_UX_SCREENSHOTS ?? "test-results/sales-overview-regression";
const row = (page: Page, number: string) => results(page).getByRole("row").filter({ has: page.getByRole("link", { name: `Unit ${number}`, exact: true }) });
async function openOverview(page: Page, params = "") {
  await page.goto(`/?screen=sales&building=all${params}#sales-results`);
  await expect(results(page).getByRole("link", { name: "Unit 101", exact: true })).toBeVisible();
}

test("All sales defaults, unit order, action urgency, mixed teams, categories and reset", async ({ page }) => {
  await developerSalesFixture(page); await openOverview(page);
  await expect(results(page).getByRole("combobox", { name: "Action with", exact: true })).toHaveValue("all");
  await expect(results(page).locator("tbody tr").first()).toContainText("Unit 101");
  await expect(row(page, "106")).toContainText("Available for reservation");
  await expect(row(page, "107")).toContainText("Legacy completed sale");
  await expect(row(page, "108")).toContainText("Review the missing active sale record");
  await results(page).getByRole("combobox", { name: "Action with", exact: true }).selectOption("ours");
  await expect(results(page).locator("tbody tr").first()).toContainText("Unit 103");
  await expect(row(page,"103")).toContainText("Review completion statement · 1 more action");
  await results(page).getByLabel("Search", { exact: true }).fill("104");
  await expect(row(page,"104")).toContainText("Review payment position");
  await expect(row(page,"104")).not.toContainText("Replace queried");
  await results(page).getByRole("combobox", { name: "Action with", exact: true }).selectOption("others");
  await expect(row(page,"104")).toContainText("Replace queried");
  await expect(row(page,"104")).not.toContainText("Review payment position");
  await results(page).getByLabel("Search", { exact: true }).fill("104");
  await expect(results(page).getByRole("status")).toContainText("1 sale waiting on other teams");
  await results(page).getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(results(page).getByRole("combobox", { name: "Action with", exact: true })).toHaveValue("all");
  await expect(results(page).getByLabel("Search", { exact: true })).toHaveValue("");
  await expect(results(page).getByRole("button", { name: "All stages", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(results(page).getByLabel("Action category")).toHaveValue("");
});

test("record return, browser Back and reload retain filters, pagination and return position", async ({ page }) => {
  await developerSalesFixture(page); await openOverview(page);
  await results(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(row(page,"113")).toBeVisible();
  await row(page,"113").getByRole("link",{name:"Review action",exact:true}).scrollIntoViewIfNeeded();
  const top=await page.evaluate(()=>window.scrollY);
  await row(page,"113").getByRole("link",{name:"Review action",exact:true}).click();
  await expect(page.locator("[data-sale-file]")).toBeVisible();
  await page.reload(); await expect(page.locator("[data-sale-file]")).toBeVisible();
  await page.getByRole("button",{name:"Back to sales overview"}).click();
  await expect(row(page,"113")).toBeVisible();
  await expect(results(page).getByText("Showing 13–18 of 18",{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(top-50);
  await row(page,"114").getByRole("link",{name:"Unit 114",exact:true}).click();
  await expect(page.locator("[data-sale-file]")).toBeVisible(); await page.goBack();
  await expect(row(page,"114")).toBeVisible();
  await results(page).getByLabel("Search",{exact:true}).fill("101");
  await expect(row(page,"101")).toBeVisible(); await page.reload();
  await expect(results(page).getByLabel("Search",{exact:true})).toHaveValue("101");
  await expect(results(page).getByRole("status")).toContainText("1 sale in this view");
});

test("filtered category landing and each additional task reach existing workflow destinations", async ({ page }) => {
  await developerSalesFixture(page);
  await page.goto("/?screen=sales&building=all&salesWork=ours&salesCategory=documents#sales-results");
  await expect(row(page,"103")).toBeVisible();
  await expect(results(page).getByRole("status")).toContainText("1 sale requiring");
  await expect(row(page,"103").locator("details")).toHaveCount(0);
  await expect(row(page,"103")).not.toContainText("Action with Developer team");
  await expect(row(page,"103")).toContainText("6 Oct 2026");
  await row(page,"103").getByRole("link",{name:"Review 2 actions",exact:true}).click();
  await expect(page).toHaveURL(/#completion-documents-step$/);
  const matching=page.getByRole("navigation",{name:"Matching actions"});
  await expect(matching.getByRole("link",{name:"Review completion statement",exact:true})).toBeVisible();
  const account=matching.getByRole("link",{name:"Review statement of account",exact:true});
  await expect(account).toHaveAttribute("href",/workVersion=.*draft_statement_of_account/);
  await account.click(); await expect(page).toHaveURL(/#completion-documents-step$/);
  await expect.poll(async()=> (await page.locator("#completion-documents-step").boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(async()=> (await page.locator("#completion-documents-step").boundingBox())?.y ?? Infinity).toBeLessThan(400);
  await expect(page.locator("[data-sale-file]")).toBeVisible();
  await page.getByRole("button",{name:"Back to sales overview"}).click();
  await expect(results(page).getByLabel("Action category")).toHaveValue("documents");
  await results(page).getByLabel("Action category").selectOption("payment-position");
  await row(page,"104").getByRole("link",{name:"Review action",exact:true}).click();
  await expect(page).toHaveURL(/section=financials.*#exchange-fee$/);
  await expect(page.locator("#agent-fees")).toBeVisible();
});

test("All buildings and a selected building retain scope, disable Forecasting and reuse Sales reads on return", async ({ page }) => {
  const f=await developerSalesFixture(page), building="10000000-0000-4000-8000-000000000002";
  f.rows.buildings.push({...f.rows.buildings[0],id:building,name:"Z Synthetic House"});
  f.rows.user_building_access.push({user_id:f.profile.id,building_id:building});
  f.rows.units.push({...f.unit,id:"20000000-0000-4000-8000-000000000099",building_id:building,unit_number:"999",sale_status:"for_sale"});
  await openOverview(page);
  await expect(page.getByLabel("Current building",{exact:true})).toHaveValue("");
  await expect(results(page).getByRole("status")).toContainText("19 sales in this view");
  await expect(page.getByRole("button",{name:"Open forecasting",exact:true})).toBeDisabled();
  await page.getByLabel("Current building",{exact:true}).selectOption(building);
  await expect(row(page,"999")).toBeVisible();
  await expect(results(page).getByRole("status")).toContainText("1 sale in this view");
  await expect(page.getByRole("button",{name:"Open forecasting",exact:true})).toBeDisabled();
  await page.getByLabel("Current building",{exact:true}).selectOption("");
  await expect(row(page,"101")).toBeVisible(); await page.waitForLoadState("networkidle");
  const reads:string[]=[];
  page.on("request",request=>{if(/unit_sale_attempts|sale_legal_emails|api\/dashboard/.test(request.url()))reads.push(request.url());});
  await results(page).getByRole("combobox",{name:"Action with",exact:true}).selectOption("ours");
  await results(page).getByLabel("Search",{exact:true}).fill("101");
  for(let repeat=0;repeat<3;repeat++) {
    await row(page,"101").getByRole("link",{name:"Review action",exact:true}).click();
    await expect(page.locator("[data-sale-file]")).toBeVisible();
    await page.getByRole("button",{name:"Back to sales overview"}).click();
    await expect(row(page,"101")).toBeVisible();
  }
  expect(reads).toEqual([]);
  await expect(results(page).getByRole("combobox", { name: "Action with", exact: true })).toHaveValue("ours");
});

for (const width of [1440,390]) test(`loading, retry, background refresh, revocation and layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:960}); await page.emulateMedia({reducedMotion:"reduce"});
  const f=await developerSalesFixture(page);
  let release: () => void = () => {}; let pending = new Promise<void>(resolve=>{release=resolve;});
  let mode: "hold"|"ok"|"error"|"revoked" = "hold";
  await page.route("**/rest/v1/sale_legal_emails?*",async route=>{
    if(mode==="hold")await pending;
    if(mode==="error"||mode==="revoked")return route.fulfill({status:mode==="error"?400:403,json:{code:mode==="error"?"XX000":"42501",message:"Sales guidance unavailable (synthetic failure)"}});
    await route.fallback();
  });
  await page.goto("/?screen=sales&building=all#sales-results");
  await expect(results(page)).toHaveAttribute("aria-busy","true");
  await expect(results(page).getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Financial overview",exact:true})).toHaveCount(1);
  await expect(results(page)).not.toContainText("0 sales");
  await mkdir(screenshotsRoot,{recursive:true});
  await page.screenshot({path:`${screenshotsRoot}/loading-${width}.png`});
  mode="error";release();
  await expect(results(page).getByRole("alert")).toContainText("Sales");
  await expect(results(page).getByRole("button",{name:"Retry Sales"})).toBeEnabled();
  await page.screenshot({path:`${screenshotsRoot}/error-${width}.png`});
  mode="ok";await results(page).getByRole("button",{name:"Retry Sales"}).click();
  await expect(row(page,"101")).toBeVisible();
  await expect(page.getByRole("button",{name:"Open forecasting",exact:true})).toBeDisabled();
  await expect(page.getByText("Not yet enabled.",{exact:true})).toBeVisible();
  pending=new Promise<void>(resolve=>{release=resolve;});mode="hold";
  if(width<700) await page.getByRole("button",{name:"Open menu",exact:true}).click();
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  if(width<700) await expect(page.getByRole("button",{name:"Open menu",exact:true})).toBeVisible();
  await expect(results(page).getByText("Refreshing…",{exact:true})).toBeVisible();
  await expect(row(page,"101")).toBeVisible();
  await results(page).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${screenshotsRoot}/refreshing-${width}.png`});
  mode="error";release();await expect(results(page).getByRole("alert")).toContainText("last loaded position");
  await expect(row(page,"101").getByRole("button",{name:"Review unavailable"})).toBeDisabled();
  await results(page).getByRole("combobox", { name: "Action with", exact: true }).selectOption("ours");
  const selected=results(page).getByRole("combobox",{name:"Action with",exact:true});
  await expect(selected).toHaveValue("ours");
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("main, section, header, nav, div, table")].map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right, overflow: getComputedStyle(element).overflowX })).filter(item => item.right > innerWidth + 1).slice(0, 12) }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  mode="revoked";await results(page).getByRole("button",{name:"Retry Sales"}).click();
  await expect(results(page).getByRole("link")).toHaveCount(0);
  mode="ok";await results(page).getByRole("button",{name:"Retry Sales"}).click();await expect(row(page,"101")).toBeVisible();
  await page.goto(`/?screen=sales&building=${f.unit.building_id}#sales-results`);
  await expect(page.getByRole("button",{name:"Open forecasting",exact:true})).toBeDisabled();
});

test("Sales polish keeps mixed tasks reachable and shows the recorded expired authority date",async({page})=>{
  const f=await developerSalesFixture(page);
  const sale=f.rows.unit_sale_attempts.find(s=>s.unit_id===f.rows.units.find(u=>u.unit_number==="105")!.id)!;
  f.rows.sale_legal_emails = [{id:"expired-authority",sale_attempt_id:sale.id,kind:"authority",version:1,snapshot:f.snapshot,to_recipients:["legal@example.test"],cc_recipients:[],body:"Synthetic authority",sending_address:"portal@example.test",subject:"Synthetic authority",issued_at:"2026-10-01T12:00:00Z",expires_at:"2026-10-06T16:00:00Z",delivery_status:"sent",revoked_at:null,replaced_by:null}];
  await openOverview(page);await expect(row(page,"105")).toContainText("Authority expired");await expect(row(page,"105")).toContainText("6 Oct 2026");
  await expect(row(page,"104")).toContainText("Action with");
  await expect(row(page,"104").locator("details")).toHaveCount(0);
  await row(page,"104").getByRole("link",{name:/^Review \d+ actions$/}).click();
  await expect(page).toHaveURL(/#sales-matching-actions$/);
  const nav=page.getByRole("navigation",{name:"Matching actions"});
  await expect(nav.getByRole("link",{name:/Replace queried/})).toHaveCount(2);
  await nav.getByRole("link",{name:/Review payment position/}).click();await expect(page.locator("#exchange-fee")).toBeVisible();
  await page.getByRole("button",{name:"Back to sales overview"}).click();await expect(row(page,"104")).toBeVisible();
  await results(page).getByRole("combobox", { name: "Action with", exact: true }).selectOption("ours");
  await expect(row(page,"103")).not.toContainText("Action with Developer team");
  await mkdir("test-results/sales-overview-regression",{recursive:true});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await results(page).scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-results/sales-overview-regression/sales-polish-${width}.png`});
  }
});
