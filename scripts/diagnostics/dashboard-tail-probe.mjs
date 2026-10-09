// Sequential, read-only Phase 2D batches. Stops for investigation after any >10s response.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { fixtures, login, verifyOrigin, hash } from './full-region-safety.mjs';

const targets = JSON.parse(process.env.FULL_REGION_TARGETS);
assert.deepEqual(Object.keys(targets).sort(), ['a', 'b']);
Object.values(targets).forEach(verifyOrigin);
const output = process.env.PHASE2D_OUTPUT;
assert.ok(output?.startsWith('test-results/'), 'Use an ignored test-results output path');
const mode = process.env.PHASE2D_MODE ?? 'dashboard';
assert.ok(['dashboard', 'sales-register'].includes(mode));
const rounds = Number(process.env.PHASE2D_ROUNDS ?? 5);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 10);
const roundStart = Number(process.env.PHASE2D_START ?? 0);
const f = await fixtures();
const normalise = value => Array.isArray(value) ? value.map(normalise) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'asOf' ? null : normalise(v)])) : value;
const evidence = fs.existsSync(output) && process.env.PHASE2D_RESUME === '1' ? JSON.parse(fs.readFileSync(output)) : { mode, started: new Date().toISOString(), samples: [], checks: [], before: await f.fingerprints() };
if (fs.existsSync(output) && process.env.PHASE2D_RESUME !== '1') throw Error('Refusing to replace existing evidence');
assert.equal(evidence.mode, mode);
if (process.env.PHASE2D_RESUME === '1') delete evidence.stop;
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const auth = await login(mode === 'dashboard' ? 'admin' : 'conveyancer');
const headers = { authorization: `Bearer ${auth.session.access_token}`, 'x-bunnywell-diagnostic': 'dashboard-tail' };
const endpoint = mode === 'dashboard' ? '/api/dashboard' : '/api/sales/register';
let stopped = false;
try {
  outer: for (let run = roundStart; run < roundStart + rounds; run++) {
    const order = Object.entries(targets); if (run % 2) order.reverse();
    for (const [variant, origin] of order) for (const scope of ['all', 'single']) {
      if (evidence.samples.some(s => s.run === run && s.variant === variant && s.scope === scope)) continue;
      const start = performance.now();
      const response = await fetch(`${origin}${endpoint}?building=${scope === 'all' ? 'all' : f.building}`, { headers, signal: AbortSignal.timeout(90000) });
      const headersMs = performance.now() - start;
      const text = await response.text(), durationMs = performance.now() - start;
      assert.equal(response.status, 200, `Unexpected ${variant} status ${response.status}`);
      assert.ok(response.headers.get('content-type')?.includes('application/json'), 'Deployment did not return API JSON; verify READY before probing');
      let data;
      try { data = JSON.parse(text); } catch { throw Error('Invalid API JSON; response body withheld'); }
      const region = response.headers.get('x-vercel-id');
      assert.ok(region?.includes(variant === 'a' ? '::iad1::' : '::fra1::'), 'Unverified function execution region');
      const encoded = response.headers.get('x-bunnywell-read-trace');
      assert.ok(encoded, 'Missing authorised diagnostic trace');
      const trace = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString());
      assert.equal(trace.truncated, false);
      assert.equal(trace.region, variant === 'a' ? 'iad1' : 'fra1');
      if (mode === 'dashboard') assert.ok(data.sources.every(s => s.state === 'ready' || s.state === 'not_permitted'), 'Incomplete source');
      else assert.equal(data.actionsAvailable, true, 'Register did not load completely');
      const projectionHash = hash(normalise(data));
      const previous = evidence.samples.find(s => s.scope === scope);
      if (previous) assert.equal(projectionHash, previous.projectionHash, 'Response content changed');
      const sample = { mode, run, variant, scope, durationMs, headersMs, bytes: Buffer.byteLength(text), status: response.status,
        region, serverTiming: response.headers.get('server-timing'), projectionHash, sources: data.sources?.map(s => ({ key: s.key, state: s.state })), actionsAvailable: data.actionsAvailable, trace };
      evidence.samples.push(sample); save();
      const slowest = [...trace.spans].sort((a, b) => (b.headers - b.start) - (a.headers - a.start))[0];
      console.log(JSON.stringify({ run, variant, scope, ms: Math.round(durationMs), slowest: slowest.operation, readMs: Math.round(slowest.headers - slowest.start), reads: trace.spans.length }));
      if (durationMs > 10000) { stopped = true; evidence.stop = { reason: 'Investigate >10s response before resuming', traceId: trace.id }; break outer; }
    }
  }
  // No live mutation routes. Check anonymous denial and unavailable building scope.
  if (!stopped) for (const [variant, origin] of Object.entries(targets)) {
    for (const [name, building, requestHeaders, expected] of [['unsigned', 'all', {}, 401], ['unavailable-building', '00000000-0000-4000-8000-000000000000', headers, 403]]) {
      const checkStarted = performance.now();
      const response = await fetch(`${origin}${endpoint}?building=${building}`, { headers: requestHeaders, signal: AbortSignal.timeout(90000) });
      await response.arrayBuffer(); assert.equal(response.status, expected);
      assert.equal(response.headers.get('x-bunnywell-read-trace'), null);
      const durationMs = performance.now() - checkStarted;
      evidence.checks.push({ variant, name, status: response.status, durationMs }); save();
      if (durationMs > 10000) { evidence.stop = { reason: 'Investigate slow security check', variant, name }; stopped = true; break; }
    }
    if (stopped) break;
  }
} finally {
  console.log(JSON.stringify({ phase: 'signout-and-integrity', samples: evidence.samples.length, checks: evidence.checks.length }));
  await auth.client.auth.signOut({ scope: 'local' });
  evidence.after = await f.fingerprints(); evidence.unchanged = JSON.stringify(evidence.before) === JSON.stringify(evidence.after);
  evidence.finished = new Date().toISOString(); save(); assert.equal(evidence.unchanged, true);
}
console.log(JSON.stringify({ samples: evidence.samples.length, stopped, unchanged: evidence.unchanged }));
