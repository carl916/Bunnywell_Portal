# Conveyancer Sales register

Feature branch: `codex/conveyancer-sales-register`, based on staging `fda77f0a9655cfaa3545bd559f95f90c3484c5a3`.

Conveyancers now open one paginated unit register in the existing Sales shell. Search, canonical stage, the global building scope and **Action with** combine over complete authorised rows. The initial stage and responsibility selections are All sales / All teams. Filters stay in memory while opening a sale and returning through either back control or browser history; a fresh visit or sign-out resets them. No shared-account restricted view is stored.

Rows reuse existing organisation responsibility, authority state and current-version completion review derivation. They promote the relevant party's progression action, group sibling document reviews, link to the exact document/section and retain saved deadlines even when the developer has the action. Available, completed, unallocated and conflicting records have neutral wording or an explicit warning. Fee/deposit exceptions remain in the existing sale workspaces and do not become completion gates. Existing developer responsibility has the generic **Developer team** label where there is no assigned developer organisation; external parties use stored organisation names, never actor/contact/domain guesses.

The new read-only `/api/sales/register` projects only row identity, stage, progression actions, responsibility and key dates. It shares the counted/batched JWT/RLS reader, active-profile/access recheck and private/no-store policy. It skips history/actor RPCs, fees, deposits, Snags, Rentals, handovers and portfolio activity. Current legal document metadata is batched; document content, conversations and full histories are not loaded on entry. The former broad Sales component only mounts when opening a sale. Manual shell refresh, focus/reconnect and actual sale-change events refresh the register without clearing filters. There is no new polling or subscription framework. Failed action reads retain readable base rows, explain unavailable responsibility filtering and never imply there is no work; access revocation clears rows.

## Financial correction

The exposed GDV/forecast/net-proceeds overview was calculated in `SalesReservationWorkflow` from transaction terms, rather than received as an aggregate API payload. The existing `canViewSalesForecasting` rule permits admin/developer only. The correction applies that rule before aggregate calculations (including stage values and the commercial-model portfolio preview) and before mounting the overview/forecasting panels. This also removes unauthorised aggregates from the sales-agent layout; its worklist, stage controls, register, transaction prices and sale workflow otherwise stay intact. Admin/developer output is unchanged.

The register response has an explicit non-financial field projection, no raw terms, no shared response cache and no persisted client snapshot. The existing forecasting tables already have internal-only RLS. A new PostgreSQL regression executes those existing policies and confirms that conveyancers/agents receive no forecast rows while retaining permitted sale access and that admin/developer forecast output remains available. No monetary entitlements, schema, permissions or mutation rules were added. Individual sale documents, authority terms and financial workspaces remain under their existing permissions.

## Verification

- Baseline: 67 relevant unit/database tests and TypeScript passed before implementation.
- Full unit run: **491/492 passed**. The sole failure is the unchanged `tests/global-building-context.test.mjs:53` Audit Log source assertion, already documented by the preceding dashboard work. The subsequently added forecasting RLS test also passes: **24 new focused tests pass** in total.
- Browser: **9 new tests pass**, plus **30 existing dashboard/legal/stage tests**. The three journeys cover our-team query replacement navigation, waiting for developer approval with a saved due date, and another colleague's synthetic replacement becoming visible after refresh while preserving the sibling approval. The last journey changes intercepted fixture state; the existing PostgreSQL handoff suite separately exercises actual versioned mutations, sibling approval, stale-version rejection and equivalent colleague accounts.
- Desktop/phone checks cover 320, 390, 768 and 1440px, focus, no horizontal overflow and bottom-navigation clearance. Exact current-version URLs, both back controls, browser Back, combined filters, 28-row pagination, unavailable/revoked responses, fresh-session defaults and other roles are exercised. API tests cover 601 units across server pages, denied scopes/roles and mid-read revocation.
- TypeScript, targeted lint and the production build pass. Broad lint reports **20 existing errors**; [changed-file comparison](lint-comparison.json) shows no added errors or warnings. The first sandboxed build stalled during compilation; the network-enabled build completed successfully with the backend hostname explicitly set to `synthetic.invalid`.
- No production data, real transactions, payments, completions or legal emails were changed. Browser fixtures intercept all API/Supabase requests and use a synthetic backend hostname. Database tests run in local PGlite with existing migrations, not connected Supabase.

## Request comparison and screenshots

Same synthetic conveyancer, one accessible building and one sale, warm local Next development server, three samples. Counts include auth/API/PostgREST responses, excluding assets. They describe request shape, not deployed database performance.

| | Before | After |
| --- | --- | --- |
| Data requests | 29 / 29 / 29 | 19 / 19 / 19 |
| Response bytes | 6,998 each | 2,551 each |
| Visible list (ms) | 323 / 296 / 348 | 230 / 234 / 264 |

[Before requests](requests-before.json) · [After requests](requests-after.json)

| | Desktop | Phone |
| --- | --- | --- |
| Before | [1440px](screenshots/before-1440.png) | [390px](screenshots/before-390.png) |
| After | [1440px](screenshots/after-1440.png) | [390px](screenshots/after-390.png) |

## Deployment boundary and limitations

Vercel project `bunnywell-portal` / `prj_4s8vIyfrGh9DSGJcixTU5slevr5P`, team `team_x65ctL8Fot37UcabAkdh8f72`, was verified read-only. Existing staging deployment `dpl_1XxNnYxWPfSp7i2Ri1nwz39HBTTo` points at staging commit `fda77f0` and its public bundle identifies `vxkpvdtrldwwqiddoyof.supabase.co`. Branch preview status will be recorded separately after publication; shared staging does not contain this iteration before merge/deployment.

Authenticated live-role validation and live colleague mutations were not performed. Synthetic route tests do not prove every deployed RLS combination. The pre-existing building-wide sales-agent access rule remains unchanged; organisation responsibility is not a new record-access restriction. The existing bounded reader rejects incomplete or over-20,000-row source reads rather than claiming complete counts. Dashboard/developer/agent layouts are retained except for the narrow existing financial restriction described above. No redesign extends into other modules.
