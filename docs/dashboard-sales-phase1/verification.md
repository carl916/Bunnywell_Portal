# Phase 1 verification

Base: `staging` at `4d11613a1a5ec073de958fbe11eb12d0f12d1521`, including PR #36's latest conveyancer work. Branch: `codex/developer-sales-phase1`. Scope/category map: [dashboard-sales-ux.md](../dashboard-sales-ux.md).

Developer/admin Sales retains the financial overview, pipeline and one sales table. Its All sales / Our actions / Other teams views use shared workflow classification, with current-version tasks, explicit ownership, saved dates and existing destinations. The URL retains filters/page; the browser history entry retains return position through record reload and Back. Forecasting remains visible and disabled in All buildings and individual buildings.

Dashboard and Agent Fees layouts and sales-agent permissions are unchanged. Shared queue counts now exclude saved-date observations and unallocated tasks; unallocated items remain in Dates & exceptions. A missing active attempt for a reserved/exchanged unit, or multiple active attempts, is a developer record check. Neither legacy completed units nor available units acquire fabricated reservation tasks.

## Automated checks actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run build` (Next 16.2.7, synthetic public Supabase settings) | Pass |
| Focused ESLint: new modules, shared model/presentation/register/loaders, navigation hook, table, workspace, building-context hook and browser fixtures | Pass |
| ESLint: `SalesReservationWorkflow.tsx`, `ProductionPortalApp.tsx` | Same baseline: 2 and 13 existing errors respectively; no added errors or warnings |
| `npm run test:sales` (includes the two new Phase 1 test files) | 289 passed |
| `npm run test:dashboard` | 39 passed |
| New overview + guidance-fact tests with all three Dashboard test files | 50 passed (11 new and 39 shared-consumer tests) |
| New overview + existing action-refresh, legal-refresh UI, register-session/auth and sales-performance tests | 65 passed |
| `npm run test:sales-refresh` | 55 passed |
| `playwright.sales-ux.config.ts`, with `SALES_UX_EVIDENCE=after` | 7 passed, including matched evidence capture |
| `playwright.conveyancer.config.ts` | 55 passed; 1 existing opt-in comparison test skipped |
| `playwright.dashboard.config.ts` | 30 passed; 1 existing opt-in performance capture skipped |

The browser suites cover synthetic mutations, stale versions, uncertain mutation outcomes, access revocation, latest-response guards, loading/retry, legal and fee destinations, desktop/mobile, and retained conveyancer sessions. The conveyancer navigation assertion still reports one register read across three returns. Developer return tests report zero extra attempt/authority/Dashboard reads across three returns. Existing history/payment source assertions were updated for the new exact-count option; the snag-pagination fixture now uses an available unit so it does not unintentionally create the new missing-sale exception.

### Reproducible baseline lint failures

Before editing, the same checkout at `4d11613` produced two `react-hooks/set-state-in-effect` errors in SalesReservationWorkflow's existing URL/form initialisation. ProductionPortalApp produced 11 `react-hooks/set-state-in-effect`, one `react/no-unescaped-entities`, and one `react-hooks/immutability` error, plus 20 existing warnings. The final comparison retains these counts and rules. Reproduce with:

```powershell
npx eslint src/components/portal/sales/SalesReservationWorkflow.tsx src/components/portal/ProductionPortalApp.tsx
```

These pre-existing failures are outside this UX change. All selected automated unit/browser tests pass; there are no remaining test failures in the executed suites.

## Same-fixture request comparison

Each measurement used three fresh navigations in a local **production build**, the same synthetic fixture (18 authorised units, 15 active attempts, one building), fixed browser time, authenticated developer and `screen=sales&building=all`. The portal canonicalises the single accessible building to its ID in both versions. Every API/Supabase request is intercepted; nothing reads or mutates a genuine business record.

| Per navigation (all three samples identical) | Before | After | Change |
| --- | ---: | ---: | ---: |
| Auth, portal and Sales data requests | 28 | 30 | +2 |
| Decoded response-body bytes | 23,375 | 23,648 | +273 (+1.17%) |
| Dashboard requests | 0 | 0 | 0 |

The additions are `sale_legal_emails` and `sale_exchange_deposit_sources`. The existing receipt request now supplies matching source/amount facts for internal guidance. Reads use batches of at most 150 sale IDs and checked 250-row pages, with a 20,000-row bound per batch. There is no per-row fetch. Already loaded attempts, terms, current documents/versions, invoices and payments feed the shared derivation; no second broad Dashboard snapshot is requested. Conveyancer loading keeps its original query shape and register-session owner.

Raw measurements: [before](requests-before.json), [after](requests-after.json). Bytes are decoded synthetic response bodies, excluding headers, static assets and transport overhead. These results describe request shape, **not live database or network latency**.

## Screenshots

| View | Desktop (1440px) | Mobile (390px) |
| --- | --- | --- |
| Before results | [Desktop](screenshots/before-results-1440.png) | [Mobile](screenshots/before-results-390.png) |
| After results | [Desktop](screenshots/after-results-1440.png) | [Mobile](screenshots/after-results-390.png) |
| Our actions | [Desktop](screenshots/after-actions-1440.png) | [Mobile](screenshots/after-actions-390.png), [scrolled review controls](screenshots/after-actions-scroll-390.png) |
| Initial loading | [Desktop](screenshots/loading-1440.png) | [Mobile](screenshots/loading-390.png) |
| Initial error / retry | [Desktop](screenshots/error-1440.png) | [Mobile](screenshots/error-390.png) |
| Background refresh | [Desktop](screenshots/refreshing-1440.png) | [Mobile](screenshots/refreshing-390.png) |

Full desktop portfolio captures: [before](screenshots/before-portfolio-1440.png), [after](screenshots/after-portfolio-1440.png). All images contain synthetic data.

## Short manual review script

Use an authorised review environment for read-only navigation. Use the local synthetic Playwright fixtures for failure, revocation and mutation steps; never use genuine records for those tests.

1. Open developer Sales in All buildings. Confirm financial/pipeline figures remain present, All sales is selected, and units follow building/floor/natural order. Compare an available unit, a legacy completed unit and a missing-sale exception.
2. Select Our actions. Confirm overdue completion work precedes routine reservations. Search and stage/category filters should change the displayed sales count before pagination; pipeline totals still describe the whole selected building.
3. Open page 2, review a sale, reload its file, then use Back to sales overview. Verify page, filters and scroll position. Repeat with browser Back. Reset filters should restore All sales, all stages/categories, empty search and page 1.
4. Open `/?screen=sales&building=all&salesWork=ours&salesCategory=documents#sales-results`. Confirm the matching sale count and results position. Expand a row's additional actions and follow each current document destination. Repeat for `salesCategory=payment-position` and verify the existing financials/fee section.
5. Compare a mixed-responsibility sale in Our actions and Other teams. Confirm the summary reflects the selected team. Review unallocated work in All sales; it must not acquire another team's ownership.
6. Confirm Open forecasting is disabled in All buildings and a selected building, with “Not yet enabled”. Check the unchanged Agent Fees entry and conveyancer register separately.
7. At 390px, check selected-view contrast, keyboard focus and controls. Scroll the table horizontally to see dates and review controls; the page itself must not scroll sideways.
8. In the synthetic fixture, hold the authority read, fail it, retry, and revoke access. Initial loading must show no sales/counts, a background refresh must retain the previous rows, failure must disable stale review controls, and access denial must hide rows. Existing legal mutation suites verify current-version guards and retained conveyancer invalidation.

For interactive fixture inspection, start the local app on port 3012 and use `npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales.spec.ts --headed --debug`. `SALES_UX_EVIDENCE=after` enables the screenshot/request capture test.

## Limitations and deferred work

- This evidence uses local fixtures, not live RLS, email delivery or real database latency. Existing permission/API and synthetic database handoff tests are included.
- If an existing broad core Sales read is truncated by the API row limit, internal guidance fails clearly and asks for a narrower building scope rather than using an incomplete workload. Compact additional guidance reads are paginated and bounded.
- Return scroll is stored per browser history entry; a newly opened tab has the URL filters but no previous tab's scroll position. Mobile retains the existing horizontal-table approach.
- Phases 2–4 (Agent Fees layout, Dashboard category layout, sales-agent fees access) are deferred. No schema, dependency, hosting-region or production changes; no merge or shared staging deployment.
