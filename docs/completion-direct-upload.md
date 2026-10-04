# Completion document direct upload

Implementation is based on assessed commit `e70c840cec437ba3e80ccf74d6e128deae92dd65`, with the existing performance instrumentation preserved. No production database, Storage or deployment has been changed.

## Transport and security

1. The browser sends only the sale, submission UUID and metadata for one or two PDFs to `prepare_completion_upload`. Selection rejects unsupported files before transferring bytes. There is no multipart fallback.
2. A service-only RPC checks the active conveyancer, current sale access, exchanged/uncompleted state, confirmed arrangements, document types, exact expected previous versions, count and the 10 MiB limit. It records a two-hour session with server-generated paths scoped to building, sale and submission. Reusing the submission UUID with a different manifest fails.
3. The server issues insert-only signed capabilities for those paths in the private `completion-uploads` bucket. The bucket enforces PDF MIME and 10,485,760 bytes. It has no browser read/update/delete policies. The browser uses Supabase's signed TUS endpoint, 6 MiB chunks, visible progress, automatic transient retries and an explicit Pause button. The same page retains its interrupted transfer for resume. Completed files are skipped on retry.
4. `finalize_completion_upload` rechecks permissions and the saved session. It checks Storage's actual byte count and MIME and reads the five-byte PDF signature with a range request. Storage copies the object internally into the private `sale-documents` bucket; the browser's upload capability cannot modify this final object. No PDF body is sent through Next.js.
5. A locked database transaction rechecks final object metadata and expected document versions, then invokes the existing `sales_completion_upload` transaction. Document versions, supersession events, approval invalidation and existing audit events are preserved. The session result commits atomically. Duplicate finalisation returns that exact result, including after later replacements or legal completion, subject to current access permission.

A failed finalisation leaves private objects available for retry. The cleanup RPC first expires abandoned sessions transactionally; the cleanup worker removes their unregistered objects only. It never removes referenced document versions. Completed sessions lose only their quarantine copies. Cleanup waits 26 hours after the two-hour session expiry because resumable upload capabilities can outlive the session. Failed removals remain eligible for retry. The authenticated cron route processes at most 30 sessions daily and requires `CRON_SECRET`. The daily schedule supports Vercel Hobby; an hourly schedule caused the first staging deployment to fail. Vercel schedules run only on production deployments, so a staging preview needs an explicitly invoked cleanup job. A sustained backlog above 30 expired sessions per day requires additional cleanup runs or a higher-throughput worker.

The original multipart completion action now fails with a reload instruction. A browser using the new code cannot silently fall back to the function body-size bottleneck if preparation fails. The separate notice PDF upload is outside this change.

## Verification and measurement scope

New staging fixtures live in **E2E Completion Upload 2026-09-22**, units **UPLOAD-1**, **UPLOAD-2** and **UPLOAD-3**. Their initial exchanged/arrangements state is explicitly synthetic; this assessment did not issue new legal instruction emails. The five completed Forum House diagnostic sales were not reused.

The initial browser measurements used a local production build with real staging authentication, TUS transfers, Storage verification/copy and database RPC. Those local results are retained below for reference. After the staging merge, the same checks were repeated against the deployed Vercel application; see the deployed verification section.

Mobile conditions match the report: 150 ms latency, 200,000 bytes/s download, 93,750 bytes/s upload, 4× CPU slowdown, 390×844 viewport. Desktop is 1280×900 without throttling. Timing runs from Upload click through finalisation and the existing page refresh. PDFs are generated on disk before measurement. No real-session traces, tokens, request bodies or signed URLs are retained.

See [live samples](../artifacts/completion-direct-upload/live-samples.json), [recovery checks](../artifacts/completion-direct-upload/recovery.json), [database/server tests](../artifacts/completion-direct-upload/direct-tests.log) and [browser tests](../artifacts/completion-direct-upload/browser-tests.log).

| Files | Prior deployed desktop / mobile median | Local-build desktop / mobile | Local-build finalisation |
|---|---:|---:|---|
| One 1 MiB | 7.78 / 19.07 s | 5.93 / 17.37 s | HTTP 200 |
| Two 1 MiB | 9.91 / 30.87 s | 8.52 / 30.25 s | HTTP 200 |
| Two 5 MiB | 11.81 / 112.31 s, **HTTP 413** | 17.62 / 119.39 s | HTTP 200 |
| Two 10 MiB | 24.33 / 224.24 s, **HTTP 413** at slightly below 10 MiB each | 31.47 / 236.72 s, **exactly 10 MiB each** | HTTP 200 |

Each new cell is one real upload, not a statistical percentile. All eight uploads succeeded. TUS creation returned 201 and continuation chunks returned 204. Preparation and finalisation returned 200. The largest Next.js request body was **480 bytes**, with a 136-byte finalisation request. The PDF data travelled directly to Storage. Playwright does not reliably expose the Blob request body size for TUS, so those request-byte fields are null rather than misleading zeroes. Known logical file sizes are recorded separately.

The live recovery run additionally verified role denials, invalid metadata before transfer, path-bound upload signatures, pause/resume at **6,291,456 bytes**, a deliberately lost committed finalisation response, concurrent duplicate finalisation, private-object read denial and service-only RPC permissions. The lost-response retry made no second Storage upload and retained the same document version.

Validation: **261 sales tests passed**, including **9 focused direct-upload tests**; **19 browser workflow tests passed**; **2 performance-instrumentation tests passed**. Production build, TypeScript and focused ESLint pass. The cleanup endpoint is tested to fail closed without a configured secret and to reject unauthorised requests. Full lint remains at the baseline 21 errors / 26 warnings.

The database/server suite covers expired leases, stale expected versions, changed access, forged PDF signatures, size mismatches, Storage failures, exact approval preservation on retry, approval invalidation on replacement, cleanup failures and retention of referenced documents. Existing workflow tests continue to cover developer review, queries, immutable history and legal-completion gating. [Original diagnostic sale counts](../artifacts/completion-direct-upload/original-sales-unchanged.json) match the earlier report.

## Deployed staging verification — 22 September 2026

Verified **https://staging.bunnywell.co.uk** at commit `c7876b0054cc8dccd9c0eae1d765fed0c9bf760b`, Vercel deployment `dpl_4jQSjWPYBdoD9Zqn33FUuMEcaAJv` (READY). Only the dedicated UPLOAD fixtures were mutated. Production and the five completed diagnostic sales were not used.

| Files | Prior deployed desktop / mobile median | New deployed desktop / mobile | New outcome |
|---|---:|---:|---|
| One 1 MiB | 7.78 / 19.07 s | 10.53 / 20.95 s | HTTP 200 |
| Two 1 MiB | 9.91 / 30.87 s | 13.62 / 37.78 s | HTTP 200 |
| Two 5 MiB | 11.81 / 112.31 s, HTTP 413 | 23.28 / 127.81 s | HTTP 200 |
| Two exact 10 MiB | 24.33 / 224.24 s, HTTP 413 at slightly smaller sizes | 36.03 / 242.25 s | HTTP 200 |

All eight deployed samples passed with real Storage and database finalisation. These are single samples per cell compared with the report's medians, not a latency regression benchmark. The added verification/copy round trips cost time; the result is support for the advertised file sizes without the function body-size failure. Slow-mobile transfer time remains bandwidth-bound. Storage requests returned 201/204 and application requests returned 200. The largest measured application request was 480 bytes; finalisation used 136 bytes. See [deployed samples](../artifacts/completion-direct-upload/staging-samples.json) and [deployment identity](../artifacts/completion-direct-upload/staging-deployment.json).

The deployed recovery run passed all nine checks: anonymous/admin/agent upload denial, invalid metadata rejection before transfer, path-bound signatures, retained file selection after pause, resumed TUS transfer at 6,422,528 bytes, lost-response recovery and concurrent duplicate finalisation without duplicate versions, and private-object/service-RPC access restrictions. The permitted conveyancer completed uploads. See [deployed recovery evidence](../artifacts/completion-direct-upload/staging-recovery.json). Focused ESLint and Git whitespace checks also passed after updating the diagnostics for deployed staging.

Cleanup verification created a disposable session without issuing any browser upload capability, aged only that session, and ran the actual worker against staging. Both its quarantine object and unregistered final copy were removed; no document version was registered. The deployed route rejected an unauthenticated call with HTTP 401. An authenticated deployed invocation remains unverified because the staging `CRON_SECRET` is not available locally. Preview deployments do not run Vercel cron automatically. See [cleanup evidence](../artifacts/completion-direct-upload/staging-cleanup.json). The daily schedule fixes the [Hobby plan's once-per-day cron restriction](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Remaining limits and rollout

- Do not deploy to production until the migration, application preview and cleanup schedule have been reviewed together. Apply the migration before serving the new UI. Existing sessions from old UI code should reload.
- Page reloads discard the in-memory TUS resume handle and selected File objects. Users must reselect files; abandoned sessions remain private and expire. Same-page retry/pause preserves the transfer and submission identity.
- PDF verification checks MIME, actual size and magic bytes, matching the existing content-check level. It is not a full structural PDF parser or malware scanner.
- The new session table intentionally has RLS enabled without browser policies, plus browser grants revoked. Supabase's informational “RLS enabled, no policy” advisory is expected. New cleanup/FK indexes may initially appear unused. Existing unrelated advisories are unchanged; see [Supabase's RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Full repository lint has the same 21 existing errors and 26 warnings as the assessment baseline. Focused lint for this change passes.
- Staging is deployed at `c7876b0054cc8dccd9c0eae1d765fed0c9bf760b`. The first merged deployment was blocked by the hourly cron schedule on Vercel Hobby; changing cleanup to daily allowed deployment. Production remains unchanged.

Current protocol references: [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [the signed TUS example](https://github.com/supabase/supabase/blob/master/examples/storage/resumable-upload-signed-uppy/index.html), and [Vercel function limits](https://vercel.com/docs/functions/limitations).
