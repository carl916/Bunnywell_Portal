import { test, expect } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';

test('Sales tables, tabs, spacing and navigation across mobile, tablet and desktop', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await salesFixture(page);
  f.rows.unit_sale_terms = [{ id: "terms", sale_attempt_id: f.attempt.id, is_current: true, contract_price: 987654321.12, list_price_at_offer: 987654321.12 }];
  await page.route('**/rest/v1/rpc/get_agent_fee_portfolio', route => route.fulfill({ json: [{
    sale_attempt_id: f.attempt.id, unit_id: f.unit.id, building_id: f.unit.building_id,
    unit_number: '101', building_name: 'Workflow Test House', sales_agent_name: 'Example Sales Agency',
    unit_sale_status: 'exchanged', workflow_status: 'exchanged', contract_price: 987654321.12,
    exchange_fee_percent: 2, completion_fee_percent: 1, vat_rate: 20,
    exchange_invoice: { id: 'invoice', status: 'approved', expected_payable_amount: 123456.78 },
  }] }));
  for (const width of [360,390,412,430,639,640,767,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?screen=sales');
    await expect(page.getByRole('heading', { name: 'Sales results', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sales results', exact: true }).locator('tbody tr')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page width at '+width).toBe(true);
    if (width >= 768) {
      await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button')).toHaveText(['Dashboard','Snags','Sales','Rentals','More']);
      await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeHidden();
    }
    if ([360,390,412,430,768,1440].includes(width)) await page.screenshot({path:testInfo.outputPath('sales-overview-'+width+'.png'),fullPage:true});
    const overview = page.getByRole('region', { name: 'Sales results', exact: true });
    const hasOverflow = await overview.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    await expect(overview.locator('..').locator('[data-visible]')).toHaveAttribute('data-visible', String(hasOverflow));
    if (width < 640) {
      const tabs = page.getByRole('tablist', { name: 'Sales views' });
      const mentions = page.getByRole('button', { name: '@ Mentions', exact: true });
      expect(Math.abs((await tabs.boundingBox())!.y - (await mentions.boundingBox())!.y)).toBeLessThan(2);
      for (const control of [tabs.getByRole('tab').first(), mentions]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const cards = page.getByRole('heading', { name: 'Financial overview', exact: true }).locator('..').locator('..').locator('h4');
      const positions = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x));
      expect(new Set(positions).size).toBe(1);
      const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
      await expect(nav.getByRole('button')).toHaveText(['Dashboard','Snags','Sales','Rentals','More']);
      await nav.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.locator('.mobile-menu-panel .menu-row').first()).toHaveText('Dashboard');
      const menu = await page.locator('.mobile-menu-panel .menu-row').allTextContents();
      expect(menu.slice(0,4)).toEqual(['Dashboard','Snags','Sales','Rentals']);
      expect(menu.indexOf('Setup')).toBeGreaterThan(3);
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await overview.scrollIntoViewIfNeeded();
      const first = overview.locator('tbody tr').first().locator('td').first();
      const x = (await first.boundingBox())!.x;
      await overview.evaluate(el => { el.scrollLeft = 220; });
      await expect.poll(() => overview.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      expect(Math.abs((await first.boundingBox())!.x - x)).toBeLessThan(2);
      await expect(overview.locator('..').locator('[data-visible]')).toHaveAttribute('data-visible','false');
      await page.evaluate(() => scrollTo(0,document.body.scrollHeight));
      const finalCard = page.locator('.portal-content > div > section').last();
      expect((await finalCard.boundingBox())!.y + (await finalCard.boundingBox())!.height).toBeLessThan((await nav.boundingBox())!.y);
    }
    await page.getByRole('tab', { name: 'Agent Fees', exact: true }).click();
    const fees = page.getByRole('region', { name: 'Agent fees', exact: true });
    await expect(fees).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'fees width at '+width).toBe(true);
    if (width < 768) {
      expect(await fees.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await expect(fees.getByRole('columnheader', { name: 'Agent', exact: true })).toBeVisible();
      await fees.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      expect(await fees.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      const first = fees.locator('tbody td').first();
      expect((await first.boundingBox())!.x).toBeGreaterThanOrEqual((await fees.boundingBox())!.x - 1);
    }
    if ([360,390,412,430,768,1440].includes(width)) {
      await page.screenshot({path:testInfo.outputPath('sales-fees-'+width+'.png'),fullPage:true});
    }
  }
});

test('forecast comparison remains scrollable and external Sales roles retain their navigation permissions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await salesFixture(page);
  f.rows.sales_forecast_scenarios = [{ id: 'scenario', building_id: f.unit.building_id, name: 'A long saved forecast scenario',
    results: { cashAfterDebt: 1234567, developerProfit: 123456, annualRent: 98765 } }];
  await page.goto('/?screen=sales');
  await page.getByRole('button', { name: 'Open forecasting', exact: true }).click();
  const table = page.getByRole('region', { name: 'Saved scenario comparison', exact: true });
  await expect(table).toBeVisible();
  for (const width of [360,390,412,430,768,1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'forecast width at '+width).toBe(true);
    if (width < 768) {
      await table.scrollIntoViewIfNeeded();
      await table.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
  }
  for (const role of ['sales_agent','conveyancer']) {
    f.profile.role = role;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/?screen=sales');
    await expect(page.getByRole('heading', { name: 'Sales results', exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
    await expect(nav.getByRole('button')).toHaveText(['Sales','More']);
    await expect(page.getByRole('tab', { name: 'Agent Fees', exact: true })).toHaveCount(0);
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.locator('.mobile-menu-panel .menu-row')).toHaveText(['Sales','Sign out']);
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
});
