# Dashboard and Sales UX — Phases 1–2.1

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

| Shared category | Fee view / responsibility | Counting unit and amount | Record destination |
| --- | --- | --- | --- |
| invoice-review | Our actions / Developer | Current invoices awaiting approval, with distinct sale count; submitted money excluded from approved balances | Financials → matching exchange/completion fee |
| payment-position | Our actions / Developer | Positive approved invoice balances after existing valid payments, credits and deductions; distinct sale count | Financials → matching exchange/completion fee, “Review payment position” |
| invoice-submission | Invoices to submit/correct / assigned Agent or explicit Unallocated | Required submission/correction milestones plus distinct sale count; no invented payable amount | Financials → matching fee milestone |

Phase 2.1 supersedes the coupled responsibility/category selection. One canonical `feeView` selects exactly one of `ours` (default), `invoice-review`, `payment-position`, `invoice-submission`, or `all`. These alternative views intentionally overlap. Our actions is the unique-sale union of current invoice approvals and positive approved unpaid/part-paid balances. Selecting an already selected view is a no-op, including on page 2 or with empty results. No data-driven selection occurs. All records retains the complete authorised population, including settled positions. Submission/correction includes assigned and genuinely unallocated work; Agent → Unassigned exposes the latter directly.

The five controls contain scoped summary totals; there is no second responsibility row or duplicate category card row. Totals cover authorised building + agent + any visible assigned-only legacy scope, independent of view, milestone, search, sort or table page. The table separately counts filtered unique sales. Counts explicitly distinguish sales, invoices and submission/correction milestones. One sale can appear in multiple views, so category counts must not be summed as unique sales. Future uninvoiced completion fees remain secondary **net** information. A short scope note and accessible About totals disclosure explain this contract.

Validated destinations are generated by `feeViewDestination(building, view, {agent, assignedOnly})` or the compatible `feeCategoryDestination(building, category, work, agent)` in `src/lib/sales/fee-workspace.ts`. For example, the latter produces `/?screen=sales&building=…&salesView=agent_fees&feeView=payment-position&feeMilestone=all&feeSort=work&feePage=1#fee-results`. Factories clear unrelated restrictions; optional agent scope can explicitly target `unassigned`. Canonical URL fields are `feeView`, `feeAssigned=only` (when present), `feeAgent`, `feeMilestone`, `feeSort`, `feeSearch`, `feePage`. Writers remove superseded `feeWork`/`feeCategory`; an allow-listed canonical view takes precedence when both forms occur.

| Legacy feeWork | Legacy feeCategory | Canonical view | Additional visible scope |
| --- | --- | --- | --- |
| omitted / ours | omitted | ours | None |
| all | omitted | all | None |
| others | omitted / invoice-submission | invoice-submission | Assigned agents only |
| ours / all | invoice-submission | invoice-submission | None |
| any | invoice-review | invoice-review | None (preserves the old effective category normalisation) |
| any | payment-position | payment-position | None (preserves the old effective category normalisation) |

Invalid values fall back to the documented default / remaining valid legacy values. Existing agent, milestone, search, sort and page values remain allow-listed/bounded. Assigned-only is an explicit, removable scope indicator, retained across view/refinement changes and record returns until removed or Reset is used. It excludes unassigned rows from **both totals and results**; selecting Unassigned while it is active truthfully produces an empty intersection. It never becomes an invisible second responsibility selection. Reset restores Our actions, all agents/milestones, work priority, blank search and page 1 within the current authorised building scope. View/refinement changes reset page 1 while retaining compatible explicit refinements.

`feeRecordUrl` writes canonical filters, retains the source context, marks `workReturn=fees` and opens the existing financials section. Both invoice milestones remain present. A single matching action targets `#exchange-fee` or `#completion-fee`; multiple actions target `#agent-fees`. Sales continues using its existing `salesOverviewDestination` / `saleRecordUrl` factories in `src/lib/sales/developer-overview.ts` and shared category IDs; its responsibility controls are unchanged. Phase 3 **must consume these shared factories and category identities**, not hard-code the superseded two-row fee state.

### Navigation intent and position (Phase 2.1)

`replaceSalesListUrl` and `useSalesOverviewNavigation` separate URL updates from scroll instructions. Work-view, agent, milestone, search, sort and Reset are in-place filter intents: replace history state, clear old saved positions, retain focus, cancel a pending arrival and issue no scroll call. The hash can remain in a bookmark without being re-executed. Automatic page clamping is also non-scrolling, preserving only a still-pending initial arrival/return.

Direct category links reveal the appropriate ready list once. The active list owns the effect (Fees readiness cannot be substituted by Sales readiness); a shared event generation prevents duplicate/replayed effects during refresh or remount. A consumed-entry marker and pagehide position snapshot preserve reload behaviour. Explicit Fees pagination requests a single list-top reveal. Opening a record retains source URL, page, document position and any scrollable ancestor positions. Browser history traversal and visible return restore the saved list position once, taking precedence over anchors. Direct record entries without saved history fall back to a valid fee-list destination. Browser native restoration remains enabled; no counter-scrolling, global disabling, arbitrary delays or blank spacers are introduced.

The normal portal scroll container is the document. While Fees is mounted, scoped `html:has(.fees)` CSS disables native anchor selection at that container, including bottom anchoring outside the changing table subtree. It does not disable scrolling or history restoration, and stops applying when the Fees list unmounts. A shorter result set can reduce its maximum scroll position and physically clamp the viewport; this is distinct from a programmed jump and cannot promise exact scrollY preservation. Embedded browser frames have their own document viewport. Keep this distinction in verification evidence.

The compact RPC provides no invoice due date or urgent flag. No overdue claim is inferred from stage or approval age. Work order is reviews, approved payment positions, then submissions/corrections, followed by configured building/floor/natural unit order and sale ID; sorting precedes pagination.

The retained Sales workspace owns the fee snapshot. Same-scope refresh retains the last successful rows/totals; errors disable review links; scope, identity and access changes withhold old snapshots. Exact row counts and required fee/payment inputs protect against partial data becoming an empty queue. No per-row requests, polling, broad Dashboard loader, schema or permission expansion.

### Bounded Sales corrections

The Sales table has one primary review route, plain summary and additional count. Current completion reviews open their existing document package. Multiple fee tasks open the financials workspace containing both milestones. Mixed actions open the record's matching-action navigator, which retains every authorised destination. The table no longer expands duplicate instruction links. Our actions suppresses redundant developer ownership only when every matching task is unambiguously owned and actionable by that team; mixed/unallocated information remains. Exceptions display the existing formatted date derived from the raw saved completion/authority value, without changing urgency or legal rules.

Phases 3–4 remain deferred: Dashboard layout and separately authorised sales-agent fee visibility. No Phase 2 change grants external portfolio, approval, payment or voiding powers.
