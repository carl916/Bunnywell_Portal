# Dashboard and Sales UX — Phases 1–2

Base: staging 4d11613 (includes the conveyancer register and retained-session improvements).

The Dashboard chooses a work category; Sales chooses a sale; Agent Fees chooses an invoice/milestone; the existing record performs the authorised action. Phase 1 changes developer/admin Sales and shared classification only. Fees, Dashboard layout and agent access remain later phases.

| Category identity | Owner | Record / counting unit | Date or exception | Record destination | Working-list filter |
| --- | --- | --- | --- | --- | --- |
| reservation | Agent prepares/corrects; developer reviews | Sale / unique sales | Submitted/returned date is context, not an SLA | Sales → reservation | salesCategory=reservation |
| commercial | Developer | Sale / unique sales | Approval state | Sales → exchange/commercial approval | salesCategory=commercial |
| exchange | Developer issues authority; conveyancer requests/renews/records exchange | Sale / unique sales | Current authority expiry; superseded/revoked authorities excluded | Sales → exchange | salesCategory=exchange |
| notice | Developer grants authority; conveyancer requests/confirms arrangements | Sale / unique sales | Required missing date remains an action | Sales → notice/arrangements | salesCategory=notice |
| documents | Developer reviews; conveyancer uploads/replaces current versions | Sale / unique sales (Dashboard may count documents) | Saved completion date is an observation | Sales → precise current document/package | salesCategory=documents |
| completion | Conveyancer | Sale / unique sales | “Completion date passed; completion not recorded” | Sales → legal completion | salesCategory=completion |
| deposit | Conveyancer, or explicitly unallocated | Sale / unique sales | Matching full receipt and expected source; missing basis is an exception | Sales → exchange deposit task | salesCategory=deposit |
| invoice-review | Developer | Invoice / invoices; Sales counts unique sales | No invented payment deadline | Sales → exchange/completion fee | salesCategory=invoice-review; later Fees category |
| invoice-submission | Assigned agent | Invoice/milestone / invoices; Sales counts unique sales | Existing eligibility only | Sales → corresponding fee section | salesCategory=invoice-submission; later Fees category |
| payment-position | Developer | Approved positive invoice balance / invoices | “Review payment position”; no overdue claim without a due date | Sales → corresponding fee section | salesCategory=payment-position; later Fees category |
| record-checks | Developer | Sale / unique sales | Stage disagreement, multiple/missing active attempts | Existing sale/check section; review does not grant mutation rights | salesCategory=record-checks |
| unallocated | No invented team | Sale / unique sales | Responsible organisation missing | Sale file; existing authorised setup remains available | salesCategory=unallocated (All sales) |
| Non-Sales work (future Dashboard) | Existing snag/rental/handover/access owner | Snags, episodes, units or requests | Existing recorded SLA/date/urgent flag | Existing Snags, Rentals, Units or Setup destination | Preserve typed module filters; no Phase 1 redesign |

salesWork=all|ours|others is relative to the authenticated viewer. salesCategory and responsibility links explicitly reset unrelated stage/search/page restrictions and target #sales-results. Existing building scope remains authoritative. Values are allow-listed. Ordinary browsing stores stage, search and page in the URL and a bounded return scroll position in browser history; record links retain that list context.

All sales keeps configured building/floor/natural unit order. Action views sort actual overdue/urgent work, approaching saved deadlines, then remaining work, with actual dates and canonical unit order as stable ties. Time in stage is never an overdue rule. Counts and membership use the same predicates before pagination; portfolio/pipeline figures continue to describe the selected building.

| Role | Sales layout | Financial overview / Forecasting | Actions / mutation rights |
| --- | --- | --- | --- |
| Admin, developer | Existing portfolio/pipeline/table plus Phase 1 views | Existing overview; Forecasting visible, opening disabled | Shared ownership; existing permission checks |
| Conveyancer | Existing compact register | None | Existing organisation filtering, scoped cache and workflow permissions |
| Sales agent | Existing agent workspace (Phase 4 later) | None | No new Fees portfolio, approval, payment or voiding access |
| Other roles | Existing access boundaries | No expansion | No new access |

Implementation reuses the already-authorised Sales snapshot and the shared Dashboard derivation. Only missing compact authority/deposit facts are read in bounded batches for internal roles, never per row. No broad Dashboard load, new task store, dependency/schema change, region change or genuine mutation is required. Shared observations remain available as dates/exceptions without inflating action counts. Unallocated work remains an explicit exception rather than another team's task.

Initial placeholders do not claim a workload. Same-scope successful data remains visible during refresh; errors disable stale guidance and offer Retry. A failed classification never presents all records under Our actions/Other teams. Scope/access changes must hide old snapshots before replacement.

## Phase 2 — developer Agent Fees

Base: latest staging at 05dc58beef3dde0620c65afd07be25a12519e90a (merged Phase 1).
The existing fee derivation remains the source of eligibility and monetary position.
Shared fee category identities are consumed by Sales, Fees and Dashboard work items.

| Shared category | Fee view / responsibility | Card counting unit and amount | Record destination |
| --- | --- | --- | --- |
| invoice-review | Our actions / Developer | Current invoices awaiting approval, with distinct sale count; submitted money excluded from approved balances | Financials → matching exchange/completion fee |
| payment-position | Our actions / Developer | Positive approved invoice balances after existing valid payments, credits and deductions; distinct sale count | Financials → matching exchange/completion fee, “Review payment position” |
| invoice-submission | All records / assigned Agent or explicit Unallocated | Required submission/correction milestones plus distinct sale count; no invented payable amount | Financials → matching fee milestone |

Our actions is the explicit default, with no automatic category selection. Waiting on others includes assigned agent work only. All records and submission/correction include unallocated work; the Unassigned agent filter exposes it directly. Selecting an agent category intentionally establishes All records, rather than leaving an incompatible developer-only filter.

Category totals cover authorised building + agent, independent of category, milestone, search, sort or table page. The table separately counts filtered unique sales. One sale can appear in multiple categories, so cards must not be summed as unique sales. Future uninvoiced completion fees remain secondary **net** information.

Validated destinations are generated by feeCategoryDestination(building, category, work):
`/?screen=sales&building=…&salesView=agent_fees&feeCategory=payment-position&feeWork=ours#fee-results`.
The factory clears unrelated restrictions. Fee URL state includes feeWork, feeCategory, feeAgent, feeMilestone, feeSort, feeSearch and feePage. Record links retain it, mark workReturn=fees and use the existing financials section. Browser history stores the source URL and scroll; Back and reload retain the journey. Both invoice milestones remain present in that record section.

The compact RPC provides no invoice due date or urgent flag. No overdue claim is inferred from stage or approval age. Work order is reviews, approved payment positions, then submissions/corrections, followed by configured building/floor/natural unit order and sale ID; sorting precedes pagination.

The retained Sales workspace owns the fee snapshot. Same-scope refresh retains the last successful rows/totals; errors disable review links; scope, identity and access changes withhold old snapshots. Exact row counts and required fee/payment inputs protect against partial data becoming an empty queue. No per-row requests, polling, broad Dashboard loader, schema or permission expansion.

### Bounded Sales corrections

The Sales table has one primary review route, plain summary and additional count. Current completion reviews open their existing document package. Multiple fee tasks open the financials workspace containing both milestones. Mixed actions open the record's matching-action navigator, which retains every authorised destination. The table no longer expands duplicate instruction links. Our actions suppresses redundant developer ownership only when every matching task is unambiguously owned and actionable by that team; mixed/unallocated information remains. Exceptions display the existing formatted date derived from the raw saved completion/authority value, without changing urgency or legal rules.

Phases 3–4 remain deferred: Dashboard layout and separately authorised sales-agent fee visibility. No Phase 2 change grants external portfolio, approval, payment or voiding powers.
