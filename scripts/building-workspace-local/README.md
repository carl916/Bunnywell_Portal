# Local connected workspace — Stage 2

Review: http://127.0.0.1:3031/dev/building-workspace

**Branch:** codex/building-workspace-contracts  
**Worktree:** C:/Users/carlg/.codex/worktrees/building-workspace-contracts/Bunnywell_Portal  
**Baseline:** 0a1ee76a18c17c4466b1031efe52b22e9959abe3

This is an authenticated, read-only integration against the approved isolated local bunnywell-workspace-stage2 database. It uses the accepted full-page design, not the simplified contracts demonstration. The original /dev/sales-workspace prototype remains unchanged in its own worktree; all 12 recorded source/asset hashes match.

## Launch and sign in

From this worktree, run **./scripts/building-workspace-local/start.ps1** with Docker Desktop's Linux engine running. It preserves existing data, never reseeds, starts hidden UI/gateway processes and checks readiness before reporting success.

- Developer: bw-stage2-developer@example.invalid
- Conveyancer: bw-stage2-conveyancer@example.invalid
- Single-building agent: bw-stage2-agent-single@example.invalid

The password and all ten synthetic accounts are in the Git-ignored **local-runtime/test-access.json**. Sessions expire after 30 minutes; sign out and sign back in when necessary.

Open **Willow Court → Sales → G11 → Completion**. The developer sees “Awaiting revised statement”; the conveyancer sees “Resolve the query”. Orchard House has different buyers and statuses for G11, LG11 and 301.

## Connected scope and boundaries

Connected: authenticated profile/access checks; building selection; building-specific dashboard counts and organisation/team responsibility; searched and filtered worklist with all outstanding actions; exact building/unit/sale identity; full-page Completion milestones, dates, document status, query text and version metadata.

The logo theme, compact identity and completion overview, wide task area, laptop spacing and permanent desktop Comments & Activity column are retained. Narrow layouts keep discussion in normal page flow.

**Not connected:** Comments, Activity, document contents, email bodies/delivery history and other detailed workspaces. These say they are unavailable rather than displaying fictional content alongside backend records. The three seeded documents contain metadata only. Business actions remain disabled; authentication creates normal local sessions separately from business reads.

The existing sale-file handoff stays disabled and is never opened or prefetched. Any future link must use the same approved environment and exact building, unit and sale attempt. Existing opening paths can write unit-open activity, initialise sale state or expire legal authority; those paths are outside the new surfaces' read-only guarantee. The local unit-open event table remained empty.

## Setup and remaining schema gap

Replayed the repository initial schema and all 70 recorded migration files without changing those files. Replay needed dependency ordering for same-date files and local enum prerequisites for the existing sales_agent/conveyancer roles omitted by the bootstrap. Reconcile that gap before a later environment integration; no remote schema parity is claimed. The empty Forum House placeholder created by the old bootstrap was replaced by the approved fictional buildings.

Setup used existing transaction-local legal/commercial/package contexts to insert synthetic snapshots, preserving triggers and permissions. The result contains 3 buildings, 8 units/current sales, 1 superseded test attempt, 3 document metadata records and 10 test accounts. Controlled access revocation was restored.

Existing developer/admin rules allow all-building access. They were preserved; the single-building case uses agent-single rather than pretending developer-single has restricted permissions. The separate staging payment hotfix has not been automatically merged into this pinned read-only branch.

## Isolation

Data services use only the dedicated internal Docker network. The credential-free fixed ingress relay publishes loopback ports and has its external default route removed. Browser CSP and the explicit read transport block external origins, business mutations, RPCs and legacy routes. The gateway also excludes the Next image proxy. Auth uses local mail capture; public signup is disabled and no messages were generated. Unneeded services such as Edge runtime and analytics are disabled. No outbound cron jobs are installed.

Private runtime keys and test credentials are Git-ignored. No remote business environment was contacted, no paid environment was created, and no unrelated database was overwritten.

## Newly executed validation

- **38 offline contract/boundary tests passed.**
- **28 authenticated journey checks passed:** explicit/single-building entry, floor ordering, multiple actions/counts, G11/LG11/301 duplicates, direct links, refresh, history, separate tabs, filter restoration, delayed response switching, role headings, inactive/restricted denial, RLS denial and controlled access revocation.
- **10 additional checks passed:** scoped direct loads, incomplete-source counts, whole-workspace errors, superseded attempt denial, keyboard focus, mobile scroll restoration and change-building access, zoom-equivalent layout, mail capture and no legacy opening side effects.
- TypeScript, focused ESLint and a local production build passed. All three experiment routes returned **404 in production**, even with the local flag enabled.
- Checked 1366×768, 390×844, 1024×768 and 1920×1080. A 683×384 CSS viewport at 2× device scale tested the effective layout at 200% laptop zoom; this is **not a native browser-zoom test**.
- Tested restart with services already running and UI startup from a stopped state. No data was reset.

Previous Stage 1 results remain in artifacts/building-contracts-stage1 and artifacts/building-workspace-stage2/previous-validation-2026-11-05.json. They are not counted as authenticated integration proof. These are synthetic read/navigation checks, not payment, approval, upload, sending or other real workflow integration tests.

## Performance and evidence

Four synthetic units in the selected building, warm local development server:

- Dashboard required 19 data/auth requests; its worklist reused the scoped snapshot with zero additional requests.
- Three direct worklist reloads took approximately **291–293 ms**, with **22 data/auth requests**, **14,266 response-body bytes** and about **16,507 header bytes** each.
- A fresh browser-cache authenticated worklist took **383 ms** with **50 total page/asset/data/auth requests** and **1,031,183 transferred bytes including headers**. Development assets are unoptimised; WebSocket frames are excluded.
- Normal entry fetched no detailed records from other buildings. No speculative prefetching was introduced.

These figures are local development evidence, not production-size, remote-latency or scalability benchmarks.

Evidence is in **artifacts/building-workspace-stage2**: validation.json, journey-tests.json, additional-checks.json, cold-page-performance.json, schema-replay.json, isolation.json, browser-isolation.json and production-route-check.json. Review images include dashboard-1366.png, worklist-1366.png, completion-1366.png, worklist-390.png, completion-390.png, completion-tablet.png and completion-wide.png.

Staging, production, production-facing endpoints and the original redesign worktree were not changed by this integration. Nothing was merged, pushed or deployed. Remaining work is separately authorised panel/file integration and, later, business actions plus realistic-scale/environment validation.

