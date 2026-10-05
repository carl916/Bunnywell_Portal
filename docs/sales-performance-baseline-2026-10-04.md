# Pre-optimisation staging baseline — 4 October 2026

Captured on deployed commit `b883040b9bfc7b66084d1c4af73c13a179af578b`, deployment `dpl_5hFWn1r6y1FW7VjbwVgcixBFt9GR` ([deployment](https://bunnywell-portal-i0gxaiq18-carl-gilbert-s-projects.vercel.app)), through [staging.bunnywell.co.uk](https://staging.bunnywell.co.uk/). Vercel reports region `iad1`; the browser verified the staging Supabase project. This is the baseline after prompt 8, before further optimisation. No application code, index, permission, environment flag or deployment was changed in this task.

Read alongside the [22 September report](sales-performance-assessment.md). All four new sale journeys succeeded, including both larger upload cases that previously failed with HTTP 413. These builds also differ in the intervening completion/upload functionality; this comparison does not isolate the cost of prompt 8 or demonstrate an optimisation effect.

## Conditions and samples

- Desktop: headless Chromium 149.0.7827.55, 1280 × 900, ordinary connection.
- Throttled mobile: same Chromium, 390 × 844, CPU slowdown 4×, latency 150 ms, download 200,000 bytes/s (1.6 Mbps), upload 93,750 bytes/s (0.75 Mbps). These match the September settings; they are emulated profiles on this Windows computer.
- Workflow: **n=2 desktop / n=2 mobile**, fresh empty authorised Forum House drafts 107–110, prepared using the normal reservation API. The September workflow had n=3 / n=2. Only four unused drafts remained in the documented authorised 102–110 scope, so no fifth sale was reset or taken outside that scope. Completed diagnostic sales 102–106 were excluded from mutations. The four new test sales remain completed; do not rerun mutations on them.
- Read-only navigation: **n=5 / n=5** on newly completed test sale 107, switching from sale 110's Reservation stage. Sale 110 had already been prepared, so its Reservation stage was explicitly selected before the measured switch. Workflow navigation is supplementary and kept separate.
- Run window: 2026-10-04T18:39:48.715Z to 2026-10-04T19:05:42.019Z (UTC). One browser diagnostic process ran at a time: first desktop workflow, navigation, then remaining desktop/mobile workflows. No builds, frontend suites, database plans/advisors or log queries ran alongside measured journeys. Normal desktop applications remained open; the staging service was not reserved against ordinary traffic.
- Cold navigation clears the Chromium cache just before reload; repeat retains it. This does not force a Vercel function cold start. Synthetic PDFs are exactly 1 MiB, 5 MiB or 10 MiB minus 1 KiB each, matching September. Files are selected from disk before upload timing begins.

## Short comparison

Desktop / mobile are shown in that order. Times are medians; counts are ranges of requests initiated during each action. Detailed [measurements](../artifacts/performance/2026-10-04-pre-optimisation/measurements.md) also show the September-compatible count of finished non-vitals requests, slowest times, browser/HTTP failures and response bytes.

| Action | 22 Sep median D / M | 4 Oct median D / M | 4 Oct requests D / M | Outcome |
|---|---:|---:|---:|---|
| Open another sale | 0.03 s / 0.07 s | 0.03 s / 0.07 s | 1–17 / 0–1 | Success |
| Cold page → sale controls | 2.09 s / 7.82 s | 2.30 s / 7.91 s | 101–117 / 101–117 | Success |
| Repeat page → sale controls | 1.91 s / 4.81 s | 1.91 s / 4.81 s | 109–117 / 101–108 | Success |
| Enter Exchange | 4.38 s / 1.90 s | 1.35 s / 1.44 s | 3 / 3 | Success |
| Authority preview | 0.85 s / 0.85 s | 1.08 s / 0.84 s | 1 / 1 | Success |
| Request authority | 5.45 s / 6.75 s | 4.65 s / 5.47 s | 39 / 38 | Success |
| Issue authority | 5.43 s / 5.49 s | 4.43 s / 5.26 s | 38 / 37 | Success |
| Record exchange | 4.43 s / 5.22 s | 3.91 s / 5.00 s | 37 / 37 | Success |
| Exchange → Completion | 0.03 s / 0.07 s | 0.03 s / 0.06 s | 0 / 0 | Success |
| Upload one 1 MiB PDF | 7.78 s / 19.07 s | 10.30 s / 20.10 s | 40 / 40–41 | Success |
| Upload two 1 MiB PDFs | 9.91 s / 30.87 s | 14.65 s / 34.52 s | 40–41 / 43–44 | Success |
| Upload two 5 MiB PDFs | 11.81 s / 112.31 s | 23.86 s / 125.38 s | 41–42 / 48 | Success; 22 Sep HTTP 413 |
| Upload two near-10 MiB PDFs | 24.33 s / 224.24 s | 37.82 s / 238.69 s | 46 / 59 | Success; 22 Sep HTTP 413 |
| Approve documents | 3.96 s / 5.77 s | 3.64 s / 5.25 s | 38 / 37 | Success |
| Record completion | 4.93 s / 8.86 s | 4.40 s / 5.50 s | 38–39 / 37–38 | Success |

There were **0 workflow failures** and **0 HTTP errors during measured workflows**. Reload windows contain browser request failures and unfinished reads/telemetry; those are retained, rather than counted as successful requests or hidden. A 204 received before the browser reports a request failure is still evidence of receiver acceptance. The new request count convention includes such requests, whereas September counted completed requests only. Telemetry and overlapping restore/poll requests are identified separately in raw rows. Response sizes are compressed body bytes where available, with nulls for missing sizes; totals are not a complete byte census when requests remain unfinished.

Workflow timing starts at the captured button click and ends at the success notification/selected-file reset plus two animation frames. Upload timing waits for finalisation and final success, not the prepare response. Navigation ends at visible sale controls, using wall time from reload initiation; September used time since the replacement document's time origin. This small boundary difference, fresh fixture data, browser revision and the September report's concurrent diagnostics limit fine-grained comparisons. Background restore reads can still overlap the next action, as in the original journeys.

## Server timing and Web Vitals

Raw request rows retain the complete `Server-Timing` header and parsed durations, call counts and completion offsets. [Phase summaries](../artifacts/performance/2026-10-04-pre-optimisation/server-timing-summary.json) distinguish context GETs, ordinary mutations, upload preparation and finalisation. Observed new spans include `body_read`, `json_parse`, `multipart_parse`, `file_prepare`, `upload_prepare`, `storage_read`, `storage_verify` and `finalization`, alongside `route`, auth, database, Storage write/cleanup and email spans where those phases execute. Parent verification/finalisation spans overlap child spans: do not add them. Direct PDF transfer enters Storage, not Next.js, so its duration belongs to browser Storage requests, not an invented server inbound-transfer phase.

Browser evidence contains **274 allowlisted payloads**, with **132 observed 204 responses**, 142 without an observed response, and bodies of 58–90 bytes. All bodies use only `metric`, `value`, `rating`, `route`; observed metrics are TTFB, LCP, INP, CLS. Query/hash checks emitted only `portal`, `request-access`, and `other`. A bounded runtime query returned 100 log entries, all with permitted payloads and all four metrics; it includes repeated connector rows, so that count is not distinct navigations. Browser unloads often prevent observing the collector response; runtime logs still show received INP/CLS records. Null browser status is not proof of lost delivery. Route-label checks and runtime confirmation are saved in the [telemetry evidence](../artifacts/performance/2026-10-04-pre-optimisation/web-vitals-runtime-observation.json). No cookies, authorisation or referrer headers were observed on collector requests. Local evidence metadata (profile/time) is outside the transmitted four-field payload; initial login records labelled admin/agent/conveyancer are unthrottled setup observations.

**Web Vitals are an initial observation, not a reliable field baseline.** These are controlled browser samples plus a limited runtime-log observation. There is insufficient identifiable real traffic to establish field distributions, and the collector intentionally has no device/session/metric IDs, so callbacks cannot be deduplicated into exact navigations. No field p75 or standard CLS comparison with September is claimed: the original report had neither field INP nor valid standard CLS. Page metrics also do not measure legal-action readiness or upload completion.

Raw [workflow samples](../artifacts/performance/2026-10-04-pre-optimisation/workflow-samples.json), [navigation samples](../artifacts/performance/2026-10-04-pre-optimisation/navigation-samples.json), [browser vitals](../artifacts/performance/2026-10-04-pre-optimisation/web-vitals-browser.json), [deployment identity](../artifacts/performance/2026-10-04-pre-optimisation/deployment.json) and [evidence README](../artifacts/performance/2026-10-04-pre-optimisation/README.md) are retained beside the original evidence. No real-account trace, screenshot, DOM dump, request/response business body, signed URL, credential or PDF content is saved.
