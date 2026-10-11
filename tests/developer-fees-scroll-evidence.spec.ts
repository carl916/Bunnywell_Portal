import { test, expect, type Response } from "@playwright/test";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { agentFeesFixture } from "./helpers/agent-fees-fixture";

test("Phase 2.1 matched interaction recording and requests", async ({ browser }) => {
  const mode = process.env.FEES_SCROLL_EVIDENCE;
  test.skip(!mode, "Opt-in before/after capture");
  const root = "docs/dashboard-sales-phase2-1";
  await mkdir(`${root}/screenshots`, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: `${root}/raw-video`, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  await agentFeesFixture(page);
  const samples = [];
  for (let run = 0; run < 3; run++) {
    const responses: Response[] = [];
    const collect = (r: Response) => { if (/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(r.url())) responses.push(r); };
    page.on("response", collect);
    await page.goto("http://localhost:3013/?screen=sales&building=all&salesView=agent_fees");
    await expect(page.locator("#fee-results").getByText("Unit 101", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    page.off("response", collect);
    const detail = await Promise.all(responses.map(async r => ({ path: new URL(r.url()).pathname, bytes: (await r.body()).length, status: r.status() })));
    samples.push({ run: run + 1, requests: detail.length, decodedBytes: detail.reduce((n, r) => n + r.bytes, 0), detail });
  }
  const reads: string[] = [];
  page.on("request", r => { if (/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(r.url())) reads.push(new URL(r.url()).pathname); });
  const panel = page.locator("#fee-results");
  await page.screenshot({ path: `${root}/screenshots/${mode}-1440.png`, fullPage: true });
  // Small presentation pauses belong only to this opt-in evidence recording.
  for (const name of [/^Awaiting approval/, /^Approved unpaid/, /^Invoices (awaiting|to)/, /^Our actions/, /^All records/]) {
    await panel.getByRole("button", { name }).click();
    await page.waitForTimeout(700);
  }
  await panel.getByRole("searchbox", { name: "Search fees" }).pressSequentially("101", { delay: 160 });
  await panel.getByRole("link", { name: /Review.*action/ }).first().click();
  await expect(page.locator("#agent-fees")).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Back to Agent Fees" }).click();
  await panel.getByRole("searchbox", { name: "Search fees" }).fill("no-matching-unit");
  await panel.getByRole("button", { name: /^Awaiting approval/ }).click();
  await expect(panel.getByRole("status")).toHaveText("0 sales in this filtered view");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${root}/screenshots/${mode}-empty.png`, fullPage: true });
  await panel.getByRole("button", { name: "Reset filters", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${root}/screenshots/${mode}-390.png`, fullPage: true });
  await writeFile(`${root}/requests-${mode}.json`, JSON.stringify({ mode, fixture: "Local production build, intercepted synthetic data", samples, interactionRequests: reads }, null, 2));
  const video = page.video()!;
  await context.close();
  await copyFile(await video.path(), `${root}/${mode}.webm`);
});
