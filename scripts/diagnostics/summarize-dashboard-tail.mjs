// Offline only: rebuild the Phase 2D summaries from retained metadata.
import fs from 'node:fs';
const input = process.argv[2] ?? 'docs/phase2d-dashboard-tail/measurements.json';
const output = process.argv[3] ?? 'test-results/phase2d-summary.json';
const data = JSON.parse(fs.readFileSync(input));
const batches = [...data.dashboardBatches, data.register];
const samples = batches.flatMap(b => b.samples);
const q = (values, p) => {
  const a = [...values].sort((a, b) => a - b); if (!a.length) return null;
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
};
const stats = a => ({ n: a.length, p50: q(a, .5), p75: q(a, .75), max: a.length ? Math.max(...a) : null,
  over5s: a.filter(x => x > 5000).length, over10s: a.filter(x => x > 10000).length, over20s: a.filter(x => x > 20000).length });
const spans = samples.flatMap(x => x.trace.spans);
const summary = { requests: [], reads: [], quality: {
  samples: samples.length, allIntegrityChecks: batches.every(x => x.unchanged), retries: spans.filter(x => x.retry > 0).length,
  maxEventLoopLagMs: Math.max(...samples.map(x => x.trace.maxEventLoopLagMs)), maxActiveAtStart: Math.max(...samples.map(x => x.trace.activeAtStart)),
  maxBodyMs: Math.max(...spans.map(x => x.bodyMs ?? 0)), checks: batches.flatMap(x => x.checks).length, errors: spans.filter(x => x.error).length,
} };
for (const mode of ['dashboard', 'sales-register']) for (const scope of ['all', 'single']) for (const variant of ['a', 'b']) {
  const s = samples.filter(x => x.mode === mode && x.scope === scope && x.variant === variant);
  summary.requests.push({ mode, scope, variant, api: stats(s.map(x => x.durationMs)), server: stats(s.map(x => x.trace.totalMs)),
    maxBodyMs: Math.max(...s.flatMap(x => x.trace.spans).map(x => x.bodyMs ?? 0)), reads: s.map(x => x.trace.spans.length) });
}
for (const mode of ['dashboard', 'sales-register']) for (const variant of ['a', 'b']) {
  const s = samples.filter(x => x.mode === mode && x.variant === variant).flatMap(x => x.trace.spans);
  for (const key of [...new Set(s.map(x => x.stage + '/' + x.operation))]) {
    const a = s.filter(x => x.stage + '/' + x.operation === key);
    summary.reads.push({ mode, variant, key, headers: stats(a.map(x => x.headers - x.start)), body: stats(a.map(x => x.bodyMs ?? 0)),
      upstream: stats(a.filter(x => x.upstreamMs !== undefined).map(x => x.upstreamMs)) });
  }
}
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.quality));
