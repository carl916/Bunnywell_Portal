import { expect, test, type Page } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';

const panel = (page: Page) => page.locator('#sale-conversation');
const layout = (page: Page) => page.locator('[data-presentation]');
const trigger = (page: Page) => page.getByRole('button', { name: /^Comments/ }).first();
const cards = (page: Page) => page.getByTestId('commercial-summary-cards');
const composer = (page: Page) => page.getByRole('textbox', { name: 'Write an update', exact: true });

async function fixture(page: Page, width = 1600) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const f = await salesFixture(page);
  f.rows.unit_sale_terms = [{
    id: 'responsive-terms', sale_attempt_id: f.attempt.id, is_current: true, status: 'draft',
    contract_price: 1340500, list_price_at_offer: 1340500, parking_value: 10000,
    developer_contribution: 5000, agent_contribution: 2500, solicitor_fee: 882,
    agent_fee_percent: 10, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5,
    reservation_fee: 5000, exchange_deposit_percent: 10, second_deposit_enabled: true,
    second_deposit_percent: 5, second_deposit_months_after_exchange: 3, completion_balance_percent: 85,
  }];
  f.attempt.buyer_person_name = 'Alexandra Elizabeth Montgomery-Worthington and Christopher James Montgomery-Worthington';
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Progression/ })).toBeVisible();
  return f;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await layout(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  if (await cards(page).isVisible()) {
    const issues = await cards(page).evaluate(grid => [...grid.querySelectorAll<HTMLElement>('div, span, strong')]
      .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
    expect(issues).toEqual([]);
  }
}

test('full-width workspaces and an on-demand overlay at desktop, tablet and mobile widths', async ({ page }, testInfo) => {
  await fixture(page);
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Progression', 'Financials', 'Commercial']) {
      const tab = page.getByRole('tab', { name: new RegExp('^' + name) });
      await tab.click();
      await expect(tab).toBeFocused();
      await expect(layout(page)).toHaveAttribute('data-presentation', 'collapsed');
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
      await noOverflow(page);
    }
    const before = (await layout(page).boundingBox())!;
    await trigger(page).click();
    await expect(panel(page)).toHaveAttribute('role', 'dialog');
    await expect(panel(page)).toHaveAttribute('aria-modal', 'true');
    await expect(panel(page).getByRole('button', { name: 'Close comments panel' })).toBeFocused();
    await expect(panel(page).getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    expect((await layout(page).boundingBox())!.width).toBe(before.width);
    expect((await panel(page).boundingBox())!.width).toBe(Math.min(420, width));
    await page.screenshot({ path: testInfo.outputPath('drawer-' + width + '.png') });
    await page.keyboard.press('Escape');
    await expect(trigger(page)).toBeFocused();
    await expect(page.locator('[inert]')).toHaveCount(0);
    expect((await layout(page).boundingBox())!.width).toBe(before.width);
    await page.screenshot({ path: testInfo.outputPath('workspace-' + width + '.png') });
  }
});

test('drawer state, focus trap, outside close and unsaved values survive resizing and workspace changes', async ({ page }) => {
  await fixture(page);
  await page.getByRole('tab', { name: /^Commercial/ }).click();
  await page.getByRole('button', { name: 'Edit commercial model', exact: true }).click();
  await page.getByLabel('Proposed contract price', { exact: true }).fill('1350500');
  await trigger(page).click();
  await composer(page).fill('Keep this draft while resizing');
  const close = panel(page).getByRole('button', { name: 'Close comments panel' });
  await close.focus(); await page.keyboard.press('Shift+Tab');
  await expect(panel(page).getByRole('button', { name: 'Send', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  for (const width of [1200, 390, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
    await expect(composer(page)).toHaveValue('Keep this draft while resizing');
    await noOverflow(page);
  }
  await page.locator('[data-conversation-backdrop]').click({ position: { x: 20, y: 300 } });
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByLabel('Proposed contract price', { exact: true })).toHaveValue('1,350,500');
  for (const name of ['Financials', 'Progression', 'Commercial']) {
    await page.getByRole('tab', { name: new RegExp('^' + name) }).click();
    await expect(panel(page)).toBeHidden();
    await trigger(page).click();
    await expect(composer(page)).toHaveValue('Keep this draft while resizing');
    await page.keyboard.press('Escape');
  }
  await trigger(page).click();
  await panel(page).getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.keyboard.press('Escape'); await trigger(page).click();
  await expect(panel(page).getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('mobile sheet follows the visual viewport when a keyboard reduces visible height', async ({ page }) => {
  await fixture(page, 390);
  await trigger(page).click();
  await composer(page).fill('Mobile update');
  await composer(page).focus();
  // Desktop Chromium cannot open an OS keyboard. Exercise the same visual
  // viewport resize/offset events a mobile keyboard produces.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 460 });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 80 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const bounds = (await panel(page).boundingBox())!;
  expect(bounds.y).toBe(80); expect(bounds.height).toBe(460);
  const send = (await panel(page).getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(540);
  expect((await composer(page).boundingBox())!.y).toBeGreaterThanOrEqual(80);
  await noOverflow(page);
});

test('Commercial breakpoints retain three, two and one columns without overflow', async ({ page }) => {
  await fixture(page);
  await page.getByRole('tab', { name: /^Commercial/ }).click();
  const commercial = page.locator('#unit-sale-commercial');
  for (const [contentWidth, expected] of [[825, 3], [824, 3], [823, 2], [641, 2], [640, 2], [639, 1]]) {
    await commercial.evaluate((node, width) => {
      const css = getComputedStyle(node);
      const edges = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
      (node as HTMLElement).style.width = String(width + edges) + 'px';
    }, contentWidth);
    expect(await cards(page).evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(expected);
    await noOverflow(page);
  }
});
