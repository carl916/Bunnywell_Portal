# Dashboard simplification — Stage 1

Implemented for `admin` and `developer` only, based on staging commit `369e02c44a0016016e3f497e973415748565fa67` (11 October 2026). Local feature branch: `codex/dashboard-stage-one`.

The internal dashboard now presents Dashboard → Building/Portfolio position → Work needing attention → Dates to review → collapsed Recent activity. The paginated worklist, responsibility tabs, module buttons, expanded business-context rows, duplicate dates banner/sidebar and building comparison are absent from this internal presentation. Their existing shared implementation remains available to the other roles.

## Main changes

- `src/components/portal/dashboard/InternalDashboard.tsx` and its CSS module: compact grouped position, three-column attention table, five priority date entries with remaining entries in a disclosure, and recent activity collapsed by default. Existing `panel`, `secondary`, mentions and navigation behaviour are reused.
- `src/lib/dashboard/overview.ts`: dashboard composition from the existing authorised snapshot and Sales selectors. It does not define workflow gates, financial calculations, ownership rules or new rental actions.
- `src/app/api/dashboard/route.ts` and `src/lib/dashboard/types.ts`: add the optional internal composition after the existing authentication and access rechecks. No new data requests are made.
- `OrganisationWorklist.tsx`: routes only internal admin/developer presentation to the new component. Its identity/scope guards, aborts, refresh cadence, mutation refresh and stale/error behaviour remain in place. `ProductionPortalApp.tsx` supplies the building name during initial loading.
- `src/lib/sales/developer-overview.ts`: accepts an optional already-derived snapshot, so the dashboard can reuse the canonical Sales row selector without deriving the workflow twice. Its existing callers and default behaviour are unchanged.
- Dashboard unit/API/browser tests and the existing `test:dashboard` script cover the new composition and navigation.

## Sources, counting units and destinations

Every destination includes `building=<selected id>` or `building=all`; no previous search, category or page refinements are inherited.

| Summary / count | Existing definition | Destination |
| --- | --- | --- |
| Sales position | `deriveDeveloperSalesRows` / `deriveSalesRegister`, `SALES_ROUTE_STATUSES`, authorised units, configured building/floor/numeric order | General Sales overview |
| Sales: Our team / Other teams | `selectDeveloperSalesRows` with `INITIAL_SALES_OVERVIEW` and `work=ours/others`. Counts **sales rows**, not tasks or documents. Existing fee work remains included, matching Sales. | Exact `salesOverviewDestination(scope, "", team)` → `salesWork=ours/others#sales-results` |
| Agent Fees: Our team / Other teams | Existing `deriveDashboard` `fee_*` work, using `deriveAgentFeePortfolioRow` and `matchesWorkTeam`. Distinct **active sale records** with fee work. | **Counts unlinked.** General Agent Fees link uses `feeViewDestination(scope, "all")`. See coverage limitation below. |
| Active developer snags / resident defects | Existing `developer_snags` / `resident_defects` summaries, using `isActiveSnag`; the populations remain separate | General Snags plus the supported `snagSource=developer_snag/leaseholder_defect` links |
| Snags & defects: team columns | Distinct **snag records** from canonical work and `matchesWorkTeam`, including missing-trade developer work alongside contractor work where applicable | **Counts unlinked.** Snags has no supported URL responsibility filter. General scoped Snags link. |
| Rentals occupied / void | Existing active rental portfolio, `activeTenancy` and the existing `occupied` / `voids` summaries | General scoped Rentals |
| Rentals: team columns | Distinct **rental units** with existing void, fixed-term review or current-tenancy rent-risk work. Source/import exceptions remain separate building-level summaries. | **Counts unlinked.** Rentals has no matching action/responsibility URL filter. General scoped Rentals link. |
| Rental evidence | Existing `reported_arrears.detail`, import evidence dates and canonical missing-evidence/import-exception work | Rentals. No freshness threshold or rent-paid inference is introduced. |
| Dates to review | Existing snapshot ordering, `deadlineState`, urgent/unallocated exceptions and `EXPANDED_DEADLINE_DAYS` (30-day date-only review window; existing 48-hour instant warning remains unchanged) | Existing `destinationUrl` per record, preserving unit, attempt, version, section/anchor and return scope |
| Recent activity | Unchanged `snapshot.activity`, authorised `sale_workflow_context`, last seven London calendar days and latest milestone per event type | Existing full-sale activity destination |

Counts may overlap across columns and areas. There is no combined total. “Our team” uses the existing organisation/developer-team ownership; it is not the logged-in account's personal assignment queue.

## Explicit gaps and limitations

1. **Agent Fees coverage differs.** The dashboard's existing fee source concerns active sale attempts. The approved Agent Fees RPC also includes invoice-bearing earlier attempts and has its own assignment scope. Although the Fee page has action views, its full population cannot be advertised as an exact match for these dashboard counts. The row explicitly says “Active-sale fee work”; both counts remain plain text and the module link opens the full portfolio. No duplicate RPC fetch or new fee counting workflow was added to force a match.
2. **Snags and Rentals do not accept matching responsibility filters.** Their counts are plain text. The existing `snagSource` filter is used only for clearly labelled general developer-snag/resident-defect links. The emitted-but-unconsumed `snagWork` parameter is not used.
3. **No combined scoped date-exception destination exists.** Five entries are initially shown; every remaining entry in the existing expanded window is available in the “more dates and exceptions” disclosure with its existing record link. There is no fabricated “View all” route. Saved contractual dates retain “Review saved contractual completion date”; elapsed workflow time does not become a deadline.
4. **Other genuine work is retained.** Eligible handovers, resident-access reviews (admin only), lifecycle reviews, unallocated work, rental evidence/import exceptions and sales work outside the current pipeline appear as compact additional summaries. Counts remain unlinked unless an exact matching view exists; general area links are labelled accordingly. Lifecycle summaries name the buildings; Setup links remain admin-only, with authorised-colleague guidance for developers.
5. **Evidence is synthetic, not a live staging reconciliation.** The browser intercepts auth/data calls and uses test records. The local build uses a synthetic Supabase URL/key. No live database was queried or changed. Full reconciliation remains Stage 2.

## Verification

| Check | Actual result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed with Next.js 16.2.7; nested-checkout workspace-root warning only |
| `npm run test:dashboard` | 48 passed, including API permissions, access revocation, scope, canonical count destinations, genuine zero/unavailable states, additional work and dates |
| `npm run test:sales` | 308 passed |
| `npm run test:rentals` | 57 passed, 1 pre-existing failure: `Agent Fees applies the shared global building scope` expects a three-argument `feeScopeRows` source string, while the approved baseline has the fourth `assignedOnly` argument. Reproduced against the unchanged original checkout. |
| Focused ESLint on new/changed dashboard files, Sales helper and tests | Passed, no findings |
| `npm run lint` | Fails with 20 errors and 33 warnings. Baseline comparison confirms identical file/rule/line/column/message findings; no unrelated fixes made. The portal entry-point file's only change is the scope-label prop. |
| `playwright test --config playwright.dashboard.config.ts organisation-dashboard.spec.ts` | 11 passed: desktop/mobile, exact Sales responsibility navigation, scope switching, polling/revocation, failed refresh, no worklist pagination, date overflow disclosure, external Sales, contractor and representative layouts |
| `git diff --check` | Passed |

Browser launch initially could not find the sandbox's default Chromium cache. Tests ran successfully using the existing installed browser with `PLAYWRIGHT_BROWSERS_PATH=C:\Users\carlg\AppData\Local\ms-playwright`. Responsive checks cover widths 320, 360, 390, 768, 1280 and 1440. A discovered grid overflow was fixed; refreshing data does not scroll the page. The Sales navigation test uses the same synthetic sale/document records on both sides and verifies the resulting one-sale count and selected responsibility filter.

## Screenshots

All screenshots contain synthetic data. The mobile dates table scrolls horizontally within its panel; summaries and team counts remain within the viewport.

- [Selected building — desktop](screenshots/dashboard-1440.png)
- [Selected building — mobile](screenshots/dashboard-390.png)
- [All accessible buildings](screenshots/dashboard-all-buildings.png)

## Publication status and scope

The implementation is in the isolated local checkout `C:\GitHub\Bunnywell_Portal\.stage1-workspace` on `codex/dashboard-stage-one`, based directly on current staging. The original checkout's Git metadata was read-only; a fresh clone allowed local branch/commit work while preserving unrelated files.

**PR publication is blocked.** GitHub branch creation returned: “MCP tool call requires approval, but approval policy is never.” No remote branch or PR was created and no staging-backed preview URL is available. The prepared PR text is in [PR.md](PR.md), with `staging` as the intended base. No deployment was attempted and no shared deployment settings were changed.

The only delivery departure is the unpublished PR/preview due to that permission restriction. The explicit navigation gaps above are retained transparently under the requested fallback rule. Production, schema, migrations, RLS, database configuration, infrastructure, regions, financial calculations, workflows, access rules, external navigation, and approved Sales/Agent Fees layouts are unchanged. The temporary managed worktree used during permission diagnosis was archived without changes.
