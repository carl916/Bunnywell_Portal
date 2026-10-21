import { test, expect } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';
import { furtherDepositDatabase } from './helpers/further-deposit-database.mjs';

for (const role of ['sales_agent', 'conveyancer', 'developer', 'admin']) {
  test(role + ' sees both deposit terms on an unapproved sale', async ({ page }, testInfo) => {
    const database = await furtherDepositDatabase();
    try {
      await database.owner();
      await database.db.query("update unit_sale_attempts set workflow_status='draft' where id=$1", [database.ids.sale]);
      await database.db.query('update unit_sale_terms set contract_price=211500 where sale_attempt_id=$1', [database.ids.sale]);
      await database.db.query('update profiles set organisation_id=$1 where id=$2', [database.agentOrg, database.ids.agent]);
      if (role === 'admin') await database.db.query("update profiles set role='admin' where id=$1", [database.ids.developer]);
      const actor = role === 'sales_agent' ? 'agent' : role === 'conveyancer' ? 'solicitor' : 'developer';
      const f = await salesFixture(page);
      f.profile.role = role;
      f.rows.buildings[0].conveyancer_organisation_id = null;
      await page.route('**/rest/v1/rpc/sales_deposit_context', async route => {
        try {
          await database.as(actor);
          await route.fulfill({ json: await database.rpc('sales_deposit_context', { p_sale: database.ids.sale }) });
        } catch (e) { await route.fulfill({ status: 403, json: { message: e instanceof Error ? e.message : 'Deposit load failed' } }); }
      });
      await f.reloadStage('Reservation');
      await page.getByRole('tab', { name: /^Financials/ }).click();
      const panel = page.locator('#sale-deposits');
      await expect(panel.locator('#exchange-deposit-task')).toContainText('Expected (10%): £21,150.00. Due on legal exchange.');
      await expect(panel.locator('#further-deposit')).toContainText('Expected (5%): £10,575.00. Due 1 April 2027 at 17:00 UK time.');
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await expect(panel.getByRole('button')).toHaveCount(0);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 960 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await panel.screenshot({ path: testInfo.outputPath(role + '-' + width + '.png') });
      }
    } finally { await database.db.close(); }
  });
}

test('failed deposit load stops loading and clears its error after a successful retry', async ({ page }) => {
  const f = await salesFixture(page);
  let fail = true;
  await page.route('**/rest/v1/rpc/sales_deposit_context', async route => {
    if (fail) await route.fulfill({ status: 503, json: { message: 'Deposits temporarily unavailable.' } });
    else await route.fallback();
  });
  await f.reloadStage('Reservation');
  await page.getByRole('tab', { name: /^Financials/ }).click();
  const panel = page.locator('#sale-deposits');
  await expect(panel.getByRole('alert')).toContainText('Deposits temporarily unavailable.');
  await expect(panel.getByText('Loading deposits…', { exact: true })).toHaveCount(0);
  fail = false;
  await panel.getByRole('button', { name: 'Refresh deposits' }).click();
  await expect(panel.getByRole('heading', { name: 'Exchange deposit', exact: true })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
