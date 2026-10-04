# Initial loading evidence

`instrumented-before-clean` and `after-final` contain the final matched, settled-warm-up measurements (five cold and five repeat navigations per desktop/mobile profile). `measurements.md` and `summary.json` summarize them. `deployments.json` identifies the immutable preview builds and starting commit. All previews use the staging database, not production.

`instrumented-before` is the exploratory before trace; its first mobile cold sample contains 14 failed Sales child reads from warm-up overlap. `after` is the first after batch on `7df733b`. These supplementary samples are retained and are not mixed into final medians.

Each raw sample has request start/end offsets, resource categories, observed HTTP status, completion/failure flags and an in-memory duplicate-comparison ordinal. Browser-local load events give scope, event label, phase, relative time and resource name. Each array element is on one line to keep raw evidence diffs compact. Nothing saves credentials, business bodies, IDs, URLs containing business parameters, cookies, screenshots or browser traces. Verification files record completed-sale preservation without persisting the queried business rows.

`lifecycle-tests.log`, `sales-tests.log`, `browser-tests.log` and `lint-comparison.json` retain validation results. Test mutations are entirely local browser/database fixtures. Live navigation diagnostics click no legal mutation controls.

Reproduce with the existing private staging diagnostic credentials in `.env.local` and the existing completed-sale scope in `.next/performance/staging-test-sales.json`:

```powershell
node scripts/diagnostics/initial-load-navigation.mjs <immutable-staging-preview-origin> <batch-label> 5
node scripts/diagnostics/summarize-initial-load.mjs instrumented-before-clean after-final
node scripts/diagnostics/compare-initial-load-lint.mjs
```

The recorder refuses production/non-scoped origins and verifies the staging Supabase project and four completed active attempts before reading. Its script contains no sale writes. Recording is performed without request interception so repeat browser cache remains enabled. Telemetry and polling have separate counts. A 1.5-second quiet grace validates settlement, while summary timing reports the last actual non-poll/non-telemetry request completion.
