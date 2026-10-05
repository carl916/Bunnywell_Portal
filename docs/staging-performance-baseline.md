# Staging performance baseline

This extends the opt-in instrumentation in `sales-performance-assessment.md`. The approved destination is a same-origin `/api/performance/vitals` endpoint writing the validated payload to existing Vercel runtime logs. No new analytics service, database table or production collection is introduced.

## Configuration

For the Vercel **preview environment, staging branch only**, set:

```text
STAGING_WEB_VITALS=1
SALES_PERF_DIAGNOSTICS=1
```

Rebuild/redeploy staging after changing these flags: the server root layout condition is evaluated when its static shell is built. `STAGING_WEB_VITALS=0` disables the receiver immediately on the next deployment and removes the boundary on rebuild. `SALES_PERF_DIAGNOSTICS=0` disables timing headers. Production is refused even if either flag is accidentally set. Web Vitals accept only `staging.bunnywell.co.uk`; arbitrary preview aliases and production domains do not collect. Server timing is permitted in explicitly enabled Vercel previews.

Local verification requires `SALES_PERF_LOCAL=1` alongside the two flags, with `VERCEL_ENV` unset and host `localhost` or `127.0.0.1`. These flags are independent of `NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS=1`, which continues to control local browser action marks. No `.env.local` secrets need to be changed or copied.

## Payload and destination

The isolated `StagingWebVitals` client component is mounted once from the server root layout only when enabled. It uses Next.js's bundled `useReportWebVitals`; no dependency or client root layout is needed. The callback identity is stable across rerenders. Only INP, LCP, CLS and TTFB pass the allowlist; FCP/FID are discarded.

Example complete request body and log message:

```json
{"metric":"INP","value":123,"rating":"good","route":"portal"}
```

Values are milliseconds except unitless CLS. Ratings are `good`, `needs-improvement` or `poor`. Routes are the fixed labels `portal` (pathname `/`), `request-access` (pathname `/request-access`) and `other`. Query strings and hashes are discarded; record paths never become labels. The label is captured for the initial document, rather than attributing delayed navigation metrics to whichever tab happens to be open later. Portal stages share one document, so this does not distinguish Exchange from Completion.

Only these four fields are sent or explicitly logged. No metric entries, DOM selectors, metric IDs, session/user/sale IDs, document details, URLs, cookies, authorization headers or unsaved fields are included. Fetch uses `credentials: omit`, `referrerPolicy: no-referrer` and `keepalive: true`. Normal hosting infrastructure still handles the HTTP request and may retain standard platform request metadata; this code does not add it to telemetry logs. Debug logging is absent.

The receiver checks the flag/environment/hostname, rejects cross-origin browser submissions and invalid or additional fields, and limits bodies to 512 bytes even without Content-Length. Accepted requests return 204; failures never affect a workflow. Collection has no retries, storage reads/writes or joins. The client retains at most four last numeric values and suppresses identical repeated reports. The public endpoint is diagnostic, not an authenticated audit trail: a caller can fabricate an allowlisted metric. No per-user inference should be drawn from it.

Vercel log retention applies; export the allowlisted records before retention expires for comparisons. There is no persistent metrics warehouse or percentile dashboard. Metrics may be re-reported on later visibility changes and BFCache restores; without sending metric IDs, rows cannot be deduplicated into exact per-navigation distributions. Treat these as diagnostic observations, not a statistically representative production p75.

## Server timing

The existing `Server-Timing` response header now separates:

| Span | Meaning |
| --- | --- |
| `route` | Route-entry to response construction, including authorization |
| `body_read` | JSON request body reading after authorization; includes any remaining inbound wait |
| `json_parse` | JSON decoding after the body has been read |
| `multipart_parse` | Existing notice upload's combined multipart body read and parse |
| `file_prepare` | Existing notice PDF's conversion to bytes |
| `upload_prepare` | Direct-upload lease lookup/creation and signed capability preparation |
| `storage_read` | Storage GET/HEAD/info request round trips, including signature fetch headers |
| `storage_upload` | Storage write/sign/copy request round trips; retained name for existing diagnostics |
| `storage_verify` | Complete object metadata and PDF prefix verification, including prefix reads |
| `finalization` | Whole direct-upload finalisation, including access/session checks, verification, copy and final database RPC; also present on idempotent retries |

Existing `auth`, `db_read`, `db_mutation`, `storage_cleanup`, `email_delivery` and `remote_other` spans remain. The completion session RPC uses `db_rpc` because the same endpoint supports begin/get/finalize operations. Each recorded phase includes a cumulative duration, call count and last-completion offset from route entry. Spans overlap: do not add parent finalisation/verification durations to child Storage timings.

These spans are remote round trips, not pure PostgreSQL or pure Storage engine time. The five-byte signature request now goes through the same request-scoped timed fetch; no contents or credentials are included in headers.

The direct completion PDFs travel browser-to-Storage via TUS. Their inbound transfer never enters Next.js, so there is no PDF inbound-transfer span in this header. Measure it with the existing browser upload journey and Storage request timings. Platform buffering, connection establishment before route entry and rejected HTTP 413 requests cannot be measured here. Multipart `formData()` combines reading and parsing; splitting it would require changing or buffering that transport, so those costs remain combined.

## Verification and comparison limits

On 4 October 2026 the two flags were configured through Vercel for project `bunnywell-portal`, target `preview`, branch `staging` only. The implementation is now deployed on commit `b883040b9bfc7b66084d1c4af73c13a179af578b`, staging deployment `dpl_5hFWn1r6y1FW7VjbwVgcixBFt9GR`. The [deployed pre-optimisation baseline](sales-performance-baseline-2026-10-04.md) verifies live payloads/runtime logs, fixed route labels and timing headers on real authorised staging journeys. Web Vitals remain initial controlled observations, not a reliable field baseline.

Local production-build verification passed TypeScript, focused ESLint, 15 focused unit/database tests and all 19 existing legal workflow browser tests with collection enabled. The direct-upload fixture now derives exchange/notice dates from the test database's current date, fixing its unrelated date-sensitive setup failure. A browser smoke check emitted TTFB, LCP, INP and CLS bodies of 59–77 bytes with no cookies, referrer or authorization headers, and no page errors. See `artifacts/staging-vitals-smoke.json` and its screenshot. These are synthetic localhost observations, not field staging measurements or a performance improvement claim.

Run `node --test tests/staging-web-vitals.test.mjs tests/sales-performance.test.mjs`, TypeScript and focused ESLint. The tests exercise the real serializer, client callback, receiver and legal POST wrapper with explicit service adapters: four metrics, fixed route labels, unknown fields, secret-bearing inputs, malformed/oversize bodies, origin rejection, offline delivery, duplicate callbacks, production/disabled gates and upload/error timing headers.

On enabled staging, open the portal with a query/hash, interact and hide the document. Inspect `/api/performance/vitals`: its body must contain only the four fields above, with `route: portal`; responses should be 204. Find the same JSON in Vercel logs. Upload only dedicated staging fixture PDFs and inspect prepare/finalise response timing headers. A lost-response retry should still return the existing result. After disabling/rebuilding, there should be no vitals requests and no timing headers. Production must remain silent regardless of accidental flag values.

Compare standard INP/LCP/CLS/TTFB observations across subsequent builds using matched browser, viewport, network and interaction conditions. The original report did not have field INP or standard CLS; its summed layout-shift values are not a valid CLS baseline. Page vitals do not measure sale-control readiness or upload success time; existing action/journey measurements do. This collector intentionally omits build, user, device and session dimensions, so keep deployment and test-profile information separately when exporting samples. Low-impact collection is supported by its bounded payload, no React state, no awaited delivery and no database access; browser smoke measurements should be recorded separately and not represented as proof of negligible impact under all real-user conditions.
