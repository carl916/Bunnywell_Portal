# Read-only staging workspace delivery — 11 November 2026

Implementation, not a design prototype. Review: http://127.0.0.1:3033/workspace

- Branch: `codex/wider-workspace-integration`
- Worktree: `C:/Users/carlg/.codex/worktrees/wider-workspace-integration/Bunnywell_Portal`
- Baseline: `89b81ab21241b06aa49d2cf939f183dd4ae782df`
- Backend: existing staging project `vxkpvdtrldwwqiddoyof`, caller JWT + existing RLS.
- No remote SQL applied, business records created/changed, new accounts, paid resources, merge, push or deployment.

## Review

Use your existing staging login, select Forum House, and open Dashboard → Sales. LG01 is a representative exchanged sale with a completion-document record; G11 currently has a different current sale position in staging. The interface displays the backend facts, including missing buyer/document information.

Open a unit's full-page Completion workspace. Check the compact summary, document status/version metadata and Comments/Activity. Return to the worklist, filter/search, change page, scroll, and open another record. The separate Change building control returns to the appropriate list.

Open Snags, then LG06 / Store / “Door doesn't close fully” for a representative photograph, video link and recorded activity. Buildings shows structure, lifecycle, delivery team and sales defaults. Setup provides People & access (profile role/active status), Organisations, Trades, Unit types and Audit. Account access editing and detailed allocation management are unavailable.

The existing staging interface is unchanged and remains separately available. No existing sale-file page is opened or preloaded by this integration.

Start/restart from this worktree:
```powershell
node scripts/workspace-staging/serve.mjs
```
The launcher uses only the verified staging URL and public anon key from the existing ignored configuration; no service-role key is loaded. Optional `WORKSPACE_CREDENTIAL_SOURCE` selects another private configuration file with that same project. Port 3033 is the review gateway; 3034 is its internal development process. Other servers were not stopped.

## Connected and unavailable

| Area | Connected read-only | Unavailable |
|---|---|---|
| Navigation | Authenticated building catalogue, role/module gates, explicit building selection, exact record IDs, independent tab context, origin-aware return | Portfolio operational mode; no implicit all-building context |
| Dashboard | Building sales stages, action/record counts, snag/defect counts, routes into work | Rentals and unrelated portfolio modules |
| Sales | Building-scoped buyers, current unit/sale position, organisation/team actions, multiple actions, scoped current/historical fee obligations | Business actions |
| Completion | Exact sale milestones, document/query/current-and-previous-version metadata, existing comment and activity read RPCs | PDF contents/signing, uploads, review/query/approval writes, comment sending, legal completion recording, email/delivery history |
| Other sale destinations | Correct full-page destination and explicit not-connected state; recorded preview information | Detailed Reservation, Exchange, Handover, Deposits, Agent Fees and Commercial integration |
| Snags | Scoped register, existing action/responsibility rules, full-page record, source/status/deadline, media, comments/activity history | Editing, resolution, uploads, sending |
| Buildings | Units/floors in configured order, areas, lifecycle, delivery teams, commercial defaults | Configuration mutations |
| Setup | Paginated authorised profiles, organisations, trades, unit types and audit summaries | Invitations, account/access changes, imports, templates/configuration mutations |

No fixture buyers, comments, documents or media are injected into connected records. Staging itself contains historical test records.

The global fee RPC is not used by the new workspace. Sale attempts are selected by building before terms/invoices/payments, with the existing fee eligibility/calculation helpers. Historical obligations are separate rows and do not inflate current-unit stage counts.

## Newly executed verification

- Focused existing regression selection: **145 passed**, including contracts, scoped sessions, local Completion boundary/upload/workflow, discussion, dashboard and fee logic.
- Full existing Dashboard suite: **88 passed**.
- Full existing Fees suite: **103 passed**.
- New staging boundary tests plus payment-hotfix/role tests: **26 passed** (including seven new integration tests). Suites overlap; these are not a unique total.
- TypeScript and focused ESLint: passed.
- Isolated production build: passed; GET `/workspace`, `/workspace/read?kind=config` and authenticated-read entry returned **404** even with staging flags set.
- **18 browser journey checks passed**: fresh building choice, Dashboard/Sales, full-page Completion, origin return, filter/page/650px scroll restoration, direct links/refresh, browser back/forward, changing building without opening a matching unit, independent tabs, wrong-building rejection, switching while an earlier response is delayed, Snags/detail/history, Buildings, Setup, 1920×1080 / 1024×768 / 390×844 layouts, no uncaught browser errors or business mutation requests. Initial laptop screenshots are 1366×768.
- Additional live checks: admin sign-in; contractor dashboard/snags reads with Sales/Setup denied; resident workspace denied; unauthenticated and unknown-building reads denied; all HTTP business mutation methods denied.
- Keyboard: discussion shortcut/focus, next tab control, modal focus and Escape passed. 683×384 reflow (equivalent available CSS width/height to 200% on a 1366×768 laptop) passed. Native browser zoom was not exercised.
- Representative non-test snag image loaded (not merely a placeholder); its activity read passed.
- The standalone network guard permits only reviewed staging GETs and the two STABLE discussion read RPCs; it does not call the legal GET with expiry side effects, sale-open tracking or read receipts.

### Evidence limits

Live testing used existing admin, contractor and resident credentials. Previously saved developer/conveyancer payment-test credentials were rejected; those accounts were not changed. Their permission and workflow rules passed offline tests, but fresh live browser sign-in coverage for those two roles remains outstanding.

No overlapping unit labels occurred in the two live sales worklists compared (Forum House and Trinity Point). Duplicate G11/LG11/301 identity isolation and single-building entry remain covered by the executed fixture contract tests. Wrong-building exact-record rejection was also verified against staging.

These staging checks perform reads only. The successful local four-step Completion mutation journey was previously confirmed by the user; this task reran its offline regressions, not remote mutation tests.

## Performance evidence

Measured on this local development server against Forum House; not a hosted production benchmark:

- Building selection → usable dashboard: **1,889 ms**.
- Dashboard → already-loaded worklist: **79 ms**.
- Fresh worklist page reload (config + auth catalogue + building read): **2,698 ms**.
- Dashboard entry after catalogue: **1 browser data request**, **228,103 transferred bytes** (Resource Timing; 227,803 body bytes).
- Selected-building API measurement: **1,564 ms**, **27 backend HTTP requests**, **240,195 decoded backend response-body bytes**. Backend wire compression was not measured.
- **0 detailed cross-building requests**, **0 global fee-portfolio calls** in the measured building load.
- Duplicate browser projection data reduced from 396,803 to 227,803 bytes. No speculative prefetch was added.

Reproduction: run `scripts/workspace-staging/inspect.mjs` using the existing private test credentials, then `browser-check.mjs`, `access-performance-check.mjs` and `evidence-check.mjs`. Runtime logs, tokens, screenshots, raw staging data and build copies are excluded from Git under `tmp/`.

## Preserved work and independent hotfix

- Accepted design: `experiment/sales-workspace-redesign`, `1df4bac80588491bc3fba47966c9854fb33b4c10`, `/dev/sales-workspace`. Original worktree unchanged.
- Local writable Completion integration: `codex/building-workspace-contracts`, `89b81ab21241b06aa49d2cf939f183dd4ae782df`, `http://127.0.0.1:3031/dev/building-workspace`. Original worktree/runtime/database unchanged.
- Independent payment hotfix `ab76ebf` / migration-name alignment `bed77db` carried into this branch verbatim (permission, error wording, existing migration source, regression tests). No new payment permission was introduced beyond that already-applied fix.
- Staging payment function inspected read-only: MD5 `3f861320cd9fb30341495201da2c9861`, conveyancer permission present. Its migration source is provenance, **not an instruction to replay migrations**.

## Publication gate

Not published. Proposed subsequent staging publication: expose authenticated `/workspace` beside the current `/` interface on the existing staging project, retain read-only enforcement and disabled actions, and keep production excluded. It requires an explicitly approved staging publication flag/build configuration (the current development-only gate intentionally returns 404 in production builds), reconciliation with the current staging branch, and hosted smoke checks. No database migrations, business writes, storage-policy changes or new integrations are part of that proposal.

Stop here for UI/workflow review. The comprehensive database/API review and any public-storage policy changes are separate later work. See the separate security observations.
