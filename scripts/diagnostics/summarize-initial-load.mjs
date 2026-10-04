import fs from 'node:fs';
const root = 'artifacts/performance/initial-load';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const range = values => [Math.min(...values), Math.max(...values)];
const nonWork = category => ['telemetry', 'polling'].includes(category);
const summary = {};
for (const label of ['instrumented-before', 'after']) {
  const samples = JSON.parse(fs.readFileSync(`${root}/${label}/samples.json`, 'utf8'));
  summary[label] = [];
  for (const profile of ['desktop', 'mobile-throttled']) for (const navigation of ['cold', 'repeat']) {
    const rows = samples.filter(row => row.profile === profile && row.navigation === navigation);
    const count = (row, predicate, ready = false) => row.requests.filter(request => (!ready || request.offsetMs <= row.readyMs) && predicate(request)).length;
    summary[label].push({ profile, navigation, n: rows.length,
      readyMedianMs: median(rows.map(row => row.readyMs)), readySlowestMs: Math.max(...rows.map(row => row.readyMs)), readyRequests: range(rows.map(row => row.readyRequests)),
      workFinishedMedianMs: median(rows.map(row => Math.max(...row.requests.filter(request => !nonWork(request.category)).map(request => request.endMs ?? request.offsetMs)))),
      quietWindowMedianMs: median(rows.map(row => row.settledMs)), settledRequests: range(rows.map(row => row.settledRequests)),
      readyCoreRequests: range(rows.map(row => count(row, request => !nonWork(request.category), true))),
      settledCoreRequests: range(rows.map(row => count(row, request => !nonWork(request.category)))),
      telemetry: range(rows.map(row => count(row, request => request.category === 'telemetry'))),
      polling: range(rows.map(row => count(row, request => request.category === 'polling'))),
      sameRequestRepeats: range(rows.map(row => count(row, request => request.duplicateOrdinal > 1 && !nonWork(request.category)))),
      tracedDataReads: range(rows.map(row => row.trace.filter(event => event.phase === 'request').length)),
      httpErrors: rows.reduce((total, row) => total + count(row, request => request.status >= 400), 0),
      browserFailures: rows.reduce((total, row) => total + count(row, request => request.failed), 0), timedOut: rows.some(row => row.timedOut),
    });
  }
  const first = samples[0];
  summary[`${label}-events`] = first.trace.filter(row => row.phase !== 'request');
  summary[`${label}-reads`] = first.trace.filter(row => row.phase === 'request').reduce((counts, row) => {
    const key = `${row.scope}:${row.event}`; counts[key] = (counts[key] ?? 0) + 1; return counts;
  }, {});
}
fs.writeFileSync(`${root}/summary.json`, JSON.stringify(summary, null, 2));
const formatRange = value => value[0] === value[1] ? String(value[0]) : value.join('–');
let markdown = '| Build | Profile | Navigation | n | Controls median / slowest | Last background work median | Requests at controls / settled | Core at controls / settled | Telemetry / polling |\n|---|---|---|---:|---:|---:|---|---|---|\n';
for (const label of ['instrumented-before', 'after']) for (const row of summary[label]) markdown += `| ${label} | ${row.profile} | ${row.navigation} | ${row.n} | ${(row.readyMedianMs / 1000).toFixed(2)} / ${(row.readySlowestMs / 1000).toFixed(2)} s | ${(row.workFinishedMedianMs / 1000).toFixed(2)} s | ${formatRange(row.readyRequests)} / ${formatRange(row.settledRequests)} | ${formatRange(row.readyCoreRequests)} / ${formatRange(row.settledCoreRequests)} | ${formatRange(row.telemetry)} / ${formatRange(row.polling)} |\n`;
markdown += '\nCore excludes Web Vitals and discussion polling. Background work ends at the last observed non-poll/non-telemetry request completion; the recording continues for 1.5 seconds of quiet. Readiness matches the October baseline: the completed sale’s Completion navigation control is visible, plus two animation frames. It does not force a function cold start.\n';
fs.writeFileSync(`${root}/measurements.md`, markdown);
console.log(markdown);
