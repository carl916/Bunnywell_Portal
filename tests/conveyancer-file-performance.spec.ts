import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { conveyancerFileFixture, detailedSalesPath } from "./helpers/conveyancer-file-fixture";

// Opt in: run against a local production build before/after the app change.
// The response model is per-response latency + decoded bytes / throughput,
// not a simulation of shared TCP bandwidth or live database/server latency.
test.skip(!process.env.SALE_FILE_PERF, "Explicit local performance run only");
for (const mobile of [false, true]) test(`populated sale readiness: ${mobile ? "mobile" : "desktop"}`, async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const f = await conveyancerFileFixture(page, 63);
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: mobile ? 4 : 1 });
  Object.assign(f.transport, mobile ? { latencyMs: 150, bytesPerSecond: 200_000 } : { latencyMs: 40, bytesPerSecond: 5_000_000 });
  await page.addInitScript(() => { (window as unknown as { portalLoadTracing: boolean }).portalLoadTracing = true; });
  const samples = [];
  for (let run = 0; run < 6; run++) {
    await page.goto("/?screen=sales&building=all");
    await expect(page.getByLabel("Action with", { exact: true })).toBeEnabled();
    await page.waitForLoadState("networkidle");
    const requests: { url: string; at: number }[] = [];
    const responses: { url: string; bytes: number; at: number; status: number }[] = [];
    const errors: string[] = [];
    const bodies: Promise<void>[] = [];
    let start = 0;
    const requestListener = (request: import("@playwright/test").Request) => requests.push({ url: request.url(), at: Date.now() - start });
    const responseListener = (response: import("@playwright/test").Response) => { bodies.push((async () => { const at = Date.now() - start; const body = await response.body(); responses.push({ url: response.url(), bytes: body.length, at, status: response.status() }); })()); };
    const failureListener = (request: import("@playwright/test").Request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    const errorListener = (error: Error) => errors.push(error.message);
    page.on("request", requestListener); page.on("response", responseListener); page.on("requestfailed", failureListener); page.on("pageerror", errorListener);
    await page.evaluate(() => {
      const state = window as unknown as { fileTiming: { start: number; structure?: number; actionable?: number }; portalLoadTrace: unknown[] };
      state.portalLoadTrace = []; state.fileTiming = { start: 0 };
      document.addEventListener("click", () => {
        state.fileTiming.start = performance.now();
        const poll = () => {
          if (document.querySelector('[data-sale-file]') && state.fileTiming.structure === undefined) state.fileTiming.structure = performance.now() - state.fileTiming.start;
          const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Request authority to serve notice");
          if (button && !button.disabled) state.fileTiming.actionable = performance.now() - state.fileTiming.start;
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }, { once: true, capture: true });
    });
    start = Date.now();
    await page.getByRole("link", { name: "Unit 103", exact: true }).click();
    await expect(page.getByRole("button", { name: "Request authority to serve notice", exact: true })).toBeEnabled();
    await page.waitForFunction(() => (window as unknown as { fileTiming: { actionable?: number } }).fileTiming.actionable !== undefined);
    const readyAt = Date.now() - start;
    await page.waitForTimeout(1000);
    await Promise.all(bodies);
    page.off("request", requestListener); page.off("response", responseListener); page.off("requestfailed", failureListener); page.off("pageerror", errorListener);
    const browser = await page.evaluate(() => {
      const state = window as unknown as { fileTiming: { structure: number; actionable: number }; portalLoadTrace: { scope: string; phase: string; at: number }[] };
      const trace = state.portalLoadTrace.filter(entry => entry.scope === "sales");
      return { ...state.fileTiming, loadMs: (trace.find(entry => entry.phase === "published")?.at ?? 0) - (trace.find(entry => entry.phase === "start")?.at ?? 0) };
    });
    const detailed = responses.filter(row => detailedSalesPath.test(new URL(row.url).pathname));
    samples.push({ run, warmup: run === 0, ...browser, requests: requests.length, detailedRequests: detailed.length, bytes: responses.reduce((n, row) => n + row.bytes, 0), detailedBytes: detailed.reduce((n, row) => n + row.bytes, 0), backgroundRequests: requests.filter(row => row.at > readyAt).length, errors, failedResponses: responses.filter(row => row.status >= 400), registerReads: f.registerReads() });
    expect(errors).toEqual([]);
  }
  const report = { variant: process.env.SALE_FILE_PERF, mobile, model: f.transport, samples };
  const path = `test-results/file-perf-${process.env.SALE_FILE_PERF}-${mobile ? "mobile" : "desktop"}.json`;
  mkdirSync("test-results", { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2));
  await info.attach("performance", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(report));
});
