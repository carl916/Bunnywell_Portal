// Read-only, caller-JWT dashboard measurements. Never persists credentials or records.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';

const envFile = process.env.STAGE2_ENV_FILE ?? '.env.local';
dotenv.config({ path: envFile, quiet: true });
assert.equal(process.env.STAGE2_STAGING, '1', 'Explicit staging opt-in required');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'https://vxkpvdtrldwwqiddoyof.supabase.co');
const output = process.env.STAGE2_OUTPUT;
assert.ok(output?.startsWith('test-results/'), 'Use ignored test-results output');
assert.ok(!fs.existsSync(output), 'Refusing to overwrite evidence');
const origin = process.env.STAGE2_ORIGIN;
if (origin) assert.equal(origin, 'https://staging.bunnywell.co.uk');
const preview = process.env.STAGE2_PREVIEW_ORIGIN;
if (preview) {
  assert.ok(origin, 'Preview comparison requires the deployed staging baseline');
  assert.match(preview, /^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/);
  // Verify the public build uses staging before sending the staging user's JWT.
  const response = await fetch(preview, { redirect: 'error' }); assert.ok(response.ok);
  const html = await response.text(), hosts = new Set();
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const url = new URL(match[1], preview); assert.equal(url.origin, preview);
    const script = await (await fetch(url)).text();
    for (const host of script.matchAll(/https:\/\/[a-z]+\.supabase\.co/g)) hosts.add(host[0]);
  }
  assert.deepEqual([...hosts], ['https://vxkpvdtrldwwqiddoyof.supabase.co']);
}
const rounds = Number(process.env.STAGE2_ROUNDS ?? 5);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 20);
// This harness is a local process, not a deployment. Enable the existing guarded
// observer here only after checking the staging backend; never changes remote flags.
if (!origin) Object.assign(process.env, { VERCEL_ENV: 'preview', SALES_PERF_DIAGNOSTICS: '1', DASHBOARD_READ_DIAGNOSTICS: '1' });
const normalise = (v, key = '') => key === 'asOf' ? null : Array.isArray(v)
  ? (key === 'sources' ? [...v].sort((a,b) => a.key.localeCompare(b.key)) : v).map(x => normalise(x))
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalise(v[k], k)])) : v;
const hash = value => createHash('sha256').update(JSON.stringify(normalise(value))).digest('hex');
function historicalReader(ref) {
  assert.match(ref, /^[a-f0-9]{7,40}$/);
  const source = execFileSync('git', ['show', `${ref}:src/lib/dashboard/read.ts`], { encoding: 'utf8' });
  const imports = {
    '../sales/permissions': loadTypescriptModule('src/lib/sales/permissions.ts'),
    '../sales/fee-portfolio-data': loadTypescriptModule('src/lib/sales/fee-portfolio-data.ts'),
    '../portal-access-snapshot': loadTypescriptModule('src/lib/portal-access-snapshot.ts'),
    './pagination': loadTypescriptModule('src/lib/dashboard/pagination.ts'),
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => {
    assert.ok(imports[name], `Unexpected baseline dependency: ${name}`); return imports[name];
  }, mod, mod.exports);
  return mod.exports;
}
const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { dashboardResponse } = loadTypescriptModule('src/lib/dashboard/response.ts');
let completeInput;
function localHandler(reader) {
  return loadTypescriptModule('src/app/api/dashboard/route.ts', { overrides: {
    ...(reader ? { '@/lib/dashboard/read': reader } : {}),
    '@/lib/dashboard/response': { dashboardResponse(input) {
      completeInput = input;
      return dashboardResponse(input);
    } },
  } }).GET;
}
const variants = origin ? (preview ? { baseline: origin, current: preview } : { deployed: origin }) : {
  ...(process.env.STAGE2_BASELINE ? { baseline: localHandler(historicalReader(process.env.STAGE2_BASELINE)) } : {}),
  current: localHandler(),
};
const evidence = { environment: origin ? (preview ? 'Deployed staging versus verified branch preview HTTPS' : 'Deployed staging HTTPS') : 'Local Node handler, live staging Supabase (not Vercel latency)', baseline: process.env.STAGE2_BASELINE ?? null, targets: origin ? { baseline: origin, ...(preview ? { current: preview } : {}) } : undefined, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), samples: [] };
fs.mkdirSync(path.dirname(output), { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = await client.auth.signInWithPassword({ email: process.env.PLAYWRIGHT_ADMIN_EMAIL, password: process.env.PLAYWRIGHT_ADMIN_PASSWORD });
assert.ok(!auth.error && auth.data.session, 'Staging reviewer sign-in failed');
try {
  const profile = await client.from('profiles').select('role,active').eq('id', auth.data.user.id).single();
  assert.equal(profile.data?.role, 'admin'); assert.equal(profile.data?.active, true);
  const building = await client.from('buildings').select('id').eq('name', 'Forum House').single();
  assert.ok(building.data?.id, 'Authorised single-building fixture unavailable');
  const headers = { authorization: `Bearer ${auth.data.session.access_token}`, 'x-bunnywell-diagnostic': 'dashboard-tail' };
  for (let run = 0; run < rounds; run++) {
    const order = Object.entries(variants); if (run % 2) order.reverse();
    for (const scope of ['all', 'single']) for (const [variant, handler] of order) {
      const request = new Request(`${typeof handler === 'string' ? handler : 'http://local'}/api/dashboard?building=${scope === 'all' ? 'all' : building.data.id}`, { headers });
      completeInput = undefined;
      const start = performance.now();
      const response = typeof handler === 'function' ? await handler(request) : await fetch(request, { signal: AbortSignal.timeout(20000) });
      const text = await response.text(), durationMs = performance.now() - start;
      assert.equal(response.status, 200, 'Dashboard request failed; body withheld');
      let completeSnapshotHash;
      if (completeInput) { const full = deriveDashboard(completeInput); full.overview = deriveInternalOverview(completeInput, full); completeSnapshotHash = hash(full); }
      const body = JSON.parse(text), encoded = response.headers.get('x-bunnywell-read-trace');
      const trace = encoded ? JSON.parse(gunzipSync(Buffer.from(encoded, 'base64'))) : null;
      const sample = { run, variant, scope, durationMs, bytes: Buffer.byteLength(text), items: body.items?.length, hash: hash(body), completeSnapshotHash, sources: body.sources?.map(s => ({ key: s.key, state: s.state })).sort((a,b) => a.key.localeCompare(b.key)), serverTiming: response.headers.get('server-timing'), trace };
      evidence.samples.push(sample); save();
      console.log(JSON.stringify({ run, variant, scope, ms: Math.round(durationMs), calls: trace?.spans.length, bytes: sample.bytes, complete: sample.sources.every(s => s.state !== 'unavailable') }));
      assert.ok(sample.sources.every(s => s.state !== 'unavailable'), 'Incomplete source; retained evidence');
      const previous = evidence.samples.find(s => s.scope === scope);
      assert.equal(sample.hash, previous.hash, 'Authorised snapshot changed; investigate before comparing');
      assert.equal(sample.completeSnapshotHash, previous.completeSnapshotHash, 'Complete authorised snapshot changed');
      assert.ok(durationMs < 10000, 'Stop to investigate a response above 10 seconds');
    }
  }
} finally {
  await client.auth.signOut({ scope: 'local' });
  evidence.finished = new Date().toISOString(); save();
}
