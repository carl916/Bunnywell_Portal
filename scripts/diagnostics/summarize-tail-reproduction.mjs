// Offline only. Retain all samples, including threshold stops and resumptions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [output, ...inputs] = process.argv.slice(2);
assert.ok(output && inputs.length);
const batches = inputs.map(file => ({ file, ...JSON.parse(fs.readFileSync(file, 'utf8')) }));
const samples = batches.flatMap(b => b.samples.map(s => ({ batch: b.file, ...s })));
const ms = n => Math.round(n * 100) / 100;
const distribution = values => ({ n: values.length, maxMs: values.length ? ms(Math.max(...values)) : null,
  over5s: values.filter(v => v > 5000).length, over10s: values.filter(v => v > 10000).length, over20s: values.filter(v => v > 20000).length });
const groups = [];
for (const variant of ['a', 'b']) for (const [mode, scope] of [['dashboard', 'all'], ['dashboard', 'single'], ['sales-register', 'all'], ['sales-register', 'single'], ['dashboard', 'unavailable'], ['dashboard', 'unsigned']]) {
  const selected = samples.filter(s => s.variant === variant && s.mode === mode && s.scope === scope);
  const spans = selected.flatMap(s => s.trace?.spans ?? []);
  groups.push({ variant, mode, scope, client: distribution(selected.map(s => s.durationMs)),
    route: distribution(selected.filter(s => s.trace).map(s => s.trace.totalMs)),
    upstreamFetch: distribution(spans.map(s => s.headers - s.start)), errors: selected.filter(s => s.error).length,
    hashes: [...new Set(selected.map(s => s.projectionHash).filter(Boolean))] });
}
const operations = [];
for (const variant of ['a', 'b']) for (const operation of ['auth.validate', 'rental_import_runs', 'sale_workflow_context']) {
  const spans = samples.filter(s => s.variant === variant).flatMap(s => s.trace?.spans ?? []).filter(s => s.operation === operation);
  operations.push({ variant, operation, headers: distribution(spans.map(s => s.headers - s.start)), body: distribution(spans.map(s => s.bodyMs ?? 0)), service: distribution(spans.map(s => s.upstreamMs ?? 0)) });
}
const allSpans = samples.flatMap(s => s.trace?.spans ?? []);
const summary = {
  batches: batches.map(b => ({ file: b.file, started: b.started, finished: b.finished, rounds: b.rounds, gapMs: b.gapMs ?? 0, samples: b.samples.length, stop: b.stop, anomalies: b.anomalies, unchanged: b.unchanged })),
  groups, operations, sampleCount: samples.length, tracedResponses: samples.filter(s => s.trace).length,
  upstreamSpans: allSpans.length, upstreamIds: new Set(allSpans.map(s => s.requestId)).size,
  upstreamErrors: allSpans.filter(s => s.error).length, retries: allSpans.filter(s => s.retry > 0 || s.attempts > 1).length,
  maxEventLoopLagMs: ms(Math.max(...samples.filter(s => s.trace).map(s => s.trace.maxEventLoopLagMs))),
  maxBodyMs: ms(Math.max(...allSpans.map(s => s.bodyMs ?? 0))),
  anomalies: samples.filter(s => s.durationMs > 5000 || s.error).map(s => ({
    batch: s.batch, key: s.key, started: s.started, finished: s.finished, vercelId: s.vercelId,
    durationMs: ms(s.durationMs), headersMs: ms(s.headersMs), bodyMs: ms(s.bodyMs), status: s.status,
    error: s.error, traceId: s.trace?.id, routeMs: s.trace?.totalMs,
    outsideRouteMs: s.trace && ms(s.durationMs - s.trace.totalMs),
    slowest: s.trace?.spans.toSorted((a,b) => (b.headers - b.start) - (a.headers - a.start)).slice(0,3),
  })),
};
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ samples: summary.sampleCount, upstreamSpans: summary.upstreamSpans,
  anomalies: summary.anomalies.map(a => ({ batch: a.batch, key: a.key, ms: a.durationMs })) }));
