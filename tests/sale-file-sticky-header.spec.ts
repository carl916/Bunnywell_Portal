import { test, expect, type Page } from '@playwright/test';
import { salesFixture, at } from './helpers/sales-fixture';

const identity = (page: Page) => page.locator('[data-sale-file-header]');
const comments = (page: Page) => identity(page).getByRole('button', { name: /^Comments & activity/ });
const panel = (page: Page) => page.locator('#sale-conversation');
const composer = (page: Page) => panel(page).getByRole('textbox', { name: 'Write an update' });
test.use({ actionTimeout: 15_000 });

async function pinned(page: Page, mustReachStickyEdge = true) {
  await expect(identity(page)).toBeInViewport();
  if (mustReachStickyEdge) await expect.poll(async () => page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-sale-file-header]')!;
    const chrome = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--portal-mobile-header')) || 0;
    return Math.abs(header.getBoundingClientRect().top - chrome);
  })).toBeLessThan(2);
  await expect(comments(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function belowIdentity(page: Page, selector: string) {
  await expect.poll(async () => page.locator(selector).evaluate(node => node.getBoundingClientRect().top - document.querySelector('[data-sale-file-header]')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);
}

async function clickVisibleComments(page: Page) {
  // Click the visible sticky control, without Playwright first scrolling its
  // natural document position out from under the document's scroll padding.
  const box = (await comments(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await panel(page).evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
}

for (const width of [1440, 390]) {
  test(`sticky identity across stages, workspaces, direct URLs and comments at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await salesFixture(page);
    f.unit.unit_number = 'LG08'; f.unit.sale_status = 'reserved';
    f.rows.buildings[0].name = 'Priors Gate';
    f.attempt.workflow_status = 'approved'; f.attempt.reservation_approved_at = at(2);
    f.rows.unit_sale_terms = [{ id: 'terms', sale_attempt_id: f.attempt.id, is_current: true, status: 'draft', contract_price: 238500, list_price_at_offer: 238500 }];
    const url = `/?screen=sales&building=${f.unit.building_id}&salesUnitId=${f.unit.id}`;
    await page.goto(url);
    await expect(identity(page).getByRole('heading', { name: 'Unit LG08', exact: true })).toBeVisible();
    await expect(identity(page).getByText('Reserved', { exact: true })).toBeVisible();
    await expect(identity(page).getByText('Priors Gate', { exact: true })).toBeVisible();
    if (width === 1440) expect((await identity(page).boundingBox())!.height).toBeLessThanOrEqual(64);
    await page.screenshot({ path: testInfo.outputPath('header-top.png') });

    for (const stage of ['reservation', 'exchange']) {
      await page.goto(`${url}#sales-stage-${stage}`);
      await expect(page.locator(`#sales-stage-${stage}`)).toBeVisible();
      await pinned(page);
      await belowIdentity(page, `#sales-stage-${stage}`);
      await page.reload();
      await pinned(page);
      await belowIdentity(page, `#sales-stage-${stage}`);
      if (stage === 'exchange') await page.screenshot({ path: testInfo.outputPath('header-scrolled.png') });
    }
    await page.goBack();
    await expect(page.locator('#sales-stage-reservation')).toBeVisible();
    await expect(identity(page)).toBeInViewport();
    await page.goForward();
    await expect(page.locator('#sales-stage-exchange')).toBeVisible();
    await expect(identity(page)).toBeInViewport();

    for (const workspace of ['Financials', 'Commercial', 'Progression']) {
      await page.getByRole('tab', { name: new RegExp(`^${workspace}`) }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await pinned(page, false);
    }
    f.attempt.workflow_status = 'draft'; f.unit.sale_status = 'for_sale';
    await page.goto(`${url}&section=commercial`);
    await page.getByRole('tab', { name: /^Commercial/ }).click();
    await page.getByRole('button', { name: 'Edit commercial model', exact: true }).click();
    const price = page.getByLabel('Proposed contract price', { exact: true });
    await price.fill('250000');
    await page.evaluate(() => window.scrollTo(0, Math.min(document.documentElement.scrollHeight - innerHeight, 1050)));
    await pinned(page);
    const section = new URL(page.url()).search;
    const y = await page.evaluate(() => scrollY);
    await page.screenshot({ path: testInfo.outputPath('header-editing.png') });
    await clickVisibleComments(page);
    await expect(panel(page).getByRole('button', { name: 'Close comments panel' })).toBeFocused();
    await expect(panel(page).getByText('Unit LG08', { exact: true })).toBeVisible();
    await composer(page).fill('Keep this sale draft');
    await page.screenshot({ path: testInfo.outputPath('comments-context.png') });
    await page.keyboard.press('Escape');
    await expect(comments(page)).toBeFocused();
    expect(new URL(page.url()).search).toBe(section);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await expect(price).toHaveValue('250,000');
    await comments(page).press('Enter');
    await expect(composer(page)).toHaveValue('Keep this sale draft');
    await panel(page).getByRole('button', { name: 'Close comments panel' }).click();
    expect(await page.evaluate(() => scrollY)).toBe(y);
    // Browser focus scrolling must keep fields clear of the sticky row.
    await price.focus();
    expect((await price.boundingBox())!.y).toBeGreaterThanOrEqual((await identity(page).boundingBox())!.y + (await identity(page).boundingBox())!.height);
  });
}

test('unit switches keep identity, status, comments and saved drafts scoped to the displayed unit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await salesFixture(page);
  const secondUnit = { ...f.unit, id: '20000000-0000-4000-8000-000000000002', unit_number: 'LG09', sale_status: 'reserved' };
  const secondSale = { ...f.attempt, id: '40000000-0000-4000-8000-000000000002', unit_id: secondUnit.id, workflow_status: 'approved', reservation_approved_at: at(2) };
  f.unit.unit_number = 'LG08';
  f.rows.units.push(secondUnit); f.rows.unit_sale_attempts.push(secondSale);
  await page.reload();
  const requests: string[] = [];
  await page.route('**/rest/v1/rpc/sale_comment_page', async route => {
    requests.push(route.request().postDataJSON().p_sale);
    await route.fulfill({ json: { comments: [], hasBefore: false, hasAfter: false } });
  });
  await comments(page).click(); await composer(page).fill('LG08 private draft'); await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Open unit', exact: true }).selectOption(secondUnit.id);
  await expect(identity(page).getByRole('heading', { name: 'Unit LG09', exact: true })).toBeVisible();
  await expect(identity(page).getByText('Reserved', { exact: true })).toBeVisible();
  await comments(page).click();
  await expect(panel(page).getByText('Unit LG09', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('Unit LG08', { exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await expect.poll(() => requests.at(-1)).toBe(secondSale.id);
  await composer(page).fill('LG09 draft'); await page.keyboard.press('Escape');
  await page.goBack();
  await expect(identity(page).getByRole('heading', { name: 'Unit LG08', exact: true })).toBeVisible();
  await expect(identity(page).getByText('For sale', { exact: true })).toBeVisible();
  await comments(page).click(); await expect(composer(page)).toHaveValue('LG08 private draft');
  await expect.poll(() => requests.at(-1)).toBe(f.attempt.id);
});

test('long unit and development labels wrap without clipping and update the navigation offset at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const f = await salesFixture(page);
  f.unit.unit_number = 'LG08-ANNEX-123456789';
  f.rows.buildings[0].name = 'Priors Gate — Long Development Name';
  await page.reload();
  await expect(identity(page).getByRole('heading', { name: `Unit ${f.unit.unit_number}`, exact: true })).toBeVisible();
  await page.locator('#sales-stage-reservation').evaluate(node => node.scrollIntoView());
  await pinned(page);
  await belowIdentity(page, '#sales-stage-reservation');
  const sizes = await identity(page).evaluate(node => ({ height: node.getBoundingClientRect().height,
    measured: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sale-file-header-height')),
    clipped: Array.from(node.querySelectorAll('h3,p,button')).some(element => element.scrollWidth > element.clientWidth) }));
  expect(sizes.measured).toBe(sizes.height);
  expect(sizes.clipped).toBe(false);
  expect((await comments(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('header-long-labels.png') });
});
