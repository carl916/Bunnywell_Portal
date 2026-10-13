# Mobile dashboard and Sales layouts

Branch: `codex/mobile-sales-layouts`, based on latest staging `22aa6539ca86ddb6f946aecfae8f4e587c0f8d2c`. Validation ran on the prior staging head; the subsequent staging update changed only workflow-context SQL, diagnostics, tests and a package script, with no changes to the reviewed UI or its dependencies.

## Changes

- Dashboard pipeline uses equal shrinking cells on phones, with manual word breaks where needed. All five stages stay in one row at normal phone text sizes. Larger text and large counts reflow without cutting off values.
- Dates to review and Sales results reflow the existing table rows into compact vertical entries below 768px. Identity and Open/Review stay together, followed by the existing issue, ownership and date information.
- A single DOM tree retains table semantics with explicit roles and visually hidden mobile column headers. There are no duplicated responsive links, IDs, screen-reader records, subscriptions or requests.
- Desktop tables, Sales stage controls, selected styling, filters, sorting, pagination and existing navigation are retained. Row warnings also remain visible on mobile when a next action is present.
- Existing application bottom-navigation clearance and safe-area padding are retained; pagination was checked at maximum scroll. No header, bottom-navigation, business-rule, API or database changes.

## Verification

Local Chromium with intercepted synthetic records; no live customer records or database writes.

| Check | Result |
| --- | --- |
| Phone widths 320, 360, 390, 430 CSS px | All five pipeline stages on one row; no overflow in either results list |
| Tablet 768px and desktop 1440px | Original table layout retained; desktop screenshots reviewed |
| Long building names, multi-action summaries, ownership and key dates | Wrap within entries; links and Review counts preserved |
| Pipeline at 200% root text size / six-digit counts | Readable wrapping fallback, no clipped counts |
| Sales entries at 150% root text size | No horizontal overflow |
| Dates disclosure | All eight synthetic records accessible; no scroll-position jump |
| Sales filters, empty results and pagination | Stable scroll position; final pagination clears mobile navigation |
| Data requests during resizing/filtering/pagination | Zero additional API or PostgREST requests |
| Existing dashboard / Sales model tests | 49 passed |
| Existing dashboard browser suite | 12 passed |
| Existing Sales behavior and stability browser suites | 19 passed |
| New focused responsive browser tests | 2 passed |
| Focused ESLint and TypeScript | Passed |
| Diff whitespace check | Passed |

Existing browser tests additionally cover loading, retry, refresh, revocation, empty states, action destinations, record returns, browser Back, reload and permissions across developer, admin and conveyancer roles.

The focused tests compare every record link across all viewport sizes, preserve the recorded contractual date / passed-date distinction, assert expired authority visibility, and exercise the Open and Review destinations. Screenshot capture temporarily hides fixed application chrome to keep component captures unobstructed; navigation-clearance assertions run with that chrome visible.

## Screenshots

| Layout | 320px | 390px | Desktop |
| --- | --- | --- | --- |
| Pipeline | [320](screenshots/pipeline-320.png) | [390](screenshots/pipeline-390.png) | [Dashboard](screenshots/dashboard-desktop.png) |
| Dates to review | [320](screenshots/dates-320.png) | [390](screenshots/dates-390.png) | [1440](screenshots/dates-1440.png) |
| Sales results | [320](screenshots/sales-320.png) | [390](screenshots/sales-390.png) | [1440](screenshots/sales-1440.png) |

Additional 360, 430 and 768px captures are included alongside [enlarged text](screenshots/pipeline-enlarged-text.png) and [large counts](screenshots/pipeline-large-counts.png).

## Limits

- Browser verification uses Chromium and synthetic data, not physical iOS/Android devices or a live deployment. Explicit table roles preserve semantics under CSS reflow; a manual screen-reader session was not performed.
- Approved Sales filter styling is unchanged. At 320px with 150% root text, the existing Exchanged/Completed stage-filter labels can exceed their button's inner width by approximately 7px; enlarged-text assertions here cover the requested results entries, not a redesign of those controls.
- The first development-server runs required fixture scope/timing corrections and one login-startup retry. Final focused and existing regression suites passed.
- No merge or production deployment was performed.

## Reproduce

Start the application with the usual local configuration (or synthetic public Supabase URL/key; the fixture intercepts data requests), then set `SALES_UX_ORIGIN` and `DASHBOARD_BROWSER_ORIGIN` to its local origin.

```text
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales-mobile-layouts.spec.ts
npx playwright test --config playwright.sales-ux.config.ts tests/developer-sales.spec.ts tests/developer-sales-overview-stability.spec.ts
npx playwright test --config playwright.dashboard.config.ts tests/organisation-dashboard.spec.ts
node --test tests/dashboard-stage2b.test.mjs tests/organisation-dashboard.test.mjs tests/organisation-dashboard-handoffs.test.mjs tests/developer-sales-overview.test.mjs
npx eslint src/components/portal/dashboard/InternalDashboard.tsx src/components/portal/sales/DeveloperSalesResults.tsx tests/developer-sales-mobile-layouts.spec.ts
npx tsc --noEmit --incremental false
```
