# Dashboard and Sales UX — Phase 1

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

Phases 2–4 remain review constraints: fee-specific category totals and return destinations; compact Dashboard categories with matching predicates; then separately authorised organisation-scoped agent fees. None grants new permissions in Phase 1.
