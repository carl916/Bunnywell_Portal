# Sales access and actor attribution

The final SQL to run is [20260908b_sale_actor_names.sql](../supabase/migrations/20260908b_sale_actor_names.sql). Its complete contents replace the earlier, unrun proposal. Run the file from `begin` through `commit` in Supabase SQL Editor, alongside this application release. It requires the existing Sales schema and the September 7 discussion/activity migrations. It works both with and without the September 8 building-agent discussion patch. No live migration was applied during this change.

## Access model

Core Sales already used building access. The original discussion implementation additionally required individual `sale_participants` rows for agents/conveyancers. A later patch bypassed assignments for those roles but retained the obsolete controls, helper structure and denial message. `sale_discussion_candidate` itself checked active accounts, Sales roles and building eligibility; the assignment requirement was in `sale_discussion_access`.

The final database rule is `sales_building_access(building, user)`: active admins/developers retain their existing access; active agents/conveyancers require direct building access or a matching organisation/building role with active access. It preserves the existing core Sales interpretation of a null organisation-building `active` value. `can_access_sales_building`, `can_access_sale_attempt`, discussions, comments, mentions and the actor resolver all delegate to this rule. No sale activity or assignment is required, including for completed and archived attempts.

`can_access_sale(sale, user)` is the general sale helper. `sale_discussion_candidate` and `sale_discussion_access` remain as compatibility wrappers with no separate eligibility logic. Explicit-user helpers are callable only by trusted database functions/service role; browser entry points obtain the requester from `auth.uid()`.

Workflow action guards and commercial write policies are unchanged. Building access does not grant reservation/commercial/completion approval rights to an agent or conveyancer. Comment writes still derive authorship from the session, retain revisions, validate mentions and restrict editing to the original author with current access.

## Why Completion displayed Unknown user

The code path was:

1. `SalesReservationWorkflow.loadSalesData` calls `sale_workflow_context` and `sale_actor_names` for the loaded sale IDs.
2. The actor-name function was not installed, so the supplemental name list was unavailable. The existing load-error handling keeps Sales data visible and reports the missing migration.
3. Completion used the event's `created_by_user_id` to search the profiles already visible to the browser. Profile RLS does not guarantee visibility of every historical actor, particularly someone with no remaining shared building or organisation access.
4. `sale_workflow_context` already returns `actor_name` from an event snapshot or a limited server lookup, but the Completion UI's event type and label code ignored that field.

The current write paths store approval IDs on `unit_sale_documents.approved_by_user_id`; the document activity trigger also records `unit_sale_workflow_events.created_by_user_id`. Completion recording writes a `completion_recorded` event with `created_by_user_id`. `unit_sale_attempts.completed_at` is a date, not the completion actor; its mutable `updated_by_user_id` must not be substituted for that historical actor. There is no dedicated `completed_by_user_id` on the attempt in this schema.

No live sale ID/row or screenshot was supplied for this change, and production data was not queried. The missing resolver and ignored workflow name are verified code-path defects, not proof that every affected production row contains an actor ID. No actor backfill or attribution to the current viewer is performed.

## Resolution and field inventory

The resolver returns only `{ id, display_name }`, preferring trimmed non-empty `full_name`, then `name`, then `Unknown user`. It does not return email, role, organisation or a full profile. It accepts sale IDs only, checks the requester's sale access and never requires a historical actor to remain active, in the same role, assigned or on the building.

It explicitly reads these finite attribution fields rather than scanning JSON key suffixes:

| Record | Actor columns used |
| --- | --- |
| `unit_sale_attempts` | `created_by_user_id`, `updated_by_user_id`, `reservation_submitted_by_user_id`, `reservation_approved_by_user_id`, `reservation_rejected_by_user_id`, `commercial_approved_by_user_id`, `redacted_by_user_id` |
| Visible `unit_sale_workflow_events` | `created_by_user_id`; the existing event projection controls visibility |
| Visible `unit_sale_documents` | `created_by_user_id`, `updated_by_user_id`, `approved_by_user_id`, `redacted_by_user_id` |
| Versions of visible documents | `uploaded_by_user_id`, `redacted_by_user_id`, including historical versions |
| `sale_comments` | `author_id` — this does **not** match the old suffix rule |
| `unit_sale_invoices` | `created_by_user_id`, `updated_by_user_id`, `approved_by_user_id` |
| `unit_sale_invoice_payments` | `recorded_by_user_id`, `voided_by_user_id` |
| Visible `unit_sale_notes` | `created_by_user_id`, `redacted_by_user_id` |

Document/note visibility follows their existing read policies. Event actors are restricted to events the viewer may see, avoiding the original proposal's scan of internal workflow events. Arbitrary metadata, mention recipients, read receipts, assignment rows, buyer/solicitor free text and organisation IDs are not actor sources. Terms and payment schedules retain their existing audit IDs; no additional resolver source is needed for their current UI because commercial approval is attributed through the attempt/event. No audit columns, rows or timestamps are changed.

Completion, Exchange and commercial stage labels now prefer a workflow name associated with a stored actor ID, then the limited name lookup. Completion approval also retains its document-approver fallback. A completion event with no actor ID, or an unavailable referenced profile without a recorded name, displays `Unknown user`. Current viewer identity is never used as a fallback.

Historical role/organisation labels continue to come from event/comment snapshots. The resolver supplies neither. Payment attribution uses the payment's organisation snapshot and no longer substitutes the actor's current organisation. The live mention picker still uses current role/organisation to help identify eligible recipients; it is not historical attribution.

## Obsolete assignment structures

The Sale participants UI and assignment RPC are removed. The migration drops `sale_discussion_creator` / `sale_discussion_submitter` triggers and their `assign_sale_creator` / `assign_sale_submitter` functions. No new assignments are written.

`sale_participants`, its indexes and its read policy remain to preserve historical assignment rows; authenticated access is revoked. No current access rule, UI or write function needs the table. It is safe for current application behaviour to remove in a later cleanup, but doing so deletes assignment history: retain/export that history first if wanted. No `CASCADE` or table deletion is part of this migration. Historical `sale_participant_changed` audit events remain untouched.

The compatibility wrappers and unused optional `sale_discussion_people.p_candidates` argument can be removed in a future coordinated API cleanup. The latter is ignored and no longer returns assignment state. They do not create an alternative access rule.

## Verification

`tests/sales-actor-access.test.mjs` executes the replacement migration in PGlite/PostgreSQL, including RLS, function privileges and security-definer bodies. It tests both migration upgrade paths, repeat application, every sale in a building without assignment rows, stale/revoked assignment irrelevance, wrong-building/wrong-role denial, private-helper impersonation attempts, comments, historical names, inactive/changed-role actors, document version/comment/payment/note authors, hidden records, injected metadata, unrelated sale/profile IDs, null IDs and minimal resolver output.

`tests/sales-actor-names.spec.ts` checks the rendered Approved by / Completed by values for both external roles when the historical profiles are absent, document-only approval fallback, workflow snapshots, null-ID Unknown user and removal of participant controls. Existing discussion and workflow tests cover comment author/revision preservation, building revocation and unchanged role-specific workflow actions.

The test databases and browser sessions use synthetic data. They do not establish the contents of the user's live completed sale or validate a deployed Supabase/PostgREST schema cache.

Final verification: all 211 tests in `npm run test:sales` passed; the 15 existing discussion cases passed; all 14 selected Playwright tests (actor names, discussions, stage tasks and loading) passed. TypeScript and `git diff --check` passed. Changed helpers, conversation code and tests pass ESLint. `SalesReservationWorkflow.tsx` retains the same four lint errors and two warnings as HEAD, verified by linting both versions; no new lint findings were introduced.
