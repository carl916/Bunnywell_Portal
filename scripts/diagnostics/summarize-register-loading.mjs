import fs from 'node:fs';
const quantile = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a,b) => a-b), at=(sorted.length-1)*p; return sorted.length ? sorted[Math.floor(at)]+(sorted[Math.ceil(at)]-sorted[Math.floor(at)])*(at%1) : null; };
export const stats = values => ({ n: values.filter(Number.isFinite).length, median: quantile(values,.5), p75: quantile(values,.75), min: quantile(values,0), max: quantile(values,1) });
const timing = header => Object.fromEntries((header ?? '').split(',').map(item => [item.trim().split(';')[0], Number(/;dur=([\d.]+)/.exec(item)?.[1])]));
if (process.argv[2]) {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const groups = [];
  for (const variant of Object.keys(data.targets)) for (const mobile of [false,true]) for (const action of ['open','refresh']) {
    const selected = data.samples.filter(s => s.variant===variant && s.mobile===mobile && s.action===action); if (!selected.length) continue;
    const api = selected.map(s=>s.api[0]);
    groups.push({ variant, mobile, action, readyMs: stats(selected.map(s=>s.readyMs)), apiMs: stats(api.map(s=>s.durationMs)),
      routeMs: stats(api.map(s=>timing(s.serverTiming).route)), authMs: stats(api.map(s=>timing(s.serverTiming).auth)),
      remoteDbSumMs: stats(api.map(s=>timing(s.serverTiming).db_read)), lastDbEndMs: stats(api.map(s=>timing(s.serverTiming).db_read_end)),
      requestStartMs: stats(selected.flatMap(s=>s.requestOffsets ?? [])),
      bytes: [...new Set(api.map(s=>s.bytes))], counts: [...new Set(api.map(s=>s.rowCount))],
      projectionHashes: [...new Set(api.map(s=>s.projectionHash).filter(Boolean))],
      regions: [...new Set(api.map(s=>s.region?.split('::')[1]))],
      upstream: [...new Set(api.map(s=>[...s.serverTiming.matchAll(/desc="(\d+) calls"/g)].reduce((n,m)=>n+Number(m[1]),0)))] });
  }
  console.log(JSON.stringify({ groups, errors: data.errors }, null, 2));
}
