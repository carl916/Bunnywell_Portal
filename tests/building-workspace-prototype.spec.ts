import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = "/dev/sales-workspace";
const out = path.resolve("artifacts/workspace-refinement");
const logs = new WeakMap<object, { requests: string[]; unexpected: string[] }>();
test.beforeEach(async ({ context }) => {
  const log = { requests: [] as string[], unexpected: [] as string[] }; logs.set(context, log);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    log.requests.push(request.method() + " " + url.pathname);
    if (url.origin === "http://127.0.0.1:3027" && (url.pathname === root || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/__nextjs_font/") || url.pathname === "/favicon.ico")) await route.continue();
    else { log.unexpected.push(request.method() + " " + url.href); await route.abort(); }
  });
  context.on("page", p => p.on("pageerror", error => log.unexpected.push(error.message)));
});
test.afterEach(async ({ context }, info) => {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, info.title.replace(/[^a-z0-9]+/gi,"-") + "-network.json"), JSON.stringify(logs.get(context), null, 2));
  expect(logs.get(context)!.unexpected).toEqual([]);
});
const identity = (page: Page) => page.getByRole("banner", { name: /^(Building|Sale) identity$/ });
async function switchTo(page: Page, building: string) {
  await page.getByRole("button", { name: "Change building", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open " + building, exact: true }).click();
}
test("building selection to worklist to task using keyboard, and fresh homepage", async ({ page }) => {
  await page.goto(root);
  await expect(page.getByRole("heading",{name:"Choose your building",exact:true})).toBeVisible();
  await expect(page.getByRole("navigation",{name:"Sale destinations"})).toHaveCount(0);
  await page.getByRole("button",{name:"Open Willow Court",exact:true}).focus(); await page.keyboard.press("Enter");
  await expect(identity(page)).toContainText("Willow Court");
  await expect(page.getByRole("navigation",{name:"Sale destinations"})).toHaveCount(0);
  await page.getByRole("button",{name:"Open sales worklist"}).focus(); await page.keyboard.press("Enter");
  await page.getByRole("textbox",{name:"Search units or buyers"}).fill("G11");
  // G11 and LG11 must remain separate records.
  await expect(page.getByRole("table")).toContainText("LG11");
  const unit = page.getByRole("link",{name:"G11 Taylor Reed",exact:true});
  await unit.focus(); await page.keyboard.press("Enter");
  await expect(identity(page)).toContainText("Willow Court / G11");
  await expect(identity(page)).toContainText("Taylor Reed");
  await expect(page.getByRole("navigation",{name:"Breadcrumb"})).toHaveText("BuildingsWillow CourtSalesG11Completion");
  await expect(page).toHaveTitle(/Willow Court · G11 · Completion/);
  await page.getByRole("button",{name:"Back to worklist",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("G11");
  await page.goto(root);
  await expect(page.getByRole("heading",{name:"Choose your building",exact:true})).toBeVisible();
  await expect(identity(page)).toHaveCount(0);
});
test("single-building entry, explicit access boundaries, and malformed direct links", async ({ page }) => {
  await page.goto(root+"?profile=single");
  await expect(identity(page)).toContainText("Willow Court");
  await expect(page.getByRole("heading",{name:"Your building at a glance"})).toBeVisible();
  for (const query of ["building=orchard&unit=g11", "building=willow&unit=unknown", "building=unknown&unit=g11", "profile=single&building=orchard&unit=orchard-g11"]) {
    await page.goto(root+"?"+query);
    await expect(page.getByRole("heading",{name:"Workspace unavailable"})).toBeVisible();
    await expect(page.getByRole("banner",{name:"Sale identity"})).toHaveCount(0);
  }
});
test("duplicate units use stable records and direct links preserve location on refresh", async ({ page }) => {
  for (const [building,id,label,buyer,status] of [
    ["willow","g11","G11","Taylor Reed","Exchanged"], ["orchard","orchard-g11","G11","Harper Stone","Reserved"],
    ["willow","willow-lg11","LG11","Jordan Finch","For sale"], ["orchard","orchard-lg11","LG11","Morgan West","Completed"],
    ["willow","willow-301","301","Avery Moss","Exchanged"], ["orchard","orchard-301","301","Riley Lake","For sale"]]) {
    await page.goto(root+"?building="+building+"&unit="+id+"&section=completion");
    await expect(identity(page)).toContainText(buyer); await expect(identity(page)).toContainText(status);
    await expect(page).toHaveTitle(new RegExp((building==="willow"?"Willow Court":"Orchard House")+" · "+label));
    await page.reload(); await expect(identity(page)).toContainText(buyer);
    expect(await page.getByLabel("Switch unit", {exact:true}).locator("option").evaluateAll(nodes => nodes.map(n => (n as HTMLOptionElement).value))).not.toContain(building==="willow"?"orchard-g11":"g11");
  }
});
test("building switch never opens same-numbered unit; independent list search and filters restore", async ({ page }) => {
  await page.goto(root+"?building=willow&view=worklist");
  await page.getByRole("textbox",{name:"Search units or buyers"}).fill("LG");
  await page.getByRole("button",{name:/^For sale/}).click();
  await page.getByLabel("Responsibility",{exact:true}).selectOption("Our actions");
  await page.getByRole("link",{name:"LG11 Jordan Finch",exact:true}).click();
  await switchTo(page,"Orchard House");
  await expect(page.getByRole("heading",{name:"Sales worklist"})).toBeVisible();
  await expect(page).not.toHaveURL(/unit=/);
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("");
  await page.getByRole("textbox",{name:"Search units or buyers"}).fill("301");
  await page.getByRole("link",{name:"301 Riley Lake",exact:true}).click();
  await switchTo(page,"Willow Court");
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("LG");
  await expect(page.getByRole("button",{name:/^For sale/})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("Responsibility",{exact:true})).toHaveValue("Our actions");
  await expect(page.getByRole("table")).not.toContainText("Morgan West");
  await switchTo(page,"Orchard House");
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("301");
});
test("worklist page and scroll restore; browser back forward retain building context", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(root+"?building=willow&view=worklist");
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByRole("link",{name:"301 Avery Moss",exact:true}).scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  const url = page.url();
  await page.getByRole("link",{name:"301 Avery Moss",exact:true}).click();
  await page.getByRole("button",{name:"Back to worklist",exact:true}).click();
  expect(page.url()).toBe(url);
  expect(Math.abs(await page.evaluate(()=>scrollY)-scroll)).toBeLessThan(3);
  await page.getByRole("link",{name:"301 Avery Moss",exact:true}).click();
  await switchTo(page,"Orchard House");
  await page.goBack(); await expect(identity(page)).toContainText("Willow Court / 301");
  await page.goForward(); await expect(identity(page)).toContainText("Orchard House");
  await expect(page.getByRole("heading",{name:"Sales worklist"})).toBeVisible();
});
test("two tabs keep independent building and worklist state", async ({ page, context }) => {
  const second = await context.newPage();
  await page.goto(root+"?building=willow&view=worklist");
  await second.goto(root+"?building=orchard&view=worklist");
  await page.getByRole("textbox",{name:"Search units or buyers"}).fill("LG11");
  await second.getByRole("textbox",{name:"Search units or buyers"}).fill("G11");
  await second.getByRole("link",{name:"G11 Harper Stone",exact:true}).click();
  await expect(identity(page)).toContainText("Willow Court");
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("LG11");
  await expect(second).toHaveTitle(/Orchard House · G11/);
  await page.getByRole("link",{name:"LG11 Jordan Finch",exact:true}).click();
  await switchTo(page,"Orchard House");
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("");
  await second.getByRole("button",{name:"Back to worklist",exact:true}).click();
  await expect(second.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("G11");
});
test("role presentations, scoped floor order, collapsed identity, confirmation context and mobile dismissal", async ({ page }) => {
  await page.goto(root+"?building=willow");
  await expect(page.getByText("Financial summary",{exact:true})).toBeVisible();
  await page.getByLabel("Prototype role").selectOption("sales_agent");
  await expect(page.getByText("Financial summary",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Prepare buyer details and invoices");
  await page.getByLabel("Prototype role").selectOption("conveyancer");
  await expect(page.getByRole("main")).toContainText("Review legal progression");
  await page.getByRole("button",{name:"Open sales worklist"}).click();
  const labels=await page.getByRole("table").locator("tbody tr td:first-child strong").allTextContents();
  expect(labels.map(s=>s.trim())).toEqual(["LG2","LG10","LG11","G2","G11","101"]);
  await page.getByRole("link",{name:"G11 Taylor Reed",exact:true}).click();
  await page.getByRole("button",{name:"Collapse sidebar"}).click(); await expect(identity(page)).toContainText("Willow Court / G11");
  await page.getByRole("button",{name:"Preview action confirmation"}).click();
  const dialog=page.getByRole("dialog",{name:"Confirmation preview"});
  await expect(dialog).toContainText("Willow Court"); await expect(dialog).toContainText("G11"); await expect(dialog).toContainText("Taylor Reed");
  await expect(dialog.getByRole("button",{name:/Confirm legal completion — Willow Court/})).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:390,height:844});
  const button=page.getByRole("button",{name:"Change building",exact:true}); await button.click();
  await expect(page.getByRole("button",{name:"Close dialog"})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.getByRole("dialog").evaluate(d=>d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(button).toBeFocused();
});
for (const [name, query, building] of [
  ["building-selection","",""], ["dashboard","?building=willow","Willow Court"], ["sales-worklist","?building=willow&view=worklist","Willow Court"],
  ["willow-g11","?building=willow&unit=g11","Willow Court"], ["orchard-g11","?building=orchard&unit=orchard-g11","Orchard House"],
  ["portfolio","?view=portfolio",""]]) {
  test("responsive journey evidence "+name, async ({ page }) => {
    for (const [view,width,height] of [["laptop",1366,768],["mobile",390,844],["desktop",1600,1000],["tablet",820,1180]] as const) {
      await page.setViewportSize({width,height}); await page.goto(root+query);
      await expect(page.getByRole("heading",{level:1}).first()).toBeVisible();
      if(building) { await expect(identity(page)).toContainText(building); await expect(identity(page)).toBeInViewport(); }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(name==="sales-worklist") {
        await expect(page.getByRole("table").locator("tbody tr").first()).toBeInViewport();
        await expect(page.getByText("Financial summary",{exact:true})).toHaveCount(0);
      }
      await page.evaluate(()=>document.fonts.ready);
      await page.addStyleTag({content:"nextjs-portal { visibility:hidden; }"});
      await mkdir(path.join(out,"screenshots"),{recursive:true});
      await page.screenshot({path:path.join(out,"screenshots",name+"-"+view+".png")});
    }
  });
}

test("role wording identifies responsibility without granting actions", async ({page}) => {
  const cases = [
    ["completion-query","conveyancer","Resolve the query","Our actions"],
    ["completion-query","developer","Awaiting revised statement","Waiting on others"],
    ["completion-query","sales_agent","Awaiting revised statement","Waiting on others"],
    ["completion-review","conveyancer","Awaiting document approval","Waiting on others"],
    ["completion-review","developer","Review completion documents","Our actions"],
    ["reservation-draft","sales_agent","Prepare the reservation","Our actions"],
    ["reservation-draft","developer","Awaiting reservation submission","Waiting on others"],
    ["reservation-review","developer","Review the reservation","Our actions"],
    ["reservation-review","sales_agent","Awaiting reservation approval","Waiting on others"],
    ["fees-submit","sales_agent","Submit the agent invoice","Our actions"],
    ["fees-submit","developer","Awaiting agent invoice","Waiting on others"],
    ["fees-review","developer","Review the agent invoice","Our actions"],
    ["fees-review","conveyancer","Awaiting invoice review","Waiting on others"],
    ["fees-paid","conveyancer","Awaiting fee payment update","Waiting on others"]
  ];
  for(const [scenario,role,title,queue] of cases) {
    await page.goto(root+"?building=willow&unit=g11&scenario="+scenario+"&role="+role);
    await expect(page.getByRole("heading",{level:1,name:title,exact:true})).toBeVisible();
    await expect(page.getByTestId("sale-task").locator("header").first()).toContainText(queue);
    for (const action of await page.getByRole("button").filter({hasText:/^(Approve|Submit|Upload replacement|Record payment|Raise query)/}).all()) await expect(action).toBeDisabled();
  }
});
test("mobile next actions and deadlines stay visible; one stage filter and responsibility queues", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(root+"?building=willow&view=worklist&q=G11");
  const row=page.getByRole("row").filter({has:page.getByRole("link",{name:"G11 Taylor Reed",exact:true})});
  await expect(row.getByText("Awaiting revised completion statement",{exact:true})).toBeVisible();
  await expect(row.getByText("Jamie Ellis · Conveyancer",{exact:true})).toBeVisible();
  await expect(row.getByText("Completion due 3 Nov 2026",{exact:true})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Sale status",exact:true})).toHaveCount(0);
  await expect(page.getByRole("main").getByText("Working in Willow Court",{exact:true})).toHaveCount(0);
  await page.getByLabel("Responsibility",{exact:true}).selectOption("Waiting on others");
  await expect(page.getByRole("link",{name:"LG11 Jordan Finch",exact:true})).toHaveCount(0);
  await row.getByRole("link",{name:"Awaiting revised completion statement"}).click();
  await expect(identity(page)).toContainText("Willow Court / G11");
  await page.getByRole("button",{name:"Back to worklist",exact:true}).click();
  await expect(page.getByLabel("Responsibility",{exact:true})).toHaveValue("Waiting on others");
  await page.getByRole("textbox",{name:"Search units or buyers"}).fill("nothing-matches");
  await expect(page.getByText("No units match these filters.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Search units or buyers"})).toHaveValue("");
  await expect(page.getByLabel("Responsibility",{exact:true})).toHaveValue("");
});
test("switching during fixture loading cancels old completion and never mixes building records", async ({page}) => {
  await page.clock.install();
  await page.goto(root+"?building=willow&view=worklist");
  await page.evaluate(() => {
    (window as unknown as {scopeViolations:string[]}).scopeViolations=[];
    const check=()=>{
      const identity=document.querySelector('header[aria-label="Building identity"]')?.textContent || "";
      const main=document.querySelector("main")?.textContent || "";
      if(identity.includes("Orchard House") && (main.includes("Taylor Reed") || main.includes("Jordan Finch"))) (window as unknown as {scopeViolations:string[]}).scopeViolations.push(main);
    };
    new MutationObserver(check).observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  await page.getByLabel("Prototype data state").selectOption("loading");
  await expect(page.getByRole("heading",{name:"Loading Willow Court",exact:true})).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.clock.fastForward(3000);
  await switchTo(page,"Orchard House");
  await expect(identity(page)).toContainText("Orchard House");
  await page.clock.fastForward(2200); // The old Willow timer would have completed now.
  await expect(page.getByRole("heading",{name:"Loading Orchard House",exact:true})).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.clock.fastForward(3000);
  await expect(page.getByRole("table")).toContainText("Harper Stone");
  await expect(page.getByRole("table")).not.toContainText("Taylor Reed");
  expect(await page.evaluate(()=>(window as unknown as {scopeViolations:string[]}).scopeViolations)).toEqual([]);
  await page.goBack();
  await expect(page.getByRole("heading",{name:"Loading Willow Court",exact:true})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("table")).toContainText("Harper Stone");
});
test("loading error empty and unavailable previews hide unit data; recovery stays scoped", async ({page}) => {
  await page.clock.install();
  await page.goto(root+"?building=willow&unit=g11");
  for(const [mode,title] of [["empty","No sales to show"],["error","Sales could not be loaded"],["unavailable","Building unavailable"]]) {
    await page.getByLabel("Prototype data state").selectOption(mode);
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Taylor Reed");
    await expect(page.getByRole("navigation",{name:"Sale destinations"})).toHaveCount(0);
    await expect(identity(page)).toContainText("Willow Court");
    await expect(page.getByLabel("Switch unit",{exact:true})).toHaveCount(0);
  }
  await page.getByLabel("Prototype data state").selectOption("error");
  await page.getByRole("button",{name:"Retry sample load",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Loading Willow Court",exact:true})).toBeVisible();
  await page.clock.fastForward(5100);
  await expect(identity(page)).toContainText("Willow Court / G11");
  await expect(page.getByRole("heading",{name:"Awaiting revised statement",exact:true})).toBeVisible();
  await page.getByLabel("Prototype data state").selectOption("unavailable");
  await page.getByRole("button",{name:"Choose another building",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Open Orchard House",exact:true}).click();
  await expect(page.getByRole("table")).toContainText("Harper Stone");
});
for(const mode of ["loading","empty","error","unavailable"]) {
  test("responsive fixture state "+mode,async({page})=>{
    await page.clock.install();
    for(const [label,width,height] of [["laptop",1366,768],["mobile",390,844]] as const) {
      await page.setViewportSize({width,height});
      await page.goto(root+"?building=willow&view=worklist&data="+mode);
      await expect(page.getByRole("region",{name:"Workspace data state"})).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(identity(page)).toBeInViewport();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.addStyleTag({content:"nextjs-portal { visibility:hidden; }"});
      await mkdir(path.join(out,"screenshots"),{recursive:true});
      await page.screenshot({path:path.join(out,"screenshots","state-"+mode+"-"+label+".png")});
    }
  });
}

