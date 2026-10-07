# Production release — 7 October 2026

## Scope and targets

Promote the application at staging commit `1dfbeea0430739f69a9a324b822d90cce7619314` to `main`, preserving production data. Staging records and files are test data and are not imported.

- Repository: `carl916/Bunnywell_Portal`.
- Vercel project: `bunnywell-portal`, `prj_4s8vIyfrGh9DSGJcixTU5slevr5P`, team `team_x65ctL8Fot37UcabAkdh8f72`.
- Production Supabase: `zxgezoiazsubopqhqhim`; staging: `vxkpvdtrldwwqiddoyof`.
- Previous production commit: `54767baa7c16edcd8de7568d4583f4e75994e1ad`; deployment `dpl_5tiUg9B4T1x5xUvVSPgKo6Xwp6dS`.
- Production domains: `portal.bunnywell.co.uk` and `defects.bunnywell.co.uk`.

## Database reconciliation

Production has no historical migration ledger. The live inventory, not Git differences alone, identified 14 missing migrations: the September discussion, actor-access and legal/completion migrations plus the October audit and independent document-review migrations. Several are already on `main` but absent from the live database.

Apply `supabase/migrations/20261007152600_sales_production_prerequisites.sql` and commit it first. It adds the missing `sales_agent` and `conveyancer` enum values and explicitly provisions the private PDF-only `sale-documents` bucket with a 10 MiB limit. Existing assignments and objects are preserved. The separate commit is required before functions can use new PostgreSQL enum values.

`node scripts/database/prepare-production-release-20261007.mjs` generates the ordered catch-up SQL and source checksums in ignored `test-results/production-release/`. It makes no connection or database changes. Execute the generated catch-up once against the confirmed production project. It uses a single transaction, a 10-second lock timeout and a 120-second statement timeout. Source migration bodies are unchanged; only their standalone transaction wrappers are consolidated. The direct-upload migration follows the completion-package migration, despite its filename sorting earlier.

The release deliberately preserves two reconciled differences from live staging:

- Production's rental table grants are tighter and match `20260906_rental_table_privileges.sql`; do not copy staging's broader grants.
- Production's `return_pre_exchange_unit_for_sale` matches the checked-in migration and reservation-redaction regression tests. Live staging has an unversioned older body that also clears buyer names and document history. That body is not promoted.

Column physical order, pre-existing enum order, and ACL array order are not treated as functional differences. No historical migrations are blindly replayed or falsely marked applied.

Two follow-up migrations complete the release:

- `20261007154000_sales_internal_function_permissions.sql` removes inherited anonymous/browser EXECUTE privileges from internal sales projection and trigger functions and fixes the notice guard's search path. Guarded activity RPCs and server access remain available. Permission-denial and normal activity-path tests pass.
- `20261007154800_audit_preserves_unit_baseline_allocation.sql` fixes a regression found by the full browser suite: trusted `sale_record_changed` audit observations were counted as intentional sales activity. Generated unit-price baselines now remain allocatable; business-field changes, ordinary workflow events and discussions still block allocation. Audit history is retained. The restored-schema check verifies both cases, and the existing live allocation test now expects the audit records.

Both follow-ups were applied to staging as well as production so the release's browser checks exercise the same behavior. Historical-name browser fixtures were updated for per-document approval and exact approved-version IDs.

## Recovery and verification

A fresh production database and Storage backup completed in GitHub Actions run `37594917875`, attempt 2, job `112868099667`. Dropbox snapshot: `2026-10-07T15-23-53Z`. The local archive checksum was verified before rehearsal. Recovery material remains in the private Dropbox backup folder; no production records or credentials are committed.

Rehearsal restored the complete public schema and 1,869 public rows from that backup into isolated PGlite, with minimal Auth and Storage adapters. All 14 migrations then executed in one transaction. Existing table row counts were preserved; content hashes for units, profiles, tenancies, arrears, snags and photos were unchanged. The resulting schema contains all 58 expected public tables, constraints, indexes and public policies. App function bodies match staging after line-ending normalization except for the deliberate return-to-sale difference above.

Rehearsal limitations: PGlite does not provide Supabase services, `supabase_vault`, `pg_stat_statements` or `pg_cron`. Only the audit migration's managed cron installation/scheduling block was omitted locally; verify the complete block, cron job, Auth trigger and Storage settings on production after applying the unmodified bundle. This is a database migration rehearsal, not a complete Supabase disaster-recovery test.

Pre-release checks: TypeScript passed; 279 sales tests and 65 audit/discussion/refresh tests passed. The source staging deployment is READY. Production environment variable names include the Supabase connection settings, Resend configuration and `CRON_SECRET`; there is no production dry-run email override. Public production JavaScript was verified to target `zxgezoiazsubopqhqhim.supabase.co`. No real legal instruction emails are sent during release verification.

## Execution status

Production migrations applied successfully through the Supabase migration tool:

| Recorded version | Migration |
| --- | --- |
| `20261007153053` | `sales_production_prerequisites` |
| `20261007153711` | `production_sales_audit_catchup_20261007` (14 source files) |
| `20261007154029` | `sales_internal_function_permissions` |
| `20261007154326` | `audit_preserves_unit_baseline_allocation` |

MCP assigns execution timestamps; the repository filenames identify the source scripts. The catch-up ledger entry records the complete consolidated SQL. Do not run a generic `db push` against the older, unreconciled history.

Live postchecks found zero differences in row counts and content fingerprints across all 46 pre-existing public tables. All 213 units, 29 tenancies, 13 arrears episodes, 32 arrears events and 54 Storage objects remain. All 58 public tables have RLS. Both sales buckets are private, PDF-only and limited to 10 MiB. The `portal-unit-opens-retention` cron job is active at `17 2 * * *`. Read-only tests using the actual authenticated database role passed for all three audit streams, units, tenancies and sales/actor context RPCs. Internal completion upload RPCs remain service-only.

Supabase security advisors were reviewed before and after. No new anonymous SECURITY DEFINER access or mutable search-path findings remain from this release. Existing advisories remain; new no-policy findings are intentional service-only tables, and new authenticated RPC findings are guarded application entry points. See the [database linter guidance](https://supabase.com/docs/guides/database/database-linter).

Release PR: [#26](https://github.com/carl916/Bunnywell_Portal/pull/26). Final CI, merge, production deployment identity and post-release backup results are recorded in the PR description.
