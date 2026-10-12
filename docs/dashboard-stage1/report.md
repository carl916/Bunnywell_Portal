# Stage 1 dashboard performance

Implemented against staging commit `2c8e189` on `codex/dashboard-stage1-performance`, 12 October 2026. This base includes the newer dashboard metric, ownership and historical Agent Fees fixes. No schema, SQL/RPC, RLS, permission, layout or deployment configuration changes are included.

## Changes

`dashboardResponse()` derives the complete authorised snapshot and internal overview before applying the existing `datesToReview()` selector to the transmitted items. It does not truncate to the five initially visible entries. Summary values, activity, source availability, ordering, deadlines, labels, links and exception classifications are unchanged. Roles without the internal overview retain the complete detailed worklist. Other consumers of `deriveDashboard()` still receive every item.

The portal shell now loads six shared database reads (assuming one page per complete list): the current profile, buildings, units, building organisation links, the current user's unit access and the current user's building access. Authentication validation is additional and unchanged. These reads support authorised navigation and existing building-context selection; units are retained because role-based building scope can depend on unit access.

Eight reads are deferred from dashboard startup:

| Dataset | First required screen |
|---|---|
| Building floors | Sales, Rentals, operational screens or Setup; screens wait for floors before presenting ordered units |
| Unit types, unit type areas | Setup Buildings |
| Trades | Snags, Units or resident operational screens |
| Organisations | Sales, Rentals, operational screens, Setup Buildings/People/Activity |
| Full profile list | Sales, operational screens, Setup People/Activity |
| All-user building and unit access lists | Operational screens or Setup People; current-user access checks remain in startup |

Areas, snag records/media/history, handovers, meters and admin access requests continue to load only when their screen needs them. Setup Allocation only needs floors in addition to the shell. A screen dependency list and per-mounted-portal loader share successful and in-flight reads across navigation. There is no persistent, cross-user, cross-organisation or time-based cache.

Auth changes, logout, failed access rechecks, explicit refresh and mutation refresh invalidate the deferred loader. Late responses cannot publish after invalidation. A same-access refresh preserves the mounted active screen and its form/navigation state; other screens reload their data on their next visit. Concurrent navigation during refresh is covered. Failed initial/deferred reads leave screens loading/unavailable, rather than passing empty lists to forms or rendering false zero counts. The header Refresh also requests a fresh dashboard snapshot.

The API's caller JWT/RLS reads, authentication, profile checks and both complete access validations are unchanged. Tests compare the old and new response composers through the real route for all six supported roles and confirm identical database call sequences and summaries.

## Measurements

Verified local comparison: the same Next 16.2.7 development server with webpack, Chromium, synthetic developer, one accessible building, warm assets, and three reloads per version. The existing building-context hook resolves the initial all-building URL to the only building. Data requests are intercepted; these timings contain **no live Supabase latency**. The ready signal requires a refreshed dashboard snapshot and an enabled Refresh work button; request counting continues until network idle. Extensions are absent.

| Metric | Before | After |
|---|---|---|
| Initial browser requests | 28 in each of 3 runs | 20 in each of 3 runs (8 fewer; 28.6%) |
| Initial browser Supabase requests | 17 in each run | 9 in each run (8 fewer; 47.1%) |
| Dashboard server-side Supabase calls | Existing authorised read sequence | Same sequence, verified for all six roles; no server calls removed |
| Dashboard API duration | Live duration not measured in this comparison | Not measured; browser API is intercepted |
| Dashboard data-read phase | Live duration not measured | Not measured; reader and access-validation sequence unchanged |
| Dashboard JSON response size, separate 60-sale fixture | 171,194 bytes; 188 items | 12,311 bytes; 8 items (92.8% fewer bytes) |
| Time to usable dashboard | Median 951 ms; range 900–979 ms | Median 837 ms; range 825–840 ms (114 ms / 12.0% lower) |

The payload fixture uses the same fixed time, buildings, role, sales and source data for both versions. Eight sales have near-term dates and the remaining sales have future dates. Bytes are uncompressed UTF-8 JSON, not compressed network transfer. The size ratio depends on the real work/date distribution. Regression tests also cover more than five relevant dates, unallocated and urgent work, unavailable sources, multiple roles and scopes, and byte-for-byte identical rendered internal HTML.

Raw evidence: [before browser samples](browser-before.json), [after browser samples](browser-after.json), [payload comparison](payload.json). Reproduce the payload result with `node scripts/diagnostics/dashboard-stage1-payload.mjs`. Browser measurement is opt-in via `STAGE1_BENCHMARK=before` or `after`, using `tests/dashboard-stage1.spec.ts` with `playwright.dashboard.config.ts` and `DASHBOARD_BROWSER_ORIGIN` pointing to the running local server. The before flag changes the fixture response only: reproducing the original startup counts requires the baseline portal source as well.

The supplied staging HAR reported 89 browser requests (including extension traffic), 52 browser Supabase requests, 27 dashboard server calls, approximately 4,044 ms API duration, 3,770 ms data-read elapsed time, 262 KiB JSON and 248 items. Time to usable dashboard was not supplied. No equivalent live after-HAR has been captured, and the current staging base contains subsequent fixes, so those figures must not be compared directly with the local fixture results. Overlapping database durations have not been summed.

This change demonstrates fewer browser reads, lower internal response volume and a lower local median startup time. **It does not demonstrate a faster server-side database phase:** complete calculations and server reads intentionally remain. A matched staging HAR on the same account/building scope is still needed to establish the real latency gain.

## Redundant-read review

- Startup previously fetched profiles twice and each access table twice: an own-user check plus an all-user operational/setup list. The broad lists are now deferred; the security checks remain.
- Browser floors and organisation-name reads overlapped with dashboard API dimensions. They no longer run at dashboard startup, and are loaded later for the screens that use them.
- Buildings, units and building organisation links remain on both sides. The browser needs these for navigation/scope; the API independently validates its caller and computes authoritative results. Reusing an untrusted browser snapshot would weaken that boundary.
- Before/after API profile and access reads are intentional revocation checks, not redundant duplicates.
- Both existing `sale_mentions_inbox` startup requests remain in the captured results. Mentions, unread state, audit activity and polling were not removed. Consolidation would need separate evidence that consumer scopes and freshness requirements are identical.
- Navigating Sales → Rentals → Snags → Units → Setup → Snags reads shared shell tables once, and operational resources once; explicit Refresh invalidates them and the next operational visit reads them again. This is asserted in the browser suite.

## Validation

| Check | Result |
|---|---|
| `npm run test:dashboard` | 86 passed, including complete-response parity, rendered dates, external worklists, historical fees/ownership, source failures, RLS fixtures, revocation, loader races and session lifecycle |
| `npm run test:sales` | 308 passed |
| `npm run test:sales-refresh` | 55 passed |
| `npm run test:audit` | 7 passed |
| `npm run test:rentals` | 57 passed; 1 pre-existing source-text assertion failed |
| Dashboard browser suite | 12 passed using the reduced production response composer |
| New Stage 1 browser regressions | 4 passed: deferred reads/navigation/refresh, failed-load retry, logout during an outstanding read, and navigation during refresh without remounting the current screen |
| Sales legal and stage browser tests | 23 passed across runs; one completion-reload readiness check timed out during the larger run, then all 4 stage tests passed on rerun |
| Agent Fees browser suite | 18 passed; 2 optional evidence captures skipped |
| Opt-in startup benchmark | Before and after captures passed |
| `npx tsc --noEmit` | Passed |
| ESLint for added modules, route, tests and diagnostic script | Passed |
| Full `npm run lint` | 20 existing errors, 33 warnings; no new error introduced |
| `git diff --check` | Passed |

The existing Rentals failure is `tests/rentals-tenancies.test.mjs`, “Agent Fees applies the shared global building scope”: its regex expects the older `feeScopeRows(rows??[],buildingContextId,filters.agent)` source. Both that test and `AgentFeesPortfolio.tsx` are identical to the staging base. They are outside this performance change. Full lint errors are in the existing `PortalApp`, `ProductionPortalApp`, `SalesForecastingModule` and `SalesReservationWorkflow` components. The 13 errors in the modified portal component were also confirmed by linting its baseline source; the other error-bearing files are unchanged.

Browser Supabase/API traffic uses synthetic intercepted records. Route tests execute the real API handler with a mocked caller client; existing PostgreSQL fixtures exercise security and workflow rules. These checks do not replace live staging RLS/latency verification. No live data was changed by validation, and no schema or production configuration was changed.

## Stage 2 opportunities, by likely impact

1. **Investigate the server data-read critical path.** The supplied HAR attributes roughly 3.77 seconds of 4.04 seconds to this phase. Use the existing diagnostics and matched staging samples to identify actual slow calls and query plans, including workflow context/actor and full Agent Fees portfolio RPCs. RPC/SQL/index work requires a separate stage; there is no evidence here to rank individual queries by elapsed contribution.
2. **Shorten independent source waits and selected-building over-fetch.** The reader waits for a whole source group before starting dependent legal/history/rent-risk work. Evaluate dependency-specific scheduling. The fee RPC returns the authorised portfolio before building filtering; assess a safely scoped equivalent while retaining historical fee eligibility and full counts. Keep the final access revalidation.
3. **Assess a smaller authoritative portal bootstrap.** Buildings/units remain complete browser lists for role scope and navigation. A separately designed bootstrap contract could reduce columns and overlap with dashboard dimensions, but must preserve unit-granted building access and avoid an extra request or stale shared cache.
4. **Review the two mention-inbox consumers.** If scope, unread behaviour and polling are proven equivalent, share an in-flight read within the page. This is lower impact than the server read phase and is deliberately unchanged here.

PR target: `staging`. Do not merge or deploy to production as part of this task.
