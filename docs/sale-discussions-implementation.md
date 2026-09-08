# Sale comments and activity

Implemented 7 September 2026. No commits, deployment, live database migrations, live customer records or real notification/email delivery were performed.

## Delivered behaviour

The selected sale file has one persistent Comments / Activity panel, outside the lifecycle and workspace switches. The heading and buyer/price/stage summary remain full width. The selected file can use up to 1,680px of the portal; other screens keep their previous width. Comments intent is default, explicitly open or explicitly closed. Default Comments appear inline when there is room and collapse quietly when there is not; only explicit intent opens a drawer at narrow widths. Closing remains effective through workspace switches and resizing. The expanded Commercial editor retains its existing two-thirds inputs and one-third stacked preview/impact layout.

## Responsive layout refinement — 7 September 2026

The previous implementation combined automatic desktop visibility and explicit opening in one boolean. It used different outer-width thresholds for Commercial (1,360px) and other workspaces (1,240px), so a tab switch could create a modal and move focus. The modal's body scroll lock could also change the root scrollbar width, feeding back into the ResizeObserver decision; no deadband separated collapse from restore. Commercial independently used Tailwind's viewport `xl:grid-cols-3`, verified to change from three columns to one between 1,280px and 1,279px despite more than 1,100px of available grid width.

The layout now measures the full outer container with inline-size containment, independent of its children. CSS defines the shared dimensional budget for every workspace: 866px main content (three 264px cards, two 16px card gaps, 42px Commercial padding/borders), a 320px minimum rail, and a 12px rail gap. The rail expands to 360px when room permits. Collapse occurs below 1,198px of outer content, and restore requires 1,238px. In the tested Chromium layout with a 15px reserved scrollbar gutter, these correspond to approximately 1,319px and 1,359px viewport widths. Fresh visits within this band use the available space; previously collapsed layouts wait for the restore threshold. No viewport threshold is encoded in the hook.

The selected sale file reserves its scrollbar gutter above mobile width so body scroll locking and changes in document height leave the measured width stable. The observer updates React only when inline availability changes. Modal focus and background inertness run only for an explicitly opened drawer. Escape restores the previous visible control, or the Comments button if that control has become hidden.

Commercial uses its own named content container with `minmax(0, 1fr)` tracks: three compact cards from 824px of grid width, two roomier cards from 640px, and one below that. These thresholds allow long labels to wrap while monetary values remain intact. They are intentionally independent of the Comments threshold. Closing or collapsing the rail gives the grid more room without triggering a viewport-driven column collapse.

Responsive checks use synthetic data, including seven-digit prices, and no live database. All 13 requested viewport widths were exercised: 1600, 1465, 1440, 1366, 1320, 1280, 1279, 1200, 1100, 1024, 900, 768 and 390. The tested result is inline Comments and three cards down through 1320px when narrowing; collapsed Comments and three cards from 1280px through 1024px; two cards at 900px; one at 768px and 390px. Both 1280px and 1279px retain three columns, with less than one pixel change per card. One-pixel sweeps and 1–5px reversals cover collapse, restore and both card-grid thresholds. Tests track presentation mutations, reject ResizeObserver errors, and check overflow, focus, explicit intent, drafts and unsaved Commercial values.

Validation for this refinement: five new responsive Playwright tests passed against both development and production builds; the ten existing discussion/editor browser tests passed; all 205 sales tests passed; TypeScript and the production build passed. New discussion/test code has no ESLint findings. The existing workflow component retains its previous four errors and two warnings. Screenshots for all requested widths are in the responsive Playwright output directory; selected production screenshots are also saved as `artifacts/sale-responsive-*.png`.

## Discussion features

Comments support plain text, safe HTTP(S) links, flat replies, eligible user-ID mentions, author edits, revision inspection, date separators and independently scrolling history. The composer keeps its draft until a confirmed send. A client operation UUID and database uniqueness constraint protect retries; edited retries cannot silently discard revised text. The client and database enforce a 5,000-character limit and reject whitespace-only messages. Enter inserts a newline; Ctrl/Cmd+Enter sends. Drafts are stored in session storage under the authenticated user and transaction IDs. Closing, switching workspace/stage or changing presentation preserves them.

Comments have one continuous thread per sale attempt. The composer begins with “Write an update…” and has no stage selector or comment stage badges. New posts and edits omit `p_stage`; the existing RPC defaults it to null and preserves historical stage metadata on edits. Older saved drafts discard their obsolete context. Queries, pagination, refresh and unread tracking already use the sale-attempt ID without stage filtering, so tagged historical comments remain alongside untagged comments. A replacement buyer's sale uses a different attempt and thread; the existing historical-sale link still opens the original conversation. No SQL migration or data backfill is required for this simplification. Activity retains its separate stage labels and links.

Read receipts acknowledge message endings actually presented while Comments is visible, the page is visible and its window has focus. Fetching, Activity and hidden panels do not acknowledge comments. Receipts preserve holes in paginated history; a separate high-water mark only advances. Counts exclude the author's own comments and do not treat edits as new messages. Overview counts use scoped batches of up to 500 sales. Open conversations refresh every 15 seconds; overview counts and the small Sales mentions inbox refresh every 30 seconds while visible. Older reading positions are preserved and arrivals expose a New messages action.

The former bottom Activity accordion has been removed. Activity uses the existing workflow log, deterministic timestamp/ID pagination, date groups, actor attribution, supporting detail and authorised document-version/stage actions. Comments do not duplicate themselves into the workflow log. New document events are written by triggers in the successful document database operation. New actor/organisation/role snapshots are stored on that existing event table. Browser consumers use explicit projections, with no raw commercial audit payloads. External viewers receive shared event types and safe titles; internal viewers retain original legacy descriptions.

## Identity and access

`unit_sale_attempts.id` is already a transaction identity. The existing return-to-For-sale action archives the prior attempt and replacement reservations use another ID. All comments, revisions, replies, receipts, assignments and mention notifications reference the attempt, with composite foreign keys preventing cross-sale replies and receipts. A draft-start RPC locks the unit and either returns its existing authorised attempt or creates a draft without reserving the unit or writing a reservation event. Comments make system drafts substantive, protecting them from baseline cleanup. Buyer-name replacement on a conversation-bearing attempt is rejected with instructions to start a new transaction. Completed and archived conversations remain available under their own permissions.

Sales and discussion access now share one building rule. Active agents and conveyancers can access every sale in their permitted buildings without individual assignment; admins/developers retain existing access. Sale participants controls and assignment writes have been removed. Historical attribution remains separate. See [Sales access and actor attribution](sales-access-and-actor-attribution.md) for the final replacement SQL, field inventory and upgrade details.

Authenticated database functions derive author, timestamps and read-state identity from `auth.uid()`. RLS protects the underlying tables; ordinary authenticated users cannot directly mutate comments or revisions. Editing requires authorship and current access. Mentions, revisions, receipts, inbox results and document deep links recheck access. In-app mention delivery is deduplicated per comment/recipient, omits self-notifications and filters revoked access at read time. No new email provider, email queue or general notification-preference system was introduced: the repository had transient notices and a separate snag-digest email path, not a reusable sales mention preference/delivery mechanism.

## Completion approval finding

The inspected handler approved both completion documents in one request and wrote the generic summary “Completion statement and statement of account approved.” It supplied no document identity or version metadata. That representation makes repeated records indistinguishable. The current source itself wrote one combined record per handler execution; no live audit rows were inspected, so a particular historical pair's origin was not inferred.

New upload/replacement/review events identify the actual document, exact version and filename. The existing completion approval/query event types remain compatible with stage consumers, while their metadata produces separate “Completion statement approved” and “Statement of account approved” titles (and corresponding upload/replacement/rejection titles). The former combined route write is removed. Legacy records with a reliable explicit document type or same-sale document ID receive corrected titles without rewriting history. Ambiguous legacy combined records keep their wording. A historical file is only linked through a recorded version ID; current files are not substituted for unknown old versions.

## Required rollout

Apply these additive migrations in order in an authorised environment, together with the application release:

1. `supabase/migrations/20260907_sale_discussions.sql`
2. `supabase/migrations/20260907b_sale_activity_projection.sql`

The second migration moves document event generation into triggers and removes authenticated raw workflow-log reads in favour of the safe RPC projection. Coordinate migration/application rollout rather than leaving an older client running against the changed event privileges. New tables use the existing Supabase authenticated session; no new environment variables, background worker or realtime publication are required. Apply the final `20260908b_sale_actor_names.sql` replacement for building access and limited historical actor resolution; no participant assignments are required.

`@electric-sql/pglite` is a development-only dependency for isolated PostgreSQL verification. Install locked dependencies normally before running the new tests.

## Verification actually performed

| Check | Result |
| --- | --- |
| `npm run test:sales` | 205 passed |
| `npm run test:sales-discussion` | 13 passed |
| Playwright: `sales-discussion.spec.ts`, `sales-stage-tasks.spec.ts`, `sales-commercial-editor.spec.ts` | 13 passed |
| `tsc --noEmit` | Passed |
| ESLint on new discussion code and tests | Passed |
| Repository-wide ESLint | 22 existing errors, 28 warnings; edited existing files match their baseline finding counts |
| `git diff --check` | Passed |

The database tests execute both new migrations unchanged in PGlite with an isolated adapter for the existing Supabase schema/auth functions, including the repository's enum role type. They exercise RLS, building access, wrong-sale denial, access revocation, draft/replacement isolation, edits/history, reply validation, retry protection, mention deduplication, exact read receipts and monotonic state, document triggers, safe projections and signed-document access checks. Playwright uses synthetic auth/data and routes discussion RPC calls into that local PostgreSQL instance. Existing workflow browser fixtures also remain synthetic. No test sends real email or queries a live conversation.

The browser checks cover all sale-file workspaces, several lifecycle stages, expanded Commercial at a measured two-thirds/one-third ratio, docking/drawer/mobile changes, drafts and unsaved input values, overview/deep-link entry, hidden-panel/Activity read behaviour, mentions and keyboard sending, lost-response retry, replies/revisions, long content, comments/activity pagination and scroll retention.

Live Supabase/PostgREST deployment, the complete historical production migration chain and actual multi-device/browser sessions were not exercised. The full unrelated browser suite and a production build were not run. Email mentions are intentionally absent for the infrastructure reason above. No moderation or deletion action was added because the repository supplied no applicable discussion moderation policy.

## Screenshots

All screenshots use synthetic fixtures. They are saved under `artifacts/`:

- `sale-discussion-before.png` — previous sale file.
- `sale-discussion-after.png` — shared conversation beside the lifecycle workspace.
- `sale-discussion-commercial-docked.png` — expanded editor with a docked conversation.
- `sale-discussion-commercial-drawer.png` — drawer fallback preserving the editor.
- `sale-discussion-mobile.png` — mobile conversation.
- `sale-discussion-activity.png` — document-specific activity.

Test output and compact lint/baseline reports are retained alongside the screenshots.
