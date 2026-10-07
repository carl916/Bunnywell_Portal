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

## Recovery and verification

A fresh production database and Storage backup completed in GitHub Actions run `37594917875`, attempt 2, job `112868099667`. Dropbox snapshot: `2026-10-07T15-23-53Z`. The local archive checksum was verified before rehearsal. Recovery material remains in the private Dropbox backup folder; no production records or credentials are committed.

Rehearsal restored the complete public schema and 1,869 public rows from that backup into isolated PGlite, with minimal Auth and Storage adapters. All 14 migrations then executed in one transaction. Existing table row counts were preserved; content hashes for units, profiles, tenancies, arrears, snags and photos were unchanged. The resulting schema contains all 58 expected public tables, constraints, indexes and public policies. App function bodies match staging after line-ending normalization except for the deliberate return-to-sale difference above.

Rehearsal limitations: PGlite does not provide Supabase services, `supabase_vault`, `pg_stat_statements` or `pg_cron`. Only the audit migration's managed cron installation/scheduling block was omitted locally; verify the complete block, cron job, Auth trigger and Storage settings on production after applying the unmodified bundle. This is a database migration rehearsal, not a complete Supabase disaster-recovery test.

Pre-release checks: TypeScript passed; 278 sales tests and 65 audit/discussion/refresh tests passed. The source staging deployment is READY. Production environment variable names include the Supabase connection settings, Resend configuration and `CRON_SECRET`; there is no production dry-run email override. No real legal instruction emails are sent during release verification.

## Execution status

Prepared and rehearsed. Record production migration versions, postchecks, PR, deployment and backup confirmation below after execution.
