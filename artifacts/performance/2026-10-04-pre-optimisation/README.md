# 4 October staging baseline evidence

Start with [the report](../../../docs/sales-performance-baseline-2026-10-04.md) and [detailed tables](measurements.md). The original September datasets in the parent directory remain intact.

- `deployment.json`: deployed commit, deployment/alias, region, staging-project verification and browser/runtime versions.
- `workflow-samples.json`: 60 measurements from four new sales; two desktop and two throttled mobile. Includes cold/repeat workflow navigation, authority request/preview/issue, exchange, Completion opening, notice authority/arrangements, four upload sizes, package approval and legal completion.
- `navigation-samples.json`: 50 read-only measurements; five samples of each of five actions per profile. Uses the newly completed sale 107 and prepared sale 110, with Reservation explicitly selected before switching.
- `comparison.json`, `comparison-table.md`, `measurements.md`: derived comparisons, counts, response sizes and phase tables.
- `server-timing-summary.json`: derived phase medians/maxima by profile/action/API operation. Raw headers, counts and `_end` offsets remain in each request row.
- `web-vitals-browser.json`: exact four-field payloads in an evidence envelope with capture time, external test profile, body size, presence flags for sensitive headers, and observed response status. No actual headers are retained. Role-name profiles denote unthrottled login/setup pages; collector-check-desktop is a separate post-journey smoke check.
- `web-vitals-route-checks.json`: portal/request-access/other checks with query and fragment navigation; no form submission or fabricated metric payloads.
- `web-vitals-runtime-observation.json`: bounded 100-entry Vercel log query, preserving only allowlisted metric messages and non-sensitive log metadata. Connector output contains duplicates. Status 0 means incomplete platform metadata, not HTTP success.
- `web-vitals-summary.json`: initial controlled observations. Browser response status can be null at unload even when receiver logs show arrival. No field percentile or exact navigation count is inferred.
- `isolation-observation.json`: process census observation and execution isolation limits.
- `verification.json`: final state, sample/field/span checks and confirmation of deployment identity.
- `final-state.json`: final deployment alias/commit confirmation and fresh-sale completion states from read-only connector checks.

Requests are counted when initiated during the measured window, including failures and unfinished requests. Finished non-vitals counts are also derived using September's recorder convention. `failed` is a browser requestfailure event; an HTTP error has status >=400. A successful UI sample does not erase either. Early desktop/navigation samples predate the addition of the optional fixed-label `failureReason` field, so missing reasons remain unknown. No URL or arbitrary error message is recorded.

`responseBytes` means compressed response body size where Playwright exposes it, not decoded asset size or response headers. Null sizes remain null. Per-action totals sum available sizes and state their coverage. `durationMs` on finished requests ends at browser request completion; `Server-Timing` phases cover server route and remote-service work. Parent spans overlap children; `_end` is a completion offset. Upload actions include prepare, direct TUS Storage transfer, finalize and the UI refresh chain. There is no Next.js PDF inbound transfer span for that transport.

Workflow button timing uses the captured click through success outcome and two animation frames. File selection happens beforehand from disk. Navigation uses reload initiation through visible stage controls. Cold clears cache, not the Vercel function. The detailed report documents the small navigation timer-boundary difference from September and other comparison limits.

The diagnostic scripts are outside CI. Existing credentials are loaded only from `.env.local`; no secrets, signed URLs, body contents, filenames, real-account traces, screenshots or DOM dumps are saved. All write actions stayed within fresh Forum House units 107–110. Completed September units 102–106 were excluded from mutation scope. The new fixtures are now completed: **do not rerun the workflow on them or reset them for another baseline**. A future mutation run requires fresh authorised fixtures and review of its scope. The verify harness deliberately refuses a non-empty/non-draft initial scope.

To reproduce the derived reports without network access or mutations, run `node scripts/diagnostics/summarize-october-baseline.mjs`. Do not run the mutation harness as a routine test.
