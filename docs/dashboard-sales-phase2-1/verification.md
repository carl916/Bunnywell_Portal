# Phase 2.1 verification — Agent Fees controls and scrolling

Base: `a531b84b76fd9e70b84a038d52528fc3b53fd19a` (latest `origin/staging` when work started; merged Phase 2 PR #38).
Head branch: `codex/fee-controls-scroll`. The delivery PR records the exact final head SHA.
Contract and destination factories: [dashboard-sales-ux.md](../dashboard-sales-ux.md).

## Result and evidence boundary

Developer Fees now has one group of five alternative views and one canonical `feeView`. Our actions counts the unique-sale union of invoice approvals and positive approved balances. Agent, milestone, sort and search remain refinements; Reset restores the documented defaults inside the authorised building. Legacy URLs preserve their effective membership, including an explicit removable Assigned agents only scope. The default and selected view remain selected for empty results and repeated activation. Ownership is omitted only for unambiguously developer-owned work in developer-only views.

All recordings, screenshots, request counts and browser results below are **local synthetic evidence**. The fee/scroll and matched captures use a local Next.js production build with intercepted API/Supabase responses. Sales controls used the existing local development-server configuration. Embedded evidence uses a same-origin iframe harness; the repository has no dedicated Fees preview wrapper. No authenticated staging or hosted preview inspection was performed. No genuine records, uploads, notifications, approvals, payments or assignments were changed. Staging counts and money were not acceptance constants.

The browser path is existing authorised fee RPC → retained snapshot → unchanged financial derivation → scoped views → existing financial milestone → retained list return. Existing synthetic SQL/permission tests cover the database boundary; intercepted browser tests do not establish live hosted RLS or database latency.

## Scrolling findings and fix

Before: every Fees refinement appended `#fee-results`, cleared `salesScroll`, and notified a shared hook whose location effect scrolled the anchor again. Both Sales and Fees instantiated that hook. Record sections have separate scroll effects; these remain intact. Neither the portal route listener nor table overflow/focus handling required a list jump.

After: one shared event generation distinguishes filter, arrival, pagination and history intents. Only the active ready list consumes a scroll request. Filter updates invalidate old saved scroll without moving focus or scrolling; refresh/remount does not replay consumed arrivals. A page clamp retains a pending arrival/return only until consumed. Explicit Fees pagination reveals the list once. Saved positions win over anchors for browser Back/Forward and the visible return control, including after record reload. Direct entries without a saved return remain valid. Pagehide records the current list position for reload. Native browser history restoration remains enabled.

An additional observed contributor was browser scroll anchoring: changing row height while near the bottom shifted the viewport even with **zero JavaScript scroll calls**. Excluding the Fees subtree fixed view switching, but typing from empty to populated results could still anchor the document bottom outside that subtree (12px desktop / 33px mobile). A local diagnostic confirmed that opting out at the actual document scroll container fixes that edge. `html:has(.fees)` now opts out of anchoring only while the Fees list is mounted; record pages and other modules automatically retain their usual anchoring. There are no counter-scroll calls, timers, permanent spacers, forced filter-to-top behaviour or global scrolling/restoration changes.

The normal container is `document.scrollingElement`; the iframe harness has its own document viewport. The helper also captures/restores any scrollable list ancestors. A shorter document legitimately clamps to its new maximum. Measured samples distinguish that from programmed movement:

| Viewport | View-switch samples | Programmatic filter scroll calls | Height clamps | Other samples |
| --- | ---: | ---: | ---: | ---: |
| 1440 × 900 | 30 | 0 | 5 | 25 |
| 390 × 844 | 30 | 0 | 5 | 25 |
| 1280 × 500 | 30 | 0 | 5 | 25 |

Each sample also re-activates the selected control to prove it stays selected. The assertions check both scroll position and control coordinates to a 2px tolerance when height permits. At clamps, the assertion checks `min(previousY, newMaximumY)` rather than claiming exact preservation. Separate tests instrument typing, zero results, delayed refresh, page clamping, first-load filter cancellation, single arrival, single return, pagination and embedded focus. Raw samples: [desktop](scroll-1440x900.json), [mobile](scroll-390x844.json), [short viewport](scroll-1280x500.json).

## Checks actually run

| Check | Result |
| --- | --- |
| Unchanged-base production build | Pass |
| Unchanged-base developer Sales smoke | 4 passed |
| `npm run test:sales` (includes financial, permission, loading/access and fee workspace tests) | 308 passed |
| `npm run test:sales-refresh` | 55 passed |
| `npm run test:dashboard` | 39 passed |
| Final Fees browser suites + after evidence capture | 19 passed |
| Existing developer Sales browser suite | 7 passed |
| Existing Sales controls browser suite | 7 passed |
| Existing conveyancer/register/loading browser configuration | 55 passed, 1 opt-in capture skipped |
| Existing Dashboard/legal/stage browser configuration | 30 passed, 1 opt-in capture skipped |
| TypeScript `npx tsc --noEmit` | Pass |
| Focused ESLint on all changed TS/TSX/MJS and browser tests | Pass |
| Final `npm run build` | Pass |
| `git diff --check` | Pass |

Final browser total: **118 passed, 2 opt-in captures skipped**. The before recording and four base smoke tests are additional. New unit fixtures include all approvals, balances only, 37 missing-invoice sales with assigned/unassigned agents, no missing invoices, two milestones on a sale, settled positions and empty populations. All 12 legacy responsibility/category combinations compare actual membership; canonical precedence, unassigned category links, visible legacy scope, all-category record targets and round trips are covered.

No suspected baseline product failure remained in the selected checks. Initial browser launches could not reach the sandboxed local server/browser; both were run outside the sandbox and the base checks rerun successfully. During implementation, the new tests caught native scroll anchoring and a mobile disclosure escaping the viewport; both were fixed without weakening the assertions. Historical screenshots regenerated by existing suites were restored, leaving Phase 2.1 evidence separate.

Reproduction (start the production server at port 3013 after `npm run build`):

```powershell
npx playwright test --config playwright.fees-ux.config.ts tests/developer-fees.spec.ts tests/developer-fees-scroll.spec.ts
$env:FEES_SCROLL_EVIDENCE='after'
npx playwright test --config playwright.fees-ux.config.ts tests/developer-fees-scroll-evidence.spec.ts
$env:SALES_UX_ORIGIN='http://localhost:3013'
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales.spec.ts
$env:CONVEYANCER_BROWSER_ORIGIN='http://localhost:3013'
npx playwright test --config playwright.conveyancer.config.ts
$env:DASHBOARD_BROWSER_ORIGIN='http://localhost:3013'
npx playwright test --config playwright.dashboard.config.ts
npx playwright test --config playwright.config.ts tests/sales-controls.spec.ts --reporter=list
```

## Matched request comparison

The same fixed-clock synthetic fixture and developer scope were used for three fresh entries on each side. Values below are observations of this fixture, not business expectations.

| Per fresh entry | Before (each of 3) | After (each of 3) |
| --- | ---: | ---: |
| Data/auth requests | 31 | 31 |
| Decoded response bytes | 51,072 | 51,072 |
| Fee portfolio RPC | 1 | 1 |
| Broad Dashboard loads | 0 | 0 |
| Additional fee RPCs during view/search/record-return sequence | 0 | 0 |

The sequence makes four existing record-detail reads on both sides. No new per-row/per-click data requests, polling, dependencies, schemas, region settings or timeouts were introduced. Raw captures: [before](requests-before.json), [after](requests-after.json). Static assets, headers and transport overhead are excluded; these measurements do not establish live server performance.

## Recordings and screenshots

[Before recording](before.webm) · [After recording](after.webm). Both show approvals → unpaid → submissions → Our actions → All records → search → record → return → empty approvals. Small pauses are only in the opt-in recording script; application navigation uses no arbitrary wait.

| Capture | Before | After |
| --- | --- | --- |
| 1440px desktop | [Before](screenshots/before-1440.png) | [After](screenshots/after-1440.png) |
| 390px mobile | [Before](screenshots/before-390.png) | [After](screenshots/after-390.png) |
| Empty approvals | [Before](screenshots/before-empty.png) | [After](screenshots/after-empty.png) |

Additional final captures: [desktop loading](screenshots/loading-1440.png), [mobile loading](screenshots/loading-390.png), [desktop error](screenshots/error-1440.png), [mobile error](screenshots/error-390.png), [desktop retained refresh](screenshots/refreshing-1440.png), [mobile retained refresh](screenshots/refreshing-390.png).

## Compact manual review

1. Open Sales → Agent Fees as an internal user. Confirm one selected view, Our actions, with distinct sale and invoice/milestone labels. Repeat the recorded sequence at desktop and 390px; reselect the active view. It must stay selected even if empty.
2. Change agent, milestone, sort and search. Confirm the view remains selected and page returns to 1. Summary totals follow building/agent scope; the filtered result count follows table refinements. Use About totals with the keyboard. Reset restores defaults inside the same building.
3. Open `/?screen=sales&building=all&salesView=agent_fees&feeWork=others#fee-results`. Confirm the visible Assigned agents only scope, including after changing views. Select Unassigned: the intersection is empty. Remove the scope: genuinely unassigned records are discoverable. Test an unassigned submission-category link directly.
4. Change views and type while the controls are in view and near the bottom of long/short lists. Expect no programmed jump. A document that becomes shorter may clamp. Pagination deliberately reveals the list top. A first category deep link reveals once; manual refresh must not replay it.
5. Review a completion invoice and a row with two actions. Confirm the matching fee destination and both milestones. Return using browser Back/Forward, then repeat using Back to Agent Fees and record reload. Filters, page and useful position should agree. Do not perform genuine mutations.
6. Smoke-test Sales category navigation/record return and the unchanged conveyancer screen. Use local synthetic suites for errors, incomplete data and revocation; initial failures must not announce zero work, retained failures disable reviews, and revoked scope hides protected data.

Stop at the PR for review. Dashboard layout, sales-agent fee access, financial/eligibility rules, genuine data and shared deployments remain outside this delivery.
