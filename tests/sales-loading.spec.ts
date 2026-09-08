import { test, expect } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';

test('staging without the name lookup still loads the Sales figures', async ({ page }) => {
  const f = await salesFixture(page);
  f.rows.unit_sale_terms = [{ id: 'terms', sale_attempt_id: f.attempt.id, is_current: true, contract_price: 345678, list_price_at_offer: 345678 }];
  await page.route('**/rest/v1/rpc/sale_actor_names', route => route.fulfill({ status: 404, json: {
    code: 'PGRST202', message: 'Could not find the function public.sale_actor_names(p_sales) in the schema cache',
  } }));
  await page.goto('/?screen=sales');
  await expect(page.getByText('£345,678', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sales data is available, but some user names need a database update. Please contact an administrator.')).toBeVisible();
  await expect(page.getByText('Could not load sales data.', { exact: true })).toHaveCount(0);
});

test('Sales displays the underlying database error for failed required queries', async ({ page }) => {
  await salesFixture(page);
  await page.route('**/rest/v1/unit_sale_terms?**', route => route.fulfill({ status: 403, json: {
    code: '42501', message: 'permission denied for table unit_sale_terms',
  } }));
  await page.goto('/?screen=sales');
  await expect(page.getByText('permission denied for table unit_sale_terms', { exact: true })).toBeVisible();
});
