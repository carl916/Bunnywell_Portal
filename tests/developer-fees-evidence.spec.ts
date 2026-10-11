import { test, expect, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { agentFeesFixture } from "./helpers/agent-fees-fixture";

test("matched fee requests and desktop/mobile evidence", async ({ page }) => {
  const mode = process.env.FEES_UX_EVIDENCE;
  test.skip(!mode, "Opt-in matched evidence capture");
  await agentFeesFixture(page);
  const root = "docs/dashboard-sales-phase2";
  await mkdir(`${root}/screenshots`, {recursive:true});
  const samples = [];
  for (let run=0;run<3;run++) {
    const responses:Response[] = [];
    const collect = (r:Response)=>{if (/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(r.url())) responses.push(r);};
    page.on("response",collect);
    await page.goto("/?screen=sales&building=all&salesView=agent_fees");
    await expect(page.getByRole("table").getByText("Unit 101",{exact:true})).toBeVisible();
    await page.waitForLoadState("networkidle"); page.off("response",collect);
    const detail=await Promise.all(responses.map(async r=>({path:new URL(r.url()).pathname,bytes:(await r.body()).length,status:r.status()})));
    samples.push({run:run+1,requests:detail.length,decodedBytes:detail.reduce((n,r)=>n+r.bytes,0),detail});
  }
  await writeFile(`${root}/requests-${mode}.json`,JSON.stringify({mode,fixture:"24 synthetic sales, four approved balances; local production build; intercepted requests, not live latency",samples},null,2));
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto("/?screen=sales&building=all&salesView=agent_fees");
    await expect(page.getByRole("table").getByText("Unit 101",{exact:true})).toBeVisible();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
    await page.screenshot({path:`${root}/screenshots/${mode}-fees-${width}.png`,fullPage:width>=700});
    if(mode==="after") {
      await page.getByRole("button",{name:/^Approved unpaid/}).click();
      await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
      await page.screenshot({path:`${root}/screenshots/after-unpaid-${width}.png`,fullPage:width>=700});
      if(width<700){
        const table=page.getByRole("region",{name:"Agent fees",exact:true});
        await table.scrollIntoViewIfNeeded();await table.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
        await page.screenshot({path:`${root}/screenshots/after-review-controls-${width}.png`});
      }
    }
  }
});
