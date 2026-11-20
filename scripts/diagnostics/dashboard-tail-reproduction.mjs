// Bounded Recommendation B reproduction. No deployment or application changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { fixtures, login, hash } from './full-region-safety.mjs';

// Immutable Phase 2D staging-backed diagnostic previews, revalidated before use.
const targets = {
  a: 'https://bunnywell-portal-6anexmdtv-carl-gilbert-s-projects.vercel.app',
  b: 'https://bunnywell-portal-itw7tq7zq-carl-gilbert-s-projects.vercel.app',
};
const output = process.env.TAIL_REPRO_OUTPUT;
assert.match(output ?? '', /^test-results\/[a-zA-Z0-9_-]+\.json$/);
const rounds = Number(process.env.TAIL_REPRO_ROUNDS ?? 10);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 10);
const gapMs = Number(process.env.TAIL_REPRO_GAP_MS ?? 0);
assert.ok(Number.isInteger(gapMs) && gapMs >= 0 && gapMs <= 15000);
const normalise = value => Array.isArray(value) ? value.map(normalise) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'asOf' ? null : normalise(v)])) : value;
const existing = fs.existsSync(output);
assert.ok(!existing || process.env.TAIL_REPRO_RESUME === '1', 'Refusing to overwrite evidence');
const evidence = existing ? JSON.parse(fs.readFileSync(output, 'utf8')) : {
  started: new Date().toISOString(), targets, rounds, gapMs, samples: [], anomalies: [], sessions: [],
};
assert.deepEqual(evidence.targets, targets);
assert.equal(evidence.rounds, rounds);
assert.equal(evidence.gapMs ?? 0, gapMs);
if (evidence.stop) {
  assert.ok(process.env.TAIL_REPRO_REVIEW, 'Record investigation before resuming');
  evidence.resumptions ??= [];
  evidence.resumptions.push({ at: new Date().toISOString(), stop: evidence.stop, review: process.env.TAIL_REPRO_REVIEW });
  delete evidence.stop;
}
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const f = await fixtures();
const before = await f.fingerprints();
if (evidence.before) assert.deepEqual(before, evidence.before, 'Protected data changed between runs');
else evidence.before = before;
save();
const sessions = {};
let stopped = false;
try {
  for (const role of ['admin', 'conveyancer']) sessions[role] = await login(role);
  evidence.sessions.push({ started: new Date().toISOString(), roles: Object.keys(sessions) });
  outer: for (let run = 0; run < rounds; run++) {
    const order = Object.entries(targets); if (run % 2) order.reverse();
    for (const [variant, origin] of order) {
      // Each successful route validates Auth; denial specifically exercises the
      // Phase 2D Auth-stall path. Anonymous denial is a no-upstream control.
      for (const [mode, scope, role, expected] of [
        ['dashboard', 'all', 'admin', 200],
        ['dashboard', 'single', 'admin', 200],
        ['sales-register', run % 2 ? 'single' : 'all', 'conveyancer', 200],
        ['dashboard', 'unavailable', 'admin', 403],
        ['dashboard', 'unsigned', null, 401],
      ]) {
        const key = `${run}:${variant}:${mode}:${scope}`;
        if (evidence.samples.some(s => s.key === key)) continue;
        const endpoint = mode === 'dashboard' ? '/api/dashboard' : '/api/sales/register';
        const building = scope === 'single' ? f.building : scope === 'unavailable' ? '00000000-0000-4000-8000-000000000000' : 'all';
        const headers = role ? { authorization: `Bearer ${sessions[role].session.access_token}`, 'x-bunnywell-diagnostic': 'dashboard-tail' } : {};
        const sample = { key, run, variant, mode, scope, started: new Date().toISOString() };
        const start = performance.now();
        try {
          const response = await fetch(`${origin}${endpoint}?building=${building}`, { headers, signal: AbortSignal.timeout(90000) });
          sample.headersMs = performance.now() - start;
          sample.headersAt = new Date().toISOString();
          sample.status = response.status;
          sample.vercelId = response.headers.get('x-vercel-id');
          sample.serverTiming = response.headers.get('server-timing');
          const encoded = response.headers.get('x-bunnywell-read-trace');
          if (encoded) sample.trace = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString());
          const body = await response.text();
          sample.durationMs = performance.now() - start;
          sample.finished = new Date().toISOString();
          sample.bodyMs = sample.durationMs - sample.headersMs;
          sample.bytes = Buffer.byteLength(body);
          assert.equal(response.status, expected, 'Unexpected API status');
          assert.ok(sample.vercelId?.includes(variant === 'a' ? '::iad1::' : '::fra1::'), 'Unexpected region');
          if (expected === 200) {
            assert.ok(sample.trace && !sample.trace.truncated, 'Missing complete trace');
            assert.equal(sample.trace.region, variant === 'a' ? 'iad1' : 'fra1');
            const data = JSON.parse(body);
            if (mode === 'dashboard') assert.ok(data.sources.every(s => ['ready', 'not_permitted'].includes(s.state)), 'Incomplete sources');
            else assert.equal(data.actionsAvailable, true, 'Register incomplete');
            sample.projectionHash = hash(normalise(data));
            const previous = evidence.samples.find(s => s.mode === mode && s.scope === scope && s.projectionHash);
            if (previous) assert.equal(sample.projectionHash, previous.projectionHash, 'Content mismatch');
          } else assert.equal(encoded, null, 'Denial leaked trace');
        } catch (error) {
          sample.durationMs = performance.now() - start;
          sample.finished = new Date().toISOString();
          // Fixed classes only: never persist token-bearing URLs, bodies or errors.
          sample.error = error?.code === 'ERR_ASSERTION' ? 'validation_failed' : 'request_or_decode_failed';
        }
        evidence.samples.push(sample);
        if (sample.durationMs > 5000 || sample.error) {
          evidence.anomalies.push(key);
          evidence.stop = { key, reason: sample.error ?? 'over_5_seconds', at: sample.finished };
          stopped = true;
        }
        save();
        const slowest = sample.trace?.spans.toSorted((a, b) => (b.headers - b.start) - (a.headers - a.start))[0];
        console.log(JSON.stringify({ key, ms: Math.round(sample.durationMs), status: sample.status, slowest: slowest?.operation, readMs: slowest && Math.round(slowest.headers - slowest.start), stopped }));
        if (stopped) break outer;
      }
    }
    if (gapMs && run < rounds - 1) await new Promise(resolve => setTimeout(resolve, gapMs));
  }
} finally {
  for (const auth of Object.values(sessions)) await auth.client.auth.signOut({ scope: 'local' });
  evidence.after = await f.fingerprints();
  evidence.unchanged = JSON.stringify(evidence.before) === JSON.stringify(evidence.after);
  evidence.finished = new Date().toISOString();
  save();
  assert.equal(evidence.unchanged, true, 'Protected data changed');
}
console.log(JSON.stringify({ finished: evidence.finished, samples: evidence.samples.length, stopped, unchanged: evidence.unchanged }));
if (evidence.samples.some(sample => sample.error)) process.exitCode = 1;
