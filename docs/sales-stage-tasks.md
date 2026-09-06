# Sales progression task steps

Implemented on the local `staging` branch, 6 September 2026. These changes have not been committed or deployed.

## What changed

Previously, Exchange alone rendered numbered tasks. Reservation already had structured submission/approval history, and Completion had upload, query, approval and recording actions, but neither displayed its task sequence. Completion readiness also accepted `completion_pending` without checking the current documents, and query reasons were not displayed in the activity history.

All three stages now use `SalesStageTasks`, based on Exchange's existing green, amber and neutral cards. Reservation has **Record reservation → Approve reservation**; Exchange retains **Confirm commercial terms → Record exchange**; Completion has **Upload completion documents → Review completion documents → Record completion**. Completed cards remain above the stage outcome. Missing actor identities are omitted from task cards rather than replaced with the current user.

Completion displays the appropriate active workspace. Review actions appear once both current documents are available, and recording controls appear only after approval. Querying returns work to the solicitor with a visible persisted reason. Document version history and the complete activity history remain available.

The cards respond to their container width: one column below 30rem, two columns from 30rem, and three Completion columns from 48rem. In the middle layout the third Completion card spans both columns. The sale-file container and PDF filename wrapping were also corrected to prevent mobile overflow.

## Persisted state rules

| Step | Rule |
|---|---|
| Reservation: Record | Complete for a persisted submitted/awaiting-approval or approved workflow state; Current for an unsubmitted draft; Changes required after rejection. Populated form fields do not count as submission. |
| Reservation: Approve | Current for `awaiting_approval` or legacy `reservation_submitted`; Complete for `approved`, `reservation_approved`, `awaiting_commercial_approval`, `ready_for_exchange`, `exchanged`, `completion_pending`, or `completed`; otherwise Locked. `fallen_through` remains a failed/ended reservation. |
| Exchange: Confirm terms | Existing rule retained: `ready_for_exchange` or a persisted `commercial_approved_at`. Before Reservation approval the step is Locked. |
| Exchange: Record | Existing rule retained: `exchanged`, `completion_pending`, `completed`, or persisted `exchanged_at`. Becomes Current only after commercial confirmation. |
| Completion: Upload | Both `completion_statement` and `statement_of_account` must have non-redacted, current persisted versions and active document records. One document, a local File selection, a superseded record or an old version is insufficient. An unresolved query changes the task to Changes required. |
| Completion: Review | Complete only when both current documents have `status = approved`. Where an approval timestamp exists, it must not predate the current upload. Uploaded documents alone cannot count as approval. An unresolved query shows Awaiting resubmission. |
| Completion: Record | Current only after Exchange and current-document approval; Complete only for persisted `completed` or `completed_at`. Entering an unsaved completion date does not advance the task. The API additionally requires `completion_pending` and checks the current documents before recording completion. |

Fully approved Reservation shows **Stage outcome / Approval record**. Recorded Exchange and Completion show **Stage outcome / Exchange recorded** and **Stage outcome / Completion recorded**. Otherwise the heading follows the active task, including returning to upload after a query. Handover, financial calculations and commercial terms retain their existing behaviour.

## Completion rejection and resubmission

The existing `query_completion_documents` action is exposed as **Reject / query documents**, alongside **Approve completion documents**. A reason is required.

The server persists `query_raised` and `query_note` on the document pack, clears approval metadata, retains the shared sale-file note, and records `completion_documents_query_raised` with the actor, time and reason. The stage remains `exchanged`; recording stays locked.

The latest query timestamp is compared with the latest required current upload. At least one corrected/relevant document must be successfully uploaded after that query before review resumes. Since the query concerns the pack, an unchanged companion document does not have to be uploaded again unnecessarily. The developer must then approve the whole current pack explicitly. Another query requires another replacement.

Replacement uses the existing upload/versioning action. It clears the replaced document's approval metadata and preserves earlier versions. Replacing a document never approves it. Both the UI and API use the same completion-document checks; a stale overall `completion_pending` value cannot bypass them. The original query stays visible during re-review and remains in Activity after completion, even after current document query notes are cleared.

## Permissions

Existing role and building-access rules are preserved; no new roles or permissions were introduced.

| Action | External role | Existing internal access |
|---|---|---|
| Record/resubmit Reservation | `sales_agent` | `developer`, `admin` |
| Approve/reject Reservation | None | `developer`, `admin` |
| Upload/replace Completion documents | `conveyancer` (Solicitor in the task cards) | `developer`, `admin` |
| Approve/reject Completion documents | None | `developer`, `admin` |
| Record Completion | `conveyancer` | `developer`, `admin` |

External users remain restricted to buildings assigned directly or through their organisation. Sales agents cannot review Completion documents or record Completion; conveyancers cannot approve/reject Reservation or Completion documents. Other roles have no access to these actions.

## Audit sources

| Task | Completing-user source |
|---|---|
| Record Reservation | `reservation_submitted_by_name`, `reservation_submitted_by_email`, `reservation_submitted_by_user_id`, resolved using the existing historical identity helper. |
| Approve Reservation | Corresponding `reservation_approved_by_*` snapshot/profile fields. |
| Confirm commercial terms | Latest `commercial_package_approved` event's `created_by_user_id`, falling back to `commercial_approved_by_user_id`. |
| Record Exchange | Latest `exchange_recorded` event's `created_by_user_id`. |
| Upload Completion documents | `uploaded_by_user_id` on the most recently uploaded required current version, once both required documents exist. |
| Review Completion documents | Latest `completion_documents_approved` event, falling back to the document approval user fields. |
| Record Completion | Latest `completion_recorded` event's `created_by_user_id`. |

Events are ordered by their persisted timestamps. Profile names/emails resolve stored user IDs; UUIDs and guessed current-user identities are not displayed as names. Legacy records without a resolvable actor keep the step but omit the `by` line. Reservation rejection metadata, Completion query metadata, approval history and document versions use the existing schema; **no SQL migration is required**.

## Changed files

- `src/components/portal/sales/SalesStageTasks.tsx` and `.module.css`: shared numbered cards and container-based layout.
- `src/lib/sales/stage-tasks.ts`: task states and shared Completion document validation.
- `src/components/portal/sales/SalesReservationWorkflow.tsx`: three-stage integration, active workspaces, attribution, query/version history and mobile containment.
- `src/app/api/sales/reservations/route.ts`: current-document checks, query/resubmission guards and approval invalidation on replacement.
- `tests/sales-stage-tasks.test.mjs`: milestone, identity, stale-data and permission tests.
- `tests/sales-completion-workflow.test.mjs` and `tests/helpers/load-typescript-module.mjs`: actual server action tests using an in-memory database adapter.
- `tests/sales-stage-tasks.spec.ts`: browser tests for saved states, refresh, rejection/resubmission, role-sensitive controls and responsive layout.
- `tests/sales-exchange-sequence.test.mjs`: existing assertions updated for the shared component.
- `package.json`: includes the new state/server tests in `test:sales`.
- This report.

## Validation

- `npm run test:sales`: **199 passed**.
- `npx playwright test tests/sales-stage-tasks.spec.ts --reporter=line`: **3 passed**, including state transitions/reloads and 1440, 1100, 768 and 390px layouts. Ran against the production build on localhost:3012 with all Supabase and API responses intercepted as synthetic fixtures.
- `npx tsc --noEmit`: passed; the final production build also completed TypeScript checking.
- `npm run build`: passed. Network access was needed for the application's existing Google Fonts downloads.
- ESLint for new source/test files and the updated Exchange test: passed.
- `npm run lint`: existing repository baseline remains **22 errors and 28 warnings**. Comparing the edited existing production files against HEAD produced identical rule counts: the workflow retains four existing `react-hooks/set-state-in-effect` errors and two warnings; the route retains one unused-variable warning. No new lint findings remain in these changes.

Server tests execute the real action functions with fake database/storage adapters, including query → replacement → fresh approval → recording, audit retention, stale approval rejection, role restrictions and building access. Browser tests exercise the rendered application using stored fixture snapshots; no live staging or production sale records were changed. A live database migration/rehearsal was not required for this UI/API change.
