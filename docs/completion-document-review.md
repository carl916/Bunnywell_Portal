# Completion document review

Section 4 owns the completion statement and draft statement of account cards, including file actions, independent review, and version history. Section 5 only summarises their statuses and approval actors/times. Stored document type names are unchanged; approved card headings omit “Draft”.

## State and history

- Approve/query requests identify one document type and its exact current version. A stale version, wrong role or inaccessible sale is rejected.
- Approval records the existing `approved_version_id`, `approved_by_user_id` and `approved_at` fields. Approval and query events use the existing immutable workflow events, with the actor snapshot and version ID.
- An unapproved file can be replaced with or without a query. Only that document returns to `uploaded` (displayed as “Awaiting approval”); the other document is untouched.
- Replacements retain all versions and events. Queries display on the relevant old version in “Previous versions”; they are cleared from the replacement's current document state.
- An approved document is locked against normal replacement and querying, both in the UI and database. Upload preparation and finalisation both check the lock. An approval received during an in-flight replacement prevents publication of that replacement.
- Legal completion requires both current versions to be individually approved. Each version ID must match its document's approved version ID.

## Database and rollout

`20261007123456_completion_document_review.sql` changes four existing PostgreSQL functions. It adds no tables or columns, rewrites no stored rows, and retains historical package approval records. Existing role checks, grants, sale locking, upload idempotency and version/audit immutability remain in place.

A function migration is necessary because the existing database requires a joint package approval, explicitly rejects individual reviews, and allows ordinary uploads to replace approved files. The existing upload capability was not a separate deliberate reopening workflow. This change exposes no reopening action. Retired shared-review endpoints ask callers to reload and review each document separately.

Apply the function migration and release this branch together: the existing shared-review client and the new individual-review client use different actions. The PR targets `staging`; production is outside this rollout.

## Verification on 7 October 2026

- 278 sales tests passed, including PostgreSQL journeys A–F, stale-version and role/access checks, immutable history, idempotent retries, and approval during an in-flight replacement.
- 38 refresh tests passed. New approve/query actions refresh the affected documents and workflow state.
- All 23 legal-workflow and stage-task browser scenarios passed across the suite and focused reruns after updating legacy fixtures. The new scenario covers independent query/approval/replacement, submitted input removal, cancellation, version history, locked approved cards and legal-completion gating. Layout checks cover desktop/tablet/mobile widths.
- Typecheck, lint of changed TypeScript files, and production build passed. The build needed network access for the existing Google Fonts.
- The deployed branch preview was checked against staging data in read-only mode using the existing conveyancer and admin reviewer accounts. Two cards, compact summary, card-local query expansion/cancellation, replacement visibility and mobile overflow checks passed. No documents were mutated.
- Live staging journeys A–F are **pending**. Automatic approval review rejected applying the persistent database-function migration without explicit execution approval. The migration has not been applied to staging or production.

The exact current versions and role-specific actions were exercised against the real PostgreSQL functions locally (PGlite). Browser scenario tests use controlled API fixtures; the read-only preview check uses the live staging API. These checks do not substitute for the pending live staging mutations.
