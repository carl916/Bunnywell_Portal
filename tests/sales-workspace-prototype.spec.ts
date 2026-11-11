import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const route = "/dev/sales-workspace";
const output = path.resolve("artifacts/workspace-refinement/task-evidence");
const unexpected = new WeakMap<Page, string[]>();
const observed = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  unexpected.set(page, []); observed.set(page, []);
  // Fail on ANY business request, including GET; block it before it can reach a service.
  await page.route("**/*", async request => {
    const url = new URL(request.request().url());
    observed.get(page)!.push(request.request().method() + " " + url.pathname);
    const allowed = url.origin === "http://127.0.0.1:3027" && (url.pathname === route || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/__nextjs_font/") || url.pathname === "/favicon.ico");
    if (!allowed) { unexpected.get(page)!.push(request.request().method() + " " + url.href); await request.abort(); }
    else await request.continue();
  });
  page.on("pageerror", error => unexpected.get(page)!.push("Browser error: " + error.message));
});
test.afterEach(async ({ page }, info) => {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, info.title.replace(/[^a-z0-9]+/gi, "-") + "-network.json"), JSON.stringify({ requests: observed.get(page), unexpected: unexpected.get(page) }, null, 2));
  expect(unexpected.get(page), "No business API/service requests of any method, or browser errors").toEqual([]);
});
const cases = [
  ["completion-review", "Review completion documents"],
  ["completion-query", "Awaiting revised statement"],
  ["completion-completed", "Legally completed"],
  ["fees-submit", "Awaiting agent invoice"],
  ["fees-review", "Review the agent invoice"],
  ["fees-paid", "Invoice & payment position"],
  ["reservation-draft", "Awaiting reservation submission"],
  ["reservation-review", "Review the reservation"],
  ["reservation-approved", "Reservation approved"],
] as const;
for (const [scenario, title] of cases) {
  test("scenario " + scenario + " responsive evidence", async ({ page }) => {
    for (const [name, width, height] of [["desktop",1600,1000],["laptop",1366,768],["mobile",390,844],["tablet",820,1180]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(route + "?building=willow&unit=lg10&scenario=" + scenario);
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const identity = await page.getByRole("banner", { name: "Sale identity" }).boundingBox();
      const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
      expect(identity!.y + identity!.height).toBeLessThan(height);
      expect(heading!.y + heading!.height).toBeLessThan(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Completion now starts with the requested compact overview above its documents.
      const startingPoint = scenario.startsWith("completion") ? page.getByRole("region", { name: "Completion overview" }).getByRole("button", { name: /Documents & approval/ })
        : scenario.startsWith("reservation") ? page.getByLabel("Personal buyer name")
        : scenario === "fees-submit" ? page.getByLabel("Invoice reference") : page.getByText("Submitted invoice total", { exact: true });
      const start = await startingPoint.boundingBox();
      expect(start!.y, "The task starting point is in the initial viewport").toBeLessThan(height);
      if (scenario === "fees-review") await expect(page.getByText("Invoice is £200 above the expected gross fee.", { exact: true })).toBeInViewport();
      await mkdir(path.join(output, "screenshots"), { recursive: true });
      await page.addStyleTag({ content: "nextjs-portal { visibility: hidden; }" }); // Hide only the framework diagnostic badge in deliverable captures.
      await page.screenshot({ path: path.join(output, "screenshots", scenario + "-" + name + "-viewport.png") });
      if (name === "desktop" || name === "mobile") await page.screenshot({ path: path.join(output, "screenshots", scenario + "-" + name + "-full.png"), fullPage: true });
    }
  });
}
test("all destinations roles scenarios and history remain local", async ({ page }) => {
  await page.goto(route + "?building=willow&unit=lg10");
  for (const label of ["Reservation", "Exchange", "Completion", "Handover", "Deposits", "Agent Fees", "Commercial Terms"]) {
    await page.getByRole("navigation", { name: "Sale destinations" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.goBack(); await expect(page).toHaveURL(/section=agent-fees/);
  await page.goForward(); await expect(page).toHaveURL(/section=commercial/);
  for (const [id] of cases) {
    await page.getByLabel("Prototype scenario").selectOption(id);
    for (const role of ["developer", "conveyancer", "sales_agent"]) {
      await page.getByLabel("Prototype role").selectOption(role);
      const buttons = page.getByRole("button").filter({ hasText: /^(Approve|Raise query|Submit|Save draft|Record payment|Upload replacement|Reject|Choose a PDF)/ });
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    }
  }
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your building at a glance" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});
test("document versions queries and native drawer focus", async ({ page }) => {
  await page.goto(route + "?building=willow&unit=lg10&scenario=completion-query");
  await expect(page.getByText("Current version queried")).toBeVisible();
  const view = page.getByRole("button", {name:"View document",exact:true}).first();
  await view.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button",{name:"Close dialog"})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(view).toBeFocused();
  await page.getByText("Previous versions (1)",{exact:true}).click();
  await page.getByRole("button",{name:"View previous version",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("This version has been superseded");
  await page.keyboard.press("Escape");
  const comments = page.getByRole("button",{name:"Comments and activity"});
  await comments.click(); await page.getByRole("button",{name:"Activity",exact:true}).click();
  await page.keyboard.press("Escape"); await expect(page.getByRole("complementary",{name:"Comments & activity",exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  const menu=page.getByRole("button",{name:"Open navigation"});
  await menu.click(); await expect(page.getByRole("dialog",{name:"Workspace navigation"})).toBeVisible();
  await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  await menu.click(); await page.getByRole("dialog").getByRole("link",{name:"Agent Fees",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading",{level:1})).toBeFocused();
});
test("sticky identity does not cover focused task content and balances are consistent", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(route+"?building=willow&unit=lg10&scenario=fees-paid");
  await expect(page.getByText("£2,150",{exact:true}).first()).toBeInViewport();
  await page.getByRole("button",{name:/^Completion fee/}).click();
  await expect(page.getByLabel("Invoice total")).toHaveValue("£2,550");
  await page.getByLabel("Prototype scenario").selectOption("completion-review");
  await page.locator('[aria-label="Completion overview"]').getByRole("button",{name:/Notice & due date/}).click();
  const identity=await page.getByRole("banner",{name:"Sale identity"}).boundingBox();
  const heading=await page.getByRole("heading",{level:1}).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(identity!.y+identity!.height);
  await page.getByRole("button",{name:"View notice"}).click(); await page.keyboard.press("Escape");
  await page.locator('[aria-label="Completion overview"]').getByRole("button",{name:/Legal completion/}).click();
  await expect(page.getByText(/Both current completion documents must be approved/)).toBeVisible();
});


test("permanent discussion and compact summary fit desktop", async ({page})=>{
 for(const [width,height]of [[1366,768],[1920,1080]]){
 await page.setViewportSize({width,height});await page.goto(route+"?building=willow&unit=lg10&scenario=completion-review");
 const task=page.getByTestId("sale-task"),panel=page.getByRole("complementary",{name:"Comments & activity",exact:true});
 await expect(panel).toBeVisible();await expect(panel.getByRole("button",{name:/Close/})).toHaveCount(0);
 const t=(await task.boundingBox())!,p=(await panel.boundingBox())!,summary=(await page.getByRole("region",{name:"Completion overview"}).boundingBox())!;
 const doc=(await page.getByTestId("document-review").boundingBox())!,h=(await page.getByRole("heading",{level:1}).boundingBox())!;
 expect(t.width).toBeGreaterThan(620);expect(t.x+t.width).toBeLessThanOrEqual(p.x);
 expect(summary.y).toBeGreaterThan(h.y+h.height);expect(summary.y+summary.height).toBeLessThan(doc.y);
 await expect(panel.getByRole("textbox",{name:"Draft comment"})).toBeInViewport();
 await expect(panel.getByRole("button",{name:"Send comment"})).toBeDisabled();expect(p.y+p.height).toBeLessThanOrEqual(height);
 await page.screenshot({path:"artifacts/permanent-discussion/after-"+(width===1366?"laptop":"wide")+".png",style:"nextjs-portal{display:none}"});
 }
});
test("laptop document opening controls are fully visible before any scrolling", async ({page})=>{
  for(const [width,height] of [[1366,768],[1280,800],[1440,900]]) {
    await page.setViewportSize({width,height});
    for(const scenario of ["completion-review","completion-query","completion-completed"]) {
      await page.goto(route+"?building=willow&unit=lg10&scenario="+scenario+"&role=developer&conversation=few");
      await expect(page.getByRole("heading",{level:1})).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      expect(await page.evaluate(()=>scrollY)).toBe(0);
      const controls=page.getByRole("button",{name:"View document",exact:true});
      const geometry=await controls.evaluateAll(nodes=>nodes.map(el=>{
        const r=el.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,inside:r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,
          uncovered:[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]].every(([x,y])=>el.contains(document.elementFromPoint(x,y)))};
      }));
      // Awaiting-review is the acceptance gate. A full warning or completed record can be longer.
      if(scenario==="completion-review") {
        expect(geometry[0],"Complete first control at "+width+"x"+height+": "+JSON.stringify(geometry[0])).toMatchObject({inside:true,uncovered:true});
        if(width>=1366)expect(geometry[1],"Both side-by-side controls fit").toMatchObject({inside:true,uncovered:true});
      }
      await expect(page.getByRole("region",{name:"Completion overview"}).getByRole("button")).toHaveCount(4);
      await expect(page.getByRole("complementary",{name:"Comments & activity",exact:true}).getByRole("textbox",{name:"Draft comment"})).toBeInViewport();
      if(scenario==="completion-query")await expect(page.getByText("Completion statement queried · 2 November",{exact:true})).toBeInViewport();
      await controls.first().click();await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");await expect(controls.first()).toBeFocused();
      const box=(await controls.first().boundingBox())!,identity=(await page.getByRole("banner",{name:"Sale identity"}).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(identity.y+identity.height);
    }
  }
});
test("empty few and long conversations keep tabs and composer reachable",async({page})=>{
 await page.setViewportSize({width:1366,height:768});
 for(const [fixture,count]of [["empty",0],["few",2],["long",24]]as const){
 await page.goto(route+"?building=willow&unit=lg10&scenario=completion-review&conversation="+fixture);
 const panel=page.getByRole("complementary",{name:"Comments & activity",exact:true}),messages=panel.getByRole("region",{name:"Conversation messages"});
 await expect(panel.getByRole("button",{name:"Comments "+count,exact:true})).toBeVisible();await expect(messages.locator("article")).toHaveCount(count);
 if(!count)await expect(messages).toContainText("No comments yet");
 const composer=panel.getByRole("textbox",{name:"Draft comment"}),before=(await composer.boundingBox())!;
 await messages.focus();await page.keyboard.press("End");
 if(count===24)await expect.poll(()=>messages.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 expect((await composer.boundingBox())!.y).toBeCloseTo(before.y,0);
 await expect(composer).toBeInViewport();await page.keyboard.press("Tab");await expect(composer).toBeFocused();
 await composer.fill("Local test draft");await expect(panel.getByRole("button",{name:"Send comment"})).toBeDisabled();
 for(const position of [400,Number.MAX_SAFE_INTEGER]){
   await page.evaluate(y=>window.scrollTo(0,y),position);
   await expect.poll(async()=>{
     const identity=(await page.getByRole("banner",{name:"Sale identity"}).boundingBox())!,dock=(await panel.boundingBox())!;
     return dock.y-(identity.y+identity.height);
   }).toBeGreaterThanOrEqual(0);await expect(composer).toBeInViewport();
 }
 }
});
test("discussion view and draft persist within a sale and remain record scoped",async({page})=>{
 await page.goto(route+"?building=willow&unit=lg10&scenario=completion-review");
 const panel=page.getByRole("complementary",{name:"Comments & activity",exact:true});
 await panel.getByRole("textbox",{name:"Draft comment"}).fill("Only for Alex at LG10");
 await panel.getByRole("button",{name:"Activity",exact:true}).click();
 await page.getByRole("navigation",{name:"Sale destinations"}).getByRole("link",{name:"Exchange",exact:true}).click();
 await expect(panel.getByRole("button",{name:"Activity",exact:true})).toHaveAttribute("aria-pressed","true");
 await page.goBack();await expect(panel.getByRole("button",{name:"Activity",exact:true})).toHaveAttribute("aria-pressed","true");
 await panel.getByRole("button",{name:"Comments 2",exact:true}).click();
 await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("Only for Alex at LG10");
 await page.getByRole("region",{name:"Completion overview"}).getByRole("button",{name:/Notice & due date/}).click();
 await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("Only for Alex at LG10");
 await page.getByLabel("Switch unit",{exact:true}).selectOption("g11");
 await expect(panel).toContainText("Taylor Reed");await expect(panel).not.toContainText("Alex Morgan");
 await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("");
 await panel.getByRole("textbox",{name:"Draft comment"}).fill("Only for Taylor at G11");
 await page.getByRole("button",{name:"Change building",exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:"Open Orchard House",exact:true}).click();
 await page.getByRole("link",{name:"G11 Harper Stone",exact:true}).click();
 await expect(panel).toContainText("Orchard House / G11");await expect(panel).toContainText("Harper Stone");
 await expect(panel).not.toContainText("Willow Court");await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("");
 await page.goBack();await page.goBack();
 await expect(panel).toContainText("Willow Court / G11");await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("Only for Taylor at G11");
 await page.goBack();await expect(panel).toContainText("Alex Morgan");
 await expect(panel.getByRole("textbox",{name:"Draft comment"})).toHaveValue("Only for Alex at LG10");
});
test("narrow and short screens keep discussion in flow with a jump shortcut",async({page})=>{
 for(const [width,height]of [[390,844],[820,1180],[1366,600]]){
 await page.setViewportSize({width,height});
 if(width===390){await page.goto(route+"?building=willow&unit=lg10&scenario=completion-review");await page.screenshot({path:"artifacts/permanent-discussion/after-mobile.png",style:"nextjs-portal{display:none}"});}
 await page.goto(route+"?building=willow&unit=lg10&scenario=completion-review&conversation=long");
 const panel=page.getByRole("complementary",{name:"Comments & activity",exact:true});
 const task=(await page.getByTestId("sale-task").boundingBox())!,box=(await panel.boundingBox())!;
 if(width<1200)expect(box.y).toBeGreaterThanOrEqual(task.y+task.height);
 expect(await panel.evaluate(e=>getComputedStyle(e).position)).not.toBe("sticky");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole("button",{name:"Comments and activity",exact:true}).click();
 await expect(panel.getByRole("heading",{name:"Comments & activity",exact:true})).toBeFocused();
 await expect(panel.getByRole("heading",{name:"Comments & activity",exact:true})).toBeInViewport();
 await panel.getByRole("region",{name:"Conversation messages"}).focus();await page.keyboard.press("Tab");
 const composer=panel.getByRole("textbox",{name:"Draft comment"});
 await expect(composer).toBeFocused();await expect(composer).toBeInViewport();
 const header=await page.getByRole("banner",{name:"Sale identity"}).boundingBox(),input=await composer.boundingBox();
 if(height>=650)expect(input!.y).toBeGreaterThanOrEqual(header!.y+header!.height);
 await expect(page.getByRole("dialog")).toHaveCount(0);
 }
});

