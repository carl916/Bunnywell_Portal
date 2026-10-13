import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { developerSalesFixture } from "./helpers/developer-sales-fixture";

const evidence = "docs/mobile-navigation";
const header = (page: Page) => page.locator(".app-header");
const nav = (page: Page) => page.locator(".mobile-bottom-nav");
const hamburger = (page: Page) => page.getByRole("button", { name: "Open menu", exact: true });
async function settle(page: Page) { await page.waitForTimeout(300); }
async function tapVisible(page: Page, control: Locator) {
  // Playwright's locator.click scrolls sticky elements into the document's
  // scroll-padding before the pointer event. Tap the visible viewport control
  // as a user does so this test measures the application's scroll preservation.
  const box = await control.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}
async function scroll(page: Page, y: number) {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: "instant" }), y);
  await settle(page);
}
async function setup(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  const f = await developerSalesFixture(page);
  await page.goto("/?screen=sales&building=all");
  await expect(page.locator("#sales-results tbody tr").first()).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await scroll(page, 0);
  return f;
}
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.screenshot({ path: `${evidence}/${name}.png` });
}

for (const width of [320, 360, 390, 430]) {
  test(`expanded, down, up, thresholds, final content and menu at ${width}`, async ({ page }) => {
    await setup(page, width);
    await expect(header(page).locator(".environment-banner")).toBeVisible();
    await expect(nav(page).getByRole("button")).toHaveText(["Dashboard", "Snags", "Sales", "Rentals", "More"]);
    expect((await nav(page).getByText("Dashboard", { exact: true }).boundingBox())!.height).toBeLessThan(16);
    await capture(page, `${width}-expanded`);
    const documentTop = await page.locator("#sales-results").evaluate(el => el.getBoundingClientRect().top + scrollY);
    await scroll(page, 400);
    await expect(header(page)).toHaveAttribute("data-compact", "true");
    await expect(nav(page)).toHaveAttribute("inert", "");
    await expect(nav(page)).toBeHidden();
    await expect(header(page).locator(".mobile-environment-indicator")).toHaveText("Staging · Not live");
    await expect(header(page).locator(".environment-banner")).toBeHidden();
    const compact = await page.locator(".mobile-compact-brand").boundingBox();
    expect(compact!.height).toBeGreaterThanOrEqual(56);
    expect(compact!.height).toBeLessThanOrEqual(64);
    expect(compact!.y).toBeGreaterThanOrEqual(0);
    expect((await hamburger(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
    expect(await page.locator("#sales-results").evaluate(el => el.getBoundingClientRect().top + scrollY)).toBe(documentTop);
    await capture(page, `${width}-down`);
    // Small reversals must not toggle either toolbar.
    for (const y of [398, 401, 397, 400]) await scroll(page, y);
    await expect(nav(page)).toBeHidden();
    await scroll(page, 386);
    await expect(nav(page)).toBeVisible();
    await expect(header(page)).toHaveAttribute("data-compact", "true");
    await capture(page, `${width}-up`);

    for (const source of [hamburger(page), nav(page).getByRole("button", { name: "More", exact: true })]) {
      const before = await page.evaluate(() => scrollY);
      await tapVisible(page, source);
      const menu = page.getByRole("dialog", { name: "Portal menu" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
      if (width === 390) await capture(page, "390-menu");
      await menu.getByRole("button", { name: "Sign out", exact: true }).focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
      await page.locator(".mobile-menu-panel").evaluate(el => { el.scrollTop = 500; });
      await page.mouse.wheel(0, 300);
      await expect(header(page)).toHaveAttribute("data-compact", "true");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(await page.evaluate(() => scrollY)).toBe(before);
      await expect(source).toBeFocused();
      await source.evaluate(el => (el as HTMLElement).blur());
      await settle(page);
    }
    await scroll(page, 600);
    await expect(nav(page)).toBeHidden();
    // Opening from the hamburger while More is hidden keeps the page fixed.
    await tapVisible(page, hamburger(page));
    await tapVisible(page, page.getByRole("button", { name: "Close menu" }));
    expect(await page.evaluate(() => scrollY)).toBe(600);
    await expect(hamburger(page)).toBeFocused();
    await hamburger(page).evaluate(el => (el as HTMLElement).blur());
    await settle(page);
    await scroll(page, 60);
    await expect(header(page)).toHaveAttribute("data-compact", "true");
    await scroll(page, 20);
    await expect(header(page)).toHaveAttribute("data-compact", "false");
    await expect(nav(page)).toBeVisible();
    await scroll(page, 90);
    await expect(header(page)).toHaveAttribute("data-compact", "false");

    await scroll(page, 1e6);
    await expect(nav(page)).toBeHidden();
    await page.mouse.wheel(0, 500);
    await settle(page);
    await expect(nav(page)).toBeHidden();
    await page.mouse.wheel(0, -16);
    await settle(page);
    await expect(nav(page)).toBeVisible();
    const content = await page.locator(".portal-content").boundingBox();
    const bar = await nav(page).boundingBox();
    expect(content!.y + content!.height).toBeLessThanOrEqual(bar!.y + 16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("long building, enlarged text, reduced motion and keyboard focus", async ({ page }) => {
  const f = await setup(page, 320);
  const name = "The extraordinarily long Bunnywell Riverside Apartments and Gardens building";
  f.rows.buildings[0].name = name;
  await page.goto(`/?screen=sales&building=${f.rows.buildings[0].id}`);
  await expect(page.locator("#sales-results tbody tr").first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  await settle(page);
  await scroll(page, 900);
  await expect(header(page)).toHaveAttribute("data-compact", "true");
  await expect(page.locator(".mobile-compact-building")).toHaveText(name);
  for (const toolbar of [header(page), nav(page)]) {
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  expect(await nav(page).evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  const brand = await page.locator(".mobile-compact-brand").boundingBox();
  expect(brand!.y).toBeGreaterThanOrEqual(0);
  expect((await hamburger(page).boundingBox())!.x).toBeGreaterThan(brand!.x);
  await capture(page, "320-enlarged-text");
  await scroll(page, 884);
  const more = nav(page).locator("button").last();
  await more.focus();
  await scroll(page, 1200);
  await expect(nav(page)).toBeVisible();
  await expect(more).toBeFocused();
  await more.evaluate(el => (el as HTMLElement).blur());
  await settle(page);
  await scroll(page, 1300);
  await expect(nav(page)).toHaveAttribute("inert", "");
  await more.evaluate(el => (el as HTMLElement).focus());
  await expect(more).not.toBeFocused();
});

test("viewport resizing, search interaction, history and desktop", async ({ page }) => {
  await setup(page);
  await scroll(page, 400);
  await page.setViewportSize({ width: 390, height: 550 });
  await settle(page);
  await expect(nav(page)).toBeHidden();
  await expect(header(page)).toHaveAttribute("data-compact", "true");
  await page.setViewportSize({ width: 430, height: 844 });
  await settle(page);
  await expect(nav(page)).toBeHidden();
  const search = page.locator("#sales-results input").first();
  await search.focus();
  const field = await search.boundingBox();
  expect(field!.y).toBeGreaterThanOrEqual((await page.locator(".mobile-compact-brand").boundingBox())!.height);
  expect(field!.y + field!.height).toBeLessThanOrEqual(844);
  const state = await header(page).getAttribute("data-compact");
  await page.setViewportSize({ width: 430, height: 430 });
  await search.fill("101");
  await expect(search).toBeFocused();
  await expect(header(page)).toHaveAttribute("data-compact", state!);
  await page.setViewportSize({ width: 430, height: 844 });
  await search.fill("");
  await search.evaluate(el => (el as HTMLElement).blur());
  await settle(page);
  await scroll(page, 500);
  await page.evaluate(() => history.pushState({}, "", "?screen=sales&building=all&toolbar-test=1"));
  await scroll(page, 700);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(500);
  await expect(header(page)).toHaveAttribute("data-compact", "true");
  await page.goForward();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(700);
  await expect(header(page)).toHaveAttribute("data-compact", "true");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await scroll(page, 0);
  await expect(hamburger(page)).toBeHidden();
  await expect(nav(page)).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("button")).toHaveText(["Dashboard", "Snags", "Sales", "Rentals", "Setup"]);
  await capture(page, "1440-desktop");
});

test("menu building selection, backdrop dismissal and role destinations", async ({ page }) => {
  const f = await setup(page);
  const second = { ...f.rows.buildings[0], id: "10000000-0000-4000-8000-000000000002", name: "Second authorised house" };
  f.rows.buildings.push(second);
  f.rows.user_building_access.push({ user_id: f.profile.id, building_id: second.id });
  await page.goto("/?screen=sales&building=all");
  await expect(page.locator("#sales-results tbody tr").first()).toBeVisible();
  await scroll(page, 400);
  await expect(page.locator(".mobile-compact-building")).toHaveText("All buildings");
  await tapVisible(page, hamburger(page));
  await page.getByRole("dialog").getByRole("combobox", { name: "Current building" }).selectOption(String(f.rows.buildings[0].id));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mobile-compact-building")).toHaveText("Workflow Test House");
  expect(await page.evaluate(() => scrollY)).toBe(400);
  await tapVisible(page, hamburger(page));
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(400);
  await expect(hamburger(page)).toBeFocused();
  await tapVisible(page, hamburger(page));
  await page.getByRole("dialog").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#sales-results tbody tr").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("");
  for (const role of ["sales_agent", "conveyancer"]) {
    f.profile.role = role;
    await page.goto("/?screen=sales");
    await expect(nav(page).getByRole("button")).toHaveText(["Sales", "More"]);
    await tapVisible(page, nav(page).getByRole("button", { name: "More", exact: true }));
    await expect(page.locator(".mobile-menu-panel .menu-row")).toHaveText(["Sales", "Sign out"]);
    await page.keyboard.press("Escape");
  }
});

test.describe("touch input", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("hamburger and More preserve scroll on a mobile viewport", async ({ page }) => {
    await setup(page);
    await scroll(page, 400);
    const menuButton = (await hamburger(page).boundingBox())!;
    await page.touchscreen.tap(menuButton.x + 22, menuButton.y + 22);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.touchscreen.tap(5, 5);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(400);
    await hamburger(page).evaluate(el => (el as HTMLElement).blur());
    await settle(page);
    await scroll(page, 384);
    const more = (await nav(page).getByRole("button", { name: "More", exact: true }).boundingBox())!;
    await page.touchscreen.tap(more.x + more.width / 2, more.y + more.height / 2);
    await expect(page.getByRole("dialog")).toBeVisible();
    const close = (await page.getByRole("button", { name: "Close menu" }).boundingBox())!;
    await page.touchscreen.tap(close.x + close.width / 2, close.y + close.height / 2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(384);
  });
});
