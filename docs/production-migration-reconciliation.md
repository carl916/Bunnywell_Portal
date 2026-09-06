# Production migration reconciliation

## Production postcheck passed — 6 September, 07:43 UTC

The user returned the production postcheck captured at `2026-09-06 07:43:25.660248+00:00`:

- `unexpected_client_privileges`: empty.
- `rental_access_failures`: empty.
- `btree_gist_installed`: true.
- `unit_count`: 213; `units_outside_rental_portfolio`: 213.
- `uncategorised_audit_events`: 0.
- `missing_last_active_with_known_sign_in`: 0.

Together with the 07:41 schema export, this clears the identified production schema gaps, the new rental-table permission issue for the checked operations, and the two measured backfill checks. No rerun of the catch-up bundle is needed. This is not a full application acceptance test or proof of every historical migration's execution.

Remaining release work: confirm the new rental permission migration is also applied to staging, include that migration in the staging-to-main release, complete application CI/release checks and perform the coordinated deployment and workflow smoke tests. Staging's correction has not been independently verified. This task has not committed, merged, pushed or deployed the application.

## Latest verification — 6 September, 07:41 UTC

The user supplied a new production schema export captured at `2026-09-06 07:41:26.783331+00:00`. The missing schema described in the historical findings below is now present. **Do not rerun the catch-up bundle.** No merge/deployment has been performed by this task.

Verification against the repository found:

- No missing explicitly added public columns or created public tables in the migration scan.
- Matching latest function bodies for all 60 distinct application function names parsed from migrations, after normalising line endings and outer whitespace. This name-based check is not exhaustive overload verification.
- All indexes named in the catch-up bundle present, valid and ready.
- Four new rental tables with RLS enabled; new allocation, audit-context, tenancy and append-only triggers present and enabled.
- Expected unit defaults (`not_released`, `not_in_portfolio`) and baseline default (`false`); updated workflow and organisation constraints; tenancy overlap exclusion constraint present.
- Scoped rental SELECT policies and replacement unit INSERT/DELETE policies present; authenticated unit UPDATE removed; inspected server-only allocation/tenancy RPCs restricted to postgres/service_role.

The reservation-date checks are intentionally `NOT VALID` in the source migration and export; this alone is not evidence of migration failure. The export now has 46 relations, 625 columns, 251 functions, 29 triggers, 87 policies, 125 indexes and 316 constraints. Extension functions are included in that function count. The inventory still cannot prove data backfill outcomes or identify every historical SQL execution.

### Corrective permission migration

The four new rental tables have direct grants `anon=rDxtm` and `authenticated=rDxtm`. The original migrations revoke only INSERT/UPDATE/DELETE, leaving default TRUNCATE and other privileges. PostgreSQL documents that TRUNCATE is not protected by RLS. This is an actual database privilege finding, not a claim that an unauthenticated HTTP endpoint exposes TRUNCATE.

Prepared `supabase/migrations/20260906_rental_table_privileges.sql`: revoke all table privileges from PUBLIC/anon/authenticated on these four tables, then restore authenticated SELECT. Existing service_role permissions and RLS remain unchanged. Apply this new migration to both production and staging; do not edit or replay the already-applied catch-up files. This narrow correction does not audit or change the older tables' grants.

Then run `scripts/database/production-migration-postcheck.sql`. Expect both failure arrays empty, `btree_gist_installed` true, and both remaining-backfill counts zero. If no intervening changes occurred, the unit counts should both be 213. The postcheck measures effective client privileges (including inheritance) for the specified operations, intended read/server-write access and RLS. The new correction and postcheck have not been executed against PostgreSQL by this task.

References: https://www.postgresql.org/docs/current/ddl-priv.html and https://www.postgresql.org/docs/18/ddl-rowsecurity.html

## Historical investigation and execution plan

Comparison refreshed from origin on 6 September 2026:

- `origin/main`: `827c14e` (25 August).
- `origin/staging`: `4a6015c` (6 September).
- Production migrations have been applied manually in the Supabase SQL Editor.
- Production schema export captured at `2026-09-06 07:34:34 UTC` has been inspected. The supplied export is treated as production based on the user's response; its database name alone does not establish project identity.

## Findings from the supplied production export

The export contains 42 relations, 538 columns, 37 function definitions, 17 triggers, 82 policies, 100 indexes and 260 constraints. There is no `supabase_migrations.schema_migrations` table. Historical execution cannot be reconstructed exactly from this schema inventory.

**Production needs an older prerequisite as well as the ten staging candidates.** `20260804_reservation_approval_workflow.sql`, already on main, is missing its nine added columns and updated workflow constraints. In particular, both `units.reservation_date` and `unit_sale_attempts.reservation_date` are absent, as are approval identity and rejection fields. Applying the newer allocation refinements without this prerequisite would fail.

| Proposed order | Migration | Evidence / classification |
| --- | --- | --- |
| 1 | `20260804_reservation_approval_workflow.sql` | Missing schema: all nine added columns absent; workflow and buyer-identity checks still have the earlier definitions. |
| 2 | `20260828_commercial_unit_allocation.sql` | Missing foundation: no rental portfolio column or new allocation functions; old unit status/organisation checks and `admins manage units` policy remain. |
| 3 | `20260829_unit_allocation_pristine_drafts.sql` | Missing helper functions; depends on allocation foundation and reservation date columns. |
| 4 | `20260830_unit_allocation_runtime_refinement.sql` | Missing `is_system_baseline` and meaningful-activity/baseline functions. Includes a historical draft backfill. |
| 5 | `20260830b_reservation_actor_identity_backfill.sql` | Data-only migration; execution not provable from schema. Approval/rejection columns it needs are absent, so it cannot currently complete. Submission-only changes may have been applied separately. |
| 6 | `20260830c_return_pre_exchange_unit_for_sale.sql` | RPC absent. |
| 7 | `20260831_rentals_tenancies.sql` | `unit_tenancies` and tenancy functions absent. Requires `btree_gist` extension. |
| 8 | `20260831b_audit_log_structure.sql` | All ten added audit columns and context function absent. Includes historical context backfills. |
| 9 | `20260901_rental_arrears_risk.sql` | All three tables absent: `rental_arrears_episodes`, `rental_arrears_events`, `rental_import_runs`. |
| 10 | `20260902_rental_arrears_tenancy_attribution.sql` | Parent arrears table and attribution columns absent. Data update would have no rows immediately after creating empty rental tables, but retain this migration for the schema. |
| 11 | `20260903_user_last_active.sql` | `profiles.last_active_at` absent. Includes Auth sign-in timestamp backfill. |

The four 25 August agent-fee migrations have their added columns present. Their latest function bodies match the export exactly after normalising line endings and outer whitespace: fee normalisation, commercial-model wrapper, record/void payment, payment audit/protection, recorder stamping and the 25 August portfolio RPC. The 28 August allocation migration subsequently replaces the portfolio RPC, which still needs that update. The 4 August snag-media migration's added columns are present. Do not replay these earlier migrations simply because another 4 August migration was missed.

A scan of all migration files for explicitly added public columns, created public tables and function names found no further missing objects outside the eleven candidates above. This is a targeted dependency scan, not proof that every previous policy, grant, constraint, overload, data update or Storage setting is correct.

## Remaining release checks

The user returned the production preflight captured at `2026-09-06 07:38:34 UTC`. All four inspected constraint-blocker counts are zero. `btree_gist` is available but not installed; the rentals migration includes its installation. These checks passed, but do not certify the whole migration sequence.

| Preflight result | Count |
| --- | ---: |
| Units to initialise as outside the rental portfolio | 213 |
| Active drafts to assess for baseline backfill | 0 |
| Submission identity backfill candidates | 0 |
| Earlier payment recorder backfill candidates | 0 |
| Audit events to categorise | 2 |
| Last-active sign-in backfill candidates | 1 |

Prepared `scripts/database/production-catchup-20260906.sql` with the eleven migrations in the order above. Each embedded migration was checked byte-for-byte against its source text and includes a SHA-256 checksum. A single explicit transaction surrounds the whole bundle, with a 10-second lock timeout and a 120-second per-statement timeout. No source migrations were edited. No local PostgreSQL or Docker executable was available, so the bundle has not been executed or rehearsed here.

The submission-identity and payment-recorder counts measure rows eligible for the existing backfills, not proof of historical execution. The payment-recorder backfill belongs to an earlier migration whose triggers are now installed; do not rerun it automatically if its count is nonzero. New reservation approval/rejection columns will initially be null, so the later identity backfill should still run after the prerequisite.

Before execution, verify backup/recovery readiness and rehearse the exact bundle on an isolated production restore. The 28 August foundation revokes authenticated unit UPDATE and adds guards to status changes, so pause application writes during the cutover and coordinate application deployment with the SQL change. Run the entire bundle together, without selecting a subsection. The explicit transaction prevents an error from committing only part of the bundle. Stop on any error; do not run later sections separately. If the editor connection fails or the result is ambiguous, inspect the schema before attempting a rerun.

After confirmed success, rerun `scripts/database/production-migration-audit.sql` and compare the export to the target migrations. Check new columns, final RPC definitions, guards, RLS and grants before releasing application writes. After deploying staging's application changes, smoke-test login, snags, reports, unit allocation, reservation approval/rejection, sales-agent fees, rentals and role access. The database bundle does not import staging data or enable rental participation on existing units. No production SQL has been executed by this task and no merge or deployment has been performed.

There are ten added migration files between these branches, with no modified or deleted migration files in that comparison:

1. `20260828_commercial_unit_allocation.sql`
2. `20260829_unit_allocation_pristine_drafts.sql`
3. `20260830_unit_allocation_runtime_refinement.sql`
4. `20260830b_reservation_actor_identity_backfill.sql`
5. `20260830c_return_pre_exchange_unit_for_sale.sql`
6. `20260831_rentals_tenancies.sql`
7. `20260831b_audit_log_structure.sql`
8. `20260901_rental_arrears_risk.sql`
9. `20260902_rental_arrears_tenancy_attribution.sql`
10. `20260903_user_last_active.sql`

This is a Git candidate list, not an approved execution plan. Files already on main, including the four 25 August agent-fee migrations, may still be missing from production. Multiple migrations replace the same functions; compare against the final intended definition, not just the presence of a function name. Some migrations update existing records; schema presence cannot establish whether those backfills completed.

## Collect production evidence

1. Open the confirmed production project in Supabase.
2. Paste and run `scripts/database/production-migration-audit.sql` in SQL Editor. It uses a read-only transaction and returns one JSON text cell with schema definitions. Export the result as CSV and label it as production.
3. Optionally repeat on staging, labelling that export separately. `current_database()` is often simply `postgres`, so it does not identify the Supabase project.
4. If the result says a migration history table exists, the optional query at the bottom can inspect its recorded versions. SQL Editor changes bypass migration history, so missing records are inconclusive.

The inventory covers public relations, columns, constraints, indexes, function definitions and ACLs, triggers, enums, and public/storage policies. It is not a backup or a complete dump: it does not collect application records, Storage bucket settings, role memberships, default privileges, or every database object type. Null ACLs mean PostgreSQL default permissions, not necessarily no access. Function definitions may contain embedded literals; keep exports private.

## Reconcile before release

Compare the exported state with the repository's cumulative migrations, including prerequisites already on main. Classify each candidate as missing, structurally present, partially present, or requiring a data check. For backfills, prepare targeted read-only counts after confirming the necessary columns exist. Matching schema does not prove historical execution, and matching data may establish that no work remains without proving which script ran.

Review any missing SQL against the live state and current main application, obtain a fresh production backup per `docs/backup-and-recovery.md`, and validate the selected sequence on an isolated restored copy. Apply the reviewed database changes before deploying application code that requires them, with a coordinated cutover if they are incompatible with the current application. Verify the resulting schema, backfill outcomes and affected workflows before merging/deploying.

Do not replay every migration blindly, mark all migrations applied, or run reset/cleandown scripts to solve history uncertainty. Older function definitions can overwrite newer ones and data migrations require individual review.

For future releases, establish a verified baseline and use one tracked migration process with unique timestamp filenames. Existing filenames include repeated date prefixes and letter suffixes; review compatibility and baseline history before adopting the CLI. Do not rename existing migrations or repair history without reconciliation.

Reference: https://supabase.com/docs/guides/deployment/database-migrations
