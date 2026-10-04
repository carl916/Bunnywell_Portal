# Initial portal and Sales loading

This change starts from `a59f3d3bb98781efd14cb5288e46d6a9bb10e6d3`. It removes repeated page-entry work without changing the legal mutation APIs, database permissions or the scoped sale-action refresh contract. No production deployment or alias change was made. Staging diagnostics use existing completed Forum House sales 107–110; no sale is reset or mutated.

## Instrument first

Commit `c2ceafa3749400345ea80eb1e664e5ffd131ffe8` adds counters without deduplicating the application. Its staging preview provides the before trace. Enable counters before the application executes with `window.portalLoadTracing = true`; read `window.portalLoadTrace`. The bounded 2,000-row buffer contains only scope, event, phase, table/RPC name and relative time. It sends no telemetry and records no identities, tokens, query parameters or business rows. Production clients bypass the query instrumentation when tracing is off.

The representative before trace is:

| Event | Work started | Reads | Assessment |
|---|---|---:|---|
| Auth `SIGNED_IN` during browser-client initialization | `loadAll()` | 25 | Duplicate of validated restoration |
| Auth `INITIAL_SESSION` | `loadAll()` | 25 | Duplicate of validated restoration |
| Explicit session restoration / `getUser()` | `loadAll()` | 25 | Necessary authentication and portal snapshot |
| Sales component mounts with temporary all-building context | `loadSalesData()` | 10 | Superseded before the intended building snapshot publishes |
| Building context resolves URL/saved selection | `loadSalesData()` | 10 | Necessary Sales snapshot |

Thus **95 instrumented data reads become 35**: 50 exact portal repeats and 10 unnecessary Sales reads disappear. The initial all-building Sales queries have different scope parameters, so they are classified as superseded work, not falsely presented as ten byte-identical requests. Identical query/table names alone are insufficient to identify duplication. Request identity is compared in memory using method, URL and RPC body; only duplicate ordinals are persisted.

The after trace records the startup auth events, waits for verified restoration, publishes one portal snapshot, resolves the accessible building context, then reads and publishes one complete Sales snapshot. Counters distinguish triggers, started work, coalescing, discarded work, publication and settlement. Development Strict Mode's cancelled setup work is a trigger/discard, not a started network load.

## Trigger inventory

| Owner | Trigger | Treatment |
|---|---|---|
| `ProductionPortalApp` | Explicit restore, including invite/recovery `setSession()` followed by Auth `getUser()` | Owns one validated initial load; startup auth notifications are recorded rather than launching competing reads |
| Portal auth subscription | `INITIAL_SESSION`; initial/repeated `SIGNED_IN`; `TOKEN_REFRESHED`; `USER_UPDATED`; `SIGNED_OUT` | Identical initial session is deduplicated. Repeated sign-in/focus reads four access inputs and reloads if they changed. New tokens and user updates reload authoritative profile/access/data. Sign-out clears and invalidates synchronously |
| Portal invite password panel | `onComplete` | Named `invite-complete` reload remains |
| Portal Shell | Explicit Refresh, including retry after an access-read failure | Named `explicit-refresh`; fresh portal reads and one Sales revision; legal context still refreshes |
| Setup, snagging, units, handover screens | Their supplied `reload={loadAll}` callbacks | Named `operation-refresh`; required reload after existing writes remains |
| Sales reservation workflow | Reservation save/approve/reject, invoice upload/approve/reject, commercial package save, return to For Sale, fee payment record/void | Existing broad Sales + portal operation refresh remains. These operations are outside the legal-action optimization |
| Sales reservation workflow effect | Mount, building selection and `units.length` / refresh key before the change | Waits for resolved context; now depends on authenticated principal, profile role/organisation, building, **sorted accessible sales-route unit IDs** and explicit refresh revision. Equal-count replacements are detected; reordering and price edits do not cause another broad load |
| Sales URL, selection and form effects | Building/unit prop changes; selected unit/stage changes | Update selection/forms; do not fetch Sales. No `buildings.length` dependency launches a core Sales load |
| Sales legal workflow | Mount or selected sale change, explicit refresh key, Retry, successful/uncertain mutation reconciliation | Existing legal-context GET and action-scoped reads remain. Its 30-second clock updates are local, not network polling |
| Forecasting, only after opening it in a specific building | Mount, internal building selection/initial-building synchronization, forecasting access, sales-route unit count; scenario save | Optional scenario/attempt/terms reads; inactive during initial sale-file measurements. Its separate count-based effect is documented, not confused with the measured core Sales loader |
| Agent Fees portfolio, only in that view | Mount, requester change, supplied portal unit-data reference after Refresh, Try again | Separate portfolio RPC; building selection filters its returned rows locally. Inactive during measured sale-file entry |
| Discussion | Mentions/unread mounts, ID membership, visibility/discussion events and 30-second intervals; open conversation/activity uses 15-second intervals | Counted separately as polling. The superseded all-building snapshot no longer creates an extra unread membership read |
| Auth activity | Visible-user mount, focus/visibility, five-minute interval with rate limit | One normal activity POST in these samples; separately identified in raw evidence |
| Legacy `PortalApp` | Its own restore/auth subscription | Not mounted by `src/app/page.tsx`, which uses `ProductionPortalApp`; not part of this request path |

Supabase can emit sign-in events on session reconfirmation; the callback schedules work outside the auth lock. See the [official auth-event guidance](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Authentication, access and overlap

Auth `getUser()` still validates restoration and every replacement principal. Portal access continues to come from database profiles, explicit user building/unit links and active organisation allocations. No user-editable metadata is used as authorization. Backend authorization and RLS are unchanged.

Per-component coordinators share only an identical **in-flight** load; there is no persistent or cross-user data cache. Explicit Refresh supersedes outstanding work. Sign-out, principal replacement, token/user changes and unmount invalidate pending portal publication. A replacement principal cannot display the old account while Auth validation runs. Repeated focus checks coalesce, and late checks cannot reload after sign-out. Failed profile/access reads hide stale portal data and expose an explicit retry.

Sales waits for context restoration and publishes all defaults, attempts, terms, schedules, documents, versions, invoices, payments, actor names and deposit presence together. Required-read failure publishes no partial snapshot. The render gate hides controls for a changed scope until its complete snapshot succeeds. Old building, membership, role or refresh results cannot replace newer ones. Unmount invalidates outstanding reads. A scoped legal refresh waits for any pending full snapshot before merging; its revision invalidates older broad work. The same guard protects scoped portal unit/audit results from sign-out or a newer portal refresh.

Network requests already sent can finish after invalidation; their data is discarded. This is a publication guard, not a claim that every superseded HTTP request is physically aborted.

## Measurements

See [the complete table](../artifacts/performance/initial-load/measurements.md), [summary and representative event traces](../artifacts/performance/initial-load/summary.json), and the raw samples and verification files in [the evidence directory](../artifacts/performance/initial-load/README.md).

Every final after sample uses **54 requests both at controls and at settlement**, versus **115 at settlement** in every matched before sample. Core requests excluding telemetry/polling fall **112 → 52 (53.6%)**; instrumented portal/Sales reads fall **95 → 35 (63.2%)**. Exact repeated core requests fall **50 → 0**. The total saving of 61 includes 60 data reads and one superseded discussion read. Neither matched build emits telemetry. All 40 final samples have zero HTTP errors, zero browser request failures and no settlement timeouts.

| Profile / navigation | Matched before controls / settled requests | After controls / settled requests | Before → after readiness median | Before → after last background work median |
|---|---|---|---|---|
| Desktop cold | 96–112 / 115 | 54 / 54 | 2.10 → 2.09 s | 2.78 → 1.88 s |
| Desktop repeat | 112 / 115 | 54 / 54 | 1.91 → 1.91 s | 2.41 → 1.45 s |
| Throttled mobile cold | 97–98 / 115 | 54 / 54 | 7.84 → 7.32 s | 9.43 → 6.85 s |
| Throttled mobile repeat | 98 / 115 | 54 / 54 | 4.76 → 3.75 s | 6.15 → 3.42 s |

Against the original **4 October** baseline:

| Profile / navigation | Original controls requests | Original → final readiness median | Final controls requests |
|---|---|---|---:|
| Desktop cold | 101–117 | 2.30 → 2.09 s | 54 |
| Desktop repeat | 109–117 | 1.91 → 1.91 s | 54 |
| Throttled mobile cold | 101–117 | 7.91 → 7.32 s | 54 |
| Throttled mobile repeat | 101–108 | 4.81 → 3.75 s | 54 |

The original baseline stopped at controls and did not measure full settlement. The matched instrumentation-only build supplies that missing before boundary. Desktop readiness is effectively flat; the clearest time improvement is mobile repeat readiness and background completion. The detailed table includes slowest samples and separate telemetry/polling counts.

Both controlled builds use staging Supabase, Vercel preview infrastructure in `iad1`, Chromium 149.0.7827.55, desktop 1280 × 900 and mobile 390 × 844. Mobile uses 4× CPU slowdown, 150 ms latency, 200,000 bytes/s download and 93,750 bytes/s upload. Each final build has five cold and five repeat samples per profile. Cache is cleared for cold and retained for repeat; this does not force a Vercel function cold start. One browser process runs at a time, with no local tests, builds or deployment inspections during measurement. Warm-up is settled before the first recorded cold reload.

The final before samples started between 20:52:24 and 20:54:39 UTC on 4 October; after samples started between 20:55:07 and 20:56:47 UTC. The measured after application is `33151cd8ae0fd06b90cac1f9c892666f6635681b`. Immutable deployment identities are retained with the evidence; subsequent evidence-only commits do not change measured application code.

Readiness preserves the October boundary: the completed sale's Completion navigation control appears, then two animation frames. Completed sales normally open at Handover, so this does not imply a fresh legal-context GET or an available mutation button. After the change, these controls additionally require a complete Sales snapshot. Recording continues until non-poll/non-telemetry work finishes and remains quiet for 1.5 seconds, with a 60-second cap. The table reports the last actual background request completion, not that artificial quiet grace period.

The original 4 October baseline used `b883040`, whereas the matched before preview has the current `a59f3d3` application plus instrumentation. The original baseline counted three Web Vitals requests and two to four discussion reads in readiness windows. These isolated preview branches have no Web Vitals flag and observe **zero telemetry requests**; telemetry is not silently credited as deduplication. Matched final before/after samples report polling separately. Small sequential samples, ordinary staging traffic, instrumentation and cache/backend variance limit timing claims; request ownership is the stronger evidence.

The exploratory `instrumented-before` samples are retained. Its first throttled cold reload overlapped warm-up and included 14 failed Sales child reads (no HTTP errors), producing a 129-request settlement window. Those failures are included in raw totals, not reported as successful reads or as necessary data work. Final settled-warm-up measurements are stored separately. The first `after` batch is supplementary; final results use the final application commit.

## Validation and remaining reads

- **57 focused Node tests passed**: restoration/sign-in/sign-out/token lifecycle, replacement identity, permission changes, overlapping access checks, stale portal/building results, equal-count membership changes, explicit refresh, atomic Sales failure paths and scoped action/UI reconciliation.
- **261 Sales tests passed**, including access, legal workflow, direct uploads, reservation redaction, commercial data and audit/allocation behavior.
- **33 Chromium tests passed**: lifecycle/access/retry/building cases, required-read failures and the legal workflow suite. New browser assertions observe exactly **4 requests for request authority and 5 for exchange**, with no broad portal/Sales reload; exchange's fifth request is the affected unit. Existing document, approval, completion and error-recovery coverage also passes.
- TypeScript `--noEmit` passed. New lifecycle/trace/access modules, building-context hook and focused browser spec pass ESLint. Comparative lint retains **13 existing portal errors and 2 existing Sales errors**, with no added errors; the repository-wide lint is not claimed clean. [Comparison](../artifacts/performance/initial-load/lint-comparison.json) and test logs are retained.
- Staging preview builds are READY. All four completed diagnostic sales remain completed with unchanged selected attempt fields, including `updated_at`, before/after each batch. Browser diagnostics perform no sales/database writes; ordinary sign-in and profile activity are separately counted.

The remaining 35 core snapshot reads are 25 portal reads (including area pagination) plus 10 Sales reads for this fixture. They retain existing broad portal dependencies; this change does not introduce screen-specific lazy loading. Two profile requests have different purposes/projections: authoritative current account and the directory used elsewhere. All-access setup lists and filtered current-user access lists also differ. Area pages have different offsets. These repeated table names are necessary reads, not identical duplicate requests. Email-based profile fallback can add a necessary read for a legacy profile.

New tokens/user updates and actual permission changes require fresh access/data; explicit Refresh discovers other users' edits; building changes, meaningful unit membership changes and real screen remounts require fresh Sales data. Legal context repeats on explicit Refresh and entering the legal panel are authoritative. Optional forecasting/fees reads and discussion polling remain separate. Legal actions continue to use the recently improved scoped path; no live action was rerun on completed diagnostic sales.

## Review scope

`main` does not yet contain the 15 staging commits through `a59f3d3`. A PR against `main` necessarily includes that existing application ancestry. Review this task's isolated changes with [the comparison from the requested starting commit](https://github.com/carl916/Bunnywell_Portal/compare/a59f3d3bb98781efd14cb5288e46d6a9bb10e6d3...codex/deduplicate-initial-loading). Existing uncommitted October baseline reports/scripts in the user's working tree were left untouched and are not added to this PR.
