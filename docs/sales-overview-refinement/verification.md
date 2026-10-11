# Sales overview refinement

Validated on 11 October 2026 from staging `428a46d` (PR #39). Target: staging only.

## What caused the movement

The old admin/developer pipeline card handler called `sales-results.scrollIntoView({ block: "start" })` after every stage selection. The existing URL-navigation hook already suppressed filter scrolling, but this separate handler bypassed it.

The baseline also showed that results controlled document height and automatic table column sizing. Initial loading returned a different tree without the Financial overview/pipeline sections; those sections were inserted above the results on completion. The conveyancer register additionally removed the Action with column in Our team, changing the table structure.

Measurements use the same synthetic 18-unit fixture, Chromium, and 1440×960 / 390×960 viewports. The capture instruments programmatic scrolling and focus, records column widths and input positions, then clicks Exchanged.

| Measurement | Before: desktop | After: desktop | Before: mobile | After: mobile |
| --- | ---: | ---: | ---: | ---: |
| Window scroll before → after | 25 → 863 | 41 → 41 | 1064 → 1788 | 956 → 956 |
| Scroll displacement | 838 px | 0 px | 724 px | 0 px |
| Explicit scrollIntoView calls on selection | 1 | 0 | 1 | 0 |
| Document height before → after | 2887 → 1823 | 2763 → 2763 | 4241 → 3079 | 3652 → 3652 |
| Table column widths changed | Yes | No | Yes | No |

Raw measurements: [desktop before](before-1440.json), [desktop after](after-1440.json), [mobile before](before-390.json), [mobile after](after-390.json). No application focus call was recorded for stage selection. Changes in document height were a separate source of native scroll-clamping/anchoring risk; the explicit scroll call is the directly evidenced cause of the measured stage jump.

## Changes

- One Sales overview panel contains six stage cards, Action with / Action category / Search / Reset filters, active refinements, result count and the existing role-specific table. The Stage dropdown and responsibility button groups are removed.
- Exactly one stage is selected, including All stages. Reselecting it is a no-op. Cards share the established Agent Fees colours (`#0f3d2e`, white and gold inset indicator); unselected hover and keyboard focus have distinct treatments. Agent Fees component/styles and business logic are untouched.
- Stage, organisation responsibility, category and search intersect independently. Reset restores All stages / All teams / all categories / empty search and page 1, retaining building scope. All teams includes neutral sales when no category is selected. Mixed-team sales match either team's relevant actions without duplicating rows.
- Existing pipeline counts, value calculation and authorised scope remain intact. All stages sums the existing five stage totals. Conveyancers continue to receive non-financial data only. Their category label is projected from the existing work classifier; no action eligibility, ownership, workflow or ordering rule was changed.
- The initial overview uses the same controls/tree as the loaded view. Existing Financial overview dimensions are reserved during loading, with unresolved figures hidden; its loaded layout, calculations and Forecasting behaviour are unchanged.
- Results retain their largest measured height for the current scope and width, including short/empty results, so shrinking a table cannot clamp the viewport upwards. This deliberately leaves reserved space below shorter results. A new scope or width starts a new measurement. Browser anchoring is disabled only while these Sales lists are mounted. No filter scroll/focus restoration is introduced.
- Fixed table layout and column proportions prevent content-driven horizontal movement. Conveyancer responsibility changes keep the Action with column present; its mobile row presentation remains responsive.
- Conveyancer filters now use the existing validated Sales URL state and return mechanism. Filters, pagination and vertical position survive the overview button, browser Back and a detail reload. Only measured layout space is added to saved list history; it contains no cached sale data. Existing freshness, scope revocation and stale-response protections remain in place.

## Evidence

| View | Before selecting | Before: Exchanged selected | After selecting | After: Exchanged selected |
| --- | --- | --- | --- | --- |
| Desktop | [Before](before-1440.png) | [Jumped to results](before-selected-1440.png) | [After](after-1440.png) | [Selection stays in place](after-selected-1440.png) |
| Mobile | [Before](before-390.png) | [Jumped to results](before-selected-390.png) | [After](after-390.png) | [Selection stays in place](after-selected-390.png) |

Final panels: [developer desktop](overview-developer-1440.png), [developer mobile](overview-developer-390.png), [admin desktop](overview-admin-1440.png), [admin mobile](overview-admin-390.png), [conveyancer desktop](overview-conveyancer-1440.png), [conveyancer mobile](overview-conveyancer-390.png).

The six `stability-{role}-{width}.json` files record seven stage transitions each, including zero results, at the document bottom. All 42 transitions have unchanged scroll/control positions and column geometry, and no application scrolling. Browser click/caret auto-reveal is distinguished from application scroll calls by focusing without scrolling before keyboard activation; the separate before/after capture uses ordinary clicks.

## Validation

All data and auth requests in browser fixtures are intercepted. These are deterministic local checks, not a live staging data audit or latency claim. Synthetic inconsistencies remain visible and are not suppressed.

| Check | Result |
| --- | --- |
| `npm run test:sales` | 308 passed |
| Register presentation/API/auth/session + developer overview unit tests | 56 passed (includes 7 also in the core suite) |
| New overview stability suite + existing developer Sales suite | 19 passed |
| Conveyancer overview, loading and corrections browser suites | 50 passed across the main run and targeted reruns after updating old-control/default expectations |
| Existing Sales loading/concurrency browser suite | 5 passed |
| Existing Agent Fees arrival/return and shared-hook browser checks | 2 passed |
| Before/after evidence capture | 2 passed per version |
| `npx tsc --noEmit --pretty false` | Passed |
| ESLint on overview components, navigation, projection and new browser tests | Passed |
| ESLint including the existing `SalesReservationWorkflow` file | Two pre-existing `react-hooks/set-state-in-effect` errors, independently reproduced by linting `origin/staging` through stdin (conversation state and buyer form initialization); no new diagnostics |
| `npm run build` | Passed |
| `git diff --check` | Passed |

Coverage includes admin/developer/conveyancer, desktop/mobile, combined stage/team/category/search, both-team actions, no-action sales, zero results, initial loading, background refresh, rapid switching, Enter/Space stage selection, native dropdown keyboard selection, reset, scope retention, browser Back, detail reload and list-position restoration. Existing tests cover auth changes, 401/403 revocation, old-response rejection, 15/60-second freshness, interrupted mutations, canonical floor ordering, and unchanged sale-file permissions.

Reproduce the new browser checks with a local server on port 3013:

```powershell
$env:SALES_UX_ORIGIN='http://localhost:3013'
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales-overview-stability.spec.ts tests/developer-sales.spec.ts
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales-overview-evidence.spec.ts
```

The evidence test's `SALES_OVERVIEW_EVIDENCE=before` mode is for the baseline staging code; omit it for this branch. No production changes, migrations, deployments or merge were performed.
