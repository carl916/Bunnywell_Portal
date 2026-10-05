# Sales loading investigation — 5 October 2026

Branch `codex/sales-loading-trace` starts from staging commit `b5507f9`. Application commit `8a9dbeb87707f3d9dcd320f80f4f79efdc88f0d1` overlaps two independent read paths in `src/lib/sales/action-refresh.ts`. Defaults no longer block attempts, and document versions no longer wait for unrelated financial/name/deposit reads. The queries, selected columns, filters, ordering, RPCs and permissions are unchanged. Every required read must still succeed before the caller publishes the snapshot.

The matched comparison supports this small change. It does not support a permission, RPC or index change. It also does not reduce request counts. Mobile cold and in-app entry improve in these controlled samples; repeat readiness changes little. These are five controlled observations per build/profile/journey, not a field percentile or guaranteed saving.

## Matched readiness

| Profile | Journey | Before median | After median |
|---|---|---:|---:|
| Desktop | Cold reload | 2.06 s | 2.07 s |
| Desktop | Repeat reload | 1.94 s | 1.92 s |
| Desktop | In-app Sales entry | 1.83 s | 1.34 s |
| Mobile | Cold reload | 6.66 s | 6.18 s |
| Mobile | Repeat reload | 3.77 s | 3.77 s |
| Mobile | In-app Sales entry | 3.99 s | 3.48 s |

The [measurements](../artifacts/performance/sales-loading/measurements.md) report min–max, median absolute deviation, paired changes, request counts, phase timings and browser task durations. The [summary](../artifacts/performance/sales-loading/summary.json) retains the numerical distributions. DOM polling contributes to the readiness boundary and produces some roughly half-second steps. Desktop Sales-entry medians differ by 492 ms, but its median paired change is only −12 ms, with a paired range of −498 to +503 ms: this does not establish a consistent desktop readiness saving. Mobile paired medians are −469 ms cold, −1 ms repeat and −552 ms Sales entry. The actual Sales start-to-publication durations independently show the dependency improvement:

| Profile | Journey | Before complete Sales read | After complete Sales read |
|---|---|---:|---:|
| Desktop | Cold | 770 ms | 605 ms |
| Desktop | Repeat | 752 ms | 591 ms |
| Desktop | Sales entry | 1,331 ms | 1,131 ms |
| Mobile | Cold | 1,398 ms | 1,124 ms |
| Mobile | Repeat | 1,435 ms | 1,120 ms |
| Mobile | Sales entry | 3,534 ms | 3,036 ms |

Reloads make **35 instrumented data requests** on both builds: portal/context reads plus the ten Sales reads. In-app Sales entry makes **10 instrumented reads** on both. All initiated network requests, including assets/auth/polling, are **54** on cold/repeat reloads and **12** on Sales entry. The supplementary Exchange journey makes one legal GET per entry. Counts through the settled boundary include failures and unfinished requests rather than counting only successful completions.

## Dependencies and trace findings

Cold and repeat reloads use the same data dependency graph. Cache retention removes the initial JavaScript transfer on repeat; it does not cache or skip the authoritative Sales reads. Auth restoration validates the user before the portal profile read. Profile lookup/deactivation handling precedes the portal's parallel collection reads, including building and unit access. Areas can involve pagination. The portal publishes its access/data context, then resolves the selected building against accessible buildings before mounting Sales. These gates remain in place.

In-app entry from Snags reuses the current authorised portal/building context and remounts Sales. It does not repeat the broad portal load in these traces. Its cost is overwhelmingly the Sales data path, followed by rendering and the independent DOM readiness observer.

The previous Sales path was:

```text
authorised building/unit context
  → defaults
  → attempts
  → parallel terms / schedule / documents / invoices / payments / actors / deposits
  → document versions
  → publish complete snapshot
```

The retained path is:

```text
authorised building/unit context
  ├─ defaults ──────────────────────────────────────────┐
  └─ attempts                                           │
       ├─ terms / schedule / invoices / payments / actors / deposits
       └─ documents → versions                          │
                                                        ↓
                            all required reads succeed → publish
```

Defaults use the existing building ID. Attempts use the existing accessible unit IDs. Neither requires the other response. Child reads require attempt IDs; versions require document IDs. Empty attempts/documents still avoid their dependent queries. No broader version query, joined payload, partial publication, cache or database API was introduced.

The exploratory before trace reproduced mobile cold 6.58 s, repeat 3.84 s and Sales entry 4.04 s. In it, defaults delayed mobile attempts by 180–222 ms, and versions waited 19–235 ms after documents completed. The repeated matched Sales-entry traces show a roughly 250 ms documents-to-versions gap before the change and about 3–4 ms afterwards. Defaults overlap attempts afterwards. The complete Sales read remains behind all financial, document/version, actor and deposit results.

Selected-sale legal context is fetched when opening Exchange or Completion; it is separate from the building-wide snapshot. Its server path validates the bearer token, active profile and `sales_legal_snapshot` access before expiry reconciliation and related legal reads. Attempt, emails, joined documents/versions, workflow events, deposit context and completion package read concurrently; actor labels depend on event/document user IDs. The expiry operation and authorisation-sensitive RPC sequence were not parallelised. Completed fixtures were checked for any expirable active authority before legal GETs, and fingerprints prove the journeys did not mutate them. The measured Exchange path shows no consistent readiness improvement from this loader change.

## What dominates

For mobile in-app entry, complete Sales loading takes 3.53 s of 3.99 s before and 3.04 s of 3.48 s after. Browser script work is only tens of milliseconds in that journey. Request timing shows substantial body-transfer time, concurrent bandwidth sharing, and network/server waits on successive read waves. Network/data loading dominates this journey.

Mobile cold readiness additionally includes initial JavaScript transfer, browser startup/hydration and the authorised portal/context reads. Main-thread script work is around 0.76–0.79 s; total browser task time is around 1.3 s, much less than the roughly six-second readiness boundary. Repeat loading largely removes startup transfer/script cost, leaving portal/context and Sales network waits. No uniform browser-processing improvement is claimed: application JavaScript increases slightly, 374,197 → 374,356 transferred bytes, from the added concurrency code.

[Exact IN-filter plans](../artifacts/performance/sales-loading/query-plans.json) ran in a read-only transaction under `authenticated` with the authorised diagnostic user's JWT subject, using the building's accessible identifier sets. Sampled execution times were attempts **22.6 ms**, schedule **64.4 ms**, documents **43.9 ms**, versions **109.1 ms**. These are single warm plan observations, outside browser measurement windows, not database medians. The version predicate has repeated document/access-policy checks. The same version SELECT through the privileged diagnostic connection took **0.3 ms** ([comparison](../artifacts/performance/sales-loading/engine-comparison.json)); this suggests RLS dominates that query's database execution, but not total mobile readiness. The comparison connection is used only for diagnostics, never application loading.

TTFB includes network, queueing, API processing and database work; body timing includes shared bandwidth and browser/protocol observation. SQL plans do not measure PostgREST JSON serialisation, and the privileged plan is not a proposal to bypass RLS. Shared previews have no branch-specific timing flags, so no new server-phase breakdown is claimed for legal GETs. The evidence supports removing demonstrated browser-side serial waits while retaining the existing database security and legal APIs.

## Safety and verification

The caller still batches the complete result into defaults, attempts, terms, schedule, documents, all versions, invoices, payments, actors and deposits, and only then updates `loadedSalesKey`. Failed required reads preserve their errors and do not mark a new snapshot complete. Only the existing narrowly recognised missing optional `sale_actor_names` lookup can fall back. The per-component coordinator, revision, current building and access/membership keys still reject superseded responses. No shared account cache or selection state was added to the loader.

Focused tests exercise concurrent defaults, documents/versions running while financial reads remain pending, required failures in every read, transport rejection, RLS-empty results, optional actors, late failures and superseding scopes through the real loader/coordinator. Browser tests hold defaults while other reads complete, hide incomplete controls, switch sales while an old load is pending, reject late responses, deny a version read, retry, revoke permissions and deactivate a profile. Existing legal refresh tests retain their four/five-request scope.

The full Sales suite (**276** tests), focused loader/lifecycle/performance tests (**56** tests), TypeScript and focused ESLint pass. All **17** focused browser tests pass. Their Windows dev-server teardown stalled after the worker completed; terminating that suite's own server allowed Playwright to report the pass result. No local tests/builds or database plan/platform inspections ran during the matched timed journeys.

All **80** matched journeys have zero application, HTTP or page failures, zero request-settlement timeouts and matching rendered progression hashes. Actual function responses verify `iad1`, including every measured legal GET. Supplementary checks open Commercial, Financials and Completion on each of the four completed fixtures, for both profiles/builds. Contract prices are checked against independent source reads, legal completion is displayed, and current document filenames are checked against the source versions. Panel hashes compare the displayed commercial figures, invoice/payment information and legal/documents between builds. No business bodies, DOM text, screenshots, signed URLs or credentials are saved.

Both browser runs fingerprint attempts, units, terms, schedule, invoices, payments, deposits, legal emails/events, documents and versions before/after. Completed sales 107–110 remain unchanged. Normal sign-in/activity bookkeeping is allowed; Sales API writes, REST row writes, Storage writes and non-allowlisted RPCs are blocked before transmission. Staging alias, production, database permissions and RPC definitions were not changed.

## Deployments and reproduction

| Variant | Immutable preview | Commit | Deployment |
|---|---|---|---|
| Before | [7wue4zuv1](https://bunnywell-portal-7wue4zuv1-carl-gilbert-s-projects.vercel.app) | `3b9b10f` | `dpl_2KRF9ozJYES4Wv1DL17vKVT6N61o` |
| After | [p05z6g90c](https://bunnywell-portal-p05z6g90c-carl-gilbert-s-projects.vercel.app) | `8a9dbeb` | `dpl_B4QEz9cD1gHZnvj63zNYjtEbKT5y` |

Before is a metadata-only commit with the same tree as `b5507f9`. Both builds are READY previews in `iad1`, inherit the same shared Preview environment with no branch-specific overrides, and browser reads verify staging Supabase `vxkpvdtrldwwqiddoyof.supabase.co`. No staging alias is used for the comparison. Later diagnostic/evidence commits do not change the measured application implementation.

Chromium 149.0.7827.55; desktop 1280×900, ordinary connection; mobile 390×844, 4× CPU slowdown, 150 ms latency, 200,000 bytes/s download and 93,750 bytes/s upload. Cold clears browser cache; repeat retains it. Both previews warm up before recorded runs, alternated by round with only one active journey at a time. A browser-cold reload does not force a function cold start. Normal desktop applications and unreserved staging traffic remain possible sources of variability. Completed unit 107 is the timed fixture; 107–110 are the supplementary display fixtures.

```powershell
node scripts/diagnostics/sales-loading-trace.mjs artifacts/performance/sales-loading/paired-deployments.json 5
node scripts/diagnostics/sales-loading-trace.mjs artifacts/performance/sales-loading/paired-deployments.json 1 desktop,mobile-throttled --data-checks
node scripts/diagnostics/summarize-sales-loading.mjs
npm run test:sales
node --test tests/sales-loading-concurrency.test.mjs tests/sales-action-refresh.test.mjs tests/portal-load-lifecycle.test.mjs tests/sales-performance.test.mjs
npx tsc --noEmit
npx playwright test tests/sales-loading.spec.ts tests/portal-load-lifecycle.spec.ts --reporter=line
```

Use the existing authorised diagnostic environment and scope files; do not reset completed fixtures. [Setup](../artifacts/performance/sales-loading/setup.json), [paired samples](../artifacts/performance/sales-loading/paired-samples.json), [paired verification](../artifacts/performance/sales-loading/paired-verification.json), [display checks](../artifacts/performance/sales-loading/data-checks-samples.json), [display verification](../artifacts/performance/sales-loading/data-checks-verification.json), and the initial exploratory traces are retained beside the report.
