import { test, expect, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

test("same-scope synthetic request comparison and desktop/mobile evidence", async ({ page }) => {
  const mode = process.env.SALES_UX_EVIDENCE;
  test.skip(!mode, "Explicit evidence capture only");
  await developerSalesFixture(page);
  const root = "docs/dashboard-sales-phase1";
  await mkdir(`${root}/screenshots`, { recursive: true });
  const samples = [];
  for (let run = 0; run < 3; run++) {
    const responses: Response[] = [];
    const collect = (response: Response) => { if (/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(response.url())) responses.push(response); };
    page.on("response", collect);
    await page.goto("/?screen=sales&building=all");
    await expect(page.getByRole("heading", { name: "Sales overview", exact: true })).toBeVisible();
    await expect(page.getByRole("table").getByText("Unit 101", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle"); page.off("response", collect);
    const requests = await Promise.all(responses.map(async response => ({ path: new URL(response.url()).pathname, bytes: (await response.body()).length, status: response.status() })));
    samples.push({ run: run + 1, requests: requests.length, decodedBytes: requests.reduce((total, row) => total + row.bytes, 0), detail: requests });
  }
  await writeFile(`${root}/requests-${mode}.json`, JSON.stringify({ mode, fixture: "18 authorised synthetic units, 15 active sales, one building; local production build. Not live latency.", samples }, null, 2));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?screen=sales&building=all");
    await expect(page.getByRole("heading", { name: "Sales overview", exact: true })).toBeVisible();
    await expect(page.getByRole("table").getByText("Unit 101", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${root}/screenshots/${mode}-portfolio-${width}.png`, fullPage: width >= 700 });
    await page.getByRole("heading", { name: "Sales overview", exact: true }).evaluate(heading => {
      const section = heading.closest("section")!; section.style.scrollMarginTop = "110px"; section.scrollIntoView({ block: "start" });
    });
    await page.screenshot({ path: `${root}/screenshots/${mode}-results-${width}.png` });
    if (mode === "after") {
      await page.locator("#sales-results").getByRole("combobox", { name: "Action with", exact: true }).selectOption("ours");
      await page.screenshot({ path: `${root}/screenshots/after-actions-${width}.png` });
      if (width < 700) {
        await page.locator("#sales-results table").evaluate(table => { table.parentElement!.scrollLeft = table.scrollWidth; });
        await page.screenshot({ path: `${root}/screenshots/after-actions-scroll-${width}.png` });
      }
    }
  }
});
