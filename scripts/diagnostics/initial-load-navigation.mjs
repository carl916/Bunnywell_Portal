// Read-only completed-sale navigation. Persist counts/timing only, never
// credentials, business bodies, URLs, identifiers, traces or screenshots.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local', quiet: true });
const [origin = 'https://staging.bunnywell.co.uk', label = 'before', runs = '5'] = process.argv.slice(2);
if (origin !== 'https://staging.bunnywell.co.uk' && !/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin)) throw Error('Staging preview required');
const project = 'vxkpvdtrldwwqiddoyof.supabase.co';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project) throw Error('Staging project required');
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await client.auth.signInWithPassword({ email: process.env.PLAYWRIGHT_ADMIN_EMAIL, password: process.env.PLAYWRIGHT_ADMIN_PASSWORD });
if (login.error) throw Error('Staging login failed');
const scope = JSON.parse(fs.readFileSync('.next/performance/staging-test-sales.json', 'utf8'));
const unit = scope.units.find(row => row.unit_number === '107');
async function fingerprint() {
  const result = await client.from('unit_sale_attempts').select('id,workflow_status,updated_at').in('unit_id', scope.units.map(row => row.id)).eq('is_active', true).order('id');
  if (result.error || result.data.length !== 4 || result.data.some(row => row.workflow_status !== 'completed')) throw Error('Only existing completed diagnostic sales allowed');
  return createHash('sha256').update(JSON.stringify(result.data)).digest('hex');
}
const original = await fingerprint();
const output = `artifacts/performance/initial-load/${label}`;
fs.mkdirSync(output, { recursive: true });
const samples = [];
function category(request) {
  const path = new URL(request.url()).pathname;
  if (path === '/api/performance/vitals') return 'telemetry';
  if (path === '/api/auth/activity') return 'activity';
  if (/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page/.test(path)) return 'polling';
  if (path.includes('/rest/v1/')) return path.split('/').at(-1).replace(/[^a-z_]/g, '');
  if (path.includes('/auth/')) return 'auth';
  if (path === '/api/sales/legal') return 'legal-context';
  if (path.endsWith('.js')) return 'javascript';
  return 'assets/document';
}
const browser = await chromium.launch({ headless: true });
try {
  for (const profile of ['desktop', 'mobile-throttled']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => { window.portalLoadTracing = true; });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname.endsWith('.supabase.co') && url.hostname !== project) throw Error('Unexpected project');
      if (url.pathname.startsWith('/api/sales/') && request.method() !== 'GET') throw Error('Diagnostic sale mutation prohibited');
      if (url.pathname.includes('/rest/v1/') && !url.pathname.includes('/rpc/') && request.method() !== 'GET') throw Error('Diagnostic database mutation prohibited');
    });
    await page.goto(origin);
    await page.getByLabel('Email', { exact: true }).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    if (profile === 'mobile-throttled') {
      await page.setViewportSize({ width: 390, height: 844 });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.goto(`${origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${unit.id}`);
    await page.getByRole('button', { name: /^Completion\b/ }).waitFor();
    // A historical build can show the navigation controls before its Sales
    // snapshot finishes. Settle warm-up before recording the first cold reload.
    await page.waitForLoadState('networkidle');
    for (let run = 1; run <= Number(runs); run++) for (const navigation of ['cold', 'repeat']) {
      if (navigation === 'cold') await cdp.send('Network.clearBrowserCache');
      const rows = [], active = new Set(), tracked = new Map(), keys = new Map();
      let lastWork = Date.now();
      const start = Date.now();
      const begin = request => {
        const kind = category(request);
        // Request identity is compared in memory; only duplicate ordinal saved.
        const key = request.method() + request.url() + (request.postData() ?? '');
        const ordinal = (keys.get(key) ?? 0) + 1; keys.set(key, ordinal);
        const row = { category: kind, duplicateOrdinal: ordinal, offsetMs: Date.now() - start, status: null, finished: false, failed: false };
        rows.push(row); tracked.set(request, row);
        if (!['telemetry', 'polling'].includes(kind)) { active.add(request); lastWork = Date.now(); }
      };
      const response = response => { const row = tracked.get(response.request()); if (row) row.status = response.status(); };
      const end = request => { const row = tracked.get(request); if (row) { row.finished = true; row.endMs = Date.now() - start; } if (active.delete(request)) lastWork = Date.now(); };
      const failed = request => { const row = tracked.get(request); if (row) row.failed = true; if (active.delete(request)) lastWork = Date.now(); };
      page.on('request', begin); page.on('response', response); page.on('requestfinished', end); page.on('requestfailed', failed);
      await page.reload();
      await page.getByRole('button', { name: /^Completion\b/ }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const readyMs = Date.now() - start, readyRequests = rows.length;
      while ((active.size || Date.now() - lastWork < 1500) && Date.now() - start < 60000) await new Promise(resolve => setTimeout(resolve, 100));
      const settledMs = Date.now() - start, timedOut = active.size > 0;
      const trace = await page.evaluate(() => window.portalLoadTrace ?? []);
      page.off('request', begin); page.off('response', response); page.off('requestfinished', end); page.off('requestfailed', failed);
      const sample = { profile, run, navigation, startedAt: new Date(start).toISOString(), readyMs, readyRequests, settledMs, settledRequests: rows.length, timedOut, requests: rows, trace };
      samples.push(sample); fs.writeFileSync(`${output}/samples.json`, JSON.stringify(samples, null, 2));
      console.log(JSON.stringify({ profile, run, navigation, readyMs, readyRequests, settledMs, settledRequests: rows.length, tracedEvents: trace.length, timedOut }));
    }
    await context.close();
  }
  const unchanged = original === await fingerprint();
  fs.writeFileSync(`${output}/verification.json`, JSON.stringify({ completedSales: 4, unchanged, browser: browser.version(), origin, label }, null, 2));
  if (!unchanged) throw Error('Completed sales changed during read-only measurement');
} finally { await browser.close(); await client.auth.signOut(); }
