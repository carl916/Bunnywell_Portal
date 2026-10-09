# Bunnywell Portal dashboard candidate review

Reviewed 7 October 2026. Prepared for reviewing the dashboard in ChatGPT.

**Historical design inventory.** Retained on 9 October 2026 for its module catalogue, measurement definitions and access constraints. The descriptions of the "current dashboard" below refer to the 7 October screenshot and implementation, before the organisation worklist dashboard reviewed in the [Frankfurt trial](staging-full-frankfurt-trial.md). They are not a current implementation checklist. Recheck candidate readiness against the current dashboard before planning new work; the original screenshot is not included in this archive.

The portal has enough functionality to support a dashboard covering snagging, sales progression, legal completion, agent fees, rentals, handovers, building lifecycle and administration. The current dashboard concentrates on developer snags. The highest-value expansion would bring together work awaiting action, upcoming deadlines and a small number of portfolio measures, with each item opening the relevant record or filtered list.

This is a review of the current repository implementation, data models, migrations and supplied dashboard screenshot. It is not a live production-data audit or a browser test of every workflow. Screenshot figures are illustrative here; they are not verified current portfolio totals. Older README and system-guide descriptions predate several sales, rental and access changes, so the current implementation takes precedence. No application behavior or production data was changed.

## How to read the candidate catalogue

Every table row represents a possible dashboard item or closely related group of items. Inclusion in the catalogue does not mean every item should appear on the opening screen.

**Existing** means the measure or signal is already calculated or displayed somewhere in the application. **Derived** means the underlying fields or workflow exist, but a dashboard calculation, aggregation or queue needs to be added. **Extension** means a dependable version needs new data, integration or an agreed business rule. These labels describe functional readiness, not whether the dashboard already loads the data.

Priority **1** means a strong candidate for the opening dashboard. Priority **2** means useful in a module summary or expanded view. Priority **3** means specialist analysis, administration or a later addition. These priorities are recommendations for an admin/developer dashboard; other roles need different priorities.

## Current dashboard

The supplied screenshot matches the current developer-snag dashboard structure:

| Existing element | Current meaning | Review implication |
| --- | --- | --- |
| Total developer snags | Records whose source is `developer_snag` in the accessible, selected building scope | Does not represent all defects or imported reports. |
| Active developer snags | Developer snags whose status is neither `closed` nor legacy `resolved` | Includes contractor-resolved snags awaiting developer review. |
| Changed today | Distinct developer snags created, updated or represented in an event today | Counts affected snags, not individual changes. |
| Ready for review | Status `resolved_by_contractor` | Developer acceptance action. |
| Needs more info | Status `needs_more_info` | Developer information action. |
| Information supplied | Currently open with a recorded transition from needs-more-info to open | Contractor follow-up signal; the current calculation checks historical transitions, not only the latest reopening. |
| Rejected back to contractor | Status `rejected_back_to_contractor` | Contractor work action. |
| Needs trade allocation | Active developer snags with no trade | Allocation action. |
| Today's movement | Created, contractor-resolved, closed, rejected back, information requested and information supplied | Each category generally counts distinct affected snags; a snag can appear in multiple categories. |
| Building workload | Active, review, information and rejection counts plus percentage closed | Only buildings with developer snags appear. |
| PC confirmation warning | Expected PC date has passed and PC is not confirmed | Additional admin/developer warning; not visible in the supplied screenshot. |

The action and movement cards open snag filters. Building cards select the building and open Snags. Zero-count action and movement cards are hidden. The dashboard respects the header's building context.

The current closure percentage counts both `closed` and legacy `resolved` as final. The screenshot's 180 total and 58 active imply 122 final records, or approximately 68%; that arithmetic is consistent with the displayed percentage. It does not establish the underlying records' accuracy.

## Developer snagging and contractor work

The system supports developer snag capture against units, rooms, private amenities and communal areas; trade allocation; status changes; contractor resolution and rejection; information requests; notes and history; photos, annotation, resolution evidence and video; search and filters; and PDF reports.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| S01 | Existing five attention buckets | Retain review, information, supplied-information, contractor rejection and missing-trade queues; open filtered Snags | Existing | 1 |
| S02 | Active snag workload by building | Identify the buildings carrying most work; open building Snags | Existing | 1 |
| S03 | Workload by trade | Show active and review counts by trade, including unallocated work | Derived | 2 |
| S04 | Workload by responsible organisation or user | Identify the owner of outstanding work; avoid equating a trade with an assigned contractor | Derived | 2 |
| S05 | Missing contractor assignment | Count active records without the required responsible organisation/user, separately from missing trade | Derived; agree assignment rules | 1 |
| S06 | Oldest active snags | Surface longstanding open work with age, building, unit and owner | Derived from creation time | 1 |
| S07 | Snags waiting longest for developer review | Order contractor-resolved records by entry into that status | Derived from event history; incomplete history needs a fallback | 1 |
| S08 | Snags with no recent progress | Show active records without meaningful progress for an agreed interval | Derived; define which events count as progress | 1 |
| S09 | Repeated rejection or reopening | Identify records repeatedly returned for more work, with count and reason drill-through | Derived from events | 2 |
| S10 | Closure trend and backlog change | Compare new, closed and reopened records over 7/30 days; show active backlog direction | Derived; historical backlog needs event reconstruction or snapshots | 2 |
| S11 | Resolution and review turnaround | Measure time to contractor resolution and time to developer closure | Derived; define first/latest transitions and treatment of reopened records | 2 |
| S12 | Unit and communal hotspots | Rank units, floors, rooms or communal areas with outstanding snags | Derived | 2 |
| S13 | Evidence missing for review | Flag contractor-resolved items without the evidence required by the agreed process | Derived from media; mandatory evidence rule needed | 2 |
| S14 | Recent snag activity | Compact feed of significant status, allocation and evidence changes | Derived presentation of existing history | 2 |
| S15 | Capture and reporting shortcuts | Add snag, open Snags, generate report or view report history, subject to role | Existing actions | 2 |

Contractor performance comparisons should account for workload, age, trade and access scope. A contractor with more open records is not automatically performing worse.

## Resident defects and initial reporting period

Resident defects are a separate source, `leaseholder_defect`. Residents have their own unit-scoped journey, with reporting gated by building lifecycle. Defect triage supports priority and SLA dates. Developer snag creation currently writes no priority or SLA date, so an SLA tile cannot be assumed to measure the full developer-snag backlog.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| D01 | Active resident defects | Count separately from developer snags; open the relevant unit defect workspace | Derived portfolio summary | 1 |
| D02 | Resident defects awaiting triage | Identify newly submitted reports that need acceptance, priority or assignment | Derived; map the actual triage states | 1 |
| D03 | Overdue SLA work | Active records with a recorded due date in the past; show priority and responsible party | Existing snag filter; portfolio summary is derived | 1 |
| D04 | SLA work due within seven days | Identify upcoming deadlines without waiting for breach | Existing snag filter; portfolio summary is derived | 1 |
| D05 | Priority distribution | P1/P2/P3 counts, with urgent unresolved items first and unset priorities separate | Derived | 1 |
| D06 | Resident defect outcomes and ageing | Open/closed totals, oldest reports and turnaround by building | Existing unit counts; portfolio/time analysis is derived | 2 |
| D07 | Defects still open near reporting closure | Join open resident defects to closing-soon buildings | Derived | 1 |
| D08 | Resident personal summary | Their open defects, outcomes, handover and documents in My home | Existing personal journey; expanded dashboard presentation is derived | 2 |

Keep the wording “initial defects reporting period.” Closing routine reporting must not be presented as ending all warranties or other defect rights. Do not introduce a permanent maintenance/service-desk dashboard as if that functionality already exists.

## Sales availability and reservation progression

The sales route covers For sale, Reserved, Exchanged, Completed and Handed over. Units also have administrative states Not released and Retained / not for sale. Sale attempts preserve reservation decisions, commercial terms, documents, failures and history. A unit's availability status and its sale attempt's workflow status answer different questions.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| P01 | Sales pipeline counts and values | Summarise the five sales-route states; open Sales filtered to a stage | Existing | 1 |
| P02 | Reservations awaiting developer approval | Show count, submission age, building/unit and submitter; open reservation review | Derived from persisted submission state | 1 |
| P03 | Rejected reservations needing correction | Surface attempts requiring resubmission or a decision | Derived | 1 |
| P04 | Commercial terms awaiting approval | Show approved reservations that still require commercial review | Derived | 1 |
| P05 | Next sales action | List the current actionable task and responsible role for each sale | Existing stage/task logic; portfolio aggregation is derived | 1 |
| P06 | Time in current sales stage | Highlight slow progression and longest waiting cases | Derived from stage timestamps/history; escalation threshold needed | 1 |
| P07 | Reservations, exchanges and completions this period | Show actual milestone activity over a selected period | Derived from milestone timestamps | 2 |
| P08 | Fallen-through sales and reasons | Report failed attempts and value returned to availability | Derived; conversion rates need a defined cohort | 2 |
| P09 | Not released and retained inventory | Show units outside the sales route alongside available stock | Derived from unit allocation | 2 |
| P10 | Missing sales values or commercial inputs | Flag unpriced units and incomplete terms that weaken totals or block progression | Existing value-coverage count; fuller exceptions are derived | 1 |
| P11 | Reservation paperwork and buyer details incomplete | Surface missing saved documents/required information for the current step | Derived from persisted validation rules | 2 |
| P12 | New reservation shortcut | Open an eligible For sale unit's reservation workflow | Existing action | 2 |

Use the active attempt for current work. Use historical attempts for failure/conversion analysis, with a stated denominator. Do not count an old rejected or redacted attempt as a current pending approval.

## Exchange authority and legal completion

The implemented legal workflow supports requesting, issuing, renewing and revoking exchange authority; locked/versioned terms; email routing and history; exchange recording; full exchange-deposit receipt confirmation; authority to serve completion notice; notice dates/PDF and completion arrangements; independent document approvals/queries; and legal completion.

The current code uses authority to serve notice. Older wording about generic completion instructions should not drive new dashboard labels. Current completion review separately approves the completion statement and statement of account, and legal completion requires approval of both current versions.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| L01 | Exchange authority requested | Developer queue of pending requests, including renewal requests | Derived from existing authority-state logic | 1 |
| L02 | Exchange authority expiring soon | Show live authorities expiring within an agreed window, with remaining time | Derived; choose warning interval | 1 |
| L03 | Expired or revoked authority needing follow-up | Highlight unexchanged sales that need a fresh authority/decision | Derived; exclude superseded authorities and completed work | 1 |
| L04 | Authority issued awaiting exchange | Conveyancer action list with the exact authority expiry | Derived | 1 |
| L05 | Exchange deposit confirmation outstanding | Exchanged sales with no recorded confirmation of full expected deposit receipt | Existing sale-level signal; portfolio queue is derived | 1 |
| L06 | Authority to serve notice requested | Developer queue for completion-notice authority | Derived | 1 |
| L07 | Notice authorised but arrangements unconfirmed | Conveyancer queue for notice issue date, completion due date and PDF | Derived from notice state | 1 |
| L08 | Upcoming contractual completion dates | Dates due today or within 7/30 days; open the sale's Completion section | Derived | 1 |
| L09 | Contractual completion overdue | Confirmed date has passed without legal completion | Derived | 1 |
| L10 | Completion documents missing | Identify which of the two required current documents is missing | Existing document state; portfolio queue is derived | 1 |
| L11 | Completion documents awaiting approval | Count documents and affected sale files separately; open exact document review | Existing individual review states; portfolio queue is derived | 1 |
| L12 | Completion queries awaiting replacement | Show the queried document/version and follow-up responsibility | Existing version/query history; portfolio queue is derived | 1 |
| L13 | Ready to record legal completion | Confirmed arrangements plus both current documents approved and no legal completion | Derived from completion gates | 1 |
| L14 | Legal email delivery exceptions | Failed, uncertain or delayed legal emails with safe reconciliation/retry actions | Existing status/history; portfolio summary is derived | 1 |
| L15 | Missing legal routing or seller information | Buildings/sales missing seller, conveyancer or valid shared inbox | Existing validation; portfolio summary is derived | 1 |
| L16 | Recent legal milestones | Authorities issued/revoked, notices confirmed, documents approved and completions recorded | Derived from existing workflow history | 2 |

Deposit confirmation is a record of receiving the full expected amount, not a bank-reconciled receipt ledger. The current UI explicitly allows completion while that task is outstanding; show it as an exception without inventing a completion block. Agent invoices/payments are also not legal-completion prerequisites.

Notice-date calculations default to ten working days excluding weekends, with editable dates. Use the saved contractual due date on the dashboard; do not infer contractual deadlines or bank holidays from the default helper.

Legal delivery statuses are manually refreshed from the provider. A dashboard should show the last status check and avoid implying automatic live delivery tracking.

## Agent fees and commercial finances

Agent fee management already has a portfolio workspace, separate exchange/completion milestones, invoice submission and review, credits/deductions, payment recording, corrections through voiding, and outstanding balances.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| F01 | Agent fee sales needing attention | Current invoice actions across sale files; open Agent Fees | Existing | 1 |
| F02 | Agent invoices awaiting approval | Active invoice review queue, separated by milestone if useful | Existing | 1 |
| F03 | Outstanding submitted invoice balances | Existing payable balance after recorded payments/credits; distinguish approval state | Existing | 1 |
| F04 | Approved unpaid and partly paid invoices | Payment action queue | Existing fee-state logic | 1 |
| F05 | Required invoices not submitted | Show exchange/completion milestone invoices awaiting submission | Existing fee-state logic | 2 |
| F06 | Rejected invoices needing replacement | Show current invoice queries/rejections | Existing fee-state logic | 2 |
| F07 | Future completion fees | Estimated net completion fees not yet invoiced | Existing | 2 |
| F08 | Fees by agent, building and milestone | Expected, invoiced, credited, paid and outstanding comparisons | Existing sale-level values; grouped dashboard is derived | 2 |
| F09 | Developer shortfalls and payer split | Separate developer and solicitor recorded payments and any remaining payable balance | Derived from existing payments and fee calculations | 2 |
| F10 | Payment corrections and exceptions | Recent voids/corrections with reasons and authorised drill-through | Derived from existing immutable payment history | 3 |
| F11 | Invoice ageing | Age from invoice/submission/approval date | Derived; choose the starting date | 2 |
| F12 | Overdue invoice payments | Payment due date versus unpaid balance | Extension unless an authoritative due date/payment-term rule is added | 3 |
| F13 | Sales financial summary | Sales-route baseline GDV, forecast revenue, variance and calculated developer net proceeds | Existing; internal commercial access only | 2 |
| F14 | Contribution and fee impact | Developer/agent/parking contributions, fees and net-proceeds impact | Existing commercial calculations; aggregation is derived | 2 |

Submitted outstanding invoices are not all approved liabilities. Future completion fees are net estimates; payable invoice balances can include VAT. Preserve those bases in labels. Exclude voided payments and superseded invoices according to the existing fee helpers.

The Sales overview shows cost, debt, profit, margin and return-on-cost placeholders. Those placeholders must not become dashboard facts. Saved scenario calculations exist separately, as described below.

## Rental portfolio and tenancy performance

Rentals supports active/exited portfolio membership; manual tenancy entry and editing; scheduled, active and ended tenancies; letting-agent attribution; rent and fixed-term dates; occupancy; rental history; void periods and estimated loss; and reporting for lifetime, year to date and the last twelve months.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| R01 | Rental units, occupied units and voids | Current active rental-portfolio position; open Rentals by occupancy | Existing | 1 |
| R02 | Current occupancy percentage | Occupied active rental units divided by active rental units | Existing | 1 |
| R03 | Monthly and annualised rent roll | Current contracted rent, with annualised amount equal to monthly rent times twelve | Existing | 1 |
| R04 | Current void action list | Unit, void duration, prior rent, estimated loss and next scheduled tenancy | Existing | 1 |
| R05 | Fixed-term dates within 30/60/90 days | Upcoming tenancy-management review dates | Existing | 1 |
| R06 | Scheduled tenancy starts | Upcoming lets and voids with a planned relet date | Existing records/next-tenancy logic; portfolio summary is derived | 2 |
| R07 | Historical occupancy and void days | Selected-period performance, weighted by available unit-days | Existing | 2 |
| R08 | Estimated void rent loss | Opportunity-cost estimate using the rent preceding each void | Existing | 2 |
| R09 | Longest recorded void | Identify the largest vacancy episode for the selected reporting period | Existing | 2 |
| R10 | Rent below first achieved and largest reduction | Like-for-like current-versus-first rent exceptions | Existing | 1 |
| R11 | Latest rent change and relet count | Movement between tenancies and recorded tenancy turnover | Existing unit/performance logic | 2 |
| R12 | Rental units for sale or exited after sale | Understand overlap between commercial availability and rentals, including completion-driven exit | Derived from existing allocation/transition data | 2 |
| R13 | Missing rent or dates affecting measurement | Identify incomplete history, unknown void loss and missing fixed-term dates | Derived; use existing unknown-value rules | 2 |

A tenancy remains active until its actual tenancy end is recorded; passing a fixed-term end does not automatically make the unit void. Historical measurement begins at the first recorded tenancy, so pre-first-tenancy vacancy is excluded. A never-let unit can be void with an unknown void duration/loss.

Contracted rent and annualised rent roll are not rent collected. Estimated void loss is not an accounting loss. Exited units retain history; define whether a historical portfolio view includes them before presenting combined totals.

## Reported rental arrears and management risk

Rent risk records material agent reports as tenancy-linked episodes/events, with reported amounts, open/cleared/reconciliation states, intervention level, owner-action flags, source references and import health. It is not a live rent account.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| A01 | Current reported arrears episodes | Open reported episodes belonging to current tenancies | Existing | 1 |
| A02 | Current tenancy action required | Tenancies at action-required intervention level | Existing | 1 |
| A03 | Repeat-arrears tenancies | Current tenancy repeat-risk signal using the existing helper | Existing | 1 |
| A04 | Reconciliation required | Tenancies/episodes requiring review of uncertain or unreconciled outcomes | Existing filters and episode states | 1 |
| A05 | Latest reported arrears amount | Sum appropriate open-episode latest amounts, with source dates and unknown amounts | Derived; agree treatment of multiple episodes/missing amounts | 2 |
| A06 | Oldest open episode and peak reported exposure | Episode duration and reported peak amounts | Existing tenancy metrics; portfolio summary is derived | 2 |
| A07 | Historic arrears on ended tenancies | Retain historic risk without attaching it to a replacement tenant | Existing tenancy-linked history | 2 |
| A08 | Arrears data freshness and import issues | Last successful update, data-through date, failures and source/attribution gaps | Existing import-health records/UI; stronger summary is derived | 1 |

No reported arrears is not proof that rent is fully paid. State “reported arrears” and show the data-through date. Do not transfer an old tenant's arrears to the current tenant because they share a unit. Current portfolio risk counts use current tenancy IDs; historical arrears deserve a separate view.

## Handovers and home records

Handover captures recipient details, keys/fobs and photographs, meter readings/photos, declaration, signature and date/time. Residents can view their own record and home documents. Handover availability depends on practical completion and the appropriate completed-unit workflow; reporting closure does not prevent an otherwise eligible late handover.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| H01 | Completed units awaiting handover | Join completed units to absence of a handover record and PC eligibility | Existing unit summary; eligible portfolio queue is derived | 1 |
| H02 | Handovers recorded this period | Count records/units by handover date, showing recipients only to authorised users | Derived | 2 |
| H03 | Handover completion by building | Eligible/completed/handed-over units and remaining work | Existing unit/handover data; denominator needs explicit definition | 2 |
| H04 | Time from legal completion to handover | Identify units waiting longest after completion | Derived from dates | 2 |
| H05 | Missing handover evidence | Flag absent required signature, declaration, keys or meter evidence in applicable records | Derived; avoid labelling valid historic records incomplete under new rules | 2 |
| H06 | Meter-record coverage | Units with required handover electricity/water/heat readings, where applicable | Derived; per-unit meter requirements needed | 3 |
| H07 | Resident access and handover mismatch | Eligible units with no active resident access, or records requiring access follow-up | Derived; absence of a user is a review signal, not proof of an error | 2 |
| H08 | Home documents and useful links | Role-scoped shortcuts to home guide, building documents and contacts | Existing | 2 |

Meter readings are point-in-time records. Consumption, usage trends and energy costs need repeated comparable readings and tariff/period data.

## Building lifecycle and unit allocation

Buildings hold PC inputs, reporting-period controls, floors, unit types/rooms, communal areas, document links and responsible organisations. Unit allocation keeps sales availability and rental-portfolio membership as separate dimensions and protects units with progressed sales workflows.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| B01 | Passed expected PC awaiting confirmation | Current dashboard warning; open building settings | Existing | 1 |
| B02 | Upcoming expected PC dates | Planning list, clearly marked expected/unconfirmed | Derived | 2 |
| B03 | Reporting periods closing soon | Confirmed PC plus twelve months; two-month closing notice period | Existing lifecycle calculation; dashboard summary is derived | 1 |
| B04 | Lifecycle distribution by building | Pre-PC, reporting active, closing, read-only and archived | Existing lifecycle helper | 2 |
| B05 | Open work at lifecycle boundaries | Outstanding defects/handovers when reporting closes; distinguish reporting gate from ongoing work | Derived | 1 |
| B06 | Unit allocation summary | Not released, retained, sales route, active rental and exited rental totals | Existing allocation workspace; dashboard summary is derived | 2 |
| B07 | Missing building setup | Missing PC inputs, guides/documents, delivery-team contacts, sales routing or floors | Derived; separate blockers from optional fields | 2 |
| B08 | Allocation blocked by an active sale | Explain why a requested commercial reassignment cannot proceed | Existing allocation rules | 3 |
| B09 | Building comparison table | Snag workload, sales stage, rental occupancy, handovers and next lifecycle date per building | Derived from existing modules | 2 |

Do not add sales-route totals and rental totals as if they were mutually exclusive. A unit can be in the active rental portfolio while marketed for sale. Group unit lists by building, then configured floor order, then natural numeric unit order using `sortUnitsByBuildingFloorOrder`; unrecognised floors follow configured floors.

## Users access communication and audit

Administration supports user creation/invitation, deactivation/reactivation, role and organisation management, building/unit access, resident access-request review, shared organisational contacts and audit history. Sales has conversations, replies, unread counts and mentions. Snag reports preserve included items and recipient delivery states; scheduled digests have run history.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| U01 | Pending resident access requests | Count and age pending requests; open Users & access review | Existing request workflow; dashboard summary is derived | 1 |
| U02 | Requests needing duplicate/existing-account review | Show overlap with current access before approval | Existing review signals | 2 |
| U03 | Active users and access coverage | Totals by role/building; units with or without active residents | Existing directory/unit data; summary is derived | 3 |
| U04 | Users missing expected role access | Identify external users without suitable building/unit assignments | Derived; use effective access including organisation links | 2 |
| U05 | Last-active and inactivity review | Administrative engagement signal using profile last-active timestamps | Existing data; threshold and presentation are derived | 3 |
| U06 | My unread sale discussions and mentions | Personal follow-up list opening the exact sale/comment | Existing unread counts and mentions inbox | 1 |
| U07 | Recent significant business activity | Approvals, completions, payments, access changes and allocations with record links | Existing histories; combined summary is derived | 2 |
| U08 | Snag report delivery failures | Failed/pending recipients and related report details | Existing recipient states; exception summary is derived | 2 |
| U09 | Latest snag reports and quick reporting | Recent PDFs, report scope and permitted generate/send actions | Existing | 2 |
| U10 | Digest failures and last successful run | Admin operational follow-up using run status/counts | Existing service-side history; authorised dashboard endpoint may be needed | 3 |
| U11 | Authentication and access audit | Separate security review stream from business activity | Existing guarded audit functionality; summary is derived | 3 |
| U12 | Unit opens and adoption signals | Administrative usage view subject to existing deduplication and retention | Existing optional audit stream | 3 |

Last-active heartbeat is presence, not a measure of work completed. Unit-open counts are deduplicated deliberate selections and do not represent every page view. Generic audit events and higher-level workflow events may describe the same operation; deduplicate before creating an activity feed or daily action total.

Do not assume all business data belongs in the generic audit log. Sales, snags and general administration retain separate history sources. Service-only import/digest data needs an authorised server route rather than broad client-table access.

## Forecasting and measures needing extension

Saved building-level sales scenarios model sell/retain/rent/refinance mixes, average values/rents, LTV, interest, timing, development cost, opening debt and investor repayment. The UI calculates sale/refinance proceeds, retained value, annual rent, interest cost, debt repaid, cash after debt and developer profit, and compares saved scenarios. These are assumption-based forecasts.

| ID | Dashboard candidate | Practical use and destination | Readiness | Priority |
| --- | --- | --- | --- | --- |
| X01 | Selected saved scenario summary | Cash after debt, developer profit and annual rent for a clearly named scenario | Existing calculations; agree which scenario is the dashboard baseline | 2 |
| X02 | Scenario comparison | Compare selected saved assumptions; open Forecasting | Existing | 3 |
| X03 | Forecast sales versus current commercial position | Compare a named scenario with current sales-route values | Derived; align populations, valuation bases and dates | 2 |
| X04 | Actual scheme profit, margin and return on cost | Dependable finance overview | Extension: authoritative actual cost/debt/accounting data and definitions needed | 3 |
| X05 | Live cash balance and reconciled buyer receipts | Treasury and actual cash collection | Extension: bank/accounting reconciliation needed | 3 |
| X06 | Rent collection percentage and exact live arrears | Compare due rent with actual allocated receipts | Extension: rent ledger/payment integration needed | 3 |
| X07 | Lead funnel, enquiries, viewings and marketing conversion | Sales acquisition performance | Extension: no implemented lead/viewing workflow identified | 3 |
| X08 | Lettings applications, renewals and compliance expiry | Full lettings operations | Extension beyond current tenancy/risk tracking | 3 |
| X09 | Construction progress and contractor cost performance | Programme and cost dashboard | Extension: PC dates/snags do not constitute a construction programme or cost ledger | 3 |
| X10 | Document expiry and recurring compliance tasks | Expiring certificates and recurring reviews | Extension: document links/version history do not provide a general expiry/task system | 3 |

## Role specific dashboard scope

| Role | Current relevant access | Appropriate dashboard content |
| --- | --- | --- |
| Admin | Dashboard, Snags, Units, Sales, Rentals and Setup | All permitted business summaries, approvals, lifecycle and administration. |
| Developer | Same screen categories as Admin, with action-specific permission checks | Portfolio oversight, developer approvals, finances, rentals, handovers and lifecycle; preserve differences in individual actions. |
| Developer representative | Dashboard, Snags and Units in effective building scope | Developer-snag review, site workload, applicable unit/handover and lifecycle signals; no sales/rental/Setup data. |
| Contractor | Dashboard and Snags in effective scope | Contractor work, supplied information, rejected work, trade allocation where permitted, evidence and reports; tailor labels to the action they can take. |
| Sales agent | Sales in effective building scope; no Dashboard screen | Reservation progress, authority requests, relevant sale milestones and personal discussions. Adding a Dashboard view requires an explicit permission/product change. |
| Conveyancer | Sales in effective building scope; no Dashboard screen | Authority expiry, exchange/deposit tasks, completion-notice work, documents, due dates and personal discussions. A Dashboard view requires an explicit permission/product change. |
| Resident | My home, Snags and Documents for assigned units; no internal Dashboard | Personal defects, handover, reporting-period notice and home documents in the resident journey. |
| Legacy user role | No equivalent internal dashboard entitlement | Resolve intended role/access before offering any internal dashboard content. |

Apply the same effective role/building/unit access to aggregates and drill-through results. External sales users must not inherit developer-only commercials or scenario outputs merely because they can access a sale file. A building's configured sales contact is routing metadata; selecting it does not itself grant user access.

## Recommended opening dashboard

For admins/developers, a workable first version would have four sections:

1. **Needs my action:** reservation approvals, commercial approvals, exchange/notice authority requests, completion-document approvals, invoice approvals, snag reviews/information requests and resident access requests. Each entry should have an owner, age and link to the actual action.
2. **Deadlines and exceptions:** urgent/overdue resident defects, expiring exchange authorities, approaching/overdue contractual completions, active voids, arrears requiring action, unconfirmed PC and closing reporting periods.
3. **Portfolio position:** active developer snags and resident defects separately, sales pipeline counts/value, rental occupancy/rent roll, approved unpaid fee balances and completed units awaiting handover.
4. **Recent movement and building comparison:** a compact period selector, significant milestones and a building table; expand to module-specific detail rather than showing every catalogue measure at once.

Personal mentions deserve a small persistent entry point. Service health, audit analytics, document coverage and detailed scenario comparison can live in expandable/admin views. A contractor or developer representative should see a scoped operational version of the dashboard, with actions suited to their role.

## Definitions and implementation constraints for the design review

- **Scope:** Keep “All accessible buildings” versus a selected building explicit. Preserve the selected scope when opening a module. Name the record population on every total.
- **Action ownership:** Distinguish “needs my action” from “waiting on someone else.” A ready-for-review snag is actionable for a developer, whereas a rejected-back snag is actionable for a contractor.
- **Overlapping queues:** Missing trade, review status and other conditions can overlap. If a combined attention badge is needed, count distinct records; keep task counts separately where one record has multiple actions.
- **Counts and money:** Label units, sale files, documents, invoices, episodes and events correctly. Avoid mixing net/gross, contracted/forecast/actual or approved/unapproved amounts.
- **History:** Today/period movement uses recorded milestones/events. Current status alone cannot reconstruct past backlog or a reliable conversion rate.
- **Time:** Standardise dashboard day boundaries on Europe/London. Current snag “today” uses browser-local midnight and only a lower time bound; a consistent reporting interval should have both start and end boundaries.
- **Complete totals:** Current main loading uses client arrays for snag/event summaries, and access requests are limited to the latest 100. Verify database row caps and pagination before reusing those arrays for portfolio-wide totals. Use authorised server aggregates/full retrieval where needed.
- **Data freshness:** Show last refresh and, separately, external data-through dates. Missing/failed loads must display unavailable/retry states rather than zero workload or no arrears. Legal provider status and reported rental data have their own freshness.
- **Navigation accuracy:** A tile's filtered destination must reproduce its count and source scope. The existing missing-trade tile counts active developer snags but its filter only selects missing trade; verify active/source filtering when reviewing this drill-through.
- **Information supplied:** The existing bucket recognises any historical needs-more-info-to-open transition on a currently open record. Decide whether the intended queue should instead use the most recent outstanding information cycle.
- **Zero states:** Hiding zero action tiles is reasonable. Keep stable headline measures or an explicit all-clear state so a missing module cannot be confused with missing data.
- **Loading cost:** Sales/rental/legal data is loaded in module-specific workflows. Reuse calculation helpers, but add a compact summary-loading path rather than assuming the current snag dashboard already has every dataset or mounting all workspaces on the opening screen.
- **Ordering and display:** Building/unit drill-throughs must use configured building floor order and natural unit numbering. Keep mobile presentation compact, with accessible links and clear date/currency units.

## Source map

These are the principal local implementation sources supporting the inventory. Links open the repository files; the report itself remains understandable when uploaded to ChatGPT.

| Area | Principal sources |
| --- | --- |
| Current navigation, dashboard, snags, handovers and administration | [ProductionPortalApp.tsx](../src/components/portal/ProductionPortalApp.tsx), particularly portal screen definitions, `Dashboard`, `buildDashboardModel`, `SnagWorkflow`, `UnitsSection`, `LeaseholderDefects`, `HandoverAndMeters`, `ReportsPanel` and `SnagList` |
| Buildings, units, snag and handover fields | [production.ts](../src/lib/data/production.ts) |
| PC and reporting lifecycle | [building-lifecycle.ts](../src/lib/building-lifecycle.ts) |
| Unit availability and required ordering | [commercial-allocation.ts](../src/lib/units/commercial-allocation.ts), [UnitAllocationWorkspace.tsx](../src/components/portal/UnitAllocationWorkspace.tsx) |
| Sales pipeline, reservation and commercials | [SalesReservationWorkflow.tsx](../src/components/portal/sales/SalesReservationWorkflow.tsx), [stage-tasks.ts](../src/lib/sales/stage-tasks.ts), [permissions.ts](../src/lib/sales/permissions.ts) |
| Legal authority, notice, deposit and completion | [SalesLegalWorkflow.tsx](../src/components/portal/sales/SalesLegalWorkflow.tsx), [authority-state.ts](../src/lib/sales/authority-state.ts), [completion-notice.ts](../src/lib/sales/completion-notice.ts), [completion-review.ts](../src/lib/sales/completion-review.ts), [ExchangeDepositReceipt.tsx](../src/components/portal/sales/ExchangeDepositReceipt.tsx) |
| Independent completion review | [completion-document-review.md](../docs/completion-document-review.md), [review migration](../supabase/migrations/20261007133421_completion_document_review.sql) |
| Fees and recorded payments | [AgentFeesPortfolio.tsx](../src/components/portal/sales/AgentFeesPortfolio.tsx), [agent-fees-portfolio.ts](../src/lib/sales/agent-fees-portfolio.ts), [agent-fees.ts](../src/lib/sales/agent-fees.ts) |
| Scenarios | [SalesForecastingModule.tsx](../src/components/portal/sales/SalesForecastingModule.tsx) |
| Rental performance | [RentalsWorkspace.tsx](../src/components/portal/rentals/RentalsWorkspace.tsx), [performance.ts](../src/lib/rentals/performance.ts), [tenancies.ts](../src/lib/rentals/tenancies.ts) |
| Rental arrears and source coverage | [RentRiskPanels.tsx](../src/components/portal/rentals/RentRiskPanels.tsx), [rent-risk.ts](../src/lib/rentals/rent-risk.ts) |
| Personal communications | [SaleConversation.tsx](../src/components/portal/sales/SaleConversation.tsx) |
| Reports and digests | [snag reports migration](../supabase/migrations/20260708_snag_reports.sql), [digest runs migration](../supabase/migrations/20260702_digest_runs.sql), [snag-digest-emails.md](../docs/snag-digest-emails.md) |
| Audit scope and release context | [audit-increment.md](../docs/audit-increment.md), `production-release-20261007.md` (historical reference; not present in this checkout), [AuditLog.tsx](../src/components/portal/audit/AuditLog.tsx) |

## Suggested ChatGPT review prompt

> Review the attached Bunnywell Portal dashboard screenshot using this functionality report. Propose an admin/developer dashboard that prioritises actions I can take, deadlines, risks and portfolio position. Separate existing measures, newly derived summaries and features needing new data. Select a manageable first release from the catalogue and explain what should remain in module drill-throughs. Specify each chosen item's label, definition, role visibility, building scope, click destination, loading/empty state and data freshness. Keep developer snags separate from resident defects, forecasts separate from actual cash, and reported arrears separate from a live rent ledger. Account for overlapping action counts, current-version document approval, authority expiry and completed units awaiting handover. Describe a compact desktop and mobile layout, then list the decisions needed before implementation. Do not assume screenshot figures are verified current portfolio totals.
