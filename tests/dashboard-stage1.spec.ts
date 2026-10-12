import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { legalFixture } from './helpers/legal-ui-fixture';
import { deriveDashboard } from '../src/lib/dashboard/model';
import { deriveInternalOverview, datesToReview } from '../src/lib/dashboard/overview';
const { fixture } = createRequire(__filename)('./helpers/dashboard-fixture.mjs');

async function prepare(page: Parameters<typeof legalFixture>[0]) {
  const f = await legalFixture(page);
  await page.route('**/api/dashboard?*', async route => {
    const scope = new URL(route.request().url()).searchParams.get('building');
    const input = fixture({ viewer: { id: f.profile.id, role: f.profile.role, organisation_id: null }, buildingId: scope === 'all' ? '' : scope });
    const snapshot = deriveDashboard(input);
    snapshot.overview = deriveInternalOverview(input, snapshot);
    if (process.env.STAGE1_BENCHMARK !== 'before') snapshot.items = datesToReview(snapshot);
    await route.fulfill({ json: snapshot });
  });
  return f;
}

test('comparable dashboard startup measurements', async ({ page }) => {
  test.skip(!process.env.STAGE1_BENCHMARK, 'Opt-in before/after measurements');
  await prepare(page);
  const ready = async () => {
    await expect(page.getByRole('region', { name: 'Dashboard', exact: true }).getByText('Refreshed', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  };
  await page.goto('/?screen=dashboard&building=all');
  await ready();
  await page.waitForLoadState('networkidle');
  const samples = [];
  for (let run = 1; run <= 3; run++) {
    const urls: string[] = [];
    const collect = (request: { url(): string }) => urls.push(request.url());
    page.on('request', collect);
    const start = performance.now();
    await page.reload();
    await ready();
    const usableMs = Math.round(performance.now() - start);
    await page.waitForLoadState('networkidle');
    page.off('request', collect);
    const paths = urls.map(url => new URL(url).pathname);
    samples.push({ run, usableMs, browserRequests: paths.length, supabaseRequests: paths.filter(path => /\/(rest|auth)\/v1\//.test(path)).length,
      dataPaths: paths.filter(path => /\/(rest|auth)\/v1\/|\/api\//.test(path)) });
  }
  await mkdir('docs/dashboard-stage1', { recursive: true });
  await writeFile(`docs/dashboard-stage1/browser-${process.env.STAGE1_BENCHMARK}.json`, JSON.stringify({ conditions: 'Local Next dev, Chromium, warm assets, same synthetic developer and single accessible building (initial all-building URL resolves to that building); intercepted data, no database latency.', samples }, null, 2));
});

test('startup defers screen data and navigation reuses it without a portal reload', async ({ page }) => {
  const f = await prepare(page);
  f.profile.role = 'admin';
  const requests: URL[] = [];
  page.on('request', request => { if (request.url().includes('/rest/v1/')) requests.push(new URL(request.url())); });
  const count = (table: string) => requests.filter(url => url.pathname === `/rest/v1/${table}`).length;
  const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  await page.goto('/?screen=dashboard&building=all');
  await expect(page.getByRole('region', { name: 'Dashboard', exact: true }).getByText('Refreshed', { exact: false })).toBeVisible();
  await page.waitForLoadState('networkidle');
  for (const table of ['building_floors', 'unit_types', 'unit_type_areas', 'trades', 'organisations', 'areas', 'snags']) expect(count(table), table).toBe(0);
  expect(count('profiles')).toBe(1);
  expect(count('user_building_access')).toBe(1);
  expect(count('user_unit_access')).toBe(1);
  await nav.getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales overview', exact: true })).toBeVisible();
  expect(count('building_floors')).toBe(1);
  expect(count('organisations')).toBe(1);
  await nav.getByRole('button', { name: 'Rentals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rentals', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Snags', exact: true }).click();
  await expect(page.getByText('Loading screen records.', { exact: false })).toHaveCount(0);
  await expect.poll(() => count('snags')).toBe(1);
  await page.waitForLoadState('networkidle');
  // Units is an existing deep-link-only screen, hidden from the primary nav.
  await page.evaluate(() => { history.pushState(null, '', '/?screen=units&building=all'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByText('Loading screen records.', { exact: false })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Setup sections' })).toBeVisible();
  expect(count('unit_types')).toBe(1);
  expect(count('unit_type_areas')).toBe(1);
  await nav.getByRole('button', { name: 'Snags', exact: true }).click();
  await page.waitForLoadState('networkidle');
  expect(count('snags')).toBe(1);
  expect(count('buildings')).toBe(1);
  expect(count('units')).toBe(1);
  expect(count('building_organisations')).toBe(1);
  expect(count('building_floors')).toBe(1);
  expect(count('profiles')).toBe(2);
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => count('buildings')).toBe(2);
  await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  await nav.getByRole('button', { name: 'Snags', exact: true }).click();
  await expect.poll(() => count('snags')).toBe(2);
  await expect(page.getByText('Loading screen records.', { exact: false })).toHaveCount(0);
});

test('failed deferred data cannot mount an empty screen and can be retried', async ({ page }) => {
  await prepare(page);
  let fail = true;
  await page.route('**/rest/v1/building_floors?*', route => fail
    ? route.fulfill({ status: 400, json: { message: 'Floors unavailable' } }) : route.fulfill({ json: [] }));
  await page.goto('/?screen=dashboard&building=all');
  await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByText('Floors unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading screen records.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales overview', exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales overview', exact: true })).toBeVisible();
});

test('sign-out discards deferred reads still in flight', async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/rest/v1/building_floors?*', async route => {
    started = true;
    await held;
    await route.fulfill({ json: [] });
  });
  await page.goto('/?screen=dashboard&building=all');
  await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Sales', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  release();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Sales overview', exact: true })).toHaveCount(0);
});

test('navigation during a shell refresh retains newly loaded screen data', async ({ page }) => {
  await prepare(page);
  const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  await page.goto('/?screen=dashboard&building=all');
  await expect(page.getByRole('button', { name: 'Refresh work' })).toBeEnabled();
  await nav.getByRole('button', { name: 'Sales', exact: true }).click();
  const sales = page.getByRole('heading', { name: 'Sales overview', exact: true });
  await expect(sales).toBeVisible();
  await sales.evaluate(element => element.setAttribute('data-stage1-mounted', 'yes'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await expect(sales).toHaveAttribute('data-stage1-mounted', 'yes');

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/rest/v1/buildings?*', async route => { started = true; await held; await route.fallback(); });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await nav.getByRole('button', { name: 'Snags', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Snags', exact: true })).toBeVisible();
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Snags', exact: true })).toBeVisible();
  await expect(page.getByText('Loading screen records.', { exact: false })).toHaveCount(0);
});
