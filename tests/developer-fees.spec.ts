import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {agentFeesFixture} from "./helpers/agent-fees-fixture";
const fees=(page:Page)=>page.locator("#fee-results");
const row=(page:Page,unit:string)=>fees(page).getByRole("row").filter({has:page.getByText(`Unit ${unit}`,{exact:true})});
async function open(page:Page,params=""){await page.goto(`/?screen=sales&building=all&salesView=agent_fees${params}#fee-results`);}

test("Our actions default, four unpaid sales, coherent categories, overlapping totals, zero and unallocated work",async({page})=>{
  await agentFeesFixture(page);await open(page);
  await expect(fees(page).getByRole("button",{name:"Our actions",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(fees(page).getByRole("status")).toHaveText("5 sales in this filtered view");
  const unpaid=fees(page).getByRole("button",{name:/^Approved unpaid/}),approval=fees(page).getByRole("button",{name:/^Awaiting approval/});
  await expect(unpaid).toContainText("£11,000");await expect(unpaid).toContainText("4 sales");await expect(approval).toContainText("2 invoices");
  await expect(row(page,"101")).toContainText("1 more action");
  await unpaid.focus();await page.keyboard.press("Enter");await expect(unpaid).toHaveAttribute("aria-pressed","true");
  await expect(fees(page).getByRole("status")).toHaveText("4 sales in this filtered view");
  await fees(page).getByRole("combobox",{name:"Milestone",exact:true}).selectOption("completion");
  await expect(fees(page).getByRole("status")).toHaveText("0 sales in this filtered view");await expect(unpaid).toContainText("£11,000");
  await expect(fees(page)).not.toContainText("All clear");
  await fees(page).getByRole("combobox",{name:"Milestone",exact:true}).selectOption("all");await approval.click();
  await expect(fees(page).getByRole("status")).toHaveText("2 sales in this filtered view");
  await expect(row(page,"101")).toContainText("Review completion agent invoice");
  await fees(page).getByRole("button",{name:/^Invoices to submit/}).click();
  await expect(fees(page).getByRole("button",{name:"Invoices to submit/correct",exact:true})).toHaveAttribute("aria-pressed","true");
  await fees(page).getByRole("combobox",{name:"Agent",exact:true}).selectOption("unassigned");await expect(row(page,"124")).toContainText("Unallocated");
  await fees(page).getByRole("button",{name:"Our actions",exact:true}).click();
  await expect(fees(page).getByRole("status")).toHaveText("0 sales in this filtered view");
  await fees(page).getByRole("button",{name:"Reset filters",exact:true}).click();
  await expect(fees(page).getByRole("status")).toHaveText("5 sales in this filtered view");
});

test("category link, correct milestone, both actions reachable, retained Fees source on reload and Back without repeat reads",async({page})=>{
  await agentFeesFixture(page);await open(page,"&feeCategory=invoice-review");
  await row(page,"101").getByRole("link",{name:"Review action",exact:true}).click();
  await expect(page).toHaveURL(/#completion-fee$/);await expect(page.locator("#completion-fee")).toBeVisible();
  await page.reload();await expect(page.locator("#completion-fee")).toBeVisible();
  await page.getByRole("button",{name:"Back to Agent Fees"}).click();
  await expect(fees(page).getByRole("button",{name:/^Awaiting approval/})).toHaveAttribute("aria-pressed","true");
  await fees(page).getByRole("button",{name:"Our actions",exact:true}).click();
  const reads:string[]=[];page.on("request",r=>{if(r.url().includes("get_agent_fee_portfolio"))reads.push(r.url());});
  await row(page,"101").getByRole("link",{name:"Review 2 actions",exact:true}).click();
  await expect(page).toHaveURL(/#agent-fees$/);
  await expect(page.locator("#exchange-fee")).toBeVisible();await expect(page.locator("#completion-fee")).toBeVisible();
  await page.goBack();await expect(row(page,"101")).toBeVisible();
  await row(page,"102").getByRole("link",{name:"Review action",exact:true}).click();
  await page.getByRole("button",{name:"Back to Agent Fees"}).click();await expect(row(page,"102")).toBeVisible();
  expect(reads).toHaveLength(0);
});

test("All records retains agent, milestone, sort, page and scroll through record reload",async({page})=>{
  await agentFeesFixture(page);await open(page,"&feeWork=all&feeAgent=agent-org&feeMilestone=completion&feeSort=unit&feePage=2");
  await expect(row(page,"113")).toBeVisible();await fees(page).scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);
  await row(page,"113").getByRole("link").click();await expect(page.locator("#completion-fee")).toBeVisible();
  await page.reload();await expect(page.locator("#completion-fee")).toBeVisible();await page.getByRole("button",{name:"Back to Agent Fees"}).click();
  await expect(row(page,"113")).toBeVisible();await expect(fees(page).getByRole("combobox",{name:"Agent",exact:true})).toHaveValue("agent-org");
  await expect(fees(page).getByRole("combobox",{name:"Milestone",exact:true})).toHaveValue("completion");await expect(fees(page).getByRole("combobox",{name:"Sort",exact:true})).toHaveValue("unit");
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThanOrEqual(y-50);
  await expect(fees(page).getByRole("button",{name:/^Approved unpaid/})).toContainText("4 sales");
});

for(const width of [1440,390])test(`initial loading, error, retry, stale refresh, partial and revoked access at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:"reduce"});
  const f=await agentFeesFixture(page);let release=()=>{};let gate=new Promise<void>(r=>{release=r;});let mode="hold";
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio",async route=>{
    if(mode==="hold")await gate;
    if(mode==="error"||mode==="revoked")return route.fulfill({status:mode==="revoked"?403:400,json:{code:mode==="revoked"?"42501":"XX000",message:"Synthetic fee read failure"}});
    if(mode==="partial")return route.fulfill({json:f.portfolio().slice(0,2),headers:{"content-range":"0-1/24","access-control-expose-headers":"content-range"}});
    return route.fallback();
  });
  await open(page);await expect(fees(page)).toHaveAttribute("aria-busy","true");await expect(fees(page)).not.toContainText("0 sales");await expect(fees(page).getByRole("link")).toHaveCount(0);
  await mkdir("docs/dashboard-sales-phase2-1/screenshots",{recursive:true});await page.screenshot({path:`docs/dashboard-sales-phase2-1/screenshots/loading-${width}.png`,fullPage:true});
  mode="error";release();await expect(fees(page).getByRole("alert")).toBeVisible();await page.screenshot({path:`docs/dashboard-sales-phase2-1/screenshots/error-${width}.png`,fullPage:true});
  mode="ok";await fees(page).getByRole("button",{name:"Retry Agent Fees"}).click();await expect(row(page,"101")).toBeVisible();
  mode="hold";gate=new Promise<void>(r=>{release=r;});
  if(width<700)await page.getByRole("button",{name:"Open menu",exact:true}).click();await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await expect(fees(page).getByText("Refreshing…",{exact:true})).toBeVisible();await expect(row(page,"101")).toBeVisible();
  await page.screenshot({path:`docs/dashboard-sales-phase2-1/screenshots/refreshing-${width}.png`,fullPage:true});
  mode="partial";release();await expect(fees(page).getByRole("alert")).toContainText("incomplete");
  await expect(row(page,"101").getByRole("button",{name:"Review unavailable"})).toBeDisabled();
  mode="revoked";await fees(page).getByRole("button",{name:"Retry Agent Fees"}).click();
  await expect(fees(page).getByText("Unit 101",{exact:true})).toHaveCount(0);await expect(fees(page)).not.toContainText("£11,000");
  mode="ok";await fees(page).getByRole("button",{name:"Retry Agent Fees"}).click();await expect(row(page,"101")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await fees(page).getByRole("button",{name:/^Approved unpaid/}).focus();await page.keyboard.press("Enter");
  await expect(fees(page).getByRole("button",{name:/^Approved unpaid/})).toHaveAttribute("aria-pressed","true");
});

test("empty and external role direct URLs remain distinct",async({page})=>{
  const f=await agentFeesFixture(page);f.rows.unit_sale_attempts=[];
  await open(page);await expect(fees(page).getByRole("status")).toHaveText("0 sales in this filtered view");
  f.profile.role="sales_agent";await open(page);await page.reload();
  await expect(page.getByRole("tab",{name:"Agent Fees",exact:true})).toHaveCount(0);await expect(fees(page)).toHaveCount(0);
});

test("building and agent scope hide protected snapshots while a new scope loads; missing terms fail clearly",async({page})=>{
  const f=await agentFeesFixture(page),other="10000000-0000-4000-8000-000000000002";
  f.rows.buildings.push({...f.rows.buildings[0],id:other,name:"Second Synthetic House"});
  f.rows.user_building_access.push({user_id:f.profile.id,building_id:other});
  const unit=f.rows.units.find(u=>u.unit_number==="104")!;unit.building_id=other;
  f.rows.unit_sale_attempts.find(s=>s.unit_id===unit.id)!.building_id=other;
  await open(page);await expect(fees(page).getByRole("button",{name:/^Approved unpaid/})).toContainText("£11,000");
  let release=()=>{};const gate=new Promise<void>(r=>{release=r;});let hold=true;
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio",async route=>{if(hold)await gate;await route.fallback();});
  await page.getByRole("combobox",{name:"Current building",exact:true}).selectOption(other);
  await expect(fees(page)).toHaveAttribute("aria-busy","true");await expect(fees(page).getByText("Unit 101",{exact:true})).toHaveCount(0);
  await expect(fees(page)).not.toContainText("£11,000");hold=false;release();await expect(row(page,"104")).toBeVisible();
  await expect(fees(page).getByRole("status")).toHaveText("1 sale in this filtered view");
  await expect(fees(page).getByRole("button",{name:/^Approved unpaid/})).toContainText("£3,000");
  await fees(page).getByRole("combobox",{name:"Agent",exact:true}).selectOption("agent-org");
  await fees(page).getByRole("combobox",{name:"Milestone",exact:true}).selectOption("completion");
  await expect(fees(page).getByRole("status")).toHaveText("0 sales in this filtered view");
  await expect(fees(page).getByRole("button",{name:/^Approved unpaid/})).toContainText("£3,000");
  await page.route("**/rest/v1/rpc/get_agent_fee_portfolio",async route=>route.fulfill({json:[{...f.portfolio()[0],contract_price:null}],headers:{"content-range":"0-0/1","access-control-expose-headers":"content-range"}}));
  await page.reload();await expect(fees(page).getByRole("alert")).toContainText("missing fee terms");
  await expect(fees(page).getByRole("status")).toHaveText("Fee counts unavailable");
});
