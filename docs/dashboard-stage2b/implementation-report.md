# Dashboard Stage 2B implementation report

Base: `origin/staging` at `6a4475b288c86dc25ff720c766460ecac6be85af` (Stage 1 present). Work is isolated on `codex/dashboard-stage2b`; the original checkout and unrelated changes are preserved.

## Responsibility and permission boundary

`buildingSalesResponsibility` in `src/lib/sales/responsibility.ts` is the shared operational source of truth. It accepts the record's building and role, never attempt assignments or actor IDs. Dashboard work, Sales action/team filters, Agent Fees rows and reservation/legal summaries use the appointed building organisation. `sellerConveyancer` delegates to the same helper. All buildings resolves each record separately. Known organisation IDs retain ownership even if their display names are unavailable.

Null appointments mean genuinely Unallocated; absent appointment inputs mean unavailable. Unallocated actions stay outside the team columns and are counted distinctly within their area. Mixed developer/external/unallocated work on one record is supported. Missing or failed fee inputs prevent apparently exact team counts; independent valid information remains visible.

Individual users remain audit actors. Isolated PostgreSQL tests execute the existing legal functions and demonstrate a second authorised conveyancer replacing a colleague's document, retaining the old uploader and attributing the new version to the second user. Reservation and invoice upload mocks exercise the real existing upload helper with a second agency user, preserving the original creator. Unrelated users without building access, inactive users and users seeking developer-only approval powers are rejected. No production workflow is mutated for tests.

**Remaining permission mismatch:** the deployed `sales_building_access` function (20260908b migration) permits an active sales agent/conveyancer through either a direct `user_building_access` grant or an active matching-role `building_organisations` relationship. It does not require equality with the current building appointment. The reservations endpoint's `requesterBuildingIds` implements the same broader rule; legal action assertions call the database access function. An isolated test proves an outsider with an explicit direct building grant can request authority. A blank/conflicting attempt assignment grants no access, but an independent existing building grant still does. Enforcing exclusive appointed-organisation mutation rights would require a separately approved change to those database/API guards (and a decision about intentional direct grants). That affected authorisation change is stopped here. This PR corrects responsibility, not those deployed permissions.

## Canonical fees and dates

Dashboard now reads `get_agent_fee_portfolio` once with the caller JWT and exact-count validation. This is the same reader used by Agent Fees. The existing RPC selects active Sales-route attempts or attempts with an eligible current fee invoice, excludes redacted/superseded invoices, selects current terms then latest-version fallback, and excludes voided/reservation-fee cash inputs. Historical attempts are included only by those existing rules.

Sales reuses its already loaded complete terms, invoices and payments through `feePortfolioFromSales`; it does not fetch a parallel portfolio. An isolated PostgreSQL parity test runs the current RPC body from the 20260828 migration and compares its financial/actions population with this adapter. Both use `deriveAgentFeePortfolioRow` / `deriveAgentFeeSummary` for monetary positions and `feeActions` for outstanding actions. Nonpositive payable balances do not produce payment work. Payment source is retained and required. Missing required terms or truncated/failed reads produce unavailable summaries, never zero expected fees.

The Dashboard Fees row counts distinct eligible sale attempts per team, including history; the Sales row still counts the existing five-stage unit register once per unit and only attaches fee work for its selected current attempt. Multiple invoice actions do not multiply attempt counts. Missing submissions are labelled separately from approved debt. No historical payee, issuer, commercial term, payment or audit field is rewritten.

Dashboard and Rentals share `reportingDate` in `src/lib/reporting-date.ts` using Europe/London. Date-only storage and tenancy rules are unchanged. Tests cover BST midnight and both clock transitions. Empty rental portfolios say “No active rental units”; unavailable sources do not. Source evidence dates are readable and retain their date/instant meaning. Source exceptions remain visible even with zero rental-unit actions.

The dashboard distinguishes contractual dates, review dates, actionable deadlines and undated exceptions. A past contractual date is a “Passed date” observation, not invented team work. Recent sales activity keeps source actor labels without requiring an ID, adds building/unit context and retains latest per sale/event type, seven London calendar days and the seven-entry cap.

## Authenticated observations and reconciliation

These are observations of existing staging, not hard-coded expectations. Shared staging checks are read-only.

| Forum House measure | Before: 11 Oct 2026, 21:23–21:33 London | Revised preview |
|---|---:|---|
| Five-stage Sales units | 62: 26 for sale, 3 reserved, 9 exchanged, 24 completed, 0 handed over | Awaiting branch preview |
| Dashboard Sales: Our / Other | 9 / 61 | Awaiting branch preview |
| Dashboard Agent Fees: Our / Other | 4 / 34 (old active-sale scope) | Awaiting branch preview |
| Agent Fees approved unpaid | £45,951; 4 attempts / 4 invoices | Awaiting branch preview |
| Agent Fees submissions/corrections | 34 attempts / 61 milestones; all 61 labelled unallocated | Awaiting branch preview |
| Active rental units | 0 | Awaiting branch preview |
| Outside-pipeline draft work | 1 separate exception | Must remain separate |

The deliberately deleted unit is not recreated and is not reported as a defect. The 62-unit baseline is a dated observation. Trinity Point data is used only for structural/scope checks.

At 21:36 London, All buildings showed 130 Sales units (31 / 5 / 11 / 83 / 0), Sales attention 13 / 61, fees 4 / 34, and 18 occupied rental units. Switching scopes immediately replaced prior figures with loading placeholders. The session then changed to conveyancer at the user's direction, so the developer Trinity measurement was not completed.

The user-confirmed conveyancer session exposes Sales-only navigation. Forum House has 62 register units, 10 Our team rows (Herrington Carmichael), 31 Other teams rows, and 0 Unallocated rows. Trinity's register showed 68 units. Team changes retain Forum scope. Destinations were inspected without opening live legal detail: its existing GET invokes legal expiry, which is outside the read-only validation boundary. The user requested retaining this conveyancer session; agent checks and a second same-organisation authenticated user remain untested. Automated fixtures cover both role semantics and colleague handoffs, but are not a claim of complete authenticated shared-working validation.

The baseline Agent Fees display confirms attempt-only false allocation; building appointments/conflicting legacy IDs have not yet been reconciled in the revised authenticated preview. No data has been repaired. `conflictingSaleAssignments` is available for isolated diagnostics and does not affect access or rewrite fields.

## Validation

- Dashboard: 63 tests passed, including 15 Stage 2B ownership/calculation/SQL/upload cases.
- Sales: 308 passed; Fees: 99 passed; Sales refresh/access: 55 passed (suites overlap).
- Rentals: 57 passed, 1 pre-existing failure. `rentals-tenancies.test.mjs:125` expects a three-argument `feeScopeRows` call; staging already has a fourth `assignedOnly` argument. Reproduced on untouched staging source: 12 pass / 1 fail in that file.
- TypeScript: passed. Production webpack build: passed, with synthetic local environment values. Initial sandbox EPERM was resolved by approved local build execution; no configuration files changed.
- Full source ESLint: 20 errors / 26 warnings, identical on untouched staging source. The two existing SalesReservationWorkflow set-state-in-effect errors remain at the same unchanged effects. Newly introduced modules and other edited components pass targeted lint.
- Isolated browser run: 33 passed, 1 fixture failure, 1 opt-in performance benchmark skipped. The failed Dashboard-to-Sales check lacked fee terms in its synthetic Sales fixture; after adding the required terms it passes. Final post-build rerun pending.
- Synthetic screenshots: [desktop](screenshots/dashboard-1440.png), [phone](screenshots/dashboard-390.png). Baseline authenticated captures: [Forum Dashboard](screenshots/forum-before.jpg), [conveyancer](screenshots/conveyancer-before.jpg). Synthetic images are not staging after evidence.

## Requests, loading and navigation limitations

[Executed isolated source-loader comparison](request-counts.json), reproducible with `node scripts/diagnostics/dashboard-stage2b-read-counts.mjs`:

| Active fixture population | Before source requests | After source requests | Fee requests before → after |
|---:|---:|---:|---:|
| 62 | 18 | 16 | 3 → 1 |
| 130 | 18 | 16 | 3 → 1 |
| 301 | 38 | 30 | 9 → 1 |

These exclude unchanged caller authentication, profile and before/after access checks. The RPC returns the full authorised portfolio before the selected-building filter, so historical/all-building payload can increase. Exact-count validation rejects truncation. There are no per-record organisation lookups or duplicate Sales fee reads. No end-user speed claim is made from these counts or privileged query timing. Synthetic browser tests cover in-place refresh, scope changes, stale snapshots, revocation, responsive widths and stable mounted sections; no prior layout-jumping defect is assumed.

Fee, Snag and Rental counts remain plain summaries with separate workspace links. Sales count links use the same selectors as the destination. Outside-pipeline draft work opens its existing unit page and explicitly says it is outside the Sales register; no matching Sales queue is invented. Historic fee financial destinations inherit the existing Sales workspace limitation: the workspace resolves the current unit attempt and warns when `workSale` differs; this PR does not redesign it into a historical-sale editor.

Production, shared business data, schema, migrations, RLS, role grants, environment and deployment configuration, closure/expiry rules and approved module layouts are unchanged. No merge or production deployment is authorised or performed.
