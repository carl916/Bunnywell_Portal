// Read-only extension of PR #46 scripts/diagnostics/dashboard-stage2.mjs.
// Run from the clean PR #46 snapshot. No records, JWTs or credentials are saved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const { loadTypescriptModule } = await import(pathToFileURL(path.resolve('tests/helpers/load-typescript-module.mjs')));
const config = dotenv.parse(fs.readFileSync(process.env.RETEST_ENV_FILE));
const database = 'https://vxkpvdtrldwwqiddoyof.supabase.co';
assert.equal(config.NEXT_PUBLIC_SUPABASE_URL, database);
assert.equal(process.env.RETEST_STAGING, '1');
const baselineSha = '40f42595908aa0d49b4dc94ab68dcbeee6587d02';
const candidateSha = '62b963385129b52fa5c06a82fedff071c78ff973';
const origins = { baseline: 'https://staging.bunnywell.co.uk', current: 'https://bunnywell-portal-minhksv0f-carl-gilbert-s-projects.vercel.app' };
const local = process.env.RETEST_MODE === 'local';
const role = process.env.RETEST_ROLE ?? 'admin';
assert.ok(['admin', 'contractor', 'resident'].includes(role));
const rounds = Number(process.env.RETEST_ROUNDS ?? 20);
const orderOffset = Number(process.env.RETEST_ORDER_OFFSET ?? 0);
assert.ok([0,1].includes(orderOffset));
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20);
const output = path.resolve(process.env.RETEST_OUTPUT);
assert.ok(output.includes(`${path.sep}test-results${path.sep}`));
assert.ok(!fs.existsSync(output), 'Never overwrite evidence');
const evidence = { started: new Date().toISOString(), mode: local ? 'local handler/live staging DB; not Vercel latency' : 'deployed HTTPS', role, baselineSha, candidateSha, deployedCandidateSha: '6ab3b69338da184dbb36e9951c27f4c2f1aad24d', databaseProject: 'vxkpvdtrldwwqiddoyof', rounds, warmupRounds: 2, singleBuilding: 'Forum House', normalisation: 'asOf only; sources array sorted by key; object keys canonicalised; all business arrays retain order', targets: local ? undefined : origins, preflight: [], samples: [], checks: [] };
fs.mkdirSync(path.dirname(output), { recursive: true });
evidence.orderOffset = orderOffset;
evidence.scopeOrder = orderOffset ? ['single', 'all'] : ['all', 'single'];
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const rawFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
  assert.ok([database, ...Object.values(origins)].includes(url.origin), 'Unexpected host blocked');
  return rawFetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(20000) });
};
// Verify both public builds before any staging JWT is sent to a deployment.
if (!local) for (const [variant, origin] of Object.entries(origins)) {
  const response = await fetch(origin); assert.ok(response.ok);
  const html = await response.text(), hosts = new Set();
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const url = new URL(match[1], origin); assert.equal(url.origin, origin);
    const script = await (await fetch(url)).text();
    for (const host of script.matchAll(/https:\/\/[a-z]+\.supabase\.co/g)) hosts.add(host[0]);
  }
  assert.deepEqual([...hosts], [database]);
  evidence.preflight.push({ variant, publicBuildDatabaseVerified: true });
}
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: database, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY });
if (local) Object.assign(process.env, { VERCEL_ENV: 'preview', SALES_PERF_DIAGNOSTICS: '1', DASHBOARD_READ_DIAGNOSTICS: '1' });
const normalise = (v, key = '') => key === 'asOf' ? null : Array.isArray(v)
  ? (key === 'sources' ? [...v].sort((a,b) => a.key.localeCompare(b.key)) : v).map(x => normalise(x))
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalise(v[k], k)])) : v;
const hash = value => createHash('sha256').update(JSON.stringify(normalise(value))).digest('hex');
function historicalReader() {
  const source = execFileSync('git', ['show', `${baselineSha}:src/lib/dashboard/read.ts`], { encoding: 'utf8' });
  const imports = {
    '../sales/permissions': loadTypescriptModule('src/lib/sales/permissions.ts'),
    '../sales/fee-portfolio-data': loadTypescriptModule('src/lib/sales/fee-portfolio-data.ts'),
    '../portal-access-snapshot': loadTypescriptModule('src/lib/portal-access-snapshot.ts'),
    './pagination': loadTypescriptModule('src/lib/dashboard/pagination.ts'),
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => { assert.ok(imports[name]); return imports[name]; }, mod, mod.exports);
  return mod.exports;
}
const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { dashboardResponse } = loadTypescriptModule('src/lib/dashboard/response.ts');
let completeInput;
function handler(reader) {
  return loadTypescriptModule('src/app/api/dashboard/route.ts', { overrides: {
    ...(reader ? { '@/lib/dashboard/read': reader } : {}),
    '@/lib/dashboard/response': { dashboardResponse(input) { completeInput = input; return dashboardResponse(input); } },
  } }).GET;
}
const variants = local ? { baseline: handler(historicalReader()), current: handler() } : origins;
const client = createClient(database, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = await client.auth.signInWithPassword({ email: config[`PLAYWRIGHT_${role.toUpperCase()}_EMAIL`], password: config[`PLAYWRIGHT_${role.toUpperCase()}_PASSWORD`] });
assert.ok(!auth.error && auth.data.session, 'Existing staging sign-in failed; details withheld');
try {
  const profile = await client.from('profiles').select('role,active').eq('id', auth.data.user.id).single();
  assert.equal(profile.data?.role, role); assert.equal(profile.data?.active, true);
  const building = await client.from('buildings').select('id').eq('name', 'Forum House').maybeSingle();
  if (role === 'admin') assert.ok(building.data?.id);
  const headers = { authorization: `Bearer ${auth.data.session.access_token}`, 'x-bunnywell-diagnostic': 'dashboard-tail' };
  async function call(target, query, callHeaders = headers) {
    const request = new Request(`${typeof target === 'string' ? target : 'http://local'}/api/dashboard${query}`, { headers: callHeaders });
    return typeof target === 'function' ? target(request) : fetch(request);
  }
  // Negative checks use existing identity or no credentials; never alter memberships.
  for (const [variant, target] of Object.entries(variants)) for (const [name, query, h, expected] of [
    ['unauthenticated', '?building=all', {}, 401],
    ['invalid-token', '?building=all', { authorization: 'Bearer invalid-test-token' }, 401],
    ['malformed-building', '?building=invalid', headers, 400],
    ['unsupported-filter', '?building=all&unit=unsupported', headers, 400],
    ['inaccessible-building', '?building=00000000-0000-4000-8000-000000000000', headers, role === 'resident' ? 403 : 403],
  ]) {
    const response = await call(target, query, h), body = await response.json();
    evidence.checks.push({ variant, name, expected, status: response.status, hash: hash(body), exposesItems: Object.hasOwn(body, 'items') }); save();
    assert.equal(response.status, expected, name); assert.ok(!Object.hasOwn(body, 'items'));
  }
  if (role === 'resident') {
    for (const [variant, target] of Object.entries(variants)) { const response = await call(target, '?building=all'); const body = await response.json(); evidence.checks.push({ variant, name: 'unsupported-role', status: response.status, hash: hash(body), exposesItems: Object.hasOwn(body, 'items') }); assert.equal(response.status,403); assert.ok(!Object.hasOwn(body, 'items')); }
  } else for (let run = -2; run < rounds; run++) {
    const order = Object.entries(variants); if (Math.abs(run + orderOffset) % 2) order.reverse();
    for (const scope of building.data?.id ? evidence.scopeOrder : ['all']) for (const [variant, target] of order) {
      completeInput = undefined;
      const start = performance.now();
      const response = await call(target, `?building=${scope === 'all' ? 'all' : building.data.id}`);
      const text = await response.text(), durationMs = performance.now() - start;
      assert.equal(response.status, 200, 'Dashboard failed; body withheld');
      let completeSnapshotHash;
      if (completeInput) { const full = deriveDashboard(completeInput); full.overview = deriveInternalOverview(completeInput, full); completeSnapshotHash = hash(full); }
      const body = JSON.parse(text), encoded = response.headers.get('x-bunnywell-read-trace');
      const rawTrace = encoded ? JSON.parse(gunzipSync(Buffer.from(encoded, 'base64'))) : null;
      const trace = rawTrace ? { totalMs: rawTrace.totalMs, region: rawTrace.region, truncated: rawTrace.truncated, stages: rawTrace.stages, spans: rawTrace.spans.map(s => Object.fromEntries(Object.entries(s).filter(([k])=> !['requestId','ray'].includes(k)))) } : null;
      const sample = { run, warmup: run < 0, variant, scope, durationMs, status: response.status, bytes: Buffer.byteLength(text), items: body.items?.length, hash: hash(body), completeSnapshotHash, sources: body.sources?.map(s=>({key:s.key,state:s.state})).sort((a,b)=>a.key.localeCompare(b.key)), serverTiming: response.headers.get('server-timing'), cacheControl: response.headers.get('cache-control'), cache: response.headers.get('x-vercel-cache'), trace };
      evidence.samples.push(sample); save();
      console.log(JSON.stringify({ run, variant, scope, ms: Math.round(durationMs), bytes: sample.bytes }));
      assert.ok(sample.sources.every(s => s.state !== 'unavailable'), 'Incomplete source; retained evidence');
      const previous = evidence.samples.find(s => s.scope === scope);
      assert.equal(sample.hash, previous.hash, 'Authorised response changed; stop for investigation');
      assert.equal(sample.completeSnapshotHash, previous.completeSnapshotHash, 'Complete snapshot changed');
      assert.ok(durationMs < 10000, 'Stop on >10s response');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
} finally {
  await client.auth.signOut({ scope: 'local' });
  evidence.finished = new Date().toISOString(); save();
}
