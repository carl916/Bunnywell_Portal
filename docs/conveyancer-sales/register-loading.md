# Phase 2C: initial conveyancer Sales register loading

9 October 2026. **Select Option B: an opt-in staging override moving only `/api/sales/register` from `iad1` to `fra1`.** In eight paired repetitions per condition, complete actionable readiness improved in all 32 pairs. Median register API latency was below one second in every Frankfurt condition. Some individual requests still exceeded one second; this is not an SLA or production-region recommendation.

The implementation adds a guarded configuration generator, tests and reproducible diagnostics. Application code, workflow rules, UI, authentication, RLS, schema, cache behavior, root `vercel.json` and all three crons are unchanged. **The shared staging alias has not been switched.** The improvement is demonstrated on an isolated Preview; merging the supporting files alone does not activate it.

## A. Baseline and critical path

Vercel inspection confirmed shared staging served `d35a975eb9fe39be41230d0bf3c1c5231420aca2`, the merge of Phase 2B PR #32. Both experiment branches are direct children of that commit. Their only application/deployment difference is the register function region in `vercel.json`; all `src/` files are identical. [Deployment identities](register-loading/deployments.json).

The real authorised conveyancer's All buildings register contains 134 eligible rows, 67 active attempts, 89 legal documents and 60 authority records. Forum House supplies 63 register rows. The existing route still makes one authentication call and sixteen database reads across nine dependency stages for this population; there are no register RPCs.

| Stage | Calls | Dependency |
| --- | ---: | --- |
| Authentication | 1 | Bearer token validation |
| Profile | 1 | Authenticated user ID; active conveyancer role |
| Initial access snapshot | 3 concurrent | Validated profile |
| Authorised buildings | 1 | Completed initial access validation |
| Units, floors, organisations, building relationships | 4 concurrent | Authorised building IDs |
| Active Sales attempts | 1 | Currently waits for all dimensions |
| Documents and authorities | 2 concurrent | Complete attempt IDs |
| Profile recheck | 1 | Completed required source reads |
| Access recheck | 3 concurrent | Unchanged profile |

The register then derives its complete nonfinancial projection and publishes once. Source failures retain the established `actionsAvailable: false` behavior; required dimension failures produce 503 and access changes produce 403. Pagination remains 250 rows per page, related-ID batches remain 150, and source bounds/completeness checks remain intact. Unrelated dashboard, Snags, Rentals, fees, deposits and history are not loaded in register mode.

Fresh shared-staging measurements, milliseconds, **median / p75 / min–max**, eight repetitions per row:

| Condition | Register API | Complete actionable readiness |
| --- | --- | --- |
| Desktop opening | 1,792 / 2,437 / 1,564–2,847 | 2,695 / 2,942 / 2,056–3,353 |
| Desktop Refresh | 1,946 / 2,134 / 1,621–2,645 | 2,229 / 2,521 / 1,894–3,426 |
| Mobile opening | 1,925 / 2,094 / 1,652–2,277 | 2,992 / 3,183 / 2,709–3,349 |
| Mobile Refresh | 1,884 / 1,954 / 1,612–2,200 | 2,527 / 2,600 / 2,270–2,845 |

[Completed baseline samples](register-loading/baseline.json). Route medians were 1,543 / 1,680 ms for desktop opening/Refresh, and 1,637 / 1,640 ms for mobile. Authentication medians were 113–118 ms. All responses were 83,179 decoded JSON bytes, with 17 upstream calls and `iad1` execution metadata. Earlier cold/probe requests were slower and are not mixed into these repeated measurements.

An additional eight local Node executions of the unchanged reader used the same caller JWT and live staging dataset. They independently confirmed the dependency structure. Local median remote spans were: auth 54 ms, profile 53, access group 90, buildings 66, dimensions group 161, attempts 104, legal group 215, profile recheck 61, access recheck 75. **These are local-to-staging remote round trips, not per-stage Vercel timings or database-engine execution.** Deployed diagnostics expose aggregate auth/database spans; independent PostgreSQL engine timings were unavailable. [Per-read offsets and durations](register-loading/read-profile.json).

## B. Options considered

| Option | Evidence and likely benefit | Complexity, security and decision |
| --- | --- | --- |
| A: overlap independent reads | Attempts need authorised building IDs, not completed dimensions. Overlapping those groups could remove one dependency stage; replaying the local spans suggests about 104 ms saved for that specific overlap, not a measured Vercel improvement. | Plausible follow-up. Requires changing the shared reader and testing concurrent failure/publication behavior. Preserve both revocation checks. Lower direct evidence than B; not implemented. |
| B: register-only Frankfurt | Matched live Preview comparison saved 0.8–1.0 seconds in median actionable readiness, with unchanged calls, bytes and content. | One function configuration override; no workflow or authorisation changes. Existing staging opt-in pattern fits. Strongest measured benefit relative to scope; selected. |
| C: narrower derivation | Same live input derived locally in median 16.2 ms, p75 17.5, range 14.1–25.2. A heavier synthetic fixture with an exchanged attempt/deadline on every unit cost about 42 ms at 63 units, 91 ms at 134 and 454 ms at 601. | CPU can matter at larger/different populations, but does not explain the current deployed delay. Avoid duplicating progression rules or broad dashboard refactoring. Not implemented. |
| D: reuse access metadata or add caching | Relationship data is read more than once, but before/after checks detect access changes. Existing scoped navigation retention already addresses repeat returns. | No evidenced alternative justified weakening revalidation or introducing new cache infrastructure. Not implemented. |

[Synthetic derivation samples](register-loading/derivation.json) are CPU observations on this workstation, with one excluded warmup and eight measurements, not user-journey predictions. `deriveDashboard()` still computes summaries and presentation work discarded by the register. Its date formatting, shared authority rules and London/DST behavior remain authoritative and unchanged.

## C. Implementation and deployment isolation

- `config/vercel.staging-register-region.json`: `iad1` default, exact register route overridden to `fra1`.
- `scripts/prepare-staging-register-region.mjs`: merges with current root configuration, preserves cron entries and unrelated function options, rejects unexpected overlays/default-region drift, writes only from `staging` outside a production environment, and supports a read-only `--check`. It never deploys or assigns aliases.
- Focused API/configuration tests and `scripts/diagnostics/register-*.mjs` plus the summary script provide reproducible validation. No application source was changed.

| Variant | Immutable Preview | Commit | Default / register |
| --- | --- | --- | --- |
| A | [Current-region Preview](https://bunnywell-portal-2vgi8dbtu-carl-gilbert-s-projects.vercel.app) | `975efb9` | `iad1` / `iad1` |
| B | [Register Frankfurt Preview](https://bunnywell-portal-mzwlenoks-carl-gilbert-s-projects.vercel.app) | `00f1d1f` | `iad1` / `fra1` |

Both production builds reached READY as Preview deployments. Only the two isolated experiment branches received matching `SALES_PERF_DIAGNOSTICS=1` and `STAGING_WEB_VITALS=1` variables. They inherit the same shared Preview Supabase settings. Browser requests and successful server authentication verified staging backend `vxkpvdtrldwwqiddoyof`; no production credentials were copied. The Web Vitals hostname gate excludes these Preview domains.

All 64 measured register responses matched their intended execution region, using the middle execution component of the full `x-vercel-id`, separately from `lhr1` ingress. All 37 observed successful auth-activity function responses stayed in `iad1`. Four additional Legal validation probes stayed in `iad1`. The root config and cron schedules are unchanged in both experimental commits except the explicit region keys. The experiment does not repeat the earlier blanket-region change. [Read-only region/security/content probes](register-loading/preflight.json).

The implementation follows the documented [Vercel per-function region override](https://vercel.com/docs/functions/configuring-functions/region), and the existing legal-region opt-in pattern. No material scope departure or additional application architecture was needed.

## D. Matched live before/after comparison

Eight alternating A/B rounds on each profile; mobile reverses the initial order. Same conveyancer, dataset, Chromium 149.0.7827.55 and application code. Desktop: 1440×960, no network or CPU throttling. Mobile: 390×844, 4× CPU slowdown, 150 ms network latency, 200,000 bytes/s download and 93,750 bytes/s upload. No overlapping benchmark or CPU test workload ran during the comparison.

Each opening navigates from `about:blank` to All buildings, creating a fresh register owner. The browser cache remains enabled and setup/sign-in/warmup are excluded; this does not claim function cold-start or cold-asset performance. The harness searches Forum House to expose populated rows while retaining the full All buildings response. Readiness requires an enabled responsibility filter, a completed fresh response, visible workflow actions, organisations and dates, and two animation frames. Refresh starts at the actual Refresh interaction; mobile menu opening is excluded. It waits for the new response even while a retained snapshot remains usable. Samples include a further 300 ms observation for duplicate register requests, excluded from readiness time.

**Milliseconds: median / p75 / min–max.** No p95 is reported for eight samples.

| Condition | A API | B API | A actionable | B actionable |
| --- | --- | --- | --- | --- |
| Desktop opening | 1,800 / 1,889 / 1,570–1,995 | 895 / 1,029 / 733–1,258 | 2,217 / 2,258 / 1,916–2,403 | 1,270 / 1,442 / 1,098–1,698 |
| Desktop Refresh | 1,667 / 1,760 / 1,581–2,567 | 873 / 900 / 802–1,039 | 1,953 / 2,049 / 1,882–2,870 | 1,158 / 1,179 / 1,076–1,309 |
| Mobile opening | 1,827 / 1,886 / 1,671–2,028 | 937 / 993 / 818–1,140 | 2,915 / 2,970 / 2,723–3,094 | 2,013 / 2,044 / 1,877–2,229 |
| Mobile Refresh | 1,765 / 1,916 / 1,618–1,985 | 868 / 910 / 787–983 | 2,456 / 2,560 / 2,242–2,636 | 1,497 / 1,546 / 1,407–1,623 |

Median actionable readiness improved 43%, 41%, 31% and 39%, respectively. Every paired journey improved; paired median savings were 947, 830, 875 and 922 ms. There was no desktop navigation regression in this register journey.

| Median server/browser detail (ms) | Desktop open A → B | Desktop Refresh A → B | Mobile open A → B | Mobile Refresh A → B |
| --- | --- | --- | --- | --- |
| Route execution | 1,608 → 828 | 1,435 → 797 | 1,571 → 823 | 1,498 → 759 |
| Authentication round trip | 120 → 71 | 112 → 29 | 125 → 60 | 112 → 34 |
| Sum of DB remote spans, overlapping | 2,551 → 1,198 | 2,394 → 1,169 | 2,555 → 1,191 | 2,364 → 1,096 |
| Journey start to register request | 345 → 348 | 269 → 249 | 1,005 → 1,009 | 603 → 594 |
| Upstream calls | 17 → 17 | 17 → 17 | 17 → 17 | 17 → 17 |
| Sequential dependency stages | 9 → 9 | 9 → 9 | 9 → 9 | 9 → 9 |
| Decoded response bytes | 83,179 → 83,179 | 83,179 → 83,179 | 83,179 → 83,179 | 83,179 → 83,179 |

Database spans overlap and **must not be added to one another or to route duration as sequential time**. Server fetch spans measure remote service headers, not pure database execution. API time includes receiving the response body. Browser readiness includes portal setup, request scheduling, JSON processing, UI checks and rendering; it is not an isolated paint/CPU measurement. Mentions polling and auth activity are excluded from register counts.

All 64 register requests succeeded with one request per journey and zero recorded browser exceptions/blocked writes. Every complete projection had the same SHA-256 after removing only `asOf`, across both variants and profiles. Separate single-building probes also matched exactly. [Raw paired samples](register-loading/comparison.json), [distribution summary](register-loading/summary.json).

These are live staging-backed Preview results, not simulations. Separate builds and ordinary shared infrastructure leave possible CDN, connection and service variability. Alternation and stable pre-request timings reduce that uncertainty but do not establish production benefits, cold-start tails or all portal navigation performance. The earlier preliminary harness runs stopped at hidden mobile controls; only completed corrected baseline runs are included. Two deployment API requests initially rejected `target: preview`; the documented omitted target created Preview deployments. Neither setup issue is counted as a successful sample.

## E. Validation

| Check | Result |
| --- | --- |
| Existing Sales Node suite | 278 passed |
| Register retention/refresh/auth suite | 55 passed |
| Dashboard, API and handoff suites | 39 passed |
| Register, security, discussion/actor and performance suites | 50 passed |
| New configuration guard tests | 3 passed (temporary Git test needs filesystem permission outside the sandbox restriction) |
| Register, Phase 2B, corrections and loading browser suite on B | 47 passed; 1 baseline-reproduced failure; 1 explicitly opt-in comparison skipped |
| Legal workflow and stage-task browser suites on B | 23 passed |
| TypeScript, changed-file ESLint, whitespace | Passed |
| Production compilation | Both immutable Vercel Preview builds READY |

The added API cases cover auth failure before data reads, required-dimension/access failure, 601 units with paginated attempts and batched legal data, exact single-building equivalence, and incomplete/failed later pages disabling every action. Existing tests cover organisation/identity/access changes, date and authority correctness including London DST, responsibility, ordering, stale snapshots, 401/403, mutation invalidation, coalescing, both Back paths and no duplicated detailed requests. Phase 2B selected-unit and internal admin/developer browser cases passed. The cached-return test rendered the retained register in 9 ms with its refresh deliberately delayed. No real legal mutation or external email was used; synthetic browser mutations were intercepted.

**Existing failure:** `conveyancer-sales.spec.ts` “repeated navigation keeps one set of refresh listeners…” expects total visibility listeners to remain 10 but observes 13. The unchanged A Preview reproduces the identical failure; other tracked event counts match. This task does not establish the extra listeners' source and does not change application listener code to address it. Other navigation/invalidation/request-count checks pass. Retain this limitation rather than treating the entire browser suite as green.

## F. Remaining bottlenecks

The nine-stage remote critical path remains. The Frankfurt route still takes roughly 0.76–0.83 seconds at the median, so independent-read overlap is the next focused server candidate if further improvement is needed. On throttled mobile, portal/bootstrap work delays the register request by about one second on opening and 0.6 seconds on Refresh, unchanged between variants. Faster API responses therefore leave about two seconds of complete opening time. CPU derivation becomes more relevant for heavily populated larger portfolios. None of these independent optimisations is included here.

## G. Review and later staging activation

Feature branch: `codex/sales-register-loading`, targeting `staging`. Do not merge either experiment branch: their root region configurations are for isolated A/B evidence only.

After a separately approved merge/activation, follow the same process as the [existing staging legal-region deployment](../staging-legal-region-deployment.md): verify the existing Bunnywell team/project and the staging Preview backend, generate from a clean `staging` checkout, then switch to a new isolated branch before deploying the generated local config. The helper does not fetch environment secrets or deploy:

```powershell
node scripts/prepare-staging-register-region.mjs --check
node scripts/prepare-staging-register-region.mjs
# After switching to a new isolated preview branch and verifying Preview settings:
vercel deploy --target preview --local-config .vercel/staging-register-region.json
```

Verify register `::fra1::`, other function regions, complete browser readiness and source commit before any separately authorised alias assignment. Do not use a production target or change the project-wide default. An ordinary Git deployment still uses the unchanged root `vercel.json`; discarding the temporary config restores ordinary future deployments. Existing deployments require a new deployment to change region.

Reproduction scripts read the existing local staging test credentials without printing them. `register-loading-browser.mjs` defaults to shared staging; set `REGISTER_PERF_TARGETS` to an object containing the two immutable Preview origins and `REGISTER_PERF_OUTPUT` to an ignored result path for a paired run. It defaults to eight rounds. Run `register-region-preflight.mjs` with those targets first. `register-read-profile.mjs` is a local caller-JWT read profile; `register-derivation-profile.mjs` is entirely synthetic. Generate distributions with `node scripts/diagnostics/summarize-register-loading.mjs <samples.json>`. No HARs, credentials, business payloads or buyer data are committed.
