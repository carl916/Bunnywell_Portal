// Controlled read-only staging comparison. Never persist credentials, URLs
// containing business identifiers, response bodies, traces or screenshots.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const out = 'artifacts/performance/2026-10-05-targeted-region';
const deployments = JSON.parse(fs.readFileSync(`${out}/deployments.json`, 'utf8'));
const rounds = Number(process.argv[2] ?? 8);
const project = 'vxkpvdtrldwwqiddoyof.supabase.co';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project) throw Error('Staging required');
for (const region of ['iad1', 'fra1']) {
  const d = deployments[region];
  if (d.state !== 'READY' || d.target !== null || d.regions.join() !== 'iad1' ||
      !/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(d.origin)) throw Error('Verified isolated preview required');
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const login = await auth.auth.signInWithPassword({ email: process.env.PLAYWRIGHT_ADMIN_EMAIL, password: process.env.PLAYWRIGHT_ADMIN_PASSWORD });
if (login.error) throw Error('Diagnostic login failed');
const token = login.data.session.access_token;
const protectedNumbers = [...Array.from({ length: 14 }, (_, i) => String(102 + i)), ...Array.from({ length: 9 }, (_, i) => String(201 + i))];
const extraNumbers = [...Array.from({ length: 6 }, (_, i) => String(210 + i)), ...Array.from({ length: 6 }, (_, i) => String(301 + i))];
async function read(query) { const r = await query; if (r.error) throw Error('Staging inspection failed'); return r.data; }
const building = (await read(admin.from('buildings').select('id').eq('name', 'Forum House').single())).id;
const units = await read(admin.from('units').select('id,unit_number').eq('building_id', building).in('unit_number', [...protectedNumbers, ...extraNumbers]));
const unit = units.find(u => u.unit_number === '107');
const previewUnit = units.find(u => u.unit_number === '209');
const sales = await read(admin.from('unit_sale_attempts').select('id,unit_id,workflow_status').in('unit_id', units.map(u => u.id)).eq('is_active', true));
const sale = sales.find(s => s.unit_id === unit.id);
const previewSale = sales.find(s => s.unit_id === previewUnit.id);
if (sale.workflow_status !== 'completed' || previewSale.workflow_status !== 'ready_for_exchange') throw Error('Existing diagnostic state required');
// GET projects overdue authority expiry into audit history. Reject any selected
// sale where that projection could write, including expiries during this run.
const authorityEmails = await read(admin.from('sale_legal_emails').select('expires_at,sent_at,expiry_recorded_at,exchanged_at,revoked_at,replaced_by')
  .in('sale_attempt_id', [sale.id, previewSale.id]).eq('kind', 'authority'));
if (authorityEmails.some(e => e.sent_at && !e.expiry_recorded_at && !e.exchanged_at && !e.revoked_at && !e.replaced_by && Date.parse(e.expires_at) < Date.now() + 3600000)) throw Error('Legal GET could mutate selected sale');
async function fingerprints() {
  const attempts = await read(admin.from('unit_sale_attempts').select('*').in('unit_id', units.map(u => u.id)).order('id'));
  const ids = attempts.map(s => s.id);
  const emails = await read(admin.from('sale_legal_emails').select('*').in('sale_attempt_id', ids).order('id'));
  const events = await read(admin.from('unit_sale_workflow_events').select('*').in('sale_attempt_id', ids).order('id'));
  const docs = await read(admin.from('unit_sale_documents').select('*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)').in('sale_attempt_id', ids).order('id'));
  const unitRows = await read(admin.from('units').select('*').in('id', units.map(u => u.id)).order('id'));
  // Child ordering is not guaranteed by PostgREST. Canonicalise recursively.
  const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const hash = rows => createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
  return { attempts: { count: attempts.length, sha256: hash(attempts) }, emails: { count: emails.length, sha256: hash(emails) },
    events: { count: events.length, sha256: hash(events) }, documentsAndVersions: { count: docs.length, sha256: hash(docs) }, units: { count: unitRows.length, sha256: hash(unitRows) } };
}
const before = await fingerprints();
fs.writeFileSync(`${out}/state-before.json`, JSON.stringify({ protectedNumbers, extraNumbers, before, selectedCompletedUnit: 107, previewOnlyUnit: 209 }, null, 2));
const browser = await chromium.launch({ headless: true });
const samples = [], sessions = {}, setupRequests = [];
let guardViolations = 0, step = 'preflight';
const save = () => fs.writeFileSync(`${out}/samples.json`, JSON.stringify(samples, null, 2));
function category(request, origin) {
  const url = new URL(request.url()), path = url.pathname;
  if (url.hostname === project) {
    if (path.includes('/storage/')) return 'browser-supabase-storage';
    if (path.includes('/auth/')) return 'browser-supabase-auth';
    return 'browser-supabase-data';
  }
  if (url.origin === origin && path.startsWith('/api/')) return 'vercel-function';
  if (url.origin === origin) return 'vercel-static-document';
  return 'other-host';
}
function name(request) {
  const p = new URL(request.url()).pathname;
  if (p.startsWith('/api/')) return p;
  if (p.includes('/rest/v1/')) return p.split('/').at(-1).replace(/[^a-z_]/g, '');
  if (p.endsWith('.js')) return 'javascript';
  if (p.endsWith('.css')) return 'stylesheet';
  if (p.includes('/auth/')) return 'auth';
  if (p.includes('/storage/')) return 'storage';
  return 'document/asset';
}
function spans(header) {
  return Object.fromEntries((header ?? '').split(',').filter(Boolean).map(s => {
    const [key] = s.trim().split(';');
    return [key, { durationMs: Number(/;dur=([\d.]+)/.exec(s)?.[1]), calls: /desc="(\d+) calls"/.test(s) ? Number(/desc="(\d+) calls"/.exec(s)[1]) : null }];
  }));
}
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function settle(page) { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500); }
async function measure(s, action, run, act, ready) {
  const rows = [], tracked = new Map(), active = new Set(), pending = [], start = performance.now();
  let lastWork = start, status = 'ok';
  const begin = r => {
    const row = { category: category(r, s.origin), endpoint: name(r), method: r.method(), offsetMs: performance.now() - start,
      status: null, finished: false, failed: false, serverTimingHeader: null, spans: {}, vercelId: null, executionRegion: null };
    tracked.set(r, row); rows.push(row);
    if (!/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page|performance\/vitals/.test(row.endpoint)) { active.add(r); lastWork = performance.now(); }
  };
  const response = r => {
    const row = tracked.get(r.request()); if (!row) return;
    const h = r.headers(); Object.assign(row, { status: r.status(), serverTimingHeader: h['server-timing'] ?? null,
      spans: spans(h['server-timing']), vercelId: h['x-vercel-id'] ?? null, cache: h['x-vercel-cache'] ?? null });
    if (row.category === 'vercel-function') {
      const regions = row.vercelId?.split('::').filter(part => /^[a-z]{3}\d$/.test(part)) ?? [];
      row.edgeRegion = regions[0] ?? null; row.executionRegion = regions.length > 1 ? regions.at(-1) : null;
    }
  };
  const finish = r => {
    const row = tracked.get(r); if (!row) return;
    row.finished = true; row.endMs = performance.now() - start; row.durationMs = row.endMs - row.offsetMs;
    row.browserTiming = r.timing();
    if (active.delete(r)) lastWork = performance.now();
    pending.push(r.sizes().then(size => { row.responseBytes = size.responseBodySize; row.requestBytes = size.requestBodySize; }).catch(() => {}));
    if (row.category === 'vercel-static-document' && ['javascript','stylesheet'].includes(row.endpoint)) {
      pending.push(r.response().then(response => response.body()).then(body => {
        row.assetSha256 = createHash('sha256').update(body).digest('hex');
        row.assetPath = new URL(r.url()).pathname;
      }).catch(() => { row.assetHashUnavailable = true; }));
    }
  };
  const fail = r => { const row = tracked.get(r); if (!row) return; row.failed = true; row.endMs = performance.now() - start;
    row.durationMs = row.endMs - row.offsetMs; row.failure = ['net::ERR_ABORTED','net::ERR_FAILED'].includes(r.failure()?.errorText) ? r.failure().errorText : 'other';
    if (active.delete(r)) lastWork = performance.now(); };
  s.page.on('request', begin); s.page.on('response', response); s.page.on('requestfinished', finish); s.page.on('requestfailed', fail);
  const startedAt = new Date().toISOString();
  try { await act(); await ready(); await frames(s.page); } catch { status = 'failed'; }
  const readyMs = performance.now() - start, readyRequests = rows.length;
  while ((active.size || performance.now() - lastWork < 1500) && performance.now() - start < 60000) await s.page.waitForTimeout(50);
  const quietBoundaryMs = performance.now() - start;
  s.page.off('request', begin); s.page.off('response', response); s.page.off('requestfinished', finish); s.page.off('requestfailed', fail);
  await Promise.all(pending);
  const sample = { region: s.region, profile: s.profile, run, action, startedAt, status, readyMs, readyRequests,
    lastRequestEndMs: Math.max(readyMs, ...rows.filter(r => r.category !== 'other-host' && !/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page/.test(r.endpoint)).map(r => r.endMs ?? 0)),
    quietBoundaryMs, settledRequests: rows.length, timedOut: active.size > 0,
    failures: rows.filter(r => r.failed || r.status >= 400).length, requests: rows };
  samples.push(sample); save();
  console.log(JSON.stringify({ region: s.region, profile: s.profile, run, action, status, readyMs: Math.round(readyMs), requests: rows.length, failures: sample.failures }));
  const functionRows = rows.filter(r => r.category === 'vercel-function');
  sample.regionsVerified = functionRows.every(r => r.executionRegion === (r.endpoint === '/api/sales/legal' ? s.region : 'iad1'));
  sample.displayedStateChecked = status === 'ok';
  save();
  if (status !== 'ok' || sample.timedOut || guardViolations || !sample.regionsVerified) throw Error('Diagnostic action, region or guard failed');
}
async function setup(region, profile) {
  step = `${region}.${profile}.setup`;
  const origin = deployments[region].origin, context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => { window.portalLoadTracing = true; });
  // Routing would disable browser cache, invalidating repeat-navigation tests.
  // Fail closed before browser sends unsafe requests using CDP interception.
  const page = await context.newPage(); page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }, { urlPattern: `${origin}/api/sales/*`, requestStage: 'Request' }] });
  const readRpcs = new Set();
  // The deployed code's RPC calls are recorded by name; reject known mutation
  // families. REST row writes and Storage writes are always forbidden here.
  cdp.on('Fetch.requestPaused', async event => {
    const r = event.request, u = new URL(r.url), method = r.method;
    let unsafe = u.hostname.endsWith('.supabase.co') && u.hostname !== project;
    if (u.origin === origin && u.pathname.startsWith('/api/sales/') && method !== 'GET') {
      let body; try { body = JSON.parse(r.postData ?? '{}'); } catch {}
      unsafe ||= u.pathname !== '/api/sales/legal' || method !== 'POST' || body?.action !== 'preview' || body?.sale !== previewSale.id;
    }
    if (u.hostname === project && u.pathname.includes('/rest/v1/') && !['GET','HEAD','OPTIONS'].includes(method)) {
      if (!u.pathname.includes('/rpc/')) unsafe = true;
      else { const rpc = u.pathname.split('/').at(-1); readRpcs.add(rpc);
        unsafe ||= /sales_legal_action|sales_legal_dispatch|sales_legal_prepare_email|sales_legal_expire|sales_completion_upload|sales_legal_submit_notice|sales_legal_register_document|save_|update_|delete_|insert_|approve_|confirm_|record_/.test(rpc); }
    }
    if (u.hostname === project && u.pathname.includes('/storage/') && !['GET','HEAD','OPTIONS'].includes(method)) unsafe = true;
    if (unsafe) { guardViolations++; console.log(JSON.stringify({ blocked: true, method, host: u.hostname, endpoint: u.pathname.split('/').at(-1) })); await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); }
    else await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
  });
  const observedProjects = new Set(); page.on('request', r => { const h = new URL(r.url()).hostname; if (h.endsWith('.supabase.co')) observedProjects.add(h); });
  page.on('pageerror', () => { setupRequests.push({ region, profile, type: 'pageerror' }); });
  step = `${region}.${profile}.login-page`;
  await page.goto(origin); await page.getByLabel('Email', { exact: true }).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
  step = `${region}.${profile}.sign-in`;
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  if (profile === 'mobile-throttled') { await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  step = `${region}.${profile}.sale-warmup`;
  await page.goto(`${origin}/?screen=sales&building=${building}&salesUnitId=${unit.id}`);
  await page.getByRole('button', { name: /^Completion\b/ }).waitFor(); await settle(page);
  if (observedProjects.size !== 1 || !observedProjects.has(project)) throw Error('Live staging project mismatch');
  console.log(JSON.stringify({ setup: 'ready', region, profile, guardViolations }));
  return { region, profile, origin, context, page, cdp, readRpcs, observedProjects };
}
let completed = false;
try {
  for (const profile of ['desktop','mobile-throttled']) {
    for (const region of ['iad1','fra1']) {
      sessions[`${profile}-${region}`] = await setup(region, profile);
      // Keep inactive contexts from polling staging while the other preview runs.
      await sessions[`${profile}-${region}`].page.goto('about:blank');
    }
    for (let run = 1; run <= rounds; run++) {
      const order = (run + (profile === 'mobile-throttled' ? 1 : 0)) % 2 ? ['iad1','fra1'] : ['fra1','iad1'];
      for (const region of order) {
        const s = sessions[`${profile}-${region}`], p = s.page;
        // Restore identical completed-sale/Handover state before each cold pair.
        await p.goto(`${s.origin}/?screen=sales&building=${building}&salesUnitId=${unit.id}`);
        await p.getByRole('button', { name: /^Handover\b/ }).click(); await settle(p);
        for (const mode of ['cold','repeat']) {
          if (mode === 'cold') await s.cdp.send('Network.clearBrowserCache');
          await measure(s, `navigation.${mode}`, run, () => p.reload(), () => p.getByRole('button', { name: /^Completion\b/ }).waitFor());
        }
        await measure(s, 'exchange.entry', run, () => p.getByRole('button', { name: /^Exchange\b/ }).click(), () => p.getByRole('list', { name: 'Exchange tasks', exact: true }).waitFor());
        await measure(s, 'legal.context_get', run, () => p.evaluate(async ({ sale, token }) => {
          const r = await fetch(`/api/sales/legal?sale=${encodeURIComponent(sale)}`, { headers: { Authorization: `Bearer ${token}` } });
          const body = await r.json(); if (!r.ok || !body.attempt || !body.snapshot) throw Error('Context rejected');
        }, { sale: sale.id, token }), async () => {});
        await measure(s, 'completion.entry', run, () => p.getByRole('button', { name: /^Completion\b/ }).click(), () => p.getByRole('list', { name: 'Completion tasks', exact: true }).waitFor());
        // Existing 209 is only read/previewed: no authority request or send.
        await p.goto(`${s.origin}/?screen=sales&building=${building}&salesUnitId=${previewUnit.id}`);
        await p.getByRole('button', { name: /^Exchange\b/ }).click();
        await p.getByRole('list', { name: 'Exchange tasks', exact: true }).waitFor(); await settle(p);
        const review = p.getByRole('button', { name: /^Review (reissued )?authority and email$/ });
        if (!await review.isEnabled()) throw Error('Safe UI authority preview unavailable');
        await measure(s, 'authority.preview', run, () => review.click(), () => p.getByRole('region', { name: 'Final confirmation and email preview' }).waitFor());
        await p.getByRole('region', { name: 'Final confirmation and email preview' }).getByRole('button', { name: 'Cancel', exact: true }).click(); await settle(p);
        await p.goto('about:blank');
      }
    }
    for (const region of ['iad1','fra1']) await sessions[`${profile}-${region}`].context.close();
  }
  completed = true;
} catch (error) { console.log(JSON.stringify({ stopped: true, step, errorType: error.name, message: error.message.startsWith('Diagnostic') || error.message.startsWith('Safe') ? error.message : 'Setup or browser step failed; no sensitive context saved' })); process.exitCode = 1; }
finally {
  await browser.close();
  const after = await fingerprints(), unchanged = JSON.stringify(before) === JSON.stringify(after);
  fs.writeFileSync(`${out}/verification.json`, JSON.stringify({ completed, unchanged, before, after, guardViolations, protectedNumbers, extraNumbers,
    salesMutations: 0, previewOnlyPost: true, selectedCompletedUnit: 107, previewOnlyUnit: 209, browser: browser.version(), node: process.version,
    profiles: { desktop: { width: 1280, height: 900 }, 'mobile-throttled': { width: 390, height: 844, cpu: 4, latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 } },
    setupRequests, sessions: Object.values(sessions).map(s => ({ region: s.region, profile: s.profile, stagingVerified: s.observedProjects.has(project), readRpcs: [...s.readRpcs] })) }, null, 2));
  await auth.auth.signOut(); if (!unchanged) throw Error('Staging state changed during read-only comparison');
}
