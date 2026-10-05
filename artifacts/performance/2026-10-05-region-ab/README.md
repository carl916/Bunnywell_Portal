# Staging region A/B evidence

Common application source: `9f423a0fe4d45204ac3ecf7d958b3d2b9a6d34d2`. Two isolated Git preview branches add only the function region configuration. Neither is production and neither replaces `staging.bunnywell.co.uk`.

## Evidence

- `deployments.json`: immutable deployment URLs, IDs, commits, configured regions, staging database identity and original production/staging identities.
- `samples.json`: browser elapsed readiness, request completion/settlement, counts, HTTP/browser failures, response sizes, request timings, full Server-Timing headers and parsed spans. Endpoint labels omit business identifiers and query strings.
- `summary.json` and `measurements.md`: medians, quartiles, min–max spread, paired differences, request categories and function timing summaries.
- `region-verification.json`: each measured function request's Vercel request ID, London ingress and actual execution region, with deployment region matching counts.
- `state-before.json` and `verification.json`: SHA-256 fingerprints of inspected staging units, sale attempts, legal emails, workflow events, documents and versions. Business bodies are hashed in memory, never persisted. This covers protected 102–115 and 201–209, plus inspected 210–215 and 301–306.
- `environment-before.json`: existing environment metadata only; no secret values. Final environment/deployment verification is saved separately after measurement.
- `fra1-configuration.patch`: exact region configuration for review, not applied to the active repository configuration. The iad1 preview uses the same change with `iad1` instead of `fra1`.
- `setup-guard-rejection.json`: failed setup with CORS preflights initially blocked by the diagnostic guard; no measurement samples and unchanged staging state. The guard was corrected to permit OPTIONS before the final measured batch.

## Reproduction

Run from the repository root, with existing authorised staging credentials in ignored `.env.local`:

```powershell
node scripts/diagnostics/staging-region-ab.mjs 8
node scripts/diagnostics/summarize-region-ab.mjs
```

The recorder refuses non-preview deployments, a non-staging database, non-completed unit 107, or pending expiry writes on either selected sale. Unit 209 is used only for the existing UI's safe authority preview, then Cancel. It blocks sales API writes except that exact preview action, direct REST row writes, known mutation RPCs and browser Storage writes. Do not add mutation actions or reset any diagnostic sale. Do not run these commands concurrently with other diagnostics. Re-running overwrites the measured evidence files: preserve the existing batch first.

Cold means browser cache cleared immediately before reload, not a forced Vercel function cold start. Repeat retains cache. Navigation starts at reload initiation and ends at visible Completion controls plus two animation frames, matching #3. Capture continues until non-poll/non-telemetry work finishes and stays quiet for 1.5 seconds; reported last completion excludes that artificial grace. Exchange entry and preview finish at the rendered task list/preview region plus two frames. Explicit legal-context GET finishes after browser fetch and JSON validation plus two frames; it is an endpoint measurement rather than an additional invented UI action.

Desktop: Chromium 149.0.7827.55, 1280×900, ordinary connection. Mobile: same browser, 390×844, 4× CPU slowdown, 150 ms latency, download 200,000 bytes/s, upload 93,750 bytes/s. Eight paired rounds per profile alternate A/B order, with the mobile starting order reversed. Setup/sign-in and preview-sale navigation are outside measured actions. Both origins are warmed and settled before measurement.

One browser process maintains two isolated contexts per profile; one action is measured at a time. The inactive context remains open, so ordinary background activity/polling can continue. This condition is matched between regions, but differs from historical single-origin batches. No builds, suites, deployment/log inspections or database diagnostics run alongside the final measured batch. Ordinary desktop applications and staging traffic were not excluded.

Playwright request counts use the #3 convention; Chromium-internal CORS preflights are handled by the safety guard and are not separately counted as application requests. Direct browser-to-Supabase data/auth and Storage requests have separate categories from Vercel Function requests. Static document/asset requests are retained with cache and Vercel headers; do not label their CDN region as function execution.

No credentials, signed URLs, preview tokens, request/response business bodies, real-account traces, screenshots, DOM dumps or PDF contents are saved. Ordinary sign-in/profile activity occurs, but no sale, legal email or upload mutation is part of this test. Conclusions are limited to read-only and preview paths, not email delivery or upload finalisation.
