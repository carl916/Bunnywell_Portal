# Phase 2 verification — developer Agent Fees

Base: latest staging at `05dc58beef3dde0620c65afd07be25a12519e90a` (merged PR #37).
Branch: `codex/developer-agent-fees-phase2`. The delivery PR records the exact head commit.
Scope map: [dashboard-sales-ux.md](../dashboard-sales-ux.md).

## Pre-change Phase 1 smoke

Before product edits, built the unchanged base and ran four existing developer Sales browser tests:
Our actions/ownership/filter reset; correct document and fee destinations; record/reload/Back with filters/page/scroll retained; and disabled Forecasting in All buildings and a selected building.
**4 passed.** Command:

```powershell
$env:SALES_UX_ORIGIN='http://localhost:3013'
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales.spec.ts --grep 'All sales defaults|record return|filtered category|All buildings'
```

This is **local synthetic fixture evidence**, not authenticated staging evidence. Every browser API/Supabase request was intercepted; no genuine approvals, invoices, payments, notifications or records were changed. No staging credentials or live-service validation were assumed.

## Changes and verification boundaries

The existing fee derivation and compact authorised RPC feed three selectable categories. Our actions explicitly defaults to invoice reviews and positive approved balances. Waiting on others includes assigned-agent submissions/corrections; unallocated work remains in All records and the submission category. The old independent Status filter is replaced by the category selection.

Category cards describe building + agent across both milestones; table search, milestone, responsibility and page have a separately labelled unique-sale count. Four synthetic approved-balance sales total **£11,000**, including one £1,000 part payment. Two reviews remain separate from that money. Unit 101 appears in both developer categories but remains one table row. The submission/correction card has 42 milestone tasks across 23 sales, including two unallocated milestones; these do not enter Our actions.

Current authorised fee calculations, VAT, rounding, deductions, reservation credits, payment allocation, voiding and invoice eligibility are unchanged. New tests cover queried/replaced, settled and zero-balance positions. The compact RPC supplies no due date/urgent flag, so the documented order is invoice reviews, payment positions, submissions, then configured building/floor/natural unit order and sale ID before pagination.

One review control opens the matching financial milestone; multiple actions open the existing financials heading containing both milestones. Fee URL filters and the browser history entry preserve source, page and scroll through record/reload/Back. The retained Sales workspace owns the fee snapshot; ordinary record returns issue **zero extra fee RPCs**. Exact count/input validation makes incomplete data explicit, same-scope refresh retains successful rows, failed refresh disables review links, and scope/access changes hide old rows/totals.

### Three bounded Sales corrections (separate from Fees)

1. Removed the inline expandable duplicate instruction links. Completion reviews open the existing package; multi-fee actions open financials; mixed actions open a small matching-action navigator in the record, retaining all destinations. Tests follow both current document reviews and the mixed document/payment routes, including same-record section scrolling.
2. Our actions suppresses redundant developer responsibility only when all matching tasks are unambiguously developer-owned and actionable. All sales and mixed/unallocated cases retain ownership.
3. Completion-date and expired-authority exceptions show the actual saved date. Tests use a saved 6 October completion date and 6 October authority expiry. No priority or legal rules changed.

Dashboard layout, conveyancer experience, sales-agent access, permissions, database schema and dependencies are unchanged.

## Automated checks actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run build` (Next 16.2.7 production build, synthetic public Supabase settings) | Pass |
| Focused ESLint: fee components/loader/styles' consumers, navigation, shared classification, Sales results, new tests and edited browser tests | Pass, no new errors/warnings |
| Full relevant existing component lint comparison | Same baseline: SalesReservationWorkflow 2 errors; ProductionPortalApp 13 errors / 20 warnings |
| `npm run test:sales` | 304 passed, including the 15 new fee workspace/loading/access tests |
| `npm run test:fees` | 95 passed (overlaps Sales) |
| `npm run test:dashboard` | 39 passed |
| `npm run test:sales-refresh` | 55 passed |
| Fee + developer-overview navigation unit selection after final navigation change | 18 passed |
| Affected Rentals tenancy/scope regression file | 13 passed |
| Global building-context test file | 5 passed, 1 reproduced baseline failure below |
| Phase 2 browser suite, including evidence capture | 8 passed |
| Developer Sales browser regression / bounded polish suite | 7 passed |
| Existing Sales controls: mentions, 62-row fee pagination, filtering, refresh and mobile review controls | 7 passed |
| Conveyancer register / Sales loading browser configuration | 55 passed, 1 existing opt-in evidence capture skipped |
| Dashboard / legal workflow browser configuration | 30 passed, 1 existing opt-in performance capture skipped |

Browser total: **107 passed, two existing opt-in captures skipped**. The Phase 1 pre-edit smoke is additional and overlaps the Sales cases. Earlier fixture/locator issues were corrected; the listed final suites are passing.

The new PostgreSQL test executes the **unchanged** portfolio RPC in PGlite using synthetic schema/auth adapters and rejects agents, conveyancers, forged requester IDs and inactive internal users. Existing permission/API tests continue to reject approval/payment/voiding escalation. This is not a live RLS or hosted PostgREST validation.

### Reproducible baseline failures

- Lint: the unchanged base and final comparison both report two existing `react-hooks/set-state-in-effect` errors in SalesReservationWorkflow. ProductionPortalApp retains 11 of that rule, one `react/no-unescaped-entities`, one `react-hooks/immutability`, plus 20 warnings. [Structured comparison](lint-comparison.json).
- `tests/global-building-context.test.mjs`, “operational pages inherit global context instead of owning building filters”, fails at the existing AuditLog assertion (`setBuildingId|<FilterSelect label="Building"`). The existing AuditLog has its own building filter. Reproduced against untouched `05dc58b` source extracted with `git archive`, running:
  `node --test --test-name-pattern="operational pages inherit" tests/global-building-context.test.mjs`.
  The Phase 2 fee assertions in that file pass; the Audit implementation/assertion was not changed.

## Matched request comparison

Three fresh navigations before and after used the same 24-sale fixture, one authorised building, developer identity, fixed clock, local production build and direct Agent Fees entry. All three samples on each side were identical.

| Per navigation | Before | After |
| --- | ---: | ---: |
| Auth, portal and Sales/Fees data requests | 31 | 31 |
| Decoded response-body bytes | 51,072 | 51,072 |
| Fee portfolio RPCs | 1 | 1 |
| Broad Dashboard loads | 0 | 0 |

Raw data: [before](requests-before.json), [after](requests-after.json). Exact-count preference adds a completeness check without an extra request. This comparison excludes static assets, headers and transport overhead and **does not measure live database latency or the server cost of exact counts**. No per-row requests or polling were added.

## Screenshots

All contain synthetic data. Mobile uses the existing horizontal table with sticky unit identity; a separate capture shows the review controls.

| View | Desktop 1440px | Mobile 390px |
| --- | --- | --- |
| Before Fees | [Desktop](screenshots/before-fees-1440.png) | [Mobile](screenshots/before-fees-390.png) |
| Our actions | [Desktop](screenshots/after-fees-1440.png) | [Mobile](screenshots/after-fees-390.png) |
| Four approved unpaid sales | [Desktop](screenshots/after-unpaid-1440.png) | [Mobile](screenshots/after-unpaid-390.png), [review controls](screenshots/after-review-controls-390.png) |
| Initial loading | [Desktop](screenshots/loading-1440.png) | [Mobile](screenshots/loading-390.png) |
| Initial failure / retry | [Desktop](screenshots/error-1440.png) | [Mobile](screenshots/error-390.png) |
| Retained background refresh | [Desktop](screenshots/refreshing-1440.png) | [Mobile](screenshots/refreshing-390.png) |
| Bounded Sales polish | [Desktop](screenshots/sales-polish-1440.png) | [Mobile](screenshots/sales-polish-390.png) |

Phase 1 Sales before reference: [desktop](../dashboard-sales-phase1/screenshots/after-actions-1440.png), [mobile](../dashboard-sales-phase1/screenshots/after-actions-390.png).

## Manual staging review script

After review/merge and an authorised staging deployment, use an internal developer/admin account for read-only checks. Do not manufacture approvals, invoices or payments on genuine records. Use synthetic tests for failures, revocation and mutations.

1. Open Sales → Agent Fees. Confirm Our actions is selected and no category is selected automatically. Review the three category totals and their building/agent scope label.
2. Select Approved unpaid balances. Reconcile positive approved/part-paid balances against existing invoice positions; unapproved submissions must remain in Awaiting approval. Compare a sale with both categories.
3. Select an agent and change milestone/search/page. Confirm category totals still describe building + agent while the filtered table count changes. Select All records, then the submission/correction category. Unassigned work must be visible without invented ownership.
4. Follow `/?screen=sales&building=all&salesView=agent_fees&feeCategory=payment-position&feeWork=ours#fee-results`. Open a row, reload, use Back to Agent Fees and browser Back. Confirm source/category/building/agent/milestone/sort/page and useful scroll position.
5. Open a two-action row. Confirm both fee milestones are present in financials; use a completion-only filter to verify its direct completion destination. Navigate without submitting any mutation.
6. In Sales Our actions, check the shorter summary, one review route, retained unit link and absence of redundant developer ownership. Open a multi-document package and a mixed-action record. Confirm all matching tasks remain reachable and saved completion/authority dates appear with exceptions.
7. At 390px, use keyboard focus/Enter, verify the pressed view/category, and scroll horizontally to the review control. Confirm no page overflow. Recheck disabled Forecasting, the unchanged Dashboard and conveyancer register.
8. Run local synthetic loading/retry/partial/revocation tests; verify initial placeholders never claim zero work, refresh retains rows, stale review controls disable on failure, and changed access/scope hides protected totals.

## Remaining limitations

- No authenticated staging journey, live database latency, live notification or hosted PostgREST verification was performed. An isolated preview was not deployed.
- The existing RPC still returns the authorised portfolio in one compact call. A server row-limit truncation or missing fee terms/payment inputs produces an explicit unavailable state rather than incomplete totals; no schema or transport redesign was introduced.
- New tabs can preserve URL filters but cannot recover another tab's scroll history. Mobile retains horizontal table scrolling.
- The existing Audit scope assertion and lint baseline remain unresolved, outside this phase.
- Dashboard simplification and sales-agent fee visibility remain Phases 3–4. Shared staging and production were not changed; this PR must stop for review.
