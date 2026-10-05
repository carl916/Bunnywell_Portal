import { test, expect } from '@playwright/test';
import { salesFixture } from './helpers/sales-fixture';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.portalLoadTracing = true; });
});

test('pending defaults allow sale/version reads but do not expose a complete workspace', async ({ page }) => {
  const f = await salesFixture(page);
  f.documents();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/building_sale_defaults?**', async route => {
    await held; await route.fulfill({ json: [] });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.portalLoadTrace?.some(row => row.scope === 'sales' && row.resource === 'unit_sale_document_versions'))).toBe(true);
  await expect(page.getByRole('region', { name: 'Sales loading' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toBeVisible();
});

test('switching sale while an old concurrent snapshot loads retains the new selection and figures', async ({ page }) => {
  const f = await salesFixture(page);
  const nextUnit = '20000000-0000-4000-8000-000000000002';
  const nextSale = '40000000-0000-4000-8000-000000000002';
  f.rows.units.push({ ...f.unit, id: nextUnit, unit_number: '102' });
  f.rows.unit_sale_attempts.push({ ...f.attempt, id: nextSale, unit_id: nextUnit });
  f.rows.unit_sale_terms = [
    { id: 'terms-A', sale_attempt_id: f.attempt.id, is_current: true, contract_price: 111111 },
    { id: 'terms-B', sale_attempt_id: nextSale, is_current: true, contract_price: 222222 },
  ];
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  let first = true;
  await page.route('**/rest/v1/building_sale_defaults?**', async route => {
    if (first) { first = false; requested(); await held; }
    await route.fulfill({ json: [] });
  });
  await page.reload(); await arrived;
  await expect(page.getByRole('region', { name: 'Sales loading' })).toBeVisible();
  await page.getByRole('button', { name: 'Snags', exact: true }).click();
  await page.evaluate(unit => {
    const url = new URL(location.href); url.searchParams.set('salesUnitId', unit);
    history.replaceState(null, '', url);
  }, nextUnit);
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unit 102', exact: true })).toBeVisible();
  await expect(page.getByText('£222,222', { exact: true }).first()).toBeVisible();
  release();
  await expect.poll(() => page.evaluate(() => window.portalLoadTrace?.some(row => row.scope === 'sales' && row.phase === 'discarded'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Unit 102', exact: true })).toBeVisible();
  await expect(page.getByText('£111,111', { exact: true })).toHaveCount(0);
});

test('failed version read keeps the workspace incomplete and an explicit retry recovers', async ({ page }) => {
  const f = await salesFixture(page); f.documents();
  let failed = true;
  await page.route('**/rest/v1/unit_sale_document_versions?**', route => failed
    ? route.fulfill({ status: 403, json: { code: '42501', message: 'Version access denied' } })
    : route.fallback());
  await page.reload();
  await expect(page.getByText('Version access denied', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toBeVisible();
});

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
