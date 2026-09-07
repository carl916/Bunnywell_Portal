import { expect, test, type Page } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';

const panel = (page: Page) => page.locator('#sale-conversation');
const layout = (page: Page) => page.locator('[data-presentation]');
const trigger = (page: Page) => page.getByRole('button', { name: /^Comments/ }).first();
const cards = (page: Page) => page.getByTestId('commercial-summary-cards');
const composer = (page: Page) => page.getByRole('textbox', { name: 'Write an update', exact: true });
const columns = (page: Page) => cards(page).evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));

async function fixture(page: Page, width = 1600) {
  await page.setViewportSize({ width, height: 1000 });
  const f = await salesFixture(page);
  f.rows.unit_sale_terms = [{
    id: 'responsive-terms', sale_attempt_id: f.attempt.id, is_current: true, status: 'draft',
    contract_price: 1340500, list_price_at_offer: 1340500, parking_value: 10000,
    developer_contribution: 5000, agent_contribution: 2500, solicitor_fee: 882,
    agent_fee_percent: 10, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5,
    reservation_fee: 5000, exchange_deposit_percent: 10, second_deposit_enabled: true,
    second_deposit_percent: 5, second_deposit_months_after_exchange: 3, completion_balance_percent: 85,
  }];
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Progression/ })).toBeVisible();
  await settle(page);
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

test('default Comments and Commercial respond together across desktop, tablet and mobile', async ({ page }, testInfo) => {
  await fixture(page);
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  const measurements = [];
  for (const width of [1600, 1465, 1440, 1366, 1320, 1280, 1279, 1200, 1100, 1024, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await settle(page);
    const presentation = width >= 1320 ? 'inline' : 'collapsed';
    for (const name of ['Progression', 'Financials', 'Commercial']) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
      await tab.click();
      await expect(tab).toBeFocused();
      await expect(layout(page)).toHaveAttribute('data-presentation', presentation);
      await expect(page.getByRole('dialog', { name: 'Sale comments and activity' })).toHaveCount(0);
      await expect(page.locator('[data-conversation-backdrop]')).toHaveCount(0);
      await expect(trigger(page)).toHaveAttribute('aria-expanded', String(presentation === 'inline'));
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      await noOverflow(page);
    }
    expect(await columns(page)).toBe(width >= 1024 ? 3 : width === 900 ? 2 : 1);
    const measurement = await cards(page).evaluate(grid => ({
      viewport: innerWidth, grid: grid.getBoundingClientRect().width,
      columns: getComputedStyle(grid).gridTemplateColumns,
      cardWidths: [...grid.children].map(card => card.getBoundingClientRect().width),
    }));
    measurements.push({ ...measurement, presentation });
    await page.screenshot({ path: testInfo.outputPath(`sale-file-${width}.png`), fullPage: true });
  }
  const at1280 = measurements.find(row => row.viewport === 1280)!;
  const at1279 = measurements.find(row => row.viewport === 1279)!;
  expect(Math.abs(at1280.cardWidths[0] - at1279.cardWidths[0])).toBeLessThan(1);
  await testInfo.attach('responsive-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('explicit intent survives resizing, closing, workspace switches and draft editing', async ({ page }) => {
  await fixture(page);
  // Clicking an already visible rail still records explicit intent.
  await trigger(page).click();
  await composer(page).fill('Keep this draft while resizing');
  await page.getByRole('tab', { name: /^Commercial/ }).click();
  await page.getByRole('button', { name: 'Edit commercial model', exact: true }).click();
  await page.getByLabel('Proposed contract price', { exact: true }).fill('1350500');
  await page.setViewportSize({ width: 1200, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
  await expect(panel(page)).toHaveAttribute('aria-modal', 'true');
  await expect(panel(page).getByRole('button', { name: 'Close comments panel' })).toBeFocused();
  await expect(composer(page)).toHaveValue('Keep this draft while resizing');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  await expect(page.locator('[inert]')).toHaveCount(0);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  // Resizing opened the modal while this field had focus: restore that field.
  await expect(page.getByLabel('Proposed contract price', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Proposed contract price', { exact: true })).toHaveValue('1,350,500');
  for (const width of [1320, 1366, 1600, 1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Financials', 'Progression', 'Commercial']) {
      await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      await expect(layout(page)).toHaveAttribute('data-presentation', 'collapsed');
    }
    await noOverflow(page);
  }
  await trigger(page).click();
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
  await expect(composer(page)).toHaveValue('Keep this draft while resizing');
  expect((await panel(page).boundingBox())!.width).toBe(390);
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator('[inert]')).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(panel(page)).toBeHidden();
  await trigger(page).click();
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  await composer(page).focus();
  await page.setViewportSize({ width: 1200, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
  await page.keyboard.press('Escape');
  // The old focus target is now hidden, so return to the Comments button.
  await expect(trigger(page)).toBeFocused();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await trigger(page).click();
  await panel(page).getByRole('button', { name: 'Close comments panel' }).click();
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(panel(page)).toBeHidden();
});

test('a narrow initial visit stays collapsed until an explicit click, or enough inline space returns', async ({ page }) => {
  await fixture(page, 1279);
  await expect(panel(page)).toBeHidden();
  for (const name of ['Commercial', 'Financials', 'Progression']) {
    const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
    await tab.click();
    await expect(tab).toBeFocused();
    await expect(panel(page)).toBeHidden();
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  await page.setViewportSize({ width: 1279, height: 1000 });
  await expect(panel(page)).toBeHidden();
  await trigger(page).click();
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
});

test('inline collapse and restore have a stable deadband, including scrollbar and focus changes', async ({ page }) => {
  const resizeErrors: string[] = [];
  page.on('pageerror', error => { if (error.message.includes('ResizeObserver')) resizeErrors.push(error.message); });
  await fixture(page);
  await page.getByRole('tab', { name: /^Commercial/ }).click();
  // Track every presentation mutation, not just the settled end state.
  const observe = () => layout(page).evaluate(node => {
    const transitions: string[] = [];
    Object.assign(window, { saleLayoutTransitions: transitions });
    new MutationObserver(records => {
      for (const record of records) transitions.push(`${record.oldValue}->${node.getAttribute('data-presentation')}`);
    }).observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ['data-presentation'] });
  });
  await observe();
  const transitions = () => page.evaluate(() => (window as unknown as { saleLayoutTransitions: string[] }).saleLayoutTransitions);
  const collapseWidth = await layout(page).evaluate(node => {
    const css = getComputedStyle(node);
    const minimum = ['--conversation-main-min', '--conversation-rail-min', '--conversation-gap']
      .reduce((sum, key) => sum + parseFloat(css.getPropertyValue(key)), 0);
    return Math.ceil(innerWidth - node.getBoundingClientRect().width + minimum);
  });
  expect(collapseWidth).toBeGreaterThanOrEqual(1280);
  expect(collapseWidth).toBeLessThanOrEqual(1320);
  for (let width = collapseWidth + 6; width >= collapseWidth - 6; width--) {
    await page.setViewportSize({ width, height: 1000 }); await settle(page);
  }
  expect(await transitions()).toHaveLength(1);
  await expect(layout(page)).toHaveAttribute('data-presentation', 'collapsed');
  const fullGridWidth = (await cards(page).boundingBox())!.width;
  expect(await columns(page)).toBe(3);
  for (const delta of [1, -1, 5, -5, 2, -2, 1, 0, 5, -1]) {
    await page.setViewportSize({ width: collapseWidth + delta, height: 1000 }); await settle(page);
  }
  expect(await transitions()).toHaveLength(1);
  await trigger(page).click();
  await expect(layout(page)).toHaveAttribute('data-presentation', 'overlay');
  const widthBeforeLock = (await layout(page).boundingBox())!.width;
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)).toBe('stable');
  await page.keyboard.press('Escape');
  expect((await layout(page).boundingBox())!.width).toBe(widthBeforeLock);
  // A closed panel stays closed as inline availability changes.
  await page.setViewportSize({ width: 1600, height: 1000 }); await settle(page);
  await expect(panel(page)).toBeHidden();
  // Reload to re-establish default intent, then measure both directions again.
  await page.reload(); await expect(cards(page)).toBeVisible();
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  await observe();
  await page.setViewportSize({ width: collapseWidth - 1, height: 1000 });
  await expect(layout(page)).toHaveAttribute('data-presentation', 'collapsed');
  const restoreMargin = await layout(page).evaluate(node => parseFloat(getComputedStyle(node).getPropertyValue('--conversation-restore-margin')));
  expect(restoreMargin).toBeGreaterThanOrEqual(24);
  let changes = 0, last = 'collapsed';
  for (let width = collapseWidth + restoreMargin - 6; width <= collapseWidth + restoreMargin + 6; width++) {
    await page.setViewportSize({ width, height: 1000 }); await settle(page);
    const next = (await layout(page).getAttribute('data-presentation'))!;
    if (next !== last) { changes++; last = next; }
  }
  expect(changes).toBe(1);
  expect(await transitions()).toHaveLength(2);
  await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  expect((await cards(page).boundingBox())!.width).toBeLessThan(fullGridWidth - 250);
  for (const delta of [-1, 1, -5, 5, -2, 2, -1, 0]) {
    await page.setViewportSize({ width: collapseWidth + restoreMargin + delta, height: 1000 }); await settle(page);
    await expect(layout(page)).toHaveAttribute('data-presentation', 'inline');
  }
  expect(await transitions()).toHaveLength(2);
  expect(resizeErrors).toEqual([]);
  await noOverflow(page);
});

test('Commercial breakpoints follow the content container and progress 3 to 2 to 1 without overflow', async ({ page }) => {
  await fixture(page);
  await panel(page).getByRole('button', { name: 'Close comments panel' }).click();
  await page.getByRole('tab', { name: /^Commercial/ }).click();
  const commercial = page.locator('#unit-sale-commercial');
  // Change only the content width while keeping a wide desktop viewport.
  // Sweep in 1px steps on both sides of each card-layout threshold.
  for (const [breakpoint, above, below] of [[824, 3, 2], [640, 2, 1]]) {
    for (const direction of [-1, 1]) {
      let last = direction === -1 ? above : below;
      let changes = 0;
      for (let step = -5; step <= 5; step++) {
        const contentWidth = breakpoint + step * direction;
        await commercial.evaluate((node, width) => {
          const css = getComputedStyle(node);
          const edges = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
          (node as HTMLElement).style.width = `${width + edges}px`;
        }, contentWidth);
        await settle(page);
        const count = await columns(page);
        expect(count).toBe(contentWidth >= breakpoint ? above : below);
        if (count !== last) { changes++; last = count; }
        await noOverflow(page);
      }
      expect(changes).toBe(1);
    }
  }
});
