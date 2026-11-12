# Reviewed application baseline

This is a consolidated application baseline for a **new, empty, isolated Supabase application schema**. It is not a migration to run against staging or production. The runner refuses an existing public application schema; it does not reset or drop a database.

## Definition choices

- Start from the schema-only definition of the preserved local Completion environment, reconciled with the recorded 11 November staging catalog and repository. No business rows or accounts are copied.
- Carry forward the reviewed staging `record_unit_sale_invoice_payment` definition, including scoped conveyancer access, locking, overpayment validation and client-reference idempotency. The independent payment migration is unchanged.
- Carry forward the reviewed meaningful-activity audit and completion-notice guard definitions. Remove inherited broad execution privileges on internal trigger/legacy helpers.
- Preserve the repository/local fall-through behaviour: retain buyer names and reservation/version history; clear the contact fields covered by the existing redaction tests. Earlier tests explicitly require this. Staging currently differs. Do not overwrite staging retention without resolving that discrepancy with the owner.
- Include `sales_agent` and `conveyancer` role enum values explicitly. The historical bootstrap alone omitted them.
- Include app-owned Auth profile creation, public `snag-images`, private `snag-reports`, `sale-documents` and `completion-uploads` setup. No handover-signature bucket or uploads are enabled.
- Preserve existing authenticated DML/RLS boundaries. Remove TRUNCATE/REFERENCES/TRIGGER application-table grants from client roles and broad future-object defaults; apply the separate A1/A2 package before seeding users. Public snag-photo reading remains deliberate.
- Keep the 71 historical SQL migration files unchanged in `supabase/migrations`. `historical-migrations.json` records their hashes. They are an archive, not the input to this runner.

## Prerequisites and order

The recorded local tooling is Supabase CLI 3.0.0, PostgreSQL 17.11, Docker Desktop Linux containers and Node 24. The Supabase platform must first provide its managed roles, Auth/Storage schemas, extensions and services. The application baseline does not reimplement Auth or Storage. `btree_gist` is an explicit application prerequisite because the existing rental exclusion constraint requires it.

Run from the integration worktree in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backend-foundation/start.ps1
node scripts/backend-foundation/runtime.mjs --verify
node scripts/backend-foundation/create-baseline.mjs
node scripts/backend-foundation/seed.mjs
node scripts/backend-foundation/large-seed.mjs
node scripts/backend-foundation/serve.mjs
```

These commands are for a **new installation**. The current foundation is already populated: start the review with only `node scripts/backend-foundation/serve.mjs` if it is not already running. Do not rerun schema creation or the one-shot seed on an existing installation.

The runner applies, in explicit order:

1. `application.sql` in a transaction: types, tables, views, functions, triggers, indexes, policies and grants.
2. `../security-patches/20261111211706_foundation_scoped_security.sql`.
3. `ownership.sql`: same-building/unit, attempt/document/invoice and approval-version ownership, nullable communal/legacy cases, validation of existing NOT VALID constraints. The area guard also locks against concurrent moves.
4. `imports.sql`: service-only historical-import provenance and protected historical status initialisation.
5. `workspace-reads.sql`: caller-JWT/RLS access context and bounded building/exact-record facts. No shared cache.

`start.ps1` pins the new `bunnywell-backend-foundation` project to loopback 55321/55322/55324. All database/Auth/Storage services use a Docker internal network. The loopback ingress has no external default route. SMTP goes to local capture. The harness verifies these properties before creating accounts or records. Runtime keys, test credentials, logs and workbooks are ignored by Git.

## Second rehearsal and imports

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backend-foundation/start-rehearsal-two.ps1
$env:FOUNDATION_REHEARSAL='two'
node scripts/backend-foundation/create-baseline.mjs
node scripts/backend-foundation/import-tests.mjs
Remove-Item Env:FOUNDATION_REHEARSAL
node scripts/backend-foundation/baseline-parity.mjs
```

The second project has its own new database and loopback ports 56321/56322/56324. Creation was rehearsed with zero application records/users. Both schema definitions were compared after testing. The original `bunnywell-workspace-stage2` database was preserved.

Synthetic account/fixture seeding is separate from schema creation. `import-tests.mjs` creates fictional Excel workbooks and invokes the actual `scripts/import-cleanup-template.mjs`; `--prod` in that legacy importer means skip account creation, not connect to production. The harness pins URL and key to one of the two local projects. It checks seven historical statuses, duplicate labels across buildings, communal rooms, handovers, identical reruns, interruption after three unit writes and recovery to eight units. Each run uses new fictional building names.

The importer no longer clears handover dates during a rerun, resets an existing account password or prints generated passwords. New account credentials can be written deliberately to a private, previously nonexistent file via `--credentials-out`; otherwise recovery is used. No remote import has been authorised.

## Validation boundaries

`artifacts/backend-foundation` contains sanitised results. PostgreSQL ownership transactions, offline PGlite tests, real Auth/Storage/database tests and browser navigation tests are identified separately. The earlier pre-validation performance files are superseded by `performance-paired.json`.

Destination updated 12 November 2026: the next hosted integration targets the approved, newly created Supabase project `mmwzhzziqvjbsphrkbqr` and Vercel project `prj_YMaQDDgEtACwTijrmmh1SxQwsfe5`. Both are provisioned; application baseline/data/deployment remain pending. Existing staging and production are protected references, not redesign migration or deployment targets. See [the hosted integration approval package](../../docs/architecture-review/2026-11-12-hosted-integration.html) and [recorded project/deployment identifiers](../../docs/architecture-review/2026-11-12-environment-targets.json). Apply this baseline only to a new, empty approved target; never an existing database. Retention reconciliation and the remaining command/media gates remain open. Local databases are engineering tools; the hosted integration will become the review environment after acceptance.
