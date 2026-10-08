import { test, expect, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { legalFixture } from "./helpers/legal-ui-fixture";
import { deriveDashboard } from "../src/lib/dashboard/model";
const { fixture, document } = createRequire(__filename)("./helpers/dashboard-fixture.mjs");

test("synthetic landing request comparison and screenshots", async ({ page }) => {
  test.skip(!process.env.CONVEYANCER_COMPARE, "Opt-in comparison");
  const mode = process.env.CONVEYANCER_COMPARE!;
  const f = await legalFixture(page);
  f.profile.role = "conveyancer";
  f.profile.organisation_id = "legal-org" as never;
  Object.assign(f.attempt, { workflow_status: "exchanged", exchanged_at: "2026-10-01", completion_arrangements_confirmed_at: "2026-10-02T12:00:00Z", contractual_completion_date: "2026-10-12", conveyancer_organisation_id: "legal-org" });
  f.unit.sale_status = "exchanged";
  const input = fixture({ viewer: f.profile, buildings: f.rows.buildings, units: f.rows.units, sales: [f.attempt], documents: [document("completion_statement", "approved"), document("draft_statement_of_account", "query_raised")] });
  const scoped = (url: string) => ({ ...input, buildingId: new URL(url).searchParams.get("building") === "all" ? "" : new URL(url).searchParams.get("building")! });
  await page.route("**/api/dashboard?*", route => route.fulfill({ json: deriveDashboard(scoped(route.request().url())) }));
  if (mode === "after") {
    const { deriveSalesRegister } = await import("../src/lib/sales/register");
    await page.route("**/api/sales/register?*", route => route.fulfill({ json: deriveSalesRegister(scoped(route.request().url())) }));
  }
  const path = "/?screen=sales&building=all";
  const ready = async () => {
    await page.getByRole("table", { name: mode === "before" ? undefined : "Sales register" }).first().waitFor();
    if (mode === "after") await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
    else await expect(page.getByRole("button", { name: "Refresh work" })).toBeEnabled();
    await expect(page.getByText(/scope changed|worklist scope changed/)).toHaveCount(0);
  };
  await page.goto(path); await ready(); await page.waitForLoadState("networkidle");
  const samples = [];
  for (let run = 1; run <= 3; run++) {
    const responses: Response[] = [];
    const collect = (response: Response) => { if (/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(response.url())) responses.push(response); };
    page.on("response", collect);
    const start = performance.now(); await page.goto(path); await ready();
    const visibleMs = Math.round(performance.now() - start);
    await page.waitForLoadState("networkidle"); page.off("response", collect);
    const sizes = await Promise.all(responses.map(async r => { try { return (await r.body()).length; } catch { return 0; } }));
    const categories: Record<string, number> = {};
    for (const r of responses) { const key = new URL(r.url()).pathname; categories[key] = (categories[key] ?? 0) + 1; }
    samples.push({ run, visibleMs, dataRequests: responses.length, responseBytes: sizes.reduce((a,b) => a+b,0), categories });
  }
  await mkdir("docs/conveyancer-sales/screenshots", { recursive: true });
  await writeFile(`docs/conveyancer-sales/requests-${mode}.json`, JSON.stringify({ mode, note: "Same synthetic conveyancer, one accessible building and one sale; intercepted data on local Next dev. Warm assets. Not live database latency.", samples }, null, 2));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 }); await ready();
    await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
    await page.screenshot({ path: `docs/conveyancer-sales/screenshots/${mode}-${width}.png`, fullPage: true });
  }
});
