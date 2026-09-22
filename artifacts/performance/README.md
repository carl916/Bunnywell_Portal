# Bunnywell Sales performance evidence

Assessment date: 22 September 2026. Start with [the assessment](../../docs/sales-performance-assessment.md) and [measurement tables](measurements.md).

## Evidence sets

- `staging-samples.json`: real staging workflow actions on the explicitly authorised Forum House test units 102–106. Five sale journeys: three desktop, two throttled mobile. HTTP 413 entries are failed uploads, even though the diagnostic's observation status is `ok`.
- `navigation-samples.json`: read-only cold/repeat navigation and in-app switching; five repetitions per device profile. Unit 107 is only viewed.
- `frontend-samples.json`: five desktop and five mobile journeys using deployed frontend assets and intercepted synthetic backend fixtures. These do not measure Supabase, Storage, email delivery or Vercel route execution.
- `database-query-timings.json`: cumulative PostgreSQL statement timings, including their reset/capture timestamps, operation names and counts; no SQL parameter values or returned business data.
- `database-plans.json`: read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on two representative SELECTs under application roles, plus a privileged control. Internal identifiers are redacted. The control is a diagnostic comparison, not a proposal to bypass permissions.
- `database-advisors.json`: relevant Supabase performance advisories. An advisory alone is not evidence that a new index will improve a measured query.
- `vercel-observations.json`: deployment region, log-count observations and connector limitations.
- `desktop-synthetic-trace.zip` and `mobile-throttled-synthetic-trace.zip`: Playwright screenshots, actions and network timings with synthetic data. Request bodies and authentication material are stripped. Real-account journeys never record traces, screenshots or DOM dumps.

Open a trace locally with `npx playwright show-trace artifacts/performance/desktop-synthetic-trace.zip` (or the mobile trace). Avoid uploading traces to a third-party service.

## Repeating safe frontend checks

Run `npm run perf:sales:frontend`. It uses the existing fixture sign-in pattern and intercepts workflow writes. The separate config does not start a development server. The ordinary Playwright suite excludes diagnostic tests. `SALES_PERF_RUNS` defaults to five. After a run, execute `node scripts/diagnostics/sanitize-performance-traces.mjs` before sharing traces, then `node scripts/diagnostics/summarize-sales-performance.mjs` to refresh combined tables.

The live staging script is deliberately not part of CI or an npm test command. It requires `SALES_PERF_ALLOW_STAGING_MUTATIONS=1`, the locally verified scope files in `.next/performance`, and existing environment credentials. It progresses real staging records and sends authority emails to their configured recipients. It skips completed sales but does not reset or resume a partially completed sale automatically: inspect current authority versions and state before any retry. The authorisation in this task applies only to Forum House units 102–110. Never repoint this script at production or another sale.

## Instrumentation

`NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS=1` enables allowlisted browser marks only on localhost, the staging hostname and Vercel preview hostnames. This is a build-time flag. `SALES_PERF_DIAGNOSTICS=1` enables request-scoped `Server-Timing` on the legal route outside Vercel production. Both default off; neither creates a telemetry sink or console log. The new instrumentation has not been deployed as part of this assessment.

Browser mark names are `sales:<action>:<sequence>:<phase>`. Durations run from the interaction start. Measurements retain at most the latest 100 groups, including abandoned interactions. Phases include pending feedback, preparation, request start/end, legal-context reload, Sales reload, portal reload and the final two-animation-frame paint approximation. Two frames estimate presentation; they do not measure physical display latency or field INP.

Server headers distinguish authentication, database reads/mutations, Storage upload/cleanup, email delivery, multipart parsing and file buffering. `_end` entries represent offsets from route entry. Summed service durations can exceed wall time where requests overlap. Fetch spans end at response headers and include remote network latency; PostgreSQL query statistics are the separate source for database execution time.

Only fixed action/phase labels, counts, numeric durations and byte counts are retained by the measurement code. It does not store buyers, recipients, filenames, contents, signed links or authentication tokens. Server traces remain unavailable on the deployed build until the instrumentation is deployed and explicitly enabled for staging.
