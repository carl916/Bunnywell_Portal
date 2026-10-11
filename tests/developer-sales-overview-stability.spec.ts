import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";
import { deriveSalesRegister } from "../src/lib/sales/register";
const { fixture } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");
const root = "docs/sales-overview-refinement";
const panel = (page: Page) => page.locator("#sales-results");
const stages = (page: Page) => panel(page).getByRole("group", { name: "Sales stage" });
const team = (page: Page) => panel(page).getByRole("combobox", { name: "Action with", exact: true });
const row = (page: Page, unit: string) => panel(page).locator("tbody tr").filter({ has: page.getByRole("link", { name: `Unit ${unit}`, exact: true }) });
async function setup(page: Page, role: "developer" | "admin" | "conveyancer") {
  const f = await developerSalesFixture(page); f.profile.role = role;
  f.rows.buildings.push({ ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second authorised house" });
  f.rows.user_building_access.push({ user_id:f.profile.id, building_id:f.rows.buildings[1].id });
  if (role === "conveyancer") {
    f.profile.organisation_id = "legal-org" as never;
    f.rows.unit_sale_documents[0].status = "query_raised"; // 103: one task per team.
    await page.route("**/api/sales/register?*", route => {
      const building = new URL(route.request().url()).searchParams.get("building");
      return route.fulfill({ json: deriveSalesRegister(fixture({ viewer: f.profile, buildingId: building === "all" ? "" : building,
        buildings: f.rows.buildings, units: f.rows.units, floors: f.rows.building_floors, organisations: f.rows.organisations,
        sales: f.rows.unit_sale_attempts, authorities: f.emails,
        documents: f.rows.unit_sale_documents.map(d => ({ ...d, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter(v => v.document_id === d.id) })) })) });
    });
  }
  return f;
}
async function frames(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = []; Object.assign(window, { salesMovement: calls });
    const into = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options) { calls.push(`into:${this.id}`); return into.call(this, options); };
    const to = window.scrollTo.bind(window);
    window.scrollTo = ((...args: Parameters<typeof to>) => { calls.push("window"); return to(...args); }) as typeof to;
    const elementTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function(this: Element, ...args: Parameters<typeof elementTo>) { calls.push(`element:${this.id}`); return elementTo.apply(this,args); } as typeof elementTo;
  });
}
async function position(page: Page) {
  return panel(page).evaluate(element => ({ y: scrollY, top: element.querySelector('[aria-label="Sales stage"]')!.getBoundingClientRect().top,
    input: element.querySelector('input')!.getBoundingClientRect().top,
    columns: [...element.querySelectorAll('th')].map(th => ({ left: th.getBoundingClientRect().left, width: th.getBoundingClientRect().width })),
    calls: (window as unknown as { salesMovement:string[] }).salesMovement }));
}
async function clear(page: Page) { await page.evaluate(() => { (window as unknown as { salesMovement:string[] }).salesMovement.length = 0; }); }
async function selected(page: Page, name: string) {
  await expect(stages(page).locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(stages(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
}

for (const role of ["developer", "admin", "conveyancer"] as const) for (const width of [1440, 390]) {
  test(`${role} combined filters, single selection, zero results and stable geometry at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await instrument(page); const f = await setup(page, role);
    await page.goto("/?screen=sales&building=all"); await expect(row(page,"101")).toBeVisible(); await frames(page);
    await selected(page,"All stages"); await expect(team(page)).toHaveValue("all");
    await expect(stages(page).getByRole("button")).toHaveCount(6);
    await expect(panel(page).getByRole("combobox", { name:"Stage",exact:true })).toHaveCount(0);
    await expect(row(page,"106")).toBeVisible();
    const calls:string[]=[]; page.on("request",request=>{if(/api\/sales\/register|rest\/v1\//.test(request.url()))calls.push(request.url());});
    // Programmatically focus without scroll, then use real keyboard activation.
    // This separates application movement from Playwright's click auto-reveal.
    const samples = [];
    for (const name of ["Exchanged", "Completed", "Handed over", "All stages", "Reserved", "For sale", "All stages"]) {
      const button=stages(page).getByRole("button",{name,exact:true});
      await button.evaluate(node=>node.focus({preventScroll:true}));
      await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"})); await frames(page); await clear(page);
      const before=await position(page);
      await page.keyboard.press("Enter"); await selected(page,name); await frames(page);
      const after=await position(page); samples.push({name,before,after});
      expect(after.calls).toEqual([]); expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.top-before.top)).toBeLessThanOrEqual(1); expect(after.columns).toEqual(before.columns);
      await expect(button).toBeFocused(); await page.keyboard.press("Space"); await selected(page,name);
    }
    await team(page).selectOption("ours");
    await panel(page).getByRole("combobox",{name:"Action category",exact:true}).selectOption("documents");
    await panel(page).getByRole("searchbox").fill(role==="conveyancer"?"103":"104");
    await stages(page).getByRole("button",{name:"Exchanged",exact:true}).click();
    await expect(team(page)).toHaveValue("ours"); await expect(panel(page).getByRole("searchbox")).toHaveValue(role==="conveyancer"?"103":"104");
    if(role==="conveyancer") await expect(row(page,"103")).toContainText("Upload revised");
    else await expect(panel(page).locator("tbody tr")).toHaveCount(0); // 104's developer task is payment, not document work.
    await team(page).selectOption("others"); await selected(page,"Exchanged");
    await expect(panel(page).locator("tbody tr")).toHaveCount(1);
    await expect(panel(page).getByLabel("Active refinements")).toContainText("Exchanged · Other teams · Completion documents");
    const search=panel(page).getByRole("searchbox"); await search.focus(); await frames(page); await clear(page);
    const before=await position(page); await search.pressSequentially("xyz"); await frames(page);
    const after=await position(page); expect(after.calls).toEqual([]); expect(after.y).toBe(before.y); expect(after.input).toBe(before.input);
    await expect(search).toBeFocused(); await expect(panel(page).locator("tbody tr")).toHaveCount(0);
    await expect(stages(page).getByRole("button",{name:"All stages",exact:true})).toContainText("18");
    // Consecutive synchronous refinements must never restore a previous response/selection.
    for (const name of ["Reserved","Completed","Exchanged"]) await stages(page).getByRole("button",{name,exact:true}).click();
    await selected(page,"Exchanged"); await expect(team(page)).toHaveValue("others");
    await panel(page).getByRole("button",{name:"Reset filters",exact:true}).click();
    await selected(page,"All stages"); await expect(team(page)).toHaveValue("all"); await expect(search).toHaveValue("");
    await expect(panel(page).getByRole("combobox",{name:"Action category",exact:true})).toHaveValue(""); await expect(row(page,"106")).toBeVisible();
    expect(calls).toEqual([]);
    if(width<700) await page.getByRole("button",{name:"Open menu",exact:true}).click();
    await page.getByRole("combobox",{name:"Current building",exact:true}).selectOption(String(f.unit.building_id));
    if(width<700 && await page.getByRole("button",{name:"Close menu",exact:true}).isVisible()) await page.getByRole("button",{name:"Close menu",exact:true}).click();
    await stages(page).getByRole("button",{name:"Reserved",exact:true}).click();
    await panel(page).getByRole("button",{name:"Reset filters",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`building=${f.unit.building_id}`));
    await expect(stages(page).getByRole("button",{name:"All stages",exact:true})).toHaveCSS("background-color","rgb(15, 61, 46)");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await mkdir(root,{recursive:true}); await writeFile(`${root}/stability-${role}-${width}.json`,JSON.stringify(samples,null,2));
    await panel(page).evaluate(node=>window.scrollTo({top:node.getBoundingClientRect().top+scrollY-130,behavior:"instant"}));
    await page.screenshot({path:`${root}/overview-${role}-${width}.png`});
  });
}

for(const role of ["developer","conveyancer"] as const) {
  test(`${role} loading retains controls; rapid changes survive response and background refresh`,async({page})=>{
    await instrument(page); await setup(page,role);
    let release=()=>{}; let pending=new Promise<void>(resolve=>{release=resolve;}); let hold=true;
    const route=role==="conveyancer"?"**/api/sales/register?*":"**/rest/v1/sale_legal_emails?*";
    await page.route(route,async route=>{if(hold)await pending;await route.fallback();});
    await page.goto("/?screen=sales&building=all"); await expect(panel(page)).toHaveAttribute("aria-busy","true");
    await panel(page).getByRole("searchbox").fill("104");
    for(const name of ["Reserved","Completed","Exchanged"])await stages(page).getByRole("button",{name,exact:true}).click();
    const control=await panel(page).getByRole("searchbox").elementHandle();
    const before=await position(page); await clear(page); hold=false;release();
    await expect(row(page,"104")).toBeVisible();await frames(page);
    const after=await position(page);expect(after.calls).toEqual([]);expect(after.input).toBe(before.input);
    expect(await control!.evaluate(node=>node===document.querySelector('#sales-results input'))).toBe(true);
    await selected(page,"Exchanged");
    pending=new Promise<void>(resolve=>{release=resolve;});hold=true;
    await page.getByRole("button",{name:"Refresh",exact:true}).click();
    await expect(panel(page).getByText("Refreshing…",{exact:true})).toBeVisible();await expect(row(page,"104")).toBeVisible();
    await stages(page).getByRole("button",{name:"Handed over",exact:true}).click();await expect(panel(page).locator("tbody tr")).toHaveCount(0);
    await clear(page);hold=false;release();await expect(panel(page).getByText("Refreshing…",{exact:true})).toHaveCount(0);await frames(page);
    await selected(page,"Handed over");expect((await position(page)).calls).toEqual([]);
  });
  for(const width of [1440,390]) test(`${role} sale return, browser Back and detail reload preserve refinements and position at ${width}`,async({page})=>{
    await page.setViewportSize({width,height:960});await instrument(page);await setup(page,role);await page.goto("/?screen=sales&building=all");await expect(row(page,"104")).toBeVisible();await frames(page);
    await stages(page).getByRole("button",{name:"Exchanged",exact:true}).click();await team(page).selectOption(role==="developer"?"others":"ours");
    await panel(page).getByRole("combobox",{name:"Action category",exact:true}).selectOption("documents");await panel(page).getByRole("searchbox").fill("104");
    for(const returnVia of ["button","history","reload"]){
      const link=row(page,"104").getByRole("link",{name:"Unit 104",exact:true});await link.scrollIntoViewIfNeeded();await frames(page);
      const y=await page.evaluate(()=>scrollY);await link.click();await expect(page.locator("[data-sale-file]")).toBeVisible();
      if(returnVia==="reload"){await page.reload();await expect(page.locator("[data-sale-file]")).toBeVisible();}
      if(returnVia==="history")await page.goBack();else await page.getByRole("button",{name:/Back to sales overview/}).click();
      await expect(link).toBeVisible();await selected(page,"Exchanged");await expect(panel(page).getByRole("searchbox")).toHaveValue("104");
      await expect(panel(page).getByRole("combobox",{name:"Action category",exact:true})).toHaveValue("documents");
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(y,0);
    }
  });
}
