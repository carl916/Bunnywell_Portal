// Read-only live staging/isolated-preview measurement. No bodies, credentials,
// screenshots, traces, business IDs or buyer data are saved.
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';

dotenv.config({ path: '.env.local', quiet: true });
const targets = JSON.parse(process.env.REGISTER_PERF_TARGETS ?? '{"staging":"https://staging.bunnywell.co.uk"}');
const rounds = Number(process.env.REGISTER_PERF_ROUNDS ?? 8);
const output = process.env.REGISTER_PERF_OUTPUT ?? 'test-results/register-staging-baseline.json';
const project = 'vxkpvdtrldwwqiddoyof.supabase.co';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project) throw Error('Staging backend required');
for (const origin of Object.values(targets)) if (origin !== 'https://staging.bunnywell.co.uk' && !/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin)) throw Error('Isolated staging preview required');
const browser = await chromium.launch({ headless: true });
const samples = [], setup = [], errors = [], otherFunctions = [];
const startedAt = new Date().toISOString();
let completed = false;
const save = () => { fs.mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ completed, startedAt, savedAt: new Date().toISOString(), targets, rounds, setup, samples, errors, otherFunctions }, null, 2)); };
try {
  for (const mobile of process.env.REGISTER_PERF_MOBILE_ONLY === '1' ? [true] : [false, true]) {
    const sessions = {};
    for (const [variant, origin] of Object.entries(targets)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      page.setDefaultTimeout(60_000);
      const hosts = new Set();
      page.on('request', r => { const h = new URL(r.url()).hostname; if (h.endsWith('.supabase.co')) hosts.add(h); });
      page.on('pageerror', () => errors.push({ variant, mobile, type: 'pageerror' }));
      page.on('response', r => { const u = new URL(r.url()); if (u.origin === origin && u.pathname.startsWith('/api/') && u.pathname !== '/api/sales/register') otherFunctions.push({ variant, mobile, endpoint: u.pathname, status: r.status(), region: r.headers()['x-vercel-id'] }); });
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
        const u = new URL(request.url), method = request.method;
        const unsafe = u.hostname.endsWith('.supabase.co') && u.hostname !== project ||
          u.origin === origin && u.pathname.startsWith('/api/sales/') && method !== 'GET' && method !== 'OPTIONS' ||
          u.hostname === project && /\/(rest|storage)\//.test(u.pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !/\/rpc\/(sale_mentions_inbox|sale_comment_unread)$/.test(u.pathname);
        if (unsafe) errors.push({ variant, mobile, type: 'blocked-write', endpoint: u.pathname.split('/').at(-1) });
        await cdp.send(unsafe ? 'Fetch.failRequest' : 'Fetch.continueRequest', unsafe ? { requestId, errorReason: 'BlockedByClient' } : { requestId });
      });
      await page.goto(origin);
      await page.getByLabel('Email', { exact: true }).fill(process.env.REGISTER_PERF_EMAIL ?? 'carl@accoladeproperties.co.uk');
      await page.getByLabel('Password', { exact: true }).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
      if (mobile) {
        await page.setViewportSize({ width: 390, height: 844 });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await page.goto(`${origin}/?screen=sales&building=all`);
      await page.getByLabel('Action with', { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('select[aria-label="Action with"]')?.disabled);
      if (hosts.size !== 1 || !hosts.has(project)) throw Error('Browser backend mismatch');
      setup.push({ variant, mobile, stagingVerified: true, browser: browser.version() }); save();
      sessions[variant] = { context, page, cdp, origin };
      await page.goto('about:blank');
    }
    for (let run = 0; run < rounds; run++) {
      const order = Object.keys(sessions); if ((run + Number(mobile)) % 2) order.reverse();
      for (const variant of order) {
        const { page, origin } = sessions[variant];
        for (const action of ['open', 'refresh']) {
          const requests = [], pending = [];
          let start = 0;
          const requestOffsets = [];
          const requestListener = r => { if (new URL(r.url()).pathname === '/api/sales/register') { requests.push(r); requestOffsets.push(performance.now() - start); } };
          const responseListener = response => {
            if (new URL(response.url()).pathname !== '/api/sales/register') return;
            pending.push((async () => {
              const body = await response.body(), data = JSON.parse(body), headers = response.headers();
              const timing = response.request().timing();
              return { status: response.status(), durationMs: timing.responseEnd,
                responseStartMs: timing.responseStart, responseEndMs: timing.responseEnd,
                bytes: body.length, serverTiming: headers['server-timing'], region: headers['x-vercel-id'],
                projectionHash: createHash('sha256').update(JSON.stringify({ ...data, asOf: null })).digest('hex'),
                rowCount: data.rows?.length, actionable: data.actionsAvailable,
                actionRows: data.rows?.filter(r => r.actions.length).length, datedRows: data.rows?.filter(r => r.keyDate).length };
            })());
          };
          page.on('request', requestListener); page.on('response', responseListener);
          if (mobile && action === 'refresh') await page.getByRole('button', { name: 'Open menu', exact: true }).click();
          start = performance.now();
          if (action === 'open') {
            await page.goto(`${origin}/?screen=sales&building=all`);
            // Show populated rows within the complete All buildings snapshot.
            await page.getByRole('searchbox').fill('Forum House');
          }
          else await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await page.waitForFunction(() => {
            const region = document.querySelector('section[aria-label="Sales register"]');
            const filter = region?.querySelector('select[aria-label="Action with"]');
            return filter && !filter.disabled && !region.textContent.includes('Refreshing…');
          });
          // On refresh the old snapshot may remain usable while the new request is
          // queued. Require the new response before accepting refreshed readiness.
          while (!pending.length && performance.now() - start < 60_000) await page.waitForTimeout(20);
          if (!pending.length) throw Error('No fresh register response within 60 seconds');
          const api = await Promise.all(pending);
          await page.waitForFunction(() => !document.querySelector('section[aria-label="Sales register"]')?.textContent.includes('Refreshing…'));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const readyMs = performance.now() - start;
          const ui = await page.locator('section[aria-label="Sales register"] table').evaluate(table => ({
            actionRows: [...table.querySelectorAll('td[data-label="Next step"]')].filter(c => c.querySelector('a')).length,
            partyRows: [...table.querySelectorAll('td[data-label="Action with"]')].filter(c => c.textContent.trim() !== '—').length,
            datedRows: [...table.querySelectorAll('td[data-label="Key date"]')].filter(c => c.textContent.trim() !== '—').length,
          }));
          await page.waitForTimeout(300);
          page.off('request', requestListener); page.off('response', responseListener);
          if (requests.length !== 1 || api.some(r => r.status !== 200 || !r.actionable) || !ui.actionRows || !ui.partyRows || !ui.datedRows) throw Error('Register failed, duplicated or not visibly actionable');
          samples.push({ variant, mobile, run, action, readyMs, requestOffsets, requests: requests.length, ui, api }); save();
          console.log(JSON.stringify({ variant, mobile, run, action, readyMs: Math.round(readyMs), apiMs: Math.round(api[0].responseEndMs) }));
        }
        await page.goto('about:blank');
      }
    }
    for (const { context } of Object.values(sessions)) await context.close();
  }
  completed = true;
} finally { save(); await browser.close(); }
if (errors.length) process.exitCode = 1;
