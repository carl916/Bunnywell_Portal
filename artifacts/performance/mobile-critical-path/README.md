# Initial load and Sales navigation, 5 October 2026

The focused change loads `jspdf` inside the existing asynchronous snag-report builder instead of importing it at portal startup. Application commit **83670f3a18a2f5370f1d9927e956723d0d86a4c3**, branch **codex/mobile-critical-path**, starts from current staging **87d83c7eda8bb2ff9df4d63b7a5760b9c7abd52d**. The report builder, download/audit sequence and report-email path otherwise remain intact. Auth, permission checks, atomic portal/Sales snapshots, sale switching and legal state are unchanged. The first report generation now fetches its PDF dependency on demand.

Initial JavaScript transfer falls **511,975 → 374,197 bytes (−137,778; −26.9%)**. Decoded JavaScript falls **1,848,820 → 1,429,803 bytes**. Mobile cold startup script execution falls **1,310 → 771 ms**. Readiness improves less consistently because data reads and measurement polling remain substantial. These results support the smaller initial bundle; they do not establish a uniform improvement in navigation or Web Vitals.

## Environment and boundaries

This is a **matched iad1 preview comparison**, not a comparison with the live staging alias. Live staging remains **dpl_9r3bmicyRqd1t7WNjrgUXCZ52NvH**, with the opt-in legal route in **fra1**. Production remains **dpl_71MV1EATioHy8bBiNornLF5hzu7m**. No alias assignments, project-default changes, production deployment, root `vercel.json` changes or cron changes were made.

| Variant | Immutable preview | Deployment | Commit |
| --- | --- | --- | --- |
| Before | bunnywell-portal-fe1e2j4f9-carl-gilbert-s-projects.vercel.app | dpl_9z11LY3JvsrhUg1iWMhyVkzp2YCK | 06e09fa |
| After | bunnywell-portal-cbq2kofji-carl-gilbert-s-projects.vercel.app | dpl_cKZEN1SXvoQdX4RYG6PHXE8TxUBC | 83670f3 |

Before is a metadata-only empty commit on 87d83c7, with identical application and root configuration. Both isolated branches inherit the shared Preview environment and have no branch-specific overrides in the inspected environment metadata. Actual browser reads in every profile target only staging Supabase, `vxkpvdtrldwwqiddoyof.supabase.co`. All **20 main legal GET invocations** and **40 main `/api/auth/activity` invocations** returned 200 with **iad1 execution**, verified from the second region in `x-vercel-id`, not its ingress region. Including auxiliary trace/LCP runs, **26 legal and 52 activity invocations** have verified 200/iad1 responses. Legal requests occur when entering Exchange; no legal POST was used.

Completed Forum House unit 107 is the displayed fixture throughout. Units 107–110 are fingerprinted before and after: attempts, units, legal emails, workflow events, documents and document versions are unchanged. No sales were consumed or mutated; 210/211 were not used. The browser guard rejects sale API writes, REST row writes, Storage writes and non-allowlisted RPCs before transmission. Normal sign-in/activity bookkeeping is allowed.

## Critical path evidence

An exploratory trace on the older 87d83c7 preview identified the PDF-bearing chunk as the last large startup dependency. That preview had staging-only diagnostic flags; its measurements are retained as exploratory evidence and excluded from the matched results. Fresh ordinary previews remove that environment mismatch.

The six sanitised Chrome traces cover mobile cold/repeat reloads and real in-app Sales entry, before and after. They include timeline, V8 and CPU sampling. Decompress a `.trace.json.gz` file and load its JSON in Chrome DevTools Performance. Query strings, identifiers, headers and bodies are excluded/redacted. `trace-samples.json` links each trace to its network and load-phase metadata.

The matched recorded cold trace finishes JavaScript at **3.900 → 3.027 s**, starts session restoration at **4.238 → 3.328 s**, publishes portal data at **5.987 → 5.086 s**, and publishes Sales at **7.439 → 6.547 s**. The PDF library is present in the before initial chunk and absent from all after initial assets; every re-fetched asset hash matches its measured hash (`bundle-verification.json`). Eight initial static JS chunks remain in each build. No PDF chunk is requested by the navigation journey.

CPU profiling itself adds overhead: the traces contain `CpuProfiler::StartProfiling` spans around 512/332 ms on cold reload. Consequently, traced wall times and script totals are **not included in the timing medians**. Explicit main-thread compile spans are about 12 ms; compilation can also run on other threads, and this is not a complete parse-cost estimate. Untraced CDP script/task counters independently confirm lower startup work. Timeline rendering spans are about 122/120 ms cold, 43/42 ms repeat and 38/37 ms for Sales entry, so the trace does not support a broad React rewrite. Overlapping timeline categories must not be added together.

Median mobile phases from the five untraced rounds:

| Phase | Before | After |
| --- | ---: | ---: |
| Last JS resource complete, cold | 3.381 s | 2.691 s |
| Validated session / portal load starts, cold | 3.715 s | 2.995 s |
| Profile and complete portal reads, cold | 1.696 s | 1.775 s |
| Portal publication to Sales load start, cold | 34 ms | 37 ms |
| Complete Sales snapshot reads, cold | 1.407 s | 1.413 s |
| Sales snapshot published, cold | 6.852 s | 6.213 s |
| Complete portal reads, repeat | 1.626 s | 1.656 s |
| Complete Sales reads, repeat | 1.309 s | 1.428 s |
| Complete Sales reads, in-app entry | 3.290 s | 3.298 s |

These are separate medians, not additive components of one synthetic run. Auth is still validated with `getUser`; restoration events coalesce into one portal snapshot. Portal reads start with the authoritative profile and then parallel reads, including paginated areas. Sales waits for resolved access/building context, then reads defaults, attempts, related financial/document/legal data and versions before publishing its complete snapshot. There are still 35 instrumented startup data requests. No required data was deferred.

Readiness uses the October protocol: visible Completion control, expected Unit 107 heading and two animation frames. It is an observed test boundary, not exact physical paint time. Playwright's adaptive locator polling contributes quantisation: cold Sales-publication-to-observed-readiness medians are 125/421 ms. That gap must not all be attributed to React rendering. The 8.712-second after outlier had faster JS completion (2.682 s) but a slow Sales snapshot (3.216 s); it is retained in all statistics.

## Matched readiness and variation

Chromium **149.0.7827.55**, one browser process, inactive preview pages blanked to stop polling. Desktop **1280×900**. Mobile **390×844**, **4× CPU**, **150 ms latency**, **200,000 B/s download**, **93,750 B/s upload**, matching the October profile. Existing authenticated fixture and Handover state are restored before each pair. Both previews are warmed; order alternates by round. Cold clears the browser HTTP cache, immediately followed by repeat with cache retained. No tests, builds or platform inspections run during recorded samples.

Each cell is median **[min–max] seconds**, **n=5 per variant/profile/action**. Paired delta is the median of after minus before **within the same round**, in milliseconds. It can differ from the subtraction of the two medians.

| Profile / action | Before | After | Paired delta |
| --- | ---: | ---: | ---: |
| Desktop cold | 2.105 [2.086–2.623] | 2.294 [2.073–2.610] | −12 ms |
| Desktop repeat | 1.923 [1.908–2.420] | 1.919 [1.908–1.941] | +11 ms |
| Desktop Sales entry | 2.350 [1.331–2.849] | 2.352 [1.832–2.834] | +483 ms |
| Desktop Exchange entry | 1.853 [1.824–2.338] | 2.327 [1.825–2.369] | +1 ms |
| Mobile cold | 6.921 [6.846–7.886] | 6.686 [6.194–8.712] | −726 ms |
| Mobile repeat | 3.787 [3.770–4.306] | 3.766 [3.752–4.242] | −5 ms |
| Mobile Sales entry | 3.510 [3.463–3.989] | 3.509 [3.456–4.023] | +9 ms |
| Mobile Exchange entry | 1.916 [1.400–1.962] | 1.916 [1.897–2.449] | −4 ms |

There are **80 main action samples**, plus **8 trace-run actions** (six recorded traces) and **16 separate LCP-attribution actions** (two additional mobile rounds per variant). Auxiliary rounds are excluded from the table. The October ~6.9 s cold / ~3.8 s repeat context is reproduced by the before preview, but live staging's legal fra1 configuration is not used here.

The desktop cold median is higher after, despite a near-zero paired median difference and overlapping ranges. Desktop Sales entry also has a worse paired median. This change does not establish a desktop navigation benefit; the in-app data-read variance remains unresolved. Five pairs are too few to declare those noisy wall-time changes causal or rule out a modest regression. The consistent evidence supports removing unnecessary startup JavaScript and execution, rather than a claim that every navigation is faster.

## Requests and main-thread work

Cold/repeat navigation remains **54 settled requests / 52 excluding polling**, in-app Sales entry **12**, Exchange entry **1 legal GET**. Repeat JavaScript transfer is **0 bytes** in both builds. The settlement condition is 1.5 seconds quiet excluding polling/telemetry, capped at 60 seconds; `lastRequestEndMs` is recorded separately so the quiet grace period is not reported as request work.

Median main-thread milliseconds to observed readiness (`script / all tasks`; task totals include script work and must not be added to it):

| Profile / action | Before | After |
| --- | ---: | ---: |
| Desktop cold | 106 / 223 | 76 / 180 |
| Desktop repeat | 25 / 118 | 20 / 109 |
| Desktop Sales entry | 10 / 131 | 11 / 137 |
| Desktop Exchange entry | 7 / 128 | 7 / 113 |
| Mobile cold | 1,310 / 2,006 | 771 / 1,311 |
| Mobile repeat | 93 / 486 | 68 / 403 |
| Mobile Sales entry | 41 / 270 | 37 / 243 |
| Mobile Exchange entry | 28 / 171 | 28 / 165 |

Mobile cold layout/recalculate-style work is approximately 50/19 ms before and 50/18 ms after. Most observed Long Tasks totals are zero; one before cold sample records a 57 ms Long Task. Aggregate script time is spread across tasks, so it is not equivalent to one long blocking task. Full medians, ranges and median absolute deviations, resource timings, request rows and phase events are in `summary.json` and `paired-samples.json`.

## Observed Web Vitals

These are browser PerformanceObserver observations at the sampling boundary, not field-percentile Web Vitals. INP was not measured; no INP success is claimed.

| Profile / cache | LCP before → after | CLS before → after |
| --- | ---: | ---: |
| Desktop cold | 1.864 → 2.156 s | 0.01469 → 0.01467 |
| Desktop repeat | 1.608 → 1.604 s | 0.01486 → 0.01488 |
| Mobile cold | 5.508 → 4.820 s | 0.000775 → 0.000775 |
| Mobile repeat | 2.200 → 3.620 s | 0.000775 → 0.000775 |

The repeat LCP increase is recorded, not discarded. Two attribution rounds show Chrome sometimes selecting a larger paragraph (12,198 px², `mt-2 text-sm ...`) around portal publication and sometimes a smaller paragraph (7,040 px², `text-sm ...`) around final Sales publication. Both patterns occur across the builds; one after repeat selects the later paragraph at 3.556 s, another selects the earlier one at 2.236 s. Thus these LCP samples do not consistently describe the same visual phase. Their attribution is in `lcp-diagnostic-samples.json`; unchanged workflow hashes and readiness are separate checks. No uniform Web Vitals improvement is claimed.

## Validation and failures

All main samples pass navigation, expected completed-sale heading, Exchange task display, settlement, HTTP and actual route-region gates. Workflow-panel text hashes match in every before/after pair. Protected fixture fingerprints remain unchanged for the trace, timing and LCP diagnostic runs.

**Measured requests:** zero application failures, zero HTTP errors, zero timeouts and zero observed aborted requests. Abort categories are therefore application **0**, polling **0**, telemetry **0**, static/document **0** within measured windows. The immutable ordinary previews do not emit the staging-host telemetry collector: collector requests **0**, accepted 204 **0**, unknown **0**. The harness records telemetry aborts separately; an observed 204 is accepted, no response is unknown, and HTTP errors and other telemetry failures still fail the gate. This is not a claim of collector acceptance on live staging. Setup/unmeasured transition requests are outside the timing-window counts.

- Real PDF builder tests: **2 passed**, checking lazy dependency loading, genuine two-page A4 PDF content/layout and dependency-load failure.
- Focused PDF, auth lifecycle and action-refresh tests: **40 passed**.
- Existing `npm run test:sales`: **261 passed**.
- TypeScript `npx tsc --noEmit`: **passed**.
- Existing Chromium loading/lifecycle/controls/stage suite: **24 passed, 1 failed** on the clean run. The Agent Fees pagination test expects page two after shrinking 62 rows to 15 and Refresh; it intermittently resets to page one. The same failure reproduces with the original eager PDF import (`browser-pagination-baseline.log`). An earlier run completed all 25 assertions but required termination of stalled Windows test-server cleanup; it is not counted as a clean pass. The focused change does not fix that existing refresh issue.
- One initial exploratory setup was discarded because the explicit RPC guard omitted required read RPCs. The allowlist was corrected before matched measurement. No prohibited write was sent.

The retained change is small and removes a verified startup dependency. Remaining costs are complete portal/Sales reads, especially sequential Sales defaults → attempts → related records → versions; in-app Sales navigation does not improve materially. Further work needs fresh trace evidence and complete-snapshot/permission tests. No recommendation to deploy this branch to production is made.

## Reproduction

With the existing authorised staging diagnostic credentials in ignored `.env.local` and the existing ignored fixture manifest `.next/performance/staging-test-sales.json`:

```powershell
node scripts/diagnostics/mobile-critical-path.mjs artifacts/performance/mobile-critical-path/paired-deployments.json 1 mobile-throttled
Copy-Item artifacts/performance/mobile-critical-path/paired-samples.json artifacts/performance/mobile-critical-path/trace-samples.json
Copy-Item artifacts/performance/mobile-critical-path/paired-verification.json artifacts/performance/mobile-critical-path/trace-verification.json
node scripts/diagnostics/mobile-critical-path.mjs artifacts/performance/mobile-critical-path/paired-deployments.json 5
node scripts/diagnostics/mobile-critical-path.mjs artifacts/performance/mobile-critical-path/paired-deployments.json 2 mobile-throttled --lcp-diagnostic
node scripts/diagnostics/summarize-mobile-critical-path.mjs
node scripts/diagnostics/verify-mobile-critical-path.mjs
```

Use only the verified immutable previews and completed fixtures. Never run the guard against production. `verification.json` records the final checks; raw business bodies, credentials and screenshots are not part of this evidence.
