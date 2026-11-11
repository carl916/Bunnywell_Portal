# Local Completion document review — 11 November 2026

Branch: **codex/building-workspace-contracts**
Worktree: **C:/Users/carlg/.codex/worktrees/building-workspace-contracts/Bunnywell_Portal**
Review: **http://127.0.0.1:3031/dev/building-workspace**
Parent checkpoint: **088a40b551f4735c59542a29baa6136c76af17b0**
Delivery: authenticated connected integration against **bunnywell-workspace-stage2**, synthetic local data only.

This extends the earlier read-only delivery under the user's explicit approval for Completion document uploads, queries, replacements, approvals, comments and associated activity writes. It does not authorise other business mutations or any staging/production connection.

## Implementation

The accepted building-first navigation, full-page Completion, logo theme, compact identity/summary, laptop spacing and permanent discussion column are preserved. All 12 recorded design source/asset hashes match both worktrees. The separate accepted prototype remains clean at **1df4bac80588491bc3fba47966c9854fb33b4c10** on **experiment/sales-workspace-redesign**, route **/dev/sales-workspace**.

The exact-scope local adapter validates the authenticated active account and exact building/unit/active sale before delegating to existing business code. It exposes only prepare/finalise upload, query/approve document and plain comment writes. It never calls the legal GET with expiry side effects.

Document preparation, signed resumable quarantine upload, PDF byte validation, immutable version finalisation, query/approval version checks, role checks and workflow/event transactions reuse the existing implementation. The browser upload helper accepts an optional local transport; its default implementation remains covered by existing tests.

Current and previous uploaded PDFs can be explicitly opened through the existing authorised signer. There is no document preloading. Missing bodies on old metadata-only fixtures produce an unavailable message. Comments and Activity use existing role-safe RPCs and paginate; selected view/draft remain isolated by record and drafts survive same-sale section navigation.

The developer sees a waiting state before submission. Conveyancer upload/replacement and developer review controls follow existing role and workflow rules. Successful document mutations invalidate and reload the building snapshot, so worklist actions and dashboard counts use persisted facts. No individual assignments were introduced.

No schema migration, policy change, workflow change or production-facing route change. The missing private sale-documents bucket was created with existing settings after isolation verification; completed test records and a fresh CR01 review record were added without modifying earlier fixtures.

## New tests executed in this delivery

### Existing and new offline regressions: 73 passed

Command:

~~~powershell
node --test tests/building-completion-boundary.test.mjs tests/building-contracts-stage1.test.mjs tests/building-integration-local-boundary.test.mjs tests/sales-completion-package.test.mjs tests/sales-completion-direct-upload.test.mjs tests/sales-discussion.test.mjs
~~~

Includes role/contract projection, stable scope identifiers, action allowlist, production exclusion, server egress denial, existing direct-upload/package validation, transaction/version checks and discussion permissions. These offline tests complement the authenticated integration checks below.

### Authenticated local workflow: 16 checks passed

Source: scripts/building-workspace-local/completion-journey.mjs. Evidence: completion-review/journey.json.

- Separate real conveyancer/developer sign-ins to the same full-page sale.
- Role-appropriate upload/review controls and disabled unrelated business actions.
- Actual signed resumable PDF upload and existing finalisation transaction; uploaded actor persisted.
- Developer query tied to the current version, with role-specific headings.
- Persisted plain comments using the existing RPC.
- Revised v2 replaces current v1; earlier query remains in history and current query clears.
- Stale-version and unauthorised conveyancer approval rejected.
- Developer approval bound to the exact version and actor; approved version locked.
- Worklist responsibility and dashboard review counts change through upload, query, revision and approval.
- Separate sessions/reload see persisted approval and comments.
- Previous version, query and actor remain visible.
- Previous PDF can be privately downloaded; response contains valid PDF header.
- Activity shows existing role-safe event projection.
- Statement of account can be uploaded/approved without disturbing statement approval.
- Existing transaction moves the sale to completion_pending when both documents are approved.
- Browser requests stay on local origins; no browser errors.

The first cycle passed 15 checks. The expanded fresh-record run added explicit dashboard-count evidence and passed 16. Do not add the two runs together as 31 distinct tests.

### Permissions, discussion and responsive UI: 9 checks passed

Source: completion-additional-checks.mjs. Evidence: completion-review/additional.json.

- Unrelated actions rejected by the local allowlist.
- Developer upload, replacement of an approved document and oversized preparation denied.
- Cross-building/unit/sale and foreign-document references denied.
- Comment retries deduplicate; changed text cannot overwrite an earlier submission.
- Controlled synthetic account revocation blocks new reads, document links and comments; access restored in finally.
- Long conversation pagination and reachable composer, without read-receipt writes.
- Same-sale view/draft preservation; changing records never shows the previous conversation/draft.
- 390×844, 1024×768, 1920×1080 and 683×384 effective zoom layouts: no horizontal overflow, reachable composer, keyboard shortcut focus and no panel/task overlap. Laptop initial viewport also checked at 1366×768.
- Receipt, mention and unit-open counts unchanged; local mail capture empty; container isolation reverified.

The initial additional run exposed an accessible-name problem in populated textareas. Explicit labels fixed it; the rerun passed all nine checks. Earlier failure artifacts are retained locally as debugging history, not the final result. The 683×384 test is a 200%-equivalent CSS viewport, not native browser zoom.

### Current navigation and late-response regression: 7 checks passed

Source: completion-navigation-checks.mjs. Evidence: completion-review/navigation.json.

- Explicit building selection, connected dashboard and worklist.
- Record refresh, browser back/forward and worklist restoration.
- Different G11/LG11/301 buyers in Willow Court and Orchard House; independent per-building filters; switch from a sale returns to the other worklist.
- Independent authenticated tabs, exact direct links and mismatched identity rejection.
- Deliberately held old-building response cannot populate the new building.
- Deliberately held previous-sale discussion response cannot populate the new record.
- Scoped initial data requests; worklist snapshot reuse; no browser errors.

### Build, release boundary and review readiness

- TypeScript without incremental cache: passed.
- Focused ESLint on the connected components/libraries, local route and upload client: passed.
- Final local production build: passed.
- A temporary production-mode server, with all local flags enabled, returned **404** for all three experimental pages and **GET/POST** on the new Completion API: five checks passed; server stopped after testing.
- Final launcher tested against the existing isolated runtime without reseeding. A readiness probe now rejects an obsolete/unconfigured UI process.
- Fresh **Willow Court / CR01** verified as conveyancer and developer, with no documents/comments consumed by the checks. Valid synthetic sample PDF files are supplied for manual upload.
- Accepted prototype Git status remains clean and all recorded hashes match.
- No staging/production access, merge, push or deployment.

## Current performance evidence

Normal selected-building entry, warm local development server and seven synthetic units in Willow Court:

| Operation | Usable | Data/auth requests | Response body | Headers |
| --- | ---: | ---: | ---: | ---: |
| Building dashboard | 233 ms | 19 | 19,802 bytes | 15,690 bytes |
| Worklist from dashboard | 43 ms | 0 additional | 0 | 0 |

No detailed records for another building were fetched during normal entry. These figures exclude page assets and WebSocket frames. They are small local synthetic measurements, not remote/production-scale benchmarks. Earlier 6 November cold-cache measurements remain historical and were not rerun or relabelled.

## Review and limits

Follow **scripts/building-workspace-local/README.md** for launch, exact accounts, file locations and the upload → query → revised upload → approval sequence. The private password remains in ignored local-runtime/test-access.json.

Connected panels: current/previous document content, document review status/query/history, Comments and Activity. Unavailable: correspondence file UI, email bodies/delivery history and other detailed sale workspaces. Legal completion, payments, authority/notice sending and other business actions remain disabled. Mention/read-receipt/notification features are not enabled. Existing sale-file handoff remains disabled and is never opened/preloaded.

Other sessions require refresh to see another user's changes; no speculative prefetch or realtime subscription was added. Native zoom and production-size performance remain untested. The earlier schema-bootstrap enum gap and remote schema parity are still matters for the later comprehensive review.

Existing documents/history in earlier fixtures are not retroactively fabricated. No secrets, local DB state, credentials, generated PDFs/screenshots or runtime logs belong in Git. Test source, fixture generators, safe approval metadata and this report do.

Next: establish the wider Dashboard, Sales, Snags, Buildings and Setup structure, reusing the earlier capability and data-loading work, then conduct the comprehensive database/API review. This delivery does not claim that broader structure or review is complete.
