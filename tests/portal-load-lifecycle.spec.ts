import { test, expect } from '@playwright/test';
import { salesFixture, userId } from './helpers/sales-fixture';
import { legalFixture } from './helpers/legal-ui-fixture';

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

test('an access-read failure hides stale Sales and an explicit retry restores a complete snapshot', async ({ page }) => {
  await salesFixture(page);
  let fail = true;
  await page.route('**/rest/v1/user_building_access?**', route => fail
    ? route.fulfill({ status: 403, json: { code: '42501', message: 'Access check denied' } })
    : route.fallback());
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Access check denied', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry access check', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toBeVisible();
});

test('post-login access loading is quiet and offers no retry before a failure', async ({ page }) => {
  const fixture = await salesFixture(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/rest/v1/profiles?**', async route => {
    requested();
    await held;
    await route.fallback();
  });
  await page.getByLabel('Email', { exact: true }).fill(fixture.profile.email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await arrived;
  try {
    await expect(page.getByRole('status', { name: 'Loading portal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry access check' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
    await expect(page.getByText('Not signed in', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Reservation tasks', exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading portal' })).toHaveCount(0);
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

test('saved building restores before Sales mounts; a building switch loads only the new Sales scope', async ({ page }) => {
  const f = await salesFixture(page);
  const second = '10000000-0000-4000-8000-000000000002';
  f.rows.buildings.push({ id: second, name: 'Second Fixture House', status: 'active' });
  f.rows.units.push({ ...f.unit, id: '20000000-0000-4000-8000-000000000002', building_id: second });
  await page.evaluate(({ id, building }) => localStorage.setItem(`bunnywell.portal.buildingContext.${id}`, building), { id: userId, building: second });
  await page.goto('/?screen=sales');
  await expect(page.getByRole('combobox', { name: 'Current building', exact: true })).toHaveValue(second);
  await expect.poll(() => starts(page, 'sales')).toBe(1);
  const defaults = await page.evaluate(() => window.portalLoadTrace?.filter(row => row.scope === 'sales' && row.resource === 'building_sale_defaults'));
  expect(defaults).toHaveLength(1);
  await page.getByRole('combobox', { name: 'Current building', exact: true }).selectOption(String(f.unit.building_id));
  await expect.poll(() => starts(page, 'sales')).toBe(2);
  await expect.poll(() => starts(page, 'portal')).toBe(1);
});

test('equal-count replacement uses fresh accessible membership; unrelated units do not cause another load', async ({ page }) => {
  const f = await salesFixture(page), filters: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.endsWith('/unit_sale_attempts')) filters.push(url.searchParams.get('unit_id') ?? ''); });
  const replacement = '20000000-0000-4000-8000-000000000003';
  f.rows.units = [{ ...f.unit, id: replacement }];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => starts(page, 'sales')).toBe(2);
  await expect.poll(() => filters.at(-1)).toContain(replacement);
  expect(filters.at(-1)).not.toContain(String(f.unit.id));
});

test('sign-out during a delayed portal refresh cannot resurrect the previous profile', async ({ page }) => {
  await salesFixture(page);
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/rest/v1/units?**', async route => { requested(); await held; await route.fulfill({ json: [] }); });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await arrived;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible(); release();
  await expect.poll(() => page.evaluate(() => window.portalLoadTrace?.some(row => row.scope === 'portal' && row.phase === 'discarded'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});

for (const action of ['request_authority', 'confirm_exchange']) test(`${action} preserves the four/five-request legal refresh without a broad reload`, async ({ page }) => {
  const f = await legalFixture(page);
  f.profile.role = action === 'request_authority' ? 'sales_agent' : 'conveyancer';
  if (action === 'confirm_exchange') f.emails.push({ id: 'authority', kind: 'authority', version: 1, delivery_status: 'sent', expires_at: new Date(Date.now() + 86400000).toISOString(), issued_at: new Date().toISOString(), snapshot: f.snapshot, to_recipients: ['legal@example.test'], cc_recipients: [], resend_message_id: 'fixture' });
  await f.reloadStage('Exchange');
  const button = page.getByRole('button', { name: action === 'request_authority' ? 'Request authority to exchange' : 'Confirm exchange', exact: true });
  if (action === 'confirm_exchange') await page.getByLabel('Actual exchange date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await expect(button).toBeEnabled();
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/sales/legal' || path.includes('/rest/v1/') && !/sale_comment|sale_mentions|sale_activity/.test(path)) requests.push(path);
  });
  await button.click();
  await expect(page.getByText(action === 'request_authority' ? /Exchange authority requested\./ : 'Exchange confirmed.', { exact: action === 'confirm_exchange' })).toBeVisible();
  expect(requests).toHaveLength(action === 'request_authority' ? 4 : 5);
  await expect.poll(() => starts(page, 'sales')).toBe(1);
  await expect.poll(() => starts(page, 'portal')).toBe(action === 'confirm_exchange' ? 2 : 1); // the second start is the scoped unit read
  expect(await page.evaluate(() => window.portalLoadTrace?.filter(row => row.scope === 'portal' && row.phase === 'start').map(row => row.event))).toEqual(action === 'confirm_exchange' ? ['session-restoration', 'legal-action'] : ['session-restoration']);
});
