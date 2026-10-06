# Staging function region comparison — 5 October 2026

**Frankfurt improves user-visible Exchange entry, legal-context reads and authority preview, but this batch does not support a permanent blanket staging region change.** Desktop cold and repeat readiness regressed in every matched pair; throttled-mobile readiness was effectively unchanged. Keep the normal staging region at `iad1` until the desktop navigation regression is resolved or isolated in replicated previews. Production remains unchanged.

Both previews contain the application from staging head `9f423a0fe4d45204ac3ecf7d958b3d2b9a6d34d2`, including #3. Each has one child commit that changes only `vercel.json`; GitHub comparisons verify that no application source differs. Their effective application environment is inherited from the same Vercel preview configuration, with identical branch-scoped `SALES_PERF_DIAGNOSTICS=1` and `STAGING_WEB_VITALS=1`. Neither preview hostname passes the Web Vitals hostname gate, and neither sends telemetry. Both use staging Supabase `vxkpvdtrldwwqiddoyof` in `eu-central-1`.

| Variant | Immutable preview | Deployment ID | Region | Commit |
|---|---|---|---|---|
| A | [iad1 preview](https://bunnywell-portal-mp9jhtpk2-carl-gilbert-s-projects.vercel.app) | `dpl_3oXXzkPL4hu9fkKPNNKxe1g7dxBR` | `iad1` | `e79f35f4e86468925c17fdb11240da2152aadb4e` |
| B | [fra1 preview](https://bunnywell-portal-ka2xc0sle-carl-gilbert-s-projects.vercel.app) | `dpl_Bm3LTYepUo2Ebo8VHV2m25fPzZXJ` | `fra1` | `3262e6991ce22face13a78cd08cbbb804f468051` |

Both deployments are READY, target preview (`target: null` in the API), with no promotion. Build durations were about 52 and 40 seconds. Frankfurt is Vercel's `eu-central-1` region and matches the database location. [Vercel region list](https://vercel.com/docs/regions), [function region configuration](https://vercel.com/docs/functions/configuring-functions/region).

## Complete browser results

**Eight paired rounds per profile, per action, per region: 192 action samples and 3,552 recorded requests.** Times below are seconds, median [25th–75th percentile]. The paired difference is the median of each round's `fra1 − iad1`, not the difference between two marginal medians. Negative means Frankfurt was faster. Full min–max ranges, per-request timings, counts and failures are in the [measurements](../artifacts/performance/2026-10-05-region-ab/measurements.md) and [summary JSON](../artifacts/performance/2026-10-05-region-ab/summary.json).

| Profile | Action | iad1 median [IQR] | fra1 median [IQR] | Paired difference | Settled requests A / B |
|---|---|---:|---:|---:|---:|
| Desktop | Cold → sale controls | 2.121 [2.096–2.739] | 4.458 [3.512–4.729] | +1.551 | 54 / 54 |
| Desktop | Repeat → sale controls | 1.902 [1.878–1.907] | 2.517 [2.386–2.544] | +0.592 | 54 / 54 |
| Desktop | Enter Exchange | 1.896 [1.885–2.394] | 0.865 [0.859–0.874] | −1.024 | 1 / 1 |
| Desktop | Legal-context GET | 1.658 [1.383–1.828] | 0.424 [0.411–0.445] | −1.214 | 1 / 1 |
| Desktop | Exchange → Completion | 0.045 [0.041–0.049] | 0.051 [0.046–0.054] | +0.006 | 0 / 0 |
| Desktop | Authority preview | 0.854 [0.848–0.977] | 0.350 [0.342–0.359] | −0.502 | 1 / 1 |
| Throttled mobile | Cold → sale controls | 6.846 [6.820–6.866] | 6.845 [6.812–7.329] | +0.006 | 54 / 54 |
| Throttled mobile | Repeat → sale controls | 3.772 [3.739–3.779] | 3.777 [3.772–3.782] | +0.021 | 54 / 54 |
| Throttled mobile | Enter Exchange | 2.166 [1.919–2.412] | 0.895 [0.887–0.902] | −1.268 | 1 / 1 |
| Throttled mobile | Legal-context GET | 1.552 [1.388–1.728] | 0.364 [0.352–0.389] | −1.188 | 1 / 1 |
| Throttled mobile | Exchange → Completion | 0.086 [0.082–0.091] | 0.085 [0.083–0.089] | effectively 0 | 0 / 0 |
| Throttled mobile | Authority preview | 0.906 [0.891–1.058] | 0.370 [0.341–0.418] | −0.565 | 1 / 1 |

There were **zero failed actions, HTTP errors, browser request failures, settlement timeouts or page errors in the final batch**. Navigation consistently had 54 requests at readiness and at settlement, reproducing #3's deduplication result. The cached Completion transition makes no function request, so its near-flat timing is not a regional function benefit. An occasional preview sample is slower despite the median improvement; the ranges retain those observations.

The historical #3 desktop readiness of 2.09/1.91 seconds is close to this batch's `iad1` 2.12/1.90. Mobile cold/repeat were 7.32/3.75 previously and 6.85/3.77 here. Those historical numbers provide context, not the causal control: only the two new same-code previews are the region A/B. This batch has matched timing diagnostics and two origin-isolated contexts per profile; the historical batch used a different preview and single-origin setup.

## Server savings and browser transport

**All 160 measured function requests executed in the intended region: 80 `iad1`, 80 `fra1`.** Every request has London (`lhr1`) ingress. Full request IDs, cache status and headers are saved in [region verification](../artifacts/performance/2026-10-05-region-ab/region-verification.json). Examples are `lhr1::iad1::qmx8d-1791212331989-033d295e3024` and the corresponding Frankfurt-form headers in the raw evidence. Region verification uses the execution region in the complete header, not just the first CDN/ingress region. [Vercel response-header documentation](https://vercel.com/docs/headers/response-headers#x-vercel-id).

The legal-context endpoint's median server and browser timings show where the saving occurs:

| Profile / component | iad1 ms | fra1 ms |
|---|---:|---:|
| Desktop route span | 1,449.8 | 269.9 |
| Desktop auth remote span | 235.4 | 36.8 |
| Desktop cumulative db_read remote span | 2,050.4 | 416.6 |
| Desktop expiry RPC span, classified db_mutation | 318.0 | 36.3 |
| Desktop browser TTFB minus route | 158.1 | 125.9 |
| Desktop complete fetch/parse/frame action | 1,658.1 | 424.5 |
| Mobile route span | 1,321.4 | 234.2 |
| Mobile auth remote span | 117.7 | 32.1 |
| Mobile cumulative db_read remote span | 1,878.8 | 366.9 |
| Mobile expiry RPC span, classified db_mutation | 221.8 | 28.1 |
| Mobile browser TTFB minus route | 164.6 | 79.1 |
| Mobile complete fetch/parse/frame action | 1,551.9 | 364.0 |

Most of the roughly 1.2-second context-read improvement is inside the function, consistent with reducing the distance to Supabase. Every measured explicit context GET has the same one auth call, nine db_read calls and one expiry RPC in both regions; this saving is not fewer queries. These spans measure remote auth/database round trips, not pure PostgreSQL engine execution. Concurrent database spans overlap and can exceed the route's elapsed time; do not add them. The GET's expiry RPC acquires locks and checks expiry, but inspection found no eligible expiry writes and before/after hashes confirm it did not change protected records.

The `TTFB − route` residual includes browser-to-function transport, routing, platform work before route entry, connection effects and measurement overhead. It is not a direct UK-to-function RTT. Desktop residuals remain broadly 120–160 ms; preview's desktop residual is slightly higher in Frankfurt (121.4 → 130.3 ms), despite its faster total action. Therefore the legal benefit must not be credited primarily to a shorter UK browser hop. The mobile context residual improves, but the same attribution limit applies. Authority-preview server route medians also fall: desktop 577.6 → 110.4 ms, mobile 573.8 → 112.5 ms.

## Navigation regression and recommendation

Frankfurt was slower in **all eight desktop cold pairs and all eight desktop repeat pairs**. Its cold range was 3.271–6.424 seconds versus 2.086–3.549 in `iad1`; repeat was 1.960–3.022 versus 1.874–2.478. Last actual network completion also regressed: cold 1.967 → 4.157 seconds; repeat 1.601 → 2.130. This is an observed complete-action regression, not hidden by the faster legal endpoints.

The raw rows locate substantial delay outside the moved functions. Recorded navigation document/static responses carried CDN `HIT` headers and a single `lhr1` region; repeat can reuse these responses from browser cache. Desktop cold static completion medians were 0.249 seconds for A and 1.313 seconds for B; first direct browser-to-Supabase data requests began at 0.362 versus 1.581 seconds. Direct data completion was also later in B. On mobile, static completion was almost identical, 3.402 seconds in both variants; complete cold/repeat readiness was effectively flat. Moving Vercel Functions does not move the browser's direct Supabase data or Storage endpoint.

This observed static/direct-data difference limits causal attribution of the desktop navigation regression to the function region itself. Separate preview builds have generated build identities and CDN/connection behaviour, even though application source and effective application configuration are matched. The ordinary network/staging service was not reserved, and the inactive matched browser context could poll. Alternation and eight pairs reduce order bias but do not remove those limitations. Do not infer that Frankfurt inherently slows static assets, or that this batch proves a production benefit. A replicated preview comparison controlling static artifact/delivery differences is needed before a blanket permanent switch.

**Recommendation: retain the current permanent staging region for now.** Frankfurt is a promising location for the measured legal read/preview paths, but the complete navigation evidence does not support approving a blanket permanent setting. No production change is recommended or made.

## Scope, integrity and review configuration

Completed unit 107 supplied read-only navigation and legal contexts. Existing protected unit 209 supplied the safe UI authority preview, which renders/signs the preview and returns before email preparation/delivery; Cancel closes it. No authority request, issue/send, exchange, completion, upload or upload-finalisation mutation was tested. Authorised additional units were inspected: 210–215 and 302–306 were empty drafts; 301 was not empty. None was modified. **The conclusion is limited to read-only and preview paths: there is no measured benefit claimed for email delivery or upload finalisation.**

Before/after SHA-256 checks match for all 35 inspected units/attempts, 45 legal emails, 411 workflow events and 90 documents with their versions. Protected 102–115 and 201–209 were neither reset nor mutated. Browser-to-Supabase Storage traffic is its own raw category and has **zero requests** in this batch; no upload transfer was timed or folded into function latency. Ordinary staging sign-in/profile activity is separate from sales mutations. [State verification](../artifacts/performance/2026-10-05-region-ab/verification.json).

Measured window: **2026-10-05 14:58:42–15:30:35 UTC** (15:58:42–16:30:35 UK time). Chromium 149.0.7827.55; desktop 1280×900. Mobile uses exactly #3's 390×844 viewport, 4× CPU slowdown, 150 ms latency, 200,000 bytes/s download and 93,750 bytes/s upload. Eight rounds alternate region order; mobile reverses the starting order. Cold clears browser cache, not Vercel function state. Navigation uses #3's visible Completion controls plus two-frame boundary. Setup/sign-in and navigation to the preview sale are excluded from action timings. The explicit legal GET includes browser fetch, parse validation and two frames; Exchange and preview timings include rendering. Raw capture continues to settlement, but the artificial quiet grace is excluded from reported network completion.

Two preliminary setup attempts blocked CORS OPTIONS preflights and failed before producing samples. The guard was corrected before the final batch; saved setup verification confirms unchanged records. Those setup failures are not successful measurements and are distinct from the final batch's zero failure count.

Exact candidate configuration, for staging preview review only, preserving existing cron settings:

```json
"regions": ["fra1"]
```

The [configuration patch](../artifacts/performance/2026-10-05-region-ab/fra1-configuration.patch) adds this key to `vercel.json`. It is already applied only in the isolated B preview branch; A uses `"regions": ["iad1"]`. The active checkout's configuration remains unchanged. Do not merge this candidate into `main` or change project-wide function settings as part of this assessment. For a future explicitly approved staging-only deployment pipeline, the equivalent deployment-scoped option is `vercel deploy --target preview --regions fra1`; production must retain its own configuration. [Supported configuration methods](https://vercel.com/docs/functions/configuring-functions/region).

Production still serves `dpl_71MV1EATioHy8bBiNornLF5hzu7m`, commit `d37ab6518a2f28640a0e5435ce0d84daaf1ee39c`, in `iad1`. The normal staging alias still serves `dpl_HUYPJC3ze6AKKpon5VFmjZHFEWdo` at `9f423a0`, in `iad1`. All pre-existing environment metadata is unchanged; the only new entries are the four matched diagnostic flags scoped to the two preview branches. [Final deployment/environment verification](../artifacts/performance/2026-10-05-region-ab/final-deployment-verification.json), [source comparison](../artifacts/performance/2026-10-05-region-ab/source-verification.json), [evidence and reproduction](../artifacts/performance/2026-10-05-region-ab/README.md).
