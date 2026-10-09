# Bunnywell whole portal Frankfurt region trial

9 October 2026. **Frankfurt was not activated. Shared staging remains in US East, and production is unchanged.** Frankfurt substantially improved typical dashboard and Sales performance, but the dashboard twice stalled inside its remote database-read path: 22.8 seconds in the main browser batch and 46.7 seconds in the focused follow-up. That unresolved tail latency fails the requested reliability gate for a whole-application switch.

## Environment and deployment isolation

The application baseline is staging commit `d6434a0fdab575f9940430e2c2d8bda350ecbf3e`, including the merged Phase 2C work. Shared staging initially served `dpl_6ePNSppjMSUf1BtcLJDCtWwJRxyo` in `iad1`. The register-only Frankfurt overlay was **not active**: successful register responses executed in `iad1`.

| Deployment | Immutable Preview or production URL | Commit | Execution region |
| --- | --- | --- | --- |
| Original staging and rollback | [enu9sezk1](https://bunnywell-portal-enu9sezk1-carl-gilbert-s-projects.vercel.app) | `d6434a0` | `iad1` |
| A current region | [1ga9v1i5o](https://bunnywell-portal-1ga9v1i5o-carl-gilbert-s-projects.vercel.app) | `635b3b6` | `iad1` |
| B Frankfurt | [f65jzpsoj](https://bunnywell-portal-f65jzpsoj-carl-gilbert-s-projects.vercel.app) | `610e4e9` | `fra1` |
| Production | [dmms8oftq](https://bunnywell-portal-dmms8oftq-carl-gilbert-s-projects.vercel.app) | `87ffc9b` | `iad1` |

All deployments belong to `bunnywell-portal`, project `prj_4s8vIyfrGh9DSGJcixTU5slevr5P`, team `team_x65ctL8Fot37UcabAkdh8f72`. Both trial browsers were verified against staging Supabase `vxkpvdtrldwwqiddoyof` in `eu-central-1`. Production Supabase is the distinct project `zxgezoiazsubopqhqhim`, also in Frankfurt. No project-wide default, production environment, production alias, schema or RLS policy was changed.

The initial deployment API attempt to set `projectSettings.serverlessFunctionRegion` did not change runtime placement. Those setup deployments were excluded. The validated pair therefore uses two isolated configuration-only child commits of the same application baseline: `codex/full-region-trial-a` and `codex/full-region-trial-b`. Their sole diff is `vercel.json` region `iad1` versus `fra1`; application files, dependency versions and the `src` tree (`84a14ae9c74b624585e4a9d18897a951f7aedd72`) are identical. **Do not merge either trial branch into staging or main.**

Both inherit the same Preview environment entries and receive the existing staging diagnostics flags as matching branch overrides. The normal root configuration remains unchanged. It has no active region or per-function override; no source-level region or Edge runtime override was found. Sampled function responses verify the execution component of `x-vercel-id`, not merely the London ingress component.

The three staging cron entries remain intact: completion uploads at `15 3 * * *`, and snag digest at `30 6 * * *` and `30 7 * * *`. Main independently contains two backup-health schedules at `0 6 * * *` and `0 7 * * *`; they were untouched. Cron handlers were not invoked. Vercel schedules crons for production deployments; these Preview deployments do not run the schedules. [Vercel cron configuration](https://vercel.com/docs/project-configuration/vercel-ts#crons).

## Controlled comparison

The final batch uses real authenticated staging reads as admin and conveyancer, with eight alternating A/B pairs per repeated journey. Desktop is 1440 × 960. Simulated mobile is 390 × 844, fourfold CPU slowdown, 150 ms added latency, 200,000 bytes/s download and 93,750 bytes/s upload. Chromium is version 149. Cold means an emptied browser cache, not a guaranteed cold function. Repeat loads keep the browser cache. Only one measured browser is active at a time; no other diagnostic workload ran alongside the final batch.

The main batch includes one full-photo Snags comparison per profile because its image transfer is substantial. An additional eight desktop Snags pairs investigate the initial transfer difference. A separate eight-pair dashboard follow-up investigates the long database-read delay. These follow-ups remain separate from the main distributions. The seven-endpoint API diagnostics also have eight alternating pairs per endpoint; they were collected during setup and serve as supporting server evidence.

Complete readiness is the later of enabled/loaded controls plus two animation frames and completion of critical network requests. On cold loads, visual readiness means the primary heading is visible; other actions use their first semantic readiness check. Actionable readiness adds the control check and two frames. These are browser readiness proxies, not isolated paint measurements. Mentions polling and authentication activity count toward requests and bytes but do not hold readiness open. Minimum, maximum, p50, p75, paired differences, request counts, bytes, request offsets, cache results and full region headers are retained. Eight samples do not support a reliable p95 claim.

The two builds have byte-identical CSS and application chunks. The only differing initial asset is the Turbopack runtime, whose bytes match after normalizing its deployment ID. This controls application build differences but does not eliminate shared CDN, connection, database or platform variability. Browser-to-Supabase traffic still goes directly to Frankfurt in both variants; static delivery remains through Vercel's CDN. [Function region configuration](https://vercel.com/docs/functions/configuring-functions/region).

Live legal reads were restricted to sales proven to have no outstanding authority capable of expiring. The two progression fixtures are completed sales. Unit-open audit calls and comment read receipts were suppressed equally in both variants; authentication/session activity remained normal. Other business writes were blocked. Before/after hashes cover Forum House units, attempts, legal emails, workflow events and documents/versions. Only timing, count and hash metadata is retained, without credentials, business response bodies or HAR files.

## Performance results

The main batch completed **996 interactions across 64 role/profile/journey combinations**, with eight pairs for every repeated journey. All 576 captured function responses executed in the intended region. There were no failed journeys, recorded browser exceptions, failed requests or blocked business writes, and protected sales hashes were unchanged.

The following table shows complete readiness in milliseconds as **p50 / p75**. The [full distributions](staging-full-frankfurt-trial/distributions.md) cover every journey, including Reservation, Completion, comments, both Back paths, another sale, Setup, units and users, with min/max, paired differences, request counts and bytes.

| Journey | Desktop A | Desktop B | Mobile A | Mobile B |
|---|---:|---:|---:|---:|
| Admin dashboard initial | 3,952 / 4,040 | 2,406 / 2,420 | 7,227 / 7,390 | 5,676 / 5,926 |
| Admin dashboard repeat | 3,216 / 3,476 | 2,422 / 2,449 | 4,094 / 4,339 | 2,820 / 2,946 |
| Dashboard Refresh | 2,785 / 2,962 | 1,616 / 1,743 | 2,919 / 2,968 | 1,861 / 1,939 |
| Dashboard building change | 2,913 / 2,921 | 1,893 / 1,899 | 3,036 / 3,040 | 1,997 / 2,005 |
| Return to Dashboard | 2,939 / 3,417 | 1,905 / 1,912 | 3,513 / 3,522 | 1,978 / 1,982 |
| Admin Sales overview | 855 / 855 | 854 / 862 | 1,445 / 1,470 | 1,469 / 1,474 |
| Admin sale file | 164 / 171 | 150 / 174 | 185 / 196 | 202 / 221 |
| Admin Exchange section | 1,607 / 1,615 | 1,102 / 1,114 | 1,801 / 1,822 | 1,293 / 1,302 |
| Dashboard task to sale | 870 / 891 | 870 / 872 | 1,431 / 1,433 | 1,414 / 1,437 |
| Conveyancer Sales initial | 2,767 / 2,974 | 1,548 / 1,698 | 5,715 / 5,849 | 4,756 / 4,829 |
| Conveyancer Sales repeat | 2,216 / 2,329 | 1,211 / 1,231 | 2,862 / 3,026 | 2,033 / 2,105 |
| Register Refresh | 2,170 / 2,291 | 1,091 / 1,118 | 2,670 / 2,767 | 1,627 / 1,658 |
| Register building change | 1,698 / 1,919 | 783 / 811 | 1,917 / 2,031 | 933 / 1,031 |
| Conveyancer sale file | 879 / 882 | 390 / 871 | 933 / 942 | 931 / 947 |
| Conveyancer Exchange | 1,611 / 1,632 | 1,104 / 1,110 | 2,354 / 3,024 | 1,878 / 2,498 |
| Rentals | 879 / 1,386 | 862 / 870 | 1,448 / 1,460 | 930 / 940 |
| Setup | 647 / 668 | 676 / 749 | 1,322 / 1,361 | 1,309 / 1,352 |
| Users and access | 580 / 588 | 593 / 640 | 1,245 / 1,258 | 1,255 / 1,280 |

Frankfurt improves initial dashboard readiness by 39% on desktop and 21% on mobile. Initial conveyancer Sales readiness improves by 44% and 17%; explicit register Refresh improves by 50% and 39%. Every paired initial load and Refresh in those four role/profile combinations is faster in B. Admin Sales overview, task links, Setup, users/access and most cached interactions remain close. Smaller percentages on interactions lasting tens of milliseconds are not treated as meaningful regressions.

The earlier broad **desktop navigation slowdown did not recur consistently**. Desktop Sales navigation is 855 → 854 ms; Setup is 647 → 676 ms; users/access is 580 → 593 ms; returning to Dashboard improves 2,939 → 1,905 ms. Browser-to-Supabase reads still dominate several unchanged paths. The separate desktop Snags follow-up is discussed below.

Desktop median offsets from the action start (A → B, milliseconds); direct-data completion excludes background polling.

| Measurement | Dashboard cold | Register cold | Admin Sales navigation |
|---|---:|---:|---:|
| Document complete | 39 → 33 | 33 → 37 | — → — |
| JS/CSS complete | 218 → 212 | 196 → 197 | — → — |
| First direct Supabase read | 332 → 346 | 351 → 308 | 31 → 31 |
| Critical direct Supabase reads complete | 616 → 608 | 775 → 649 | 636 → 600 |
| Visual readiness | 1,017 → 1,049 | 1,031 → 1,021 | 837 → 840 |
| Handler duration | 2,681 → 1,493 | 1,762 → 803 | — → — |
| Usable controls | 3,952 → 2,406 | 2,767 → 1,548 | 855 → 854 |

All cold-load document and same-origin static responses in these desktop samples were CDN HITs. The asset and first direct-read offsets give no evidence of the earlier broad desktop scheduling regression. Faster completion of a browser read is not attributed to moving the Vercel function.

### Server and remote service timings

The separate API results support a real reduction in remote round-trip cost. These are successful authenticated reads; allocation uses its default authorised portfolio scope because that endpoint ignores a building query parameter.

| Endpoint and scope | A p50 / p75 ms | B p50 / p75 ms |
|---|---:|---:|
| admin /api/dashboard all | 2,857 / 2,998 | 1,507 / 1,620 |
| admin /api/dashboard single | 2,534 / 2,930 | 1,296 / 1,351 |
| admin /api/rentals/tenancies default | 553 / 687 | 165 / 192 |
| admin /api/rentals/rent-risk default | 563 / 694 | 202 / 221 |
| admin /api/units/allocation default | 548 / 726 | 195 / 215 |
| conveyancer /api/sales/register all | 1,817 / 1,896 | 862 / 965 |
| conveyancer /api/sales/register single | 1,645 / 1,734 | 707 / 809 |
| Legal GET (admin desktop, main batch) | 1,129 / 1,190 | 499 / 601 |

Legal handler duration improves 958 → 430 ms, auth 124 → 57 ms, and overlapping read spans 1,574 → 592 ms in those desktop admin samples. Its expiry RPC was proven to be a no-op for the selected fixtures; no legal-state mutation was performed.

Instrumented median handler durations are 2,611 → 1,402 ms for the all-building dashboard and 1,586 → 747 ms for the all-building register. Their auth round trips are 130 → 49 ms and 112 → 40 ms respectively. Overlapping database-fetch span sums are 6,603 → 4,015 ms and 2,511 → 1,109 ms. These fetch spans measure remote headers, not database CPU execution, and **must not be added together or added to handler elapsed time**. Rentals and allocation have no equivalent server breakdown; none is inferred.

### Tail latency and photo transfer

The Frankfurt desktop building switch took **22,790 ms** in round 1; its handler took 22,493 ms and its final database read ended 22,443 ms after entry. That sample remains in the original distribution. The same journey still has a favorable B median/p75 of 1,893/1,899 ms, illustrating why those statistics alone are insufficient.

The preannounced follow-up used eight further alternating pairs against the same single-building dashboard endpoint. A was **2,441 / 2,571 / 2,293–2,690 ms** (p50 / p75 / min–max). B was **1,534 / 1,715 / 1,291–46,743 ms**. Seven of eight follow-up pairs were faster in B. The second stall's handler took 46,650 ms, auth 119 ms, and the final database read ended at 46,609 ms. All source states were ready and the HTTP status was 200. Recent 30-minute runtime error/fatal groups were empty; a one-hour log query exceeded available retention.

This is a reproducible reliability concern in B, not proof that Frankfurt geography itself causes the stalls. The current spans cannot identify the individual delayed query or distinguish connection/transport, service queueing, database waiting and platform scheduling. It is sufficient reason to withhold blanket activation while retaining the substantial median gains as evidence for a focused investigation.

The original desktop Snags sample transferred about 25 MB and finished in 9.00 seconds on A versus 10.62 on B, while controls were usable in 1.89 versus 1.88 seconds. The separate eight-pair follow-up found A **9,040 / 9,182 / 8,956–9,314 ms** and B **9,031 / 9,119 / 8,867–9,858 ms**, with a paired median B−A of −16 ms and four faster pairs each. Usable controls were 1,898 → 1,901 ms. This supports transfer variability rather than a repeatable desktop Snags regression. The follow-up reloaded the Sales overview with an empty browser cache before each Snags navigation; it is kept separate from the main batch.

On mobile, the single full-photo sample is 48.40 → 48.34 seconds for about 9.37 MB, dominated by the imposed bandwidth and viewport-dependent image loading. Controls become usable much earlier. Photo delivery goes directly to Supabase Storage, so these transfer differences are not attributed to the Vercel function region. Another retained outlier is admin mobile Exchange: B max 3.36 seconds versus A 2.29, despite B's better median/p75; all ranges remain in the full distributions.

## Functional and security verification

The existing Node suite initially returned 522 passes out of 524. The temporary-Git configuration test failed under the filesystem sandbox and passed all three cases when rerun with the required permission. The remaining source assertion failure is pre-existing: the global-building-context test rejects the current AuditLog component's `setBuildingId` usage. No application source changed in this trial.

The selected existing browser suite against B returned 77 passes and the already documented listener-count failure: repeated navigation expects 10 visibility listeners and observes 13. The same failure reproduces on A. Passing cases cover snapshot retention, cached returns, stale responses, explicit refresh, access revocation, 401/403 handling, selected-unit loading, current-version approvals, synthetic legal transitions, both Back paths and dashboard worklists. Synthetic writes were intercepted by the existing fixtures. These results are not an entirely green suite.

An accidentally included live unit-allocation mutation test stopped at its first missing environment check, before creating a client, signing in or writing any data. It was removed from the trial's synthetic-only Playwright configuration and was not rerun with live credentials. Real allocation coverage uses read-only browsing and API GETs.

The 112 paired API reads succeeded, and 12 initial authentication/scope denials returned the expected 401/403. Additional live checks confirm that the all-building register's 134 rows and Forum House's 63 rows stay within the caller's RLS-visible units, and the single-building projection contains only that building. Role denials for admin use of the conveyancer register and conveyancer use of unit allocation returned 403. This conveyancer can see all available building fixtures, so a real inaccessible-building probe was unavailable; nonexistent-building denial and synthetic access-revocation tests supply that part of the coverage.

All eight Legal reads matched across the four role/sale pairs in A/B, preserving workflow, approval and document/version content in the normalized hashes. Register projections also match after normalizing `asOf` and array order. The 64 conveyancer in-app/browser Back returns made **zero register refetches**. All four role/profile logout checks passed on B, after closing the paired A context because application logout intentionally invalidates all sessions.

Protected hashes remained unchanged across the main run, both focused follow-ups, Legal/content checks and final endpoint probes. They cover 64 units, 66 attempts, 60 legal emails, 590 workflow events and 131 documents with nested versions. No real legal transaction, upload or email was performed. Changed-file ESLint passed; both immutable Preview builds are READY. No schema, RLS or application code was edited.

## Activation and rollback

**No alias was reassigned.** [Shared staging](https://staging.bunnywell.co.uk) still serves `dpl_6ePNSppjMSUf1BtcLJDCtWwJRxyo`, application commit `d6434a0fdab575f9940430e2c2d8bda350ecbf3e`, in `iad1`. Authenticated reads against the actual staging hostname passed for Dashboard, register, safe Legal, Rentals and allocation. The same reads passed against the retained immutable rollback URL, with `::iad1::` execution headers. That deployment remains the active, read-tested rollback target.

The unactivated Frankfurt deployment remains available at [f65jzpsoj](https://bunnywell-portal-f65jzpsoj-carl-gilbert-s-projects.vercel.app), deployment `dpl_65m9VaVnXGP5QPfvuUZ712rgaoKE`, configuration commit `610e4e998a52495b29870d7694ca5d457e64b118`. Its tested functions execute in `fra1`, but its dashboard tail latency needs investigation before a blanket rollout.

Production remains deployment `dpl_63zzZzc3KFqbZjcmyCa6Jm8AfS5W`, main commit `87ffc9b52884f83c91253858d16fa0fe03b5c8af`. Both `portal.bunnywell.co.uk` and `defects.bunnywell.co.uk` still point there, and anonymous Rentals requests returned the expected 401 with `::iad1::` headers. Its other listed aliases and region are unchanged. Final Git remote checks confirm both branch heads remain at the baseline commits.

If a later authorised trial requires rollback, the exact retained target is:

```powershell
vercel alias set bunnywell-portal-enu9sezk1-carl-gilbert-s-projects.vercel.app staging.bunnywell.co.uk --scope carl-gilbert-s-projects
```

This command is documented, not executed: staging never left that deployment. Do not use a production promotion or change shared project defaults.

## Future staging deployments

The immediate recommendation is to retain `iad1` for the dashboard and normal staging deployment, investigate the delayed dashboard fetches with per-query timing and platform/database correlation, and consider the already tested targeted Legal/Register overrides in a separate staging rollout. This trial did not activate those overrides either. Resolve the tail concern before repeating a whole-application activation gate.

If a future Frankfurt trial passes, an alias assignment to an isolated deployment is temporary. The next ordinary Git deployment of `staging` uses the unchanged root configuration and can overwrite the alias with an `iad1` deployment. It cannot make Frankfurt durable by itself.

For a later durable change, use one programmatic `vercel.ts` configuration replacing `vercel.json`, with the Frankfurt override gated strictly by both `VERCEL_ENV === "preview"` and `VERCEL_GIT_COMMIT_REF === "staging"`. Preserve the existing default otherwise, including production. Vercel supports build-time configuration and the same region/cron fields; it requires a single configuration file. This is a small follow-up configuration PR, not a new deployment architecture. [Programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

That follow-up should test production, main, staging and ordinary PR branches; verify system-variable availability during configuration evaluation; retain all current cron and function settings; and verify actual runtime regions after deployment. Main's extra backup-health schedules must survive any reconciliation. Do not copy the unconditional Frankfurt trial config into main. A separate Vercel project offers stronger isolation but adds environment/domain/cron administration and is unnecessary unless the existing project cannot support the guarded configuration. No permanent restructuring was implemented here.

## Reproduction and evidence

The final main batch ran 12:25:36–12:52:23 UTC. Preliminary selector/auth/session setup attempts and the deployments with ineffective API region settings are excluded. The original shared staging and production identities are retained in [environment evidence](staging-full-frankfurt-trial/environment.json), with the config-only branches, flags and cron definitions.

- [All journey distributions and request/byte medians](staging-full-frankfurt-trial/distributions.md); [full summary including API spans and network categories](staging-full-frankfurt-trial/summary.json).
- [Sanitized main browser requests](staging-full-frankfurt-trial/browser.json); [paired API checks](staging-full-frankfurt-trial/api.json); [dashboard tail follow-up](staging-full-frankfurt-trial/dashboard-tail.json).
- [Desktop Snags follow-up](staging-full-frankfurt-trial/snags-followup.json); [its distributions](staging-full-frankfurt-trial/snags-summary.json); [initial asset hashes](staging-full-frankfurt-trial/assets.json).
- [Legal and access verification](staging-full-frankfurt-trial/content.json); [final staging/rollback/production probes](staging-full-frankfurt-trial/final-probes.json); [infrastructure verification](staging-full-frankfurt-trial/infrastructure.json); [final alias readbacks](staging-full-frankfurt-trial/final-aliases.json).
- [Node test output](staging-full-frankfurt-trial/node-tests.txt), [configuration-test rerun](staging-full-frankfurt-trial/config-tests.txt), [B browser tests](staging-full-frankfurt-trial/functional.txt), [baseline failure reproduction](staging-full-frankfurt-trial/functional-control.txt).

See the [archive inventory and offline reuse instructions](staging-full-frankfurt-trial/README.md). The conveyancer email must now be supplied as `REGISTER_PERF_EMAIL` (the archived helper no longer embeds an account address). Reproduction uses the existing authorised staging credentials in ignored `.env.local`; do not print or commit them. Create the ignored `test-results` output directory first. Set `FULL_REGION_TARGETS` to a JSON object with keys `a` and `b` and the A/B immutable URLs above. `full-region-browser.mjs` defaults to eight rounds and both roles/profiles. Use `FULL_REGION_FOCUS=snags`, `FULL_REGION_ROLES=admin`, `FULL_REGION_PROFILES=desktop` and a separate `FULL_REGION_OUTPUT` for the Snags follow-up; clear that focus for the full trial. `full-region-api.mjs` accepts `FULL_REGION_API_FOCUS=dashboard-single` and `FULL_REGION_API_OUTPUT` for the separate tail check. Do not run diagnostic workloads concurrently with a timed batch. `full-region-content-check.mjs` and `full-region-final-probes.mjs` run the additional protected reads; for a fresh checkout, copy the retained environment evidence to `test-results/full-region-environment.json` before running the final probes.

Generate the main summary with `node scripts/diagnostics/summarize-full-region.mjs <browser.json> <summary.json>`. The synthetic-only browser suite uses `playwright.region-trial.config.ts` and `FULL_REGION_ORIGIN`; keep live mutation suites excluded. Diagnostic code and this report were collected on `codex/full-frankfurt-trial` and preserved on `codex/preserve-frankfurt-trial`; deployment branches are isolated experiments and must not be merged.
