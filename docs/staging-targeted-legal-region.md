# Targeted Sales legal function region — 5 October 2026

**The targeted `fra1` override worked and improved complete legal actions without reproducing the earlier material desktop navigation regression. An opt-in staging configuration is supported; production adoption is not established.** Exchange entry improved by about 1.03 seconds on both profiles. The single fresh authority-issue pair improved from 2.926 to 0.878 seconds, including its context and portal refreshes. One mutation per region is too few for a firm mutation latency conclusion.

The application baseline is staging commit `9f423a0fe4d45204ac3ecf7d958b3d2b9a6d34d2`. The [earlier 5 October comparison](https://github.com/carl916/Bunnywell_Portal/blob/803caeb82297bf439c7d29a6ec2f5174d7cb3083/docs/staging-function-region-ab.md) is the historical reference. It measured a blanket region change and a substantial desktop navigation regression. This test uses new previews and moves only the legal function.

## Deployment and isolation

| Variant | Immutable preview | Commit | Default / legal region |
|---|---|---|---|
| A | [A preview](https://bunnywell-portal-mwvgb5vko-carl-gilbert-s-projects.vercel.app) | `73b935201aaf25705a297963f6fcdab78b0441e7` | `iad1` / `iad1` |
| B | [B preview](https://bunnywell-portal-11i4lffpk-carl-gilbert-s-projects.vercel.app) | `5cbe6805a0c66a959ba5e9313c9fc6c9d36c15ac` | `iad1` / `fra1` |

Both deployments are READY, target Preview, with no promotion. A built in about 47 seconds and B in about 40 seconds. Each is one child commit from the baseline; GitHub comparisons show only `vercel.json` differs. Both inherit the same shared Vercel Preview Supabase environment entries and identical branch-scoped `SALES_PERF_DIAGNOSTICS=1` and `STAGING_WEB_VITALS=1`. Browser requests and successful server authentication verified staging project `vxkpvdtrldwwqiddoyof`, whose database is in `eu-central-1`. The previews do not pass the Web Vitals hostname gate.

Inspection found one App Router file, `src/app/api/sales/legal/route.ts`, implementing both GET and POST. It uses the default Node.js runtime and imports `node:crypto`. The exact B configuration preserves the existing three cron definitions and adds:

```json
"regions": ["iad1"],
"functions": {
  "src/app/api/sales/legal/route.ts": {
    "regions": ["fra1"]
  }
}
```

This is the documented [per-function region override](https://vercel.com/docs/functions/configuring-functions/region), applied to the actual source path. No runtime, route, application behaviour, project-wide region setting or normal alias was changed. The root workspace `vercel.json` remains unchanged.

**All 160 measured read-only-batch function requests matched their intended execution region.** This includes 96 legal requests, plus 64 `/api/auth/activity` requests that remained in `iad1`. All four measured legal requests in the mutation pair—two POSTs and two subsequent context GETs—also matched. Execution is taken from the complete `x-vercel-id`, separately from London `lhr1` ingress.

Additional isolation checks sampled successful GET handlers on `/api/rentals/tenancies` and `/api/rentals/rent-risk`: 12/12 returned 200 and executed in `iad1`, across both previews. All eight reservation preparation POSTs also returned 200 and executed in `iad1`. Initial region probes include intentional legal 400 responses without a sale and method-only 405 responses; those are separate from successful action measurements. See [region evidence](../artifacts/performance/2026-10-05-targeted-region/region-verification.json), [other handlers](../artifacts/performance/2026-10-05-targeted-region/other-function-verification.json) and [setup/source evidence](../artifacts/performance/2026-10-05-targeted-region/setup-evidence.json).

## Paired browser actions

**Eight paired rounds per action/profile/region: 192 action samples and 3,552 recorded requests.** Seconds below are median readiness and median within-round `B − A`. Negative means B was faster. Complete action times, defined as the later of readiness and final relevant network completion, produce the same paired medians in this batch. Full IQRs, min–max ranges, request counts, server spans and failures are retained in [measurements](../artifacts/performance/2026-10-05-targeted-region/measurements.md) and [summary](../artifacts/performance/2026-10-05-targeted-region/summary.json).

| Profile | Action | A median | B median | Paired B − A | Settled requests A / B |
|---|---|---:|---:|---:|---:|
| Desktop | Cold navigation → sale controls | 2.125 | 2.138 | +0.044 | 54 / 54 |
| Desktop | Repeat navigation → sale controls | 1.939 | 1.937 | effectively 0 | 54 / 54 |
| Desktop | Enter Exchange | 1.894 | 0.867 | −1.026 | 1 / 1 |
| Desktop | Legal-context GET | 1.487 | 0.318 | −1.135 | 1 / 1 |
| Desktop | Exchange → Completion | 0.051 | 0.053 | +0.002 | 0 / 0 |
| Desktop | Authority preview | 1.354 | 0.252 | −1.021 | 1 / 1 |
| Throttled mobile | Cold navigation → sale controls | 6.921 | 6.923 | −0.001 | 54 / 54 |
| Throttled mobile | Repeat navigation → sale controls | 3.791 | 3.794 | −0.005 | 54 / 54 |
| Throttled mobile | Enter Exchange | 1.935 | 0.906 | −1.025 | 1 / 1 |
| Throttled mobile | Legal-context GET | 1.460 | 0.363 | −1.055 | 1 / 1 |
| Throttled mobile | Exchange → Completion | 0.087 | 0.091 | +0.003 | 0 / 0 |
| Throttled mobile | Authority preview | 0.907 | 0.397 | −0.524 | 1 / 1 |

Every Exchange-entry, explicit context-GET and authority-preview pair favoured B: 8/8 for each action on each profile. The cached Completion transition has no function request and provides no regional-function benefit. There were zero failed measured actions, HTTP errors, browser request failures, page errors, region mismatches or settlement timeouts. All samples passed their displayed-state/readiness checks.

Desktop cold navigation was slightly slower in six of eight B rounds: paired median +44 ms, IQR +6 to +175 ms, range −58 to +596 ms. Repeat was effectively flat. The cold median is about 2% of the control readiness, and the prior +1.551-second cold / +0.592-second repeat regressions did not recur. The retained +596 ms cold outlier matters; these eight pairs do not prove navigation can never regress. Mobile cold/repeat paired ranges were approximately −27 to +27 ms and −67 to +55 ms.

## Static delivery and direct Supabase reads

All nine non-runtime JS/CSS assets matched by path and SHA-256 across builds. The tenth asset, `turbopack-2_9az3epal9fr.js`, has the same path and 10,835-byte decoded size but a different raw hash. Replacing each build's single generated Vercel deployment ID makes those runtime files byte-identical: the [normalised hash check](../artifacts/performance/2026-10-05-targeted-region/runtime-asset-verification.json) passed. This accounts for the separate-build byte difference without claiming the raw files were identical.

The table gives median offsets from navigation start, in seconds. Static/document responses had CDN HIT headers in all recorded cases; repeat can use browser cache. Direct reads continue to go from the browser to staging Supabase, independently of the legal function region.

| Profile / navigation | Static completion A / B | First direct data start A / B | Last direct data completion A / B |
|---|---:|---:|---:|
| Desktop cold | 0.235 / 0.249 | 0.364 / 0.402 | 1.937 / 2.045 |
| Desktop repeat | 0.079 / 0.086 | 0.141 / 0.150 | 1.555 / 1.582 |
| Mobile cold | 3.392 / 3.399 | 3.709 / 3.712 | 6.803 / 6.794 |
| Mobile repeat | 0.358 / 0.366 | 0.545 / 0.556 | 3.544 / 3.564 |

There is no repeat of the earlier desktop static-completion jump from about 0.25 to 1.31 seconds. Direct browser-to-Supabase reads are not moved by this configuration and should not be credited as a function-region saving. Per-request direct-read durations and the complete static hash list are in [details](../artifacts/performance/2026-10-05-targeted-region/details.json).

For explicit legal GETs, median server route spans fall from 1,347 to 246 ms on desktop and 1,249 to 237 ms on mobile. Desktop remote-auth spans fall from 306 to 29 ms and cumulative remote database-read spans from 2,292 to 419 ms; mobile equivalents are 126 to 32 ms and 1,811 to 393 ms. The calls are matched: one auth call, nine database-read calls and one expiry RPC. The expiry RPC is classified as a mutation span, but the selected-sale checks and before/after hashes confirm no expiry writes occurred in the read-only batch. Remote spans include network/service round trips; overlapping spans must not be added or treated as pure database-engine time.

## Fresh representative mutation

Candidate units 210–215 and 302–306 were inspected before use. All eleven were active, unredacted empty drafts, without buyers, authority requests, legal emails, exchange/completion dates or documents. Occupied 301 was excluded. Only **210 for A and 211 for B** were consumed. The other nine candidate drafts remain empty. Units 102–115, 201–209 and 301 were neither reset nor mutated; protected unit, sale, document/version, legal-email, workflow-event, comment and mention-notification hashes match around the mutation test.

Both fixtures were prepared through the normal reservation API with the same £250,000 contract price, synthetic buyer and reservation PDF, then developer-approved. Both started the measured issue in `approved` state, with no authority request, issued authority, exchange or completion. Normalised legal snapshots matched across all legal terms, payment schedules, seller, recipient and approver fields, excluding only sale/unit/plot and generated terms IDs. Both used the same future expiry and the existing staging test mailbox `carl@accoladeproperties.co.uk`; the synthetic buyer address was `performance-test@example.invalid`. No shared recipient settings were changed.

**One desktop authority issue per region, one pair, no repeats on either sale.** B was measured before A after both previews were warmed with read/preview work. This single ordering cannot estimate order effects or a latency distribution; no mobile mutation was measured.

| Component | A: iad1 / unit 210 | B: fra1 / unit 211 | B − A |
|---|---:|---:|---:|
| Complete click → refreshed displayed success | 2.926 s | 0.878 s | −2.048 s |
| Legal POST browser completion | 1.639 s | 0.475 s | −1.164 s |
| Legal POST server route | 1.446 s | 0.418 s | −1.028 s |
| POST remote database mutation spans | 0.557 s | 0.124 s | −0.432 s |
| Resend acceptance HTTP span, inside POST | 0.264 s | 0.206 s | −0.058 s |
| Subsequent legal context GET browser completion | 1.168 s | 0.235 s | −0.932 s |
| Subsequent context GET server route | 1.045 s | 0.168 s | −0.877 s |
| Direct Supabase refresh requests | 2 | 2 | 0 |
| Settled requests | 4 | 4 | 0 |
| Measured Storage requests/spans | 0 | 0 | 0 |

The context GET started at about 1.658 s in A and 0.510 s in B after the click. Context and direct portal refreshes can overlap; the component times are not an additive decomposition of complete action time. The email span measures Resend HTTP acceptance, not final inbox delivery. Both actions saved one version-1 authority with `sent` state, a sent timestamp and provider receipt. The success notice, Active authority badge and reissue control were displayed after refresh, followed by two animation frames. There were no failed mutation actions or requests.

Reservation PDF Storage work belongs to fixture preparation and is excluded from the measured authority action. Its reservation upload request is separately recorded among the eight setup POSTs; that route does not provide an isolated Storage sub-span. This test establishes no upload-transfer/finalisation benefit. [Raw mutation phases, receipts and state verification](../artifacts/performance/2026-10-05-targeted-region/mutation-results.json), [candidate final state](../artifacts/performance/2026-10-05-targeted-region/candidate-details-after.json).

## Recommendation and production separation

**Prepare an opt-in staging-only targeted legal region change for review.** The complete legal read/preview actions improved in every pair, the representative complete mutation improved, and the observed navigation differences are small compared with the earlier material regression. Keep all other functions in `iad1`. The mutation result is encouraging but one pair is too few for a firm conclusion about mutation p50/p75, email latency or failures. There is no evidence here supporting a production rollout.

The proposed [overlay](../config/vercel.staging-legal-region.json) and [preparation helper](../scripts/prepare-staging-legal-region.mjs) preserve the checkout's current cron and other configuration settings. They do not change root `vercel.json` and are not automatically loaded by Vercel Git deployments. Merging the supporting files into `main` therefore does not enable the override in production. The helper only generates an ignored configuration from `staging`; it never deploys or assigns an alias. The [staging deployment procedure](staging-legal-region-deployment.md) uses an isolated branch and explicit Preview target, with a separate approval for any later staging-alias assignment.

The normal staging alias still serves `dpl_5z4uiDHDcs7Ttd75CV9C5NRW2id1` at `803caeb`, as found at the start. That commit adds the previous comparison documentation; application source is unchanged from `9f423a0`. Production still serves `dpl_71MV1EATioHy8bBiNornLF5hzu7m`, commit `d37ab6518a2f28640a0e5435ce0d84daaf1ee39c`, in `iad1`. All pre-existing environment metadata is unchanged; four new diagnostic entries are scoped only to the two isolated test branches. [Platform verification](../artifacts/performance/2026-10-05-targeted-region/final-platform-verification.json).

## Protocol and verification limits

Read-only measurements ran 5 October 2026, 15:49:03–16:20:52 UTC (16:49:03–17:20:52 UK time). Mutation preparation/measurement ran 16:22:53–16:23:30 UTC (17:22:53–17:23:30 UK time). Chromium 149.0.7827.55; desktop 1280×900; mobile 390×844, 4× CPU slowdown, 150 ms latency, 200,000 bytes/s download and 93,750 bytes/s upload.

Each preview was warmed. Region order alternated across eight rounds and mobile reversed the start. Inactive contexts were sent to `about:blank` to avoid competing polling. Cold clears browser cache, not Vercel function state. Sign-in, fixture preparation and navigation to the authority-preview sale are excluded from action timings. Quiet settlement grace is excluded from reported network/complete-action time. Read-only navigation/context used completed 107; safe authority preview used existing 209 without issuing or mutating it.

Separate preview identities/CDN entries, ordinary shared staging services and a shared desktop host remain limitations. The improved protocol and new builds mean the disappearance of the historical navigation regression cannot be attributed solely to narrowing the region override. No slower sample was removed. Eight read/preview pairs and one mutation pair are controlled staging observations, not production field percentiles.

The [evidence checks](../artifacts/performance/2026-10-05-targeted-region/evidence-checks.json) passed, validating sample counts, intended execution regions, successful other handlers, matching configuration/source scope, displayed states, receipts and protected records. The preparation helper generated the expected configuration without changing the root file; relevant scripts passed syntax/lint checks. An initial environment-creation attempt was rejected because the preview branches did not yet exist, without creating variables; it succeeded after branch creation. Inspection/setup tool errors did not produce performance samples or consume fixtures. Intentional preflight 400/405 probes are retained separately from the zero-failure measured batches.

Raw request timing metadata, all static hashes, ranges, fingerprints and reproduction details are in the [evidence directory](../artifacts/performance/2026-10-05-targeted-region/README.md). No credentials, business response bodies, real document contents, signed URLs, screenshots or traces are saved.
