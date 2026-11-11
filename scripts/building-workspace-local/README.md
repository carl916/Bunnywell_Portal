# Local connected workspace — Completion review

Review: http://127.0.0.1:3031/dev/building-workspace

**Branch:** codex/building-workspace-contracts
**Worktree:** C:/Users/carlg/.codex/worktrees/building-workspace-contracts/Bunnywell_Portal
**Read-only checkpoint:** 088a40b551f4735c59542a29baa6136c76af17b0
**Current delivery:** authenticated local integration with the separately approved Completion document-review writes, using the isolated synthetic bunnywell-workspace-stage2 backend.

This uses the accepted full-page interface, not the /dev/building-workspace-contracts technical demonstration. The accepted /dev/sales-workspace prototype remains unchanged on experiment/sales-workspace-redesign at 1df4bac80588491bc3fba47966c9854fb33b4c10. All 12 recorded design source/asset hashes still match both copies.

## Start and sign in

With Docker Desktop's Linux engine running:

~~~powershell
Set-Location 'C:\Users\carlg\.codex\worktrees\building-workspace-contracts\Bunnywell_Portal'
./scripts/building-workspace-local/start.ps1
~~~

The launcher verifies local isolation, preserves the existing database and starts hidden UI/gateway processes. It never replays the schema or reseeds. Use port **3031**, not the internal UI port 3032. Do not run a plain npm dev command for this connected delivery: the launcher sets the exact local environment and server guard.

- Conveyancer: **bw-stage2-conveyancer@example.invalid**
- Developer: **bw-stage2-developer@example.invalid**
- Shared synthetic test password: Git-ignored **local-runtime/test-access.json**, property **password**.

Sessions last 30 minutes; sign out and back in when necessary. Different browser tabs have separate session/building context. Test credentials and local runtime keys are not committed.

## Try the complete document review

Choose **Willow Court → Sales → CR01 → Completion**. CR01 was left empty for manual review; completed automated-test records have names beginning with T. The original G11 fixtures are preserved.

Sample files are in **artifacts/building-workspace-stage2/completion-review/review-files/**:

1. Sign in as conveyancer. In Completion statement, choose **completion-v1.pdf**, then **Upload document**.
2. Sign out; sign in as developer. Open the same CR01 sale, view the document and **Raise query**, entering a reason.
3. Sign out; sign in as conveyancer. The heading is **Resolve the query**. Upload **completion-v2.pdf** in the queried statement's card.
4. Sign out; sign in as developer. **Approve document**, then confirm the building, unit and version.
5. Optionally upload/review **statement-of-account.pdf** in the separate Statement of account card. Both approvals are independent.

Comments can be added by both roles. Activity and version history show persisted actions and actors. Expand **Recorded document versions** to see the original version/query and open either version. Approved documents stay locked under existing rules.

Successful document mutations refresh the current building's worklist/dashboard snapshot. Another already-open session needs a page/workspace refresh to see another user's changes; there is no new realtime subscription. Comments reload on view/navigation/reload; there are no read-receipt or mention writes.

This completes document review, **not legal completion**: Confirm legal completion remains disabled. The existing transaction moves the sale to completion_pending when both documents are approved.

For repeat automated cycles, the setup below creates a new fictional test record without unlocking or overwriting existing sales:

~~~powershell
node scripts/building-workspace-local/prepare-completion-review.mjs --test
node scripts/building-workspace-local/completion-journey.mjs
node scripts/building-workspace-local/completion-additional-checks.mjs
node scripts/building-workspace-local/completion-navigation-checks.mjs
~~~

The setup without --test creates CR01 only if absent and generates the sample PDFs. It never resets CR01. Setup validates isolation before creating a private bucket or synthetic record.

## Connected and unavailable

Connected:
- Authenticated profile/access, building selection, scoped dashboard counts and sales worklist.
- Exact building/unit/sale-attempt full-page Completion, milestones, dates and current/previous document metadata.
- Completion statement and statement-of-account PDF uploads/replacements, private viewing, queries and approvals.
- Plain comments and paginated role-safe Activity, using existing discussion permissions and actor attribution.

Explicitly unavailable:
- Email bodies/delivery history, correspondence file UI and the other detailed sale workspaces.
- Legal completion recording, authority/notice sending, payments, other business actions, mention notifications, read receipts, comment edits/replies/assignments.
- The existing sale-file handoff, which is not opened or prefetched. Legacy opening paths can write state.

No sample buyer, comment or document is substituted into a connected record. Earlier G11 document fixtures have metadata only; unavailable file bodies are reported clearly.

## Business logic and isolation

The development-only adapter delegates to the existing legal POST, upload preparation/finalisation helpers, sales_legal_action and sales_completion_upload_session functions. Comment writes and timeline reads use existing sale_comment_write, sale_comment_page and sale_activity_page functions; private file links use the existing document signer and discussion access checks. Existing transaction validation, roles, locks, stale-version checks and workflow/activity writes remain authoritative.

No production endpoint, migration, RLS policy, authentication rule or workflow definition changed. The shared resumable-upload client gained an optional local transport; its default production transport and existing regression tests are retained.

Only the named local project and loopback API are permitted. Data services remain on the dedicated internal Docker network, with a credential-free ingress relay whose external default route is removed. Browser CSP, the gateway allowlist, a server fetch guard and exact environment checks restrict the connected UI. Auth uses local mail capture; public signup and outbound integrations remain disabled. No remote business environment was contacted.

Existing read-only setup replayed the initial schema and 70 recorded migrations, including local enum prerequisites omitted by the bootstrap. This delivery reuses that database; it adds no schema migration. It creates the missing private sale-documents bucket with the existing PDF/10 MiB settings and new fictional review records. The earlier schema-baseline gap and remote parity assessment remain outstanding for the later review.

## Validation

See **docs/workspace-checkpoints/2026-11-11-completion-review.md** for the current tests, performance evidence and limits. Current results are under **artifacts/building-workspace-stage2/completion-review/**. These are real authenticated workflow tests against synthetic local data, not fixture-only UI simulations or staging/production tests.

The earlier read-only checkpoint and 6 November results remain recorded in **docs/workspace-checkpoints/2026-11-11.md** and the original Stage 2 artifacts. Those historical test totals are not counted as newly executed results.

Next sequence: wider Dashboard, Sales, Snags, Buildings and Setup structure, then the comprehensive database/API review. Reuse the capability/location, data-loading and information-architecture groundwork listed in the earlier checkpoint. No broad visual redesign, merge, push or deployment.
