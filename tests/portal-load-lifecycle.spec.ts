import { test, expect } from '@playwright/test';
import { salesFixture, userId } from './helpers/sales-fixture';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.portalLoadTracing = true; });
});
const starts = (page: import('@playwright/test').Page, scope: string) => page.evaluate(scope =>
  (window.portalLoadTrace ?? []).filter(row => row.scope === scope && row.phase === 'start').length, scope);

test('direct entry restores one portal snapshot and mounts Sales only in the resolved building', async ({ page }) => {
  await salesFixture(page);
  await expect.poll(() => starts(page, 'portal')).toBe(1);
  await expect.poll(() => starts(page, 'sales')).toBe(1);
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Current building', exact: true })).toHaveCount(0); // single accessible building
});

test('Refresh reloads portal and Sales once; a unit price/status edit does not trigger another broad Sales load', async ({ page }) => {
  const f = await salesFixture(page);
  f.rows.unit_sale_terms = [{ id: 'terms', sale_attempt_id: f.attempt.id, is_current: true, contract_price: 321234 }];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('£321,234', { exact: true }).first()).toBeVisible();
  await expect.poll(() => starts(page, 'portal')).toBe(2);
  await expect.poll(() => starts(page, 'sales')).toBe(2);
});

test('a late old Sales snapshot cannot replace refreshed figures or expose incomplete controls', async ({ page }) => {
  const f = await salesFixture(page);
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  let first = true;
  await page.route('**/rest/v1/unit_sale_terms?**', async route => {
    if (first) { first = false; requested(); await held; await route.fulfill({ json: [{ id: 'old', sale_attempt_id: f.attempt.id, is_current: true, contract_price: 111111 }] }); }
    else await route.fulfill({ json: [{ id: 'new', sale_attempt_id: f.attempt.id, is_current: true, contract_price: 222222 }] });
  });
  await page.reload(); await arrived;
  await expect(page.getByRole('region', { name: 'Sales loading' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('£222,222', { exact: true }).first()).toBeVisible();
  release();
  await expect.poll(() => page.evaluate(() => window.portalLoadTrace?.some(row => row.scope === 'sales' && row.phase === 'discarded'))).toBe(true);
  await expect(page.getByText('£111,111', { exact: true })).toHaveCount(0);
});

test('permission revocation on Refresh removes Sales even if an old read finishes later', async ({ page }) => {
  const f = await salesFixture(page);
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/rest/v1/unit_sale_terms?**', async route => { requested(); await held; await route.fulfill({ json: [] }); });
  await page.reload(); await arrived;
  f.profile.role = 'user';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sales loading' })).toHaveCount(0);
  release();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});

test('deactivated profile signs out and old portal/Sales reads do not restore it', async ({ page }) => {
  const f = await salesFixture(page); f.profile.active = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
});

test('token refresh loads one fresh snapshot; focus with changed role removes Sales', async ({ page }) => {
  const f = await salesFixture(page);
  async function emit(event: string, token: string) {
    await page.evaluate(({ event, token, id, email }) => {
      const channel = new BroadcastChannel('sb-vxkpvdtrldwwqiddoyof-auth-token');
      channel.postMessage({ event, session: { user: { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }, access_token: token, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer' } });
      channel.close();
    }, { event, token, id: userId, email: f.profile.email });
  }
  await emit('TOKEN_REFRESHED', 'new-fixture-token');
  await expect.poll(() => starts(page, 'portal')).toBe(2);
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toBeVisible();
  await expect.poll(() => starts(page, 'sales')).toBe(2);
  f.profile.role = 'user';
  await emit('SIGNED_IN', 'new-fixture-token');
  await expect.poll(() => starts(page, 'portal')).toBe(3);
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
});
