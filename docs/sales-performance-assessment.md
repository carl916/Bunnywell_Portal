# Sales and conveyancing performance assessment

22 September 2026 · [staging.bunnywell.co.uk](https://staging.bunnywell.co.uk/) · deployed commit `e70c840cec437ba3e80ccf74d6e128deae92dd65`

The clearest problems are oversized uploads that fail after transferring their bodies, repeated initial data loading, and broad serial reloads after small workflow updates. The interface normally acknowledges clicks promptly. Once loaded, switching sales or moving from Exchange to Completion is fast. PostgreSQL permission evaluation contributes to building-wide reads, but the legal mutation RPCs themselves are much shorter than the user-visible delay.

Only opt-in instrumentation and diagnostic tests were added. There are no performance optimisations, index changes, permission changes, migrations or deployments in this assessment. Existing authority versions, legal emails and audit records remain intact.

## Measurements

<!-- ACTION_TABLE -->
Desktop / mobile values are shown in that order. Workflow samples: **n=3 / n=2**. Read-only navigation: **n=5 / n=5**.

| Action | Median time D / M | Slowest time D / M | Requests D / M | Main bottleneck | Evidence |
|---|---:|---:|---:|---|---|
| Open another sale in app | 0.03 s / 0.07 s | 0.04 s / 0.09 s | 0 / 0 | Local state; data already loaded | [sale.open.in_app](../artifacts/performance/navigation-samples.json) |
| Cold page navigation to sale controls | 2.09 s / 7.82 s | 2.13 s / 7.85 s | 95–99 / 93–95 | Initial assets and repeated restore reads | [sale_file.navigation.cold](../artifacts/performance/navigation-samples.json) |
| Repeat page navigation to sale controls | 1.91 s / 4.81 s | 1.95 s / 4.88 s | 95–104 / 95–97 | Repeated restore reads | [sale_file.navigation.repeat](../artifacts/performance/navigation-samples.json) |
| Enter Exchange from another stage | 4.38 s / 1.90 s | 4.41 s / 2.97 s | 3–18 / 3–11 | Legal context GET; overlapping restore work in some samples | [progression.stage_change](../artifacts/performance/navigation-samples.json) |
| Authority email preview | 0.85 s / 0.85 s | 1.36 s / 0.86 s | 1 / 1 | Authorised snapshot/preview round trip | [authority.preview_open](../artifacts/performance/staging-samples.json) |
| Request authority | 5.45 s / 6.75 s | 10.01 s / 7.56 s | 37 / 37 | Broad post-save reload | [authority.request](../artifacts/performance/staging-samples.json) |
| Issue authority | 5.43 s / 5.49 s | 12.55 s / 5.54 s | 37 / 37 | Email/API path plus broad reload | [authority.issue](../artifacts/performance/staging-samples.json) |
| Record exchange | 4.43 s / 5.22 s | 10.00 s / 5.46 s | 37 / 37 | Broad post-save reload | [exchange.record](../artifacts/performance/staging-samples.json) |
| Exchange → Completion | 0.03 s / 0.07 s | 0.03 s / 0.07 s | 0 / 0 | Local state/context reuse | [completion.open](../artifacts/performance/navigation-samples.json) |
| Upload one 1 MiB PDF | 7.78 s / 19.07 s | 16.78 s / 19.44 s | 37 / 37 | Transfer, server/Storage and broad reload | [completion.documents_upload.one-1MiB](../artifacts/performance/staging-samples.json) |
| Upload two 1 MiB PDFs | 9.91 s / 30.87 s | 10.80 s / 30.97 s | 37–39 / 39 | Transfer, sequential Storage writes and broad reload | [completion.documents_upload.two-1MiB](../artifacts/performance/staging-samples.json) |
| Upload two 5 MiB PDFs — failed | 11.81 s / 112.31 s | 12.55 s / 112.32 s | 1–3 / 7 | HTTP 413 body limit | [completion.documents_upload.two-5MiB](../artifacts/performance/staging-samples.json) |
| Upload two near-10 MiB PDFs — failed | 24.33 s / 224.24 s | 24.75 s / 224.26 s | 3 / 12–13 | HTTP 413 body limit | [completion.documents_upload.two-near-10MiB](../artifacts/performance/staging-samples.json) |
| Approve completion documents | 3.96 s / 5.77 s | 10.00 s / 6.00 s | 37 / 37 | Broad post-save reload | [completion.documents_approve](../artifacts/performance/staging-samples.json) |
| Record legal completion | 4.93 s / 8.86 s | 4.98 s / 11.12 s | 37 / 37 | Broad post-save reload | [completion.record](../artifacts/performance/staging-samples.json) |
<!-- END_ACTION_TABLE -->

The [complete measurement tables](../artifacts/performance/measurements.md) contain per-profile sample counts, request/response bytes, pending feedback, API round trips and the residual time after each POST. The [evidence README](../artifacts/performance/README.md) explains the datasets and trace replay.

Five genuine staging journeys used authorised Forum House units 102–106: three desktop and two mobile. All important business mutations have five samples in total, not five per device. Read-only navigation and synthetic frontend journeys each have five repetitions per profile. These small samples reveal reproducible problems but do not establish population percentiles.

Desktop used Chromium at 1280 × 900 with the ordinary connection. Mobile used a 390 × 844 viewport, fourfold CPU slowdown, 150 ms emulated latency, approximately 1.6 Mbps download and 0.75 Mbps upload. These are emulations on this computer, not measurements on physical phones. Some independent diagnostic processes ran concurrently, so isolated reruns are appropriate before attributing small timing differences to a code change.

Cold navigation in the read-only dataset clears the browser cache immediately before reload; repeat navigation retains it. This does not force a Vercel cold start. Workflow journey run 1 did not clear its cache and is excluded from claims about cold-cache behaviour. The synthetic suite intercepts backend traffic, which disables normal HTTP caching; its first/repeat labels are not a cold/warm cache comparison.

Read-only navigation ends when the sale's stage controls are visible. Some background restore reads continue after that point and can overlap the next stage change. Workflow mutations end at their success notification after the existing reload chain, or the displayed failure. Request counts include background polling initiated in the measurement window; they are browser requests, not counts of SQL statements. Compressed response-body sizes are recorded separately from the decoded JavaScript asset size.

## The slowest observations

<!-- SLOWEST_TABLE -->
| Action | Profile / run | Time | Outcome |
|---|---|---:|---|
| completion.documents_upload.two-near-10MiB | mobile-throttled / 4 | 224.26 s | HTTP 413 |
| completion.documents_upload.two-near-10MiB | mobile-throttled / 5 | 224.23 s | HTTP 413 |
| completion.documents_upload.two-5MiB | mobile-throttled / 4 | 112.32 s | HTTP 413 |
| completion.documents_upload.two-5MiB | mobile-throttled / 5 | 112.30 s | HTTP 413 |
| completion.documents_upload.two-1MiB | mobile-throttled / 4 | 30.97 s | HTTP 200 |
<!-- END_SLOWEST_TABLE -->

Failed large uploads dominate this ranking. A failed request is not treated as a successful upload. In the raw dataset, `status: ok` means that the diagnostic successfully observed the expected UI outcome; the separate HTTP status records the failure.

## Document-upload breakdown

<!-- UPLOAD_TABLE -->
| Profile / files | n | Pending median | Total median | POST round trip median | After POST median | Outcome |
|---|---:|---:|---:|---:|---:|---|
| desktop / one-1MiB | 3 | 29 ms | 7.78 s | 3.47 s | 4.40 s | HTTP 200 |
| desktop / two-1MiB | 3 | 29 ms | 9.91 s | 6.33 s | 3.86 s | HTTP 200 |
| desktop / two-5MiB | 3 | 30 ms | 11.81 s | 11.78 s | 0.04 s | HTTP 413 |
| desktop / two-near-10MiB | 3 | 30 ms | 24.33 s | 24.29 s | 0.04 s | HTTP 413 |
| mobile-throttled / one-1MiB | 2 | 25 ms | 19.07 s | 14.38 s | 4.69 s | HTTP 200 |
| mobile-throttled / two-1MiB | 2 | 24 ms | 30.87 s | 25.94 s | 4.93 s | HTTP 200 |
| mobile-throttled / two-5MiB | 2 | 23 ms | 112.31 s | 112.22 s | 0.09 s | HTTP 413 |
| mobile-throttled / two-near-10MiB | 2 | 27 ms | 224.24 s | 224.16 s | 0.08 s | HTTP 413 |
<!-- END_UPLOAD_TABLE -->

Files were synthetic PDFs of exactly 1 MiB, 5 MiB or 10 MiB minus 1 KiB each. One 1 MiB file and two 1 MiB files succeeded. Both larger two-file cases returned HTTP 413. The current UI accepts up to two PDFs close to 10 MiB each, but sends the complete multipart body through the Next.js function. Vercel documents a 4.5 MB request/response-body limit. This explains the reproducible size boundary; no database index or loading animation can fix it. [Vercel function limits](https://vercel.com/docs/functions/limitations)

The successful-upload path is: file metadata validation → FormData → browser-to-Next transfer → multipart parsing and buffering → sequential uploads to Supabase Storage → atomic `sales_completion_upload` RPC → orphan-path checks → legal context reload → building Sales reload → portal reload → final outcome. The two Storage writes run sequentially. File buffering uses `arrayBuffer()` on the server. There is no PDF parsing or base64 conversion in the application’s completion-file selection code. See [the upload route](../src/app/api/sales/legal/route.ts) and [CompletionDocuments](../src/components/portal/sales/CompletionDocuments.tsx).

The POST column includes the incoming transfer, function execution, Storage, database round trips and the response. It cannot isolate Storage transfer time. The final column is total click-to-outcome minus that round trip: predominantly the observed refresh chain, plus browser work and a small amount of pre-request overhead. Medians of separate columns need not add exactly.

The deployed build has no new `Server-Timing` header, so pure Vercel execution, multipart parsing and Storage spans remain unmeasured. The added instrumentation will expose these phases in an explicitly enabled staging deployment. PostgreSQL’s recorded `sales_completion_upload` execution averaged 10.57 ms across eight calls at the database snapshot; that is only its database portion, not the whole upload and not a per-sample attribution.

The original live file-selection harness transferred in-memory buffers through Playwright, producing size-dependent automation work. Those selection timings and long tasks are retained transparently in the raw evidence but excluded from application-PDF-processing conclusions. The final synthetic journey reads files from disk and starts timing at the native input change event.

## Repeated reads and refreshes

Successful legal mutations normally triggered **37 browser requests**, occasionally 39 when background polling overlapped. There was one legal POST per measured click: no duplicate mutation or upload POST was observed. After it, [SalesLegalWorkflow](../src/components/portal/sales/SalesLegalWorkflow.tsx) waits for:

1. A new legal-context GET.
2. `loadSalesData()` in [SalesReservationWorkflow](../src/components/portal/sales/SalesReservationWorkflow.tsx).
3. `reloadPortalData()` / `loadAll()` in [ProductionPortalApp](../src/components/portal/ProductionPortalApp.tsx).

These operations are sequential. The Sales reload fetches defaults, all attempts for the building's units, seven dependent datasets and then all document-version rows: roughly ten requests over four dependency waves. It includes historic attempts, terms, documents, invoices and payments even after a change to one sale.

The portal reload first loads the profile, then launches 23 parallel branches covering buildings, units, areas, organisations, profiles/access, snags, photos, events, handovers, meters and audit data. Areas require paging in this dataset. Most branches select all columns and are unrelated to the changed authority or completion package.

The full Exchange-page reload measured **115 requests**. Most portal tables were requested three times and most Sales tables twice. Source inspection finds both explicit session restoration and an unfiltered `onAuthStateChange` callback calling `loadAll()`. The Sales effect depends on building/unit counts. This is evidence of duplicated loading; the precise third auth event should be captured with a fixed event-label counter before changing that lifecycle. Do not remove authentication checks merely to reduce request counts.

No `router.refresh()` or `revalidatePath()` is used in these Sales flows. Navigation uses React state and `history.pushState`. The costly “refresh” is the application’s own data reload chain. Exchange and Completion share the mounted legal component and context, which explains their fast local transition. Returning from another stage mounts the legal component again and fetches context.

The legal GET has five dependency waves: authenticated user/profile → authorised sale snapshot → authority expiry check → six parallel context reads → actor-name lookup. It fetches complete legal emails (including stored bodies/snapshots) and all nested document versions. The expiry call can legitimately record an expiry outcome, so it must not be treated as a harmless cacheable read or reordered speculatively. Most remaining context queries can be investigated for narrower data or a purpose-built authorised RPC.

There is no browser-side per-row query loop in the inspected Sales loader. It uses bulk `in(...)` requests. Permission helpers evaluated for each returned row form a separate database cost. Actor names are fetched in a batch. Activity and Comments are lazy and paginated; Activity initially fetches 51 rows to show 50 and polls while open. The full-history concern is principally the legal context and building-wide document versions, rather than those two panels.

## PostgreSQL evidence

Read-only inspection used the connected **Bunnywell Portal Staging** project, never production. Statements ran in read-only transactions with a five-second timeout. No mutation function was passed to `EXPLAIN ANALYZE`, no extension/configuration was enabled, and no index was created or removed.

The following are cumulative `pg_stat_statements` observations, not timings correlated to individual browser samples. Counters were last reset on 20 June 2026. They include earlier development/test traffic and this diagnostic run; their call counts are not a production request rate. PostgREST JSON aggregation often returns one SQL row containing many application rows. [Supabase query diagnostics](https://supabase.com/docs/guides/observability/inspect)

<!-- DATABASE_TABLE -->
Snapshot: 2026-09-22T19:26:35.309723+00:00.

| Operation / query ID | Calls | Mean execution | Maximum execution |
|---|---:|---:|---:|
| unit_sale_payment_schedule / 974553335667187863 | 652 | 130.9 ms | 671.33 ms |
| unit_sale_terms / 8368201375633199557 | 510 | 90.57 ms | 325.39 ms |
| unit_sale_documents / 8669688438123704398 | 243 | 58.28 ms | 201.56 ms |
| unit_sale_workflow_events / -8760926568830373644 | 258 | 50.97 ms | 190.66 ms |
| unit_sale_documents / 6329297679653605544 | 266 | 31.39 ms | 186.94 ms |
<!-- END_DATABASE_TABLE -->

The payment-schedule statement selects all columns for 64 sale-attempt IDs and sorts by sequence. The terms statement similarly selects all columns for the building’s attempts. The corresponding `EXPLAIN ANALYZE` reads returned 185 schedule rows and 64 terms rows:

| Query | Sales-agent role | Admin role | Privileged control | Evidence |
|---|---:|---:|---:|---|
| Payment schedules | 65.631 ms | 110.062 ms | 0.269 ms | Existing sale/sequence index; permission filter; 185 rows |
| Sale terms | 24.423 ms | 57.427 ms | 0.156 ms | Existing attempt index; permission filter; 64 rows |

All these plans had zero shared disk-block reads and no temporary-file spill. The privileged control establishes a useful contrast, not a safe implementation alternative: application permissions must remain enforced. These differences implicate row-level policy/helper evaluation rather than missing lookup indexes. A single plan does not quantify every nested function’s contribution. Function tracking is currently off; statement tracking is `top`.

The existing indexes already cover attempts by building/status, schedule by sale/sequence, terms by sale/current flag, documents by sale/type and versions by document/upload time. The [saved plans](../artifacts/performance/database-plans.json) and [statement timings](../artifacts/performance/database-query-timings.json) provide execution evidence.

Supabase’s performance advisor reports multiple permissive SELECT policies on the core Sales tables and several uncovered foreign keys. These are investigation leads, not justification to add indexes wholesale. For example, the invoice-payment sale-attempt foreign key lacks a covering index, but that table had only eight live rows in the initial snapshot; its query averaged about 15 ms. No measured plan currently supports an index change. See [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), and the [filtered advisor output](../artifacts/performance/database-advisors.json).

## Browser rendering and monitoring

<!-- BROWSER_OBSERVATIONS -->
Real action pending feedback ranged from **21–32 ms**, comfortably within the 100 ms diagnostic target for these samples.

Native file-selection results use the final synthetic fixture with files on disk; the backend is intercepted.

| Files | Desktop median / maximum | Mobile median / maximum | Network requests |
|---|---:|---:|---:|
| one-1MiB | 25 / 47 ms | 50 / 85 ms | 0 |
| two-1MiB | 24 / 32 ms | 38 / 72 ms | 0 |
| two-5MiB | 23 / 38 ms | 50 / 85 ms | 0 |
| two-near-10MiB | 34 / 43 ms | 42 / 92 ms | 0 |

The largest long task in these native selection windows was **0 ms** (zero means none reached the 50 ms observation threshold). Source inspection and these controlled measurements do not support blaming synchronous PDF processing for the multi-second upload delays.
<!-- END_BROWSER_OBSERVATIONS -->

The portal client component is about 10,600 lines and SalesReservationWorkflow about 3,500. Initial deployed scripts total approximately **1.94 MB decoded** across eight script assets; this is not the compressed transfer size. The components eagerly import functionality including PDF generation outside this completion upload path. This makes bundle splitting a plausible follow-up, but line counts alone do not establish an expensive render. A React commit profile and CPU trace are still needed before attributing a specific render cost to a component.

Neither `@vercel/speed-insights` nor an equivalent Web Vitals collector is installed in the inspected source/package manifest; the public deployed shell also had no corresponding marker. There is no field INP/LCP/CLS baseline. Pending-feedback timing is not field INP. The navigation dataset includes Navigation Timing TTFB and limited observed LCP/layout-shift data; its simple accumulated layout-shift sum is not the standard session-window CLS metric and must not be presented as one.

The smallest proposal is one isolated client component importing `SpeedInsights` from `@vercel/speed-insights/next`, mounted once from the server root layout after approval to enable that service. Use a stable `beforeSend` callback to remove query strings/hash and map URLs to fixed route labels, and keep debug output disabled. This can collect INP, LCP, CLS and TTFB without making the whole layout a client component. Alternatively, a tiny `useReportWebVitals` boundary can send an allowlisted metric/value/rating payload to an existing approved sink when one is available. Do not send metric entry objects, DOM selectors or sale URLs. No monitoring service was installed. [Speed Insights configuration](https://vercel.com/docs/speed-insights/package), [supported metrics](https://vercel.com/docs/speed-insights/metrics)

Vercel’s connected deployment metadata confirms **`iad1`** functions while the staging database is in **`eu-central-1`**. Cross-region latency is a plausible multiplier for the sequential route calls; its contribution has not been isolated. After the journeys, a deployment-scoped preview query for 18:00–20:00 UTC returned **167 HTTP 200 and 10 HTTP 413 entries**, matching the ten failed large-upload observations. The connector noted three distinct status values but displayed only two, so these counts are not used to calculate an error rate. The error-cluster query returned no clusters for the legal route in its inspected two-hour window; the diagnostics include test traffic. A narrow one-entry log query succeeded but supplied no function duration or start type. Other individual-log queries timed out even with a deployment and two-minute window. Function-duration distributions, cold-start frequency and per-invocation response sizes therefore remain unverified. [Vercel Observability](https://vercel.com/docs/observability)

## Recommended next work, in order

| Priority | Change to assess/implement separately | Expected benefit | Effort | Regression risk |
|---|---|---|---|---|
| 1 | Correct completion-upload transport/size contract; consider authorised direct-to-Storage upload followed by atomic server finalisation | Prevents all observed large-file failures and multi-minute wasted transfers | Medium–high | Medium–high: validate ownership, file size/type, idempotency, cleanup and immutable versions |
| 2 | Refresh only the changed sale/context and necessary totals after a legal mutation | Targets the measured multi-second post-POST delay and most of the 37 requests | Medium | Medium: stale commercial/approval state and cross-panel consistency |
| 3 | Deduplicate auth restoration and initial Sales loading | Removes repeated identical portal/Sales reads on the 115-request page load | Medium | Medium: session changes and access changes must still refresh correctly |
| 4 | A/B-test staging legal functions in the database’s region | Potential reduction in repeated cross-region round trips | Low configuration effort | Medium: deployment configuration; benefit must be measured |
| 5 | Profile and simplify repeated RLS helper evaluation while retaining identical policy semantics | Targets 24–110 ms representative reads and frequently repeated building queries | Medium–high | High: requires positive and negative role/access regression tests |
| 6 | Load current document/email summaries first; fetch immutable histories on demand | Reduces growing responses and repeat parsing as history accumulates | Medium | Medium: full audit history must remain available |
| 7 | Capture a React/CPU profile, then split demonstrably expensive client bundles | Potential cold-navigation improvement, especially mobile | Medium | Medium; benefit not yet isolated |
| 8 | Enable the small approved Web Vitals boundary and stage-only server timing deployment | Establishes field and server baselines for subsequent comparisons | Low–medium | Low with strict payload allowlisting and staging flags |

The first three recommendations have direct user-visible/request evidence. Region alignment, targeted policy changes, history pagination and bundle work need controlled comparisons before claiming a saving. Existing immediate click feedback, local stage switching, single mutation submission and the core legal RPC execution are already comparatively healthy. No optimisation should overwrite or reactivate an old authority, alter permissions, or discard audit history.

## Validation and limits

- 252 existing Sales tests and two instrumentation tests pass.
- 19 legal-workflow browser regressions pass on local code, including authority lifecycle/versioning, embedded notice preview, permissions and completion-package behaviour. A first local run encountered a Windows Turbopack write-denied error; the rerun with normal filesystem access passed.
- Ten deployed-frontend diagnostic journeys pass using synthetic fixtures. Desktop/mobile traces are sanitised before sharing.
- Type checking and focused lint for instrumentation, route, tests and scripts pass. Full repository lint remains failing on existing code (21 errors); the three errors in the touched SalesReservationWorkflow file were reproduced from its unchanged HEAD version. These were not converted into unrelated behaviour changes.
- Five authorised real staging sales progressed to legal completion. Their sent emails, authority versions, document versions and audit history are retained. Units 107–110 have no workflow mutations from this assessment; 107 is viewed in navigation checks.
- No production records were used for mutation tests. No production telemetry sink, query-plan endpoint, extension, index or deployment was enabled.
- Missing: deployed internal Storage/server phase spans, reliable field Web Vitals, React commit attribution and Vercel cold-start/duration distributions. The report identifies these limits rather than inventing a timing breakdown.
