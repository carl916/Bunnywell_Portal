import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

const phase = process.env.SALES_OVERVIEW_EVIDENCE ?? "after";
const root = "docs/sales-overview-refinement";
async function measure(page: Page) {
  return page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight,
    controls: document.querySelector('#sales-results input')?.getBoundingClientRect().toJSON(),
    columns: [...document.querySelectorAll('#sales-results th')].map(el => el.getBoundingClientRect().width),
    calls: (window as unknown as { movement: unknown[] }).movement }));
}
for (const width of [1440, 390]) test(`Sales overview ${phase} evidence ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const calls: unknown[] = []; (window as unknown as { movement: unknown[] }).movement = calls;
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options) { calls.push({ method: "scrollIntoView", target: this.id }); return scroll.call(this, options); };
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options) { calls.push({ method: "focus", target: this.id }); return focus.call(this, options); };
  });
  await developerSalesFixture(page);
  await page.goto("/?screen=sales&building=all");
  await expect(page.locator("#sales-results").getByRole("link", { name: "Unit 101", exact: true })).toBeVisible();
  const stage = phase === "before" ? page.getByRole("button", { name: /^Exchanged/ }) : page.getByRole("button", { name: "Exchanged", exact: true });
  await stage.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as unknown as { movement: unknown[] }).movement.length = 0; });
  await mkdir(root, { recursive: true });
  await page.screenshot({ path: `${root}/${phase}-${width}.png` });
  const before = await measure(page);
  await stage.click();
  await expect(page.locator("#sales-results tbody tr")).toHaveCount(2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await measure(page);
  await page.screenshot({ path: `${root}/${phase}-selected-${width}.png` });
  await writeFile(`${root}/${phase}-${width}.json`, JSON.stringify({ before, after }, null, 2));
});
