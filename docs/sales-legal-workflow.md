# Building sales contacts and legal workflow

Implemented 22 September 2026. The existing Reservation → Exchange → Completion → Handover journey remains in place. Exchange and Completion now contain chronological steps with recorded instructions, approvals, confirmations and document versions.

## Schema and migration

`supabase/migrations/20260922_sales_legal_workflow.sql` adds:

- `organisations.shared_system_email`, with database email-format validation. The existing `conveyancer` and `sales_agent` organisation types are reused.
- Nullable building references `conveyancer_organisation_id` and `sales_agent_organisation_id`, plus `seller_name` and `completion_information`. Type guards prevent selecting an incompatible organisation or changing a selected organisation to an incompatible type.
- Sale fields for the authority request, confirmed contractual completion date, optional notice/confirmation issue date, actual legal completion timestamp and confirming user.
- `unit_sale_documents.approved_version_id` and a `completion_correspondence` document type.
- `sale_legal_emails`, containing immutable rendered messages and sale/organisation snapshots, version numbers, approver, sender, To/CC, expiry, and controlled delivery, revocation, replacement and exchange state.
- RLS, access-checked transactional functions, guards against bypassing legal confirmations or editing authorised terms, and extensions to the existing audit/activity projection.

Apply the migration once, after the repository's existing sales, commercial-allocation, actor-attribution and discussion migrations. It runs in a transaction. It does not assign contacts, manufacture historic authorities, change old sale dates, or backfill old statement approvals to an assumed document version. Existing completed sales retain their recorded date; the UI explicitly says when the historical time is unknown.

The migration has been executed repeatedly in isolated PGlite PostgreSQL test databases, including the existing discussion triggers and protected unit transition functions. It has **not** been applied to the deployed Supabase project: this workspace has no configured SQL migration connection/tooling. Applying it to the development project and then production remains a rollout step. No deployment, push, live message send or production-data change was performed.

## Building and organisation UI

Organisation create, edit and detail views show the shared system email. Sales contacts appears beside Sales setup on the building page, with filtered organisation selectors, the selected shared inbox, missing-email guidance and an organisation settings link. Either reference can be cleared.

The seller/SPV field was added because the existing building and sale models did not provide an authoritative legal seller. Set it explicitly before sending instructions. Completion information is optional and is included in the reviewed authority. Existing approved buyer, price, fee, deposits, contributions, parking, payment schedule and special conditions populate the authority without re-entry.

Building contact changes update references only. Existing user/organisation access allocations remain authoritative for access. Selecting an organisation never grants its members building access. Contact and shared-email changes are audited.

## Email routing and delivery

`src/lib/sales/legal-workflow.ts` supplies recipient resolution, structured terms and message rendering for both actions. The database revalidates the selected recipients when saving the instruction.

| Instruction | To | CC |
| --- | --- | --- |
| Authority to exchange | Building conveyancer's shared inbox | Building sales agent's shared inbox, if configured |
| Completion arrangements | Building conveyancer's shared inbox | None |

Individual users and legacy sale-level contacts are not fallback recipients. Missing conveyancer details block sending with a route to settings. Changes affect new instructions; historical records and retries retain the original exact addresses and organisation identities.

The final preview shows sender, To, CC, subject, full body, building, plot and buyer. A server signature binds approval to the current terms, recipients, sender and selected date. Changes require a fresh preview; database locking also checks for concurrent edits before saving.

Configure the existing Supabase server environment plus `RESEND_API_KEY`. The sender uses `SALES_FROM_EMAIL`, falling back to `DIGEST_FROM_EMAIL`, then `Bunnywell Portal <no-reply@bunnywell.co.uk>`; configure a verified sender for the target environment. Legal sending is blocked when `DIGEST_DRY_RUN_EMAIL` is set. No invoice-payment emails were added.

Emails use the existing Resend HTTP infrastructure. Each saved instruction has one idempotency key, a two-minute dispatch lease and a conservative 23-hour retry window. Resend documents a 24-hour idempotency-key lifetime: <https://resend.com/changelog/idempotency-keys>. Retries resend the saved payload, not current organisation data. An uncertain result remains visible for reconciliation; it does not silently become issued authority. After the retry window, inspect Resend before revoking/cancelling and issuing a new instruction. Cancelling a portal instruction cannot recall an email already delivered.

The saved Resend message ID and delivery status appear in email history. Authorised developer users can refresh delivery status; retrieving status needs a Resend API key with email-read access. Delivery updates are manually refreshed rather than webhook-driven. This workspace has no Resend key, so automated tests mock the provider and no live deliverability check has been performed.

## Workflow and permissions

| Existing role | Legal workflow actions |
| --- | --- |
| Sales agent | Request exchange authority |
| Conveyancer | Request authority; confirm exchange; confirm contractual completion arrangements; upload legal documents; confirm legal completion |
| Developer/admin | Issue, revoke or reissue authority; send completion instructions; approve or query a particular statement version |
| Other users with existing sale access | Read-only |

UI checks are backed by API checks and database role/access checks. The old checkbox-style exchange and completion API actions are retired. The database prevents direct legal-state/document writes from bypassing the new workflow, including service-backed legacy routes.

Authority requests use the existing discussion/mention notification system to notify developers/admins with sale access. A request itself grants no authority. Developer issue requires an approved reservation, reviewed terms, a legal seller, valid routing and a future expiry. The default expiry is 48 hours from preview preparation; the exact value is reviewed before issue. The developer can change it. Inputs use the operator's local time; saved timestamps are absolute and displayed in Europe/London time in email/history.

Authorised terms are locked while an authority is live or sending and permanently after exchange. Reissue creates a new version; successful sending marks the previous authority replaced. Revocation retains its reason and history. Expiry blocks exchange immediately; its activity entry is projected once on the next sale read and dated at the actual expiry time. Conveyancers record the actual exchange date and confirm deposit receipt. The existing post-exchange unit transition is reused.

Completion remains neutral about fixed dates versus notice. A developer proposes a date and sends instructions; the conveyancer confirms the contractual date and may record a notice/confirmation date and upload correspondence. Statement approval names a specific current version. Query/rejection requires comments; a replacement resets approval atomically. Legal completion requires the confirmed contractual date and approval of the current statement, then records the conveyancer and actual date/time. That confirmation enables the existing handover path; other established requirements, including practical completion, still apply. Agent invoices and payments are not prerequisites. Final statements of account can be uploaded after completion.

Uploads reuse the styled reservation PDF surface with drag/drop, selected-file state, view/replace actions and version history. The server checks PDF type/header and a 10 MB limit. Failed document registration removes the newly uploaded object without changing prior approvals.

## Validation

- `npm run build`: passed, including the production TypeScript check.
- `npx tsc --noEmit`: passed.
- `npm run test:sales`: 217 passed, covering routing/validation, real PostgreSQL migration execution, RLS and role enforcement, immutable history, stale previews, provider retry idempotency, expiry/reissue, version approvals, completion gates and existing sales behavior.
- `node --test tests/sales-discussion.test.mjs tests/sales-actor-access.test.mjs`: 20 passed.
- Chromium browser coverage: 23 distinct tests passed across `sales-legal-workflow`, `sales-contacts`, `sales-stage-tasks`, `sales-actor-names`, `sales-loading` and `sales-discussion` specs. The final focused run of the first four files passed all 13 tests. Browser tests use synthetic records and intercepted backend calls; API/database behavior is separately exercised by the integration tests.
- Desktop/mobile previews were inspected, including layout checks at 1440, 1100, 768 and 390 pixels.
- Full ESLint was run: 22 existing errors and 27 warnings remain; changed-file comparison against HEAD found no new errors or warnings. New implementation/test files pass lint. See `artifacts/legal-workflow-lint-comparison.json` and the validation logs in `artifacts/`.

## Assumptions and Herrington Carmichael confirmations

Existing active developer/admin roles represent authorised developer approvers; no new legal permission group has been created. The authority request is a notification and is not a mandatory prerequisite for an authorised developer to issue authority. Existing commercial amendment/approval rules remain in place; this change does not add a new amendment editor. Historic completions continue to support their existing handover path without inventing a legal timestamp or retrospective authority.

Before rollout, confirm with Herrington Carmichael:

1. The correct legal seller/SPV per building and which named developer users can authorise exchange and completion instructions.
2. Whether each contract uses fixed-date completion, completion on notice or another mechanism, and the required contractual steps/correspondence. The portal currently leaves that determination to the conveyancer.
3. The authority wording, default 48-hour expiry and treatment of material amendments, revocation and reissue. Revocation is recorded in the portal; it does not send an automatic revocation email, so an agreed process for notifying the conveyancer is needed.
4. The process when exchange occurred before expiry but is reported after it. The current system requires authority still to be unexpired at confirmation and does not allow backdating around that check.
5. Whether the displayed reservation-fee/deposit treatment, incentives, parking and special-terms summary captures all contract-specific requirements.
6. What evidence and checks are required for completion-statement approval, legal-completion confirmation and release of keys, including whether final accounts need any additional review.

For rollout, apply the migration to development, configure organisation inboxes and building contacts/sellers explicitly, configure the verified Resend sender, and exercise the real Supabase/PostgREST/storage and email path with the intended roles before promoting the same migration and application build.
