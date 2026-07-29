# Bunnywell Sales Pipeline Production Spec

## Purpose

Replace the sales and conveyancing spreadsheet with a controlled sale file workflow for each unit.

The production feature should allow Bunnywell, sales agents, and conveyancers to work from the same structured record, reducing errors caused by email threads, spreadsheet edits, unclear unit references, and untracked commercial changes.

## Core Principle

The portal is the single source of truth for the commercial position of each sale.

The app should model both:

- The conveyancing workflow.
- The commercial approval process that confirms the deal is ready for exchange.

The developer defines and approves the commercial package. The conveyancer then completes the legal transaction based on the approved terms.

## Product Scope

The production feature should support:

- Unit sale files.
- Multiple sale attempts per unit.
- Failed reservation history with redaction.
- Building-level default deal structures.
- Unit-level commercial overrides.
- Reservation form storage and approval.
- Commercial approval / Ready for Exchange.
- Exchange confirmation.
- Agent invoice reconciliation.
- Solicitor payment recording.
- Developer shortfall payment recording.
- Completion document review.
- Completion confirmation.
- Existing handover workflow once completed.
- Role-based access for Developer, Sales Agent, and Conveyancer.
- Future forecasting and exit scenario modelling.

## POC UI Patterns To Retain

The disposable conveyancing POC established several UI patterns that should be carried forward into the production build.

These are product learnings, not implementation instructions to copy the POC code wholesale.

### Sales Overview

Keep a scheme-level Sales workspace before the user opens a unit sale file.

The overview should include:

- Building selector.
- Financial overview.
- Sales pipeline.
- Sales results table.
- Search by unit number.
- Unit selector/open unit control where useful.

The financial overview should use calculation-style panels rather than isolated KPI cards.

Preferred panels:

- Revenue view.
- Cost / debt view.
- Profit view.

The Sales pipeline should remain prominent and easy to scan:

- For Sale.
- Reserved.
- Exchanged.
- Completed.

Each pipeline stage should show:

- Unit count.
- Total value.
- Click/filter behaviour.

The sales results table should remain dense and operational, showing:

- Unit.
- Stage.
- Price.
- Next action.
- Time in stage.

### Selected Unit Sale File

When a user opens a unit, the page should become a focused sale file rather than a continuation of the overview.

Retain:

- Back to sales overview action.
- Search sales input.
- Open unit dropdown including unit status.
- Selected sale file heading.
- Unit number.
- Building/floor context.
- Sale status badge.

The sale file should not show unnecessary scheme overview clutter once a unit is selected.

### Developer View And Agent View

The POC's two-panel commercial summary is an important pattern to retain.

The selected sale file should show:

- Developer view.
- Agent view.

These should be calculation-style lists with labels and values close together, right-aligned numeric values, and tabular numerals.

Developer view should show the developer's commercial outcome, including:

- List price.
- Expected sale price or contract price.
- Parking value.
- Developer contribution.
- Solicitor fee.
- Agent fee / invoice impact.
- Net developer proceeds.

Agent view should show the agent invoice calculation, including:

- Agent fee percentage.
- Fee base.
- Net agent fee.
- VAT.
- Reservation fee deduction.
- Agent contribution.
- Forecast invoice.

This split is important because developer contributions and agent contributions affect different sides of the deal.

### Commercial Model Panel

The POC commercial model panel should be retained as a concept.

Before reservation, the developer should be able to open a discreet modelling panel to test the commercial deal.

The panel should use three areas:

- Deal inputs.
- Live preview.
- Scheme impact.

Deal inputs should include:

- Proposed unit price.
- Parking value.
- Developer contribution.
- Agent contribution.

Live preview should show:

- Developer net before.
- Developer net after.
- Developer difference.
- Agent invoice before.
- Agent invoice after.
- Agent difference.

Scheme impact should show the effect if the same commercial change is applied across remaining For Sale units.

It should include:

- Applies to X For Sale units.
- Current GDV.
- Proposed GDV.
- GDV difference.
- Current forecast net proceeds.
- Proposed forecast net proceeds.
- Forecast difference.

The production implementation should describe this as commercial modelling or deal modelling, not just incentive modelling.

Once a unit is reserved, the commercial position should normally lock for simple workflow purposes. Future versions may support post-reservation amendments through a controlled approval process.

### Sale Timeline

The POC showed that the timeline should be the centrepiece of the sale file.

Production should retain a four-stage timeline:

- Reservation.
- Exchange.
- Completion.
- Handover.

The timeline should show:

- Stage status.
- Owner / who has the ball.
- Next action.
- Relevant timestamp.
- Locked/future state where applicable.
- Completed history where applicable.

Detailed tasks should sit inside the selected stage, not as separate top-level timeline stages.

### Stage Detail Panel

The selected workflow stage should show the relevant checks, forms, documents, and actions for that stage.

Avoid showing every possible sale field at once.

Reservation should focus on:

- Buyer details.
- Reservation form.
- Reservation fee.
- Commercial comparison.
- Developer approval/query.

Exchange should focus on:

- Approved commercial package.
- Commercial Approval / Ready for Exchange.
- Agent invoice as part of the commercial package.
- Exchange date recording.
- Solicitor payment recording after exchange.

Completion should focus on:

- Completion statement.
- Statement of account.
- Developer approval/query.
- Completion date recording.

Handover should point to the existing handover workflow rather than rebuilding it.

### Notes And Activity

Notes and activity should remain available, but should not dominate the sale file screen.

The POC pattern of a compact "View notes/activity" action is preferred over a permanent large notes sidebar.

### Naming Cleanup For Production

Do not carry forward POC labels into production UI.

Replace:

- "Conveyancing POC" with "Sale timeline" or "Sale file".
- "Admin/Developer only" with role-appropriate visibility.
- "Model incentive" with "Edit commercial model" or "Model commercial terms".

## Key Concepts

### Unit

The existing flat/unit record. The existing unit sale status should remain simple and should continue supporting existing handover rules:

- For Sale
- Reserved
- Exchanged
- Completed
- Handed Over

Do not overload this field with every sales workflow state.

### Sale Attempt

A unit can have more than one sale attempt.

Examples:

- First reservation falls through.
- Buyer details are redacted.
- Reservation form is removed or marked redacted.
- The unit later gets reserved again by a new buyer.

Only one sale attempt should normally be active at a time.

### Active Sale Attempt

The current live sale for the unit. This is the record used for reservation, exchange, commercial approval, invoice reconciliation, completion, and reporting.

### Failed Sale Attempt

A previous sale that fell through.

The system should retain enough history to show that a reservation existed and failed, while removing or redacting sensitive buyer information and non-applicable documents.

Retain:

- Sale attempt reference.
- Unit.
- Status history.
- Reservation date if required.
- Fall-through date.
- Fall-through reason.
- Reservation fee position.
- Non-sensitive audit history.
- Redacted document references where useful.

Redact or remove:

- Buyer name.
- Buyer email.
- Buyer phone.
- Buyer solicitor personal data if required.
- Reservation form contents.
- Documents no longer applicable.

### Commercial Terms

The structured financial terms of the sale.

These include:

- Contract price.
- Parking value.
- Developer contribution.
- Agent contribution.
- Other agreed concessions.
- Reservation fee.
- Deposit/payment structure.
- Sales agent fee.
- Solicitor fee assumptions.

### Building Default Deal Structure

Each building should define default commercial terms for new sales.

Example:

- Reservation fee: GBP 5,000.
- Deposit required by exchange: 10%, including the reservation fee.
- Further payment: 5%, due three months after exchange.
- Remaining balance: 85% on completion.

Defaults should apply to new sale attempts, but should be overridable at unit level.

### Unit-Level Overrides

Before reservation, the developer can override the building default deal structure for an individual unit.

Examples:

- Different reservation fee.
- Different exchange deposit.
- Delayed deposit.
- Parking included.
- Developer contribution.
- Agent contribution.

Future versions may support renegotiation after reservation. The first production build does not need a complex amendment workflow, but the data model should not prevent it.

### Reservation

The sales agent creates or updates the reservation pack.

Reservation captures:

- Buyer details.
- Buyer solicitor details.
- Reservation date.
- Reservation fee.
- Reservation fee holder.
- Reservation form document.
- Any reservation-specific notes.

The developer reviews and approves or queries the reservation.

When approved, the unit becomes Reserved.

### Commercial Approval / Ready For Exchange

The developer is not simply approving an invoice. The developer is approving the complete commercial package before exchange.

Commercial approval confirms:

- Buyer details.
- Contract price.
- Parking value.
- Developer contribution.
- Agent contribution.
- Reservation fee.
- Deposit/payment structure.
- Sales agent invoice.
- Invoice reconciliation.
- Solicitor details.

Once approved, the sale becomes Ready for Exchange.

This should be a sale workflow state, not a unit sale status. The existing unit status should remain Reserved until exchange is actually confirmed.

### Exchange

The conveyancer exchanges contracts outside the portal based on the approved commercial package.

After exchange, the conveyancer records:

- Actual exchange date.

The exchange date cannot be in the future.

Once exchange is recorded, the unit becomes Exchanged.

### Solicitor Payment Recording

After exchange, the solicitor records:

- Amount paid to the sales agent.
- Date payment was made.

Payment recording must not delay or prevent exchange.

Exchange is a legal milestone. Invoice payment is a financial milestone.

### Invoice Reconciliation

The system should calculate the amount the solicitor is permitted to release to the sales agent using the approved deal structure.

Example:

- Contract price: GBP 200,000.
- Exchange deposit: 10%.
- Maximum releasable from deposit: GBP 20,000.
- Reservation fee already held by agent: GBP 5,000.
- Solicitor payment: GBP 15,000.

Invoice example:

- Agency fee: GBP 20,000 net.
- VAT: GBP 4,000.
- Gross invoice: GBP 24,000.

The system should display:

- Reservation fee already held by agent: GBP 5,000.
- Amount paid by solicitor: GBP 15,000.
- Total received by agent: GBP 20,000.
- Outstanding developer balance: GBP 4,000.

### Developer Shortfall Payment

Where the solicitor cannot settle the full invoice, the developer records:

- Amount paid.
- Payment date.

Once recorded, the invoice can be fully reconciled.

### Completion

The conveyancer uploads completion documents:

- Completion statement.
- Statement of account.

The developer reviews and approves or queries these documents.

Once approved and completion happens, the conveyancer records:

- Actual completion date.

The completion date cannot be in the future.

Once completion is recorded, the unit becomes Completed.

### Handover

Completion should make the existing handover workflow available.

Do not rebuild the current handover process as part of the sales pipeline feature.

### Documents

Documents should be stored internally, not just linked.

Core document types:

- Reservation form.
- Sales agent invoice.
- Completion statement.
- Statement of account.

Each document should support:

- Sale attempt link.
- Document type.
- Version.
- Storage path.
- Uploaded by.
- Uploaded at.
- Status.
- Approval/query status where relevant.
- Superseded/redacted state.
- Visibility rules.

The app may later generate reservation forms from structured portal data. The initial production build can support uploaded reservation forms first, but the data model should allow generation later.

### Forecasting

Forecasting is valuable and should be planned as a connected module.

It should use structured sales data from the pipeline, but should not be buried inside the sale file UI.

Forecasting should eventually support:

- Sell all units.
- Retain selected units.
- Rent selected units.
- Refinance selected units.
- Loan-to-value assumptions.
- Monthly interest.
- Sale timing.
- Completion timing.
- Investor repayment.
- Developer profit.
- Cash after debt repayment.
- Scenario comparison.

Forecasting may be delivered after the first sales pipeline slices, but the schema should preserve clean values needed for forecasting.

## Roles And Access

Initial production launch should support:

- Developer.
- Sales Agent.
- Conveyancer.

Residents and contractors must not see sales pipeline data.

### Developer

Can see and manage:

- All commercial data.
- Building defaults.
- Unit-level commercial overrides.
- Reservation approval/query.
- Commercial approval.
- Invoice reconciliation.
- Completion document approval/query.
- Forecasting.
- Audit history.

### Sales Agent

Can see and manage assigned building sales actions, including:

- Unit availability/status for assigned buildings.
- Reservation creation.
- Buyer details they submit.
- Reservation form upload.
- Sales invoice upload.
- Relevant invoice status.

Should not see:

- Developer profit.
- Debt/refinance forecasting.
- Internal developer-only notes.
- Other agents' buildings.

### Conveyancer

Can see and manage assigned building legal actions, including:

- Approved commercial snapshot.
- Reservation information needed for conveyancing.
- Exchange readiness.
- Exchange date recording.
- Solicitor payment recording.
- Completion document upload.
- Completion date recording.

Should not see:

- Developer profit.
- Debt/refinance forecasting.
- Unrelated buildings.
- Internal developer-only notes unless explicitly shared.

### Resident

No access to sales pipeline data.

Residents should only see their resident/handover-facing records according to the existing portal model.

### Contractor

No access to sales pipeline data.

Future buyer-specific build changes may create contractor actions, but that should expose only the required build instruction, not the sale file or buyer financial details.

## Workflow

1. Developer sets building default deal structure.
2. Developer can override deal structure per unit.
3. Sales agent creates reservation and uploads reservation form.
4. Developer approves or queries reservation.
5. Sales agent uploads invoice.
6. Developer reviews full commercial package.
7. Developer grants Commercial Approval.
8. Sale becomes Ready for Exchange.
9. Conveyancer exchanges outside portal.
10. Conveyancer records exchange date.
11. Solicitor records payment to agent.
12. Developer records invoice shortfall if needed.
13. Conveyancer uploads completion documents.
14. Developer approves completion documents.
15. Conveyancer records completion date.
16. Unit becomes Completed.
17. Existing handover workflow becomes available.

## Recommended Production Data Model

The exact schema should be designed during implementation, but the production model should be based around separate entities rather than one wide POC table.

Suggested tables:

- `building_sale_defaults`
- `unit_sale_attempts`
- `unit_sale_terms`
- `unit_sale_payment_schedule`
- `unit_sale_documents`
- `unit_sale_document_versions`
- `unit_sale_invoices`
- `unit_sale_invoice_payments`
- `unit_sale_workflow_events`
- `unit_sale_notes`
- `unit_sale_audit_events`
- `sales_forecast_scenarios`
- `sales_forecast_scenario_units`

## Data Model Principles

- A unit can have many sale attempts.
- A unit should normally have only one active sale attempt.
- Failed sale attempts should be retained in redacted form.
- Documents should be versioned.
- Approvals should be audited.
- Workflow history should be event-based.
- Financial terms should be structured, not buried in notes.
- Deposit structures should support multiple scheduled payments.
- Unit status should remain compatible with existing handover rules.
- Forecasting should consume approved sales data, not mutate it.

## Build Sequence

### Slice 1: Production Data Model

Create the production schema and RLS foundations.

Include:

- Building sale defaults.
- Sale attempts.
- Commercial terms.
- Payment schedule.
- Document metadata.
- Invoice metadata.
- Workflow events.
- Notes.

Do not build all UI in this slice.

### Slice 2: Permissions

Implement role and building-scoped access for:

- Developer.
- Sales Agent.
- Conveyancer.

Block:

- Residents.
- Contractors.

Add tests for role visibility before expanding the UI.

### Slice 3: Reservation

Build the first usable workflow:

- Create active sale attempt.
- Enter buyer details.
- Upload reservation form.
- Developer approve/query reservation.
- Mark unit Reserved on approval.
- Support failed reservation with redaction/history.

### Slice 4: Commercial Approval / Ready For Exchange

Build the commercial approval screen:

- Commercial snapshot.
- Approved buyer details.
- Contract price.
- Parking value.
- Developer contribution.
- Agent contribution.
- Reservation fee.
- Deposit/payment schedule.
- Sales agent invoice.
- Invoice reconciliation.
- Solicitor details.

Require sales agent invoice upload before commercial approval for the initial production version.

On approval:

- Record approved by.
- Record approved at.
- Mark sale attempt Ready for Exchange.

### Slice 5: Exchange

Build conveyancer exchange flow:

- Show approved commercial snapshot.
- Record actual exchange date.
- Prevent future exchange dates.
- Mark unit Exchanged.

Do not require payment recording before exchange.

### Slice 6: Invoice Reconciliation

Build post-exchange invoice reconciliation:

- Calculate permitted release from payment schedule.
- Record solicitor payment amount.
- Record solicitor payment date.
- Calculate total received by agent.
- Calculate outstanding developer balance.
- Record developer shortfall payment.
- Mark invoice reconciled when settled.

### Slice 7: Completion

Build completion workflow:

- Upload completion statement.
- Upload statement of account.
- Developer approve/query completion documents.
- Record actual completion date.
- Prevent future completion dates.
- Mark unit Completed.
- Leave existing handover workflow unchanged.

### Slice 8: Forecasting

Build forecasting as a connected module.

Initial forecasting should support:

- Sell/retain/rent/refinance scenarios.
- LTV assumptions.
- Completion timing.
- Monthly interest.
- Debt repayment timing.
- Cash after debt.
- Developer profit.
- Scenario comparison.

## Implementation Rules

- Build from `staging`.
- Do not merge the disposable `conveyancing-poc` branch wholesale.
- Reuse POC product learning and selected UI/calculation ideas only.
- Keep existing snags, handover, resident access, auth, and production/staging config stable.
- Add migrations carefully and test RLS before broad UI exposure.
- Keep residents and contractors blocked from sales data.
- Prefer small production slices over a large all-at-once merge.

## Open Decisions

- Whether reservation forms should be generated by the portal in the first release or later.
- Exact document size limits and accepted file types.
- Exact failed reservation redaction policy.
- Exact sales agent and conveyancer organisation scoping rules.
- Whether forecasting is released with the first sales pipeline launch or shortly after.
- Whether buyer-specific build changes are part of the first release or a later contractor workflow.
