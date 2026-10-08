# Sales corrections implementation report

Branch: `codex/sales-workflow-corrections`, based on latest fetched staging `e7b9e3b` (the merge of PR #29). This iteration covers the three reported Sales issues only.

## Causes and corrections

1. **Seller's conveyancer:** the shared reader omitted `buildings.conveyancer_organisation_id`, and the responsibility model used the sale allocation or a single project-access relationship instead. The shared model now resolves the configured building organisation through an explicit seller-conveyancer helper. Both the Sales register and organisation work use it. Buyer solicitor text and legacy sale allocation cannot override the building's seller conveyancer. Missing/unresolvable configuration has an explicit label and no invented organisation ID. The existing building sales-agent contact also supplies the reservation responsibility fallback.
2. **Duplicate navigation:** `WorkReturnLink` supplied a standalone Sales return link while `SalesReservationWorkflow` already rendered its overview button beside Mentions. Sales-origin links now use that existing button alone. Dashboard-origin navigation retains its distinct organisation-work return link. Building scope, conveyancer search/stage/responsibility filters and browser Back remain intact.
3. **Apparently missing reservation form:** this is an existing permission/presentation issue, not removal of the form by PR #29. The pre-dashboard implementation (`13d647c^`) already rendered the form only when `canPerformSalesAction(role, "submit_reservation")` allowed it, but showed “Record reservation” to everyone. There was no draft save control. The existing form still renders for agents/admins/developers. Conveyancers now see waiting guidance, the configured agent where available, permitted saved details and a view-only PDF control. Task labels distinguish waiting from actions the viewer may perform.

The existing form now has **Save draft**, using the same reservation role/building checks and existing tables. A buyer identity is required to save; the full buyer/date/terms/PDF validation remains required for submission. Saving a returned draft retains its return reason and state. Submission persists the draft, uploads the PDF, then enters developer approval; the server now requires a current, non-redacted PDF before that transition. Failed uploads therefore do not submit a new incomplete pack. Updates check the active attempt and its approval state. Draft saves append `reservation_draft_saved`; submission/resubmission/return/approval events and protected unit-status calls are retained.

No migrations, new role permissions, contact-based access grants, per-sale conveyancer fields, financial layout changes or legal progression changes were introduced. Existing reservation multi-request operations remain multi-request operations; this is not a transactional rewrite. Existing audit/notification infrastructure remains in place, and no external email was sent during tests.

## Files changed

| Files | Purpose |
| --- | --- |
| `src/lib/sales/responsibility.ts`, `src/lib/dashboard/read.ts`, `src/lib/dashboard/model.ts` | Read building contacts and resolve seller-side responsibility consistently |
| `src/lib/sales/register.ts` | Surface the active draft's reservation preparation task |
| `src/components/portal/dashboard/WorkReturnLink.tsx` | Remove the duplicate Sales return link |
| `src/components/portal/sales/SalesReservationWorkflow.tsx`, `src/lib/sales/stage-tasks.ts` | Accurate read-only guidance and existing-form draft control |
| `src/app/api/sales/reservations/route.ts`, `src/lib/sales/action-refresh.ts` | Guarded draft persistence, current PDF submission check and scoped draft refresh |
| `tests/sales-corrections.test.mjs`, `tests/helpers/reservation-route-fixture.mjs`, `tests/conveyancer-sales-corrections.spec.ts` | Focused model, real-handler, PostgreSQL and browser regressions |
| Existing conveyancer/dashboard tests and `tests/helpers/dashboard-fixture.mjs` | Update fixtures to use configured building contacts and the retained overview button |
| This directory | Report, lint comparison and synthetic screenshots |

## Verification

- **Seven new focused tests pass:** configured/missing/unresolved seller organisations, buyer-solicitor separation, equivalent individual/shared accounts, reservation HTTP handler lifecycle/validation, forbidden roles/buildings, stale active/state changes and PostgreSQL contact/access separation.
- **Five new browser tests pass:** agent creates an eligible sale draft, returns/reopens/reloads it, completes fields/uploads/submits, developer returns it, agent corrects/resubmits, developer approves; history remains. They also demonstrate current register responsibility after transitions, the configured conveyancer, one Sales return button, preserved filters/scope, all three authorised entry roles and conveyancer read-only behavior.
- **Nine existing conveyancer browser tests pass.** **Thirty existing dashboard/legal/stage browser checks pass** (29 on the initial run; the remaining navigation assertion was updated for the deliberately removed duplicate and passed on rerun).
- **Full unit run: 498/499 passed.** The sole failure is the pre-existing `tests/global-building-context.test.mjs:53` Audit Log building-filter assertion. The subsequently added PDF-invalidity regression passes in the seven-test focused run above.
- `npx tsc --noEmit` and `npm run build` pass. New files and changed helpers/API/navigation pass targeted lint. Changed-file comparison against staging adds **zero lint errors/warnings**; the large Sales component retains its two existing effect lint errors. Broad source lint (`npx eslint . --ignore-pattern 'test-results/**'`) reports **20 existing errors / 33 warnings**. The unfiltered command also found two errors in an old ignored test-results helper; it is not part of this change. See [lint comparison](lint-comparison.json).
- Draft refresh reads only its attempt, actors and documents through the existing scoped refresh helper. Browser assertions confirm no Snags, Rentals or building-default reload on saving a draft and no unrelated access/workspace reload when returning to Sales. Existing compact register/no-polling tests pass. Existing submission/approval refresh paths are unchanged.
- Screenshots were visually inspected. Generated changes to prior feature screenshots were restored; unrelated local `debug.log` and `docs/dashboard-functionality-review.md` were preserved.

## Browser evidence

All images use synthetic organisations and buyers, not live customer records.

- [Configured seller conveyancer in Sales](screenshots/configured-conveyancer.png)
- [Single existing overview button](screenshots/single-return-control.png)
- [Authorised agent reservation entry and draft control](screenshots/agent-reservation-entry.png)
- [Conveyancer read-only guidance](screenshots/conveyancer-read-only.png)

## Boundaries and remaining limitations

Browser tests ran locally with `https://synthetic.invalid` as the backend hostname and all business/auth requests intercepted. The main reservation journey calls the real HTTP handler in the test process with an explicit in-memory PostgREST/Storage adapter; separate PGlite tests execute existing legal/access migrations. These checks do not claim live Supabase, Storage, notification delivery or every deployed RLS combination was exercised. Forum House G08's live record and its authenticated account were not read or changed. The code cause was traced and reproduced using equivalent synthetic state.

The PR targets `staging` and must remain unmerged. Production and shared staging have not been changed by this correction branch. No production deployment was requested or performed.
