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

`20261007133421_completion_document_review.sql` changes four existing PostgreSQL functions. It adds no tables or columns, rewrites no stored rows, and retains historical package approval records. Existing role checks, grants, sale locking, upload idempotency and version/audit immutability remain in place.

A function migration is necessary because the existing database requires a joint package approval, explicitly rejects individual reviews, and allows ordinary uploads to replace approved files. The existing upload capability was not a separate deliberate reopening workflow. This change exposes no reopening action. Retired shared-review endpoints ask callers to reload and review each document separately.

The function migration was applied to **Bunnywell Portal Staging** (`vxkpvdtrldwwqiddoyof`) after explicit approval on 7 October 2026. Its recorded migration version is `20261007133421`; the repository filename matches that version. Production was not changed. Merge this PR into `staging` to release the matching UI: the old shared-review client and the new individual-review client use different actions.

## Verification on 7 October 2026

- 278 sales tests passed, including PostgreSQL journeys A–F, stale-version and role/access checks, immutable history, idempotent retries, and approval during an in-flight replacement.
- 38 refresh tests passed. New approve/query actions refresh the affected documents and workflow state.
- All 23 legal-workflow and stage-task browser scenarios passed across the suite and focused reruns after updating legacy fixtures. The new scenario covers independent query/approval/replacement, submitted input removal, cancellation, version history, locked approved cards and legal-completion gating. Layout checks cover desktop/tablet/mobile widths.
- Typecheck, lint of changed TypeScript files, and production build passed. The build needed network access for the existing Google Fonts.
- The deployed branch preview was checked against staging data using the existing conveyancer and admin reviewer accounts. The initial read-only check confirmed two cards, compact summary, card-local query expansion/cancellation, replacement visibility and no mobile overflow.
- After migration application, all live staging journeys A–F passed on the dedicated synthetic sales `UPLOAD-1` and `UPLOAD-2` in `E2E Completion Upload 2026-09-22`. Browser actions used the real preview API, resumable Storage upload and staging database. Database reads verified current versions, approval actors/timestamps, and version-linked query audit records.
- A: uploading and approving both files independently locked both cards and made legal completion available.
- B/C: querying only the statement left the account awaiting approval; submission controls cleared. Replacement returned the statement to awaiting approval and retained the old query, actor and time only in version history.
- D/E/F: replacement without a query succeeded. Account-only approval locked that card and kept legal completion locked. Subsequent statement queries/replacements preserved the account's exact version, approval actor and timestamp.
- Both synthetic sales ended with both documents approved and all previous history retained. No legal completion was recorded and no emails were sent. Live review used the existing admin reviewer; developer-role enforcement was covered by the PostgreSQL/browser fixture tests.
- The 15 focused completion database/upload tests passed again after matching the local migration filename to staging's recorded version. The four functions retain their previous execution grants; none are anonymously callable, and upload functions remain service-only.

The live runner is `scripts/diagnostics/completion-document-review.mjs`, with explicit staging and branch-preview guards. It preserves its evidence under `test-results/completion-document-review-staging/`. It intentionally refuses to repeat approvals against already locked fixtures; do not unlock existing files just to repeat the test. The verified application commit was `6c8f35e4ceef4794f59b9d76c648d7646ec1b9c9`; subsequent changes only record verification, add this diagnostic, and align the migration filename/test reference.
