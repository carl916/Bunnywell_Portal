# sale_workflow_context: repeated-work optimisation

## Change and status

The only runtime change is the forward migration
[20261012200050_sale_workflow_context_materialized.sql](../../supabase/migrations/20261012200050_sale_workflow_context_materialized.sql).
The branch starts at staging commit `1562549b0c4aa609f8ae205f190d8ddf34e1a8aa`; it contains none of PR #46's scheduling changes. PR #46 remains unchanged and draft.

The migration has **not** been applied to shared staging or production. All shared-database work was read-only, inside bounded transactions with rollback. The migration and rollback were executed only in disposable local PostgreSQL fixtures.

The function now materializes:

1. Distinct requested sale IDs that actually have events.
2. Those IDs passing the **existing** sale-access helper.
3. One **existing** projection result per authorised event.

It filters NULL projections before selecting the latest visible event per sale/type, then preserves the original `created_at DESC, id DESC` response order. It returns the full original JSON. No history cutoff, limit, field removal, shared cache, index, access rule, event writer or other RPC changed.

`CREATE OR REPLACE` retains the existing function's owner, OID and ACL. The declaration retains `jsonb`, PL/pgSQL, STABLE, SECURITY DEFINER, `search_path=public`, NULL-input behaviour, parallel-unsafe classification and default cost 100. The existing 500-ID check still counts duplicates and rejects 501 IDs before deduplication. The existing execute grants to authenticated/service_role and revocations from PUBLIC/anon remain intact; no GRANT/REVOKE is issued.

## SQL evidence, 12 October 2026

Shared staging PostgreSQL 17.6.1.127, admin/all buildings, 127 requested active non-redacted sale IDs, 588 matching raw events, 38 sales with events, 523 returned rows.

Twenty sequential, alternating pairs used the exact SELECT extracted from the original function and from the new migration. The queries ran as the existing postgres function owner with the same authenticated caller JWT claims and unchanged access/projection helpers. This reproduces the inner SECURITY DEFINER query context without installing a second RPC or changing the shared function. It is not a service-role application shortcut.

| Measurement | Existing | Optimised |
|---|---:|---:|
| SQL median, 20 samples each | 476.98 ms | 163.67 ms |
| SQL range | 455.78–627.41 ms | 159.68–213.66 ms |
| Sale-access helper calls | 588 | 38 |
| Outer projection helper calls | 1,176 | 588 |
| Shared disk reads | 0 | 0 |
| Temporary blocks read/written | 0 | 0 |
| Returned admin rows | 523 | 523 |
| Returned admin JSON bytes | 327,800 | 327,800 |

Median saving: **313.30 ms / 65.7%**. Every optimised sample was faster than its paired baseline. The earlier 481 → 164 ms investigation result was reproduced, not assumed.

Helper calls were measured with transaction-local `track_functions=all` and `pg_stat_xact_user_functions`, not instrumentation wrappers or permission stubs. Projection counts refer to the outer projection function; its unchanged internal wrapper/helper calls still execute normally.

The existing plan spends almost all its time in the event scan's access/projection work, followed by small in-memory sorts and JSON aggregation. The candidate uses 38 accessible IDs, a hash join, and a materialized 588-row projection before the same 523-row visible-latest selection. Representative complete plans are included with only scoped UUID literals redacted.

A supplementary forced-generic prepared-plan check measured 468.93 → 159.74 ms, with no disk reads/spills. This checks parameter-plan sensitivity; it is one pair, not a second statistical benchmark.

Evidence:

- [All 40 SQL timings and measured function counts](sql-timings.json)
- [Existing execution plan](baseline-plan.json)
- [Optimised execution plan](optimized-plan.json)
- [Forced-generic prepared plans](generic-plans.json)
- [All staging identity comparisons](staging-parity.json)
- [HTTP baseline samples](http-baseline.json)

## Output, permission and workflow validation

`npm run test:sale-workflow-context`: **9 tests passed**. They execute the full deployed projection chain and actual access helpers in PGlite PostgreSQL **18.3** with an isolated minimal schema; legal workflow cases use the repository's complete legal fixture. Live SELECT comparisons/plans separately cover the staging PostgreSQL 17 engine.

For every parity check the test calls the **same public RPC as authenticated** under identical claims. It temporarily reinstalls the original definition inside a rolled-back local transaction and compares the complete `jsonb::text` result (including array order), or exact error code/message. The normal permission helpers remain intact. Privileged fixture setup does not grant the read caller table/private-helper access.

Coverage includes:

- All application roles, active developer/admin, both external roles, inactive accounts, missing identity and unauthorised users.
- Explicit building access and external organisation access, mixed accessible/inaccessible buildings, wrong/missing membership, link deactivation and access revocation between calls.
- Hidden newer events with older visible events, cross-sale document references, historical non-current versions, version/document redaction, role-restricted document visibility and historical actor snapshots after name/role changes.
- Real authority requests, revocations, renewals/reissues, unchanged historical authority rows and derived authority state.
- Real completion document queries, replacements and approvals with full metadata/version context.
- Empty/NULL/unknown/duplicate IDs, 500 IDs, and rejection of 501 IDs including duplicates.
- 12,000-event histories with timestamp ties, deterministic UUID tie-breaking, reversed input order and no truncation.
- Complete function catalog/ACL/OID parity, private helper/table denial, anon denial, preservation of additional deployment-specific grants, unchanged workflow records and executable rollback.
- Real helper call counters: a 12-event fixture falls from 12/24 access/projection calls to 2/12.

Read-only staging comparisons additionally used **all 28 existing identities**, including 16 inactive accounts. Every complete ordered JSON comparison matched. Admin returned 523 events; the authorised sales agent and conveyancer each returned 483; unauthorised/inactive identities returned zero. These are SQL comparisons with each identity's claims, not 28 browser sign-ins. There is no active developer account in this staging population; active developer coverage is local.

Existing suites: **86 dashboard tests and 308 Sales tests passed**. Changed-file ESLint and TypeScript `--noEmit` passed. No visibility or authorisation discrepancy was found.

The staging security advisor baseline returned seven existing notices. Its broad authenticated SECURITY DEFINER notice includes intentionally privileged APIs; this migration retains their existing security properties. No advisor issue was introduced or remediated on shared staging. Re-run advisors after an approved apply; distinguish existing findings from new ones. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## HTTP evidence and limits

Using the existing staging admin's real JWT (anon API key, no service key):

| Existing deployment only | Samples | Median | Range |
|---|---:|---:|---:|
| RPC complete round trip | 20 | 630.61 ms | 594.25–764.89 ms |
| Deployed dashboard API | 10 | 3,013.58 ms | 2,827.97–4,216.32 ms |

All 20 RPC responses had the same complete byte hash, 523 events and 327,800 bytes. All ten dashboard responses had the same normalised hash and 15,944 bytes, with **27 database requests** reported by the existing timing instrumentation (authentication is separate). Application query count/batching is unchanged because no application code changes.

The first HTTP collection stopped when two baseline dashboard hashes differed. Investigation found only the existing source-status list's completion-dependent order. The completed run normalises this diagnostic list by key and removes `asOf`, matching the previous investigation. It does **not** normalise RPC output or dashboard business arrays.

**Optimised HTTP/dashboard latency remains unmeasured:** applying the migration to shared staging is explicitly awaiting approval. A branch preview still calls the unchanged shared database, so it cannot establish an RPC improvement. The observed ~313 ms SQL saving is not a guarantee of the same end-to-end saving or a sub-two-second dashboard.

Materialization can consume memory/spill as event histories grow; the 500-sale limit does not bound event count. The large local fixture proves parity, not production-scale memory behaviour. Actual RPC pool/cached plans, concurrent load and deployed network variability still require post-approval validation.

## Reproduce

From this worktree with installed repository dependencies:

```powershell
npm run test:sale-workflow-context
npm run test:dashboard
npm run test:sales
npx eslint tests/sale-workflow-context.test.mjs tests/helpers/workflow-context-database.mjs scripts/diagnostics/sale-workflow-context-sql.mjs scripts/diagnostics/sale-workflow-context-http.mjs
npx tsc --noEmit
```

The HTTP harness reads existing staging credentials from ignored `.env.local`, asserts the staging URL/active admin, signs out locally, and refuses to overwrite evidence:

```powershell
$env:RPC_PERF_OUTPUT='test-results/sale-workflow-context/new-http-run.json'
node scripts/diagnostics/sale-workflow-context-http.mjs
$env:RPC_PERF_OUTPUT='test-results/sale-workflow-context/read-only-statements.json'
node scripts/diagnostics/sale-workflow-context-http.mjs --prepare-sql
```

The second command writes read-only plan/count/parity statements with caller UUID and scoped sale IDs to an ignored local file; no JWT or record content is saved. Run those statements through the approved staging SQL connection as the existing function owner. Alternate baseline/optimised plan statements for 20 pairs, changing which runs first each pair; keep concurrent benchmark traffic off. Role parity uses the same scope and each existing profile's sub claim. Keep any real IDs local and redact them before committing plans. The query builder extracts the SELECT from the migration rather than maintaining an independent candidate.

## Deployment and validation plan — approval required

1. Review/approve this PR independently of #46. Before applying anywhere, verify the target project and current staging SHA. Capture `pg_get_functiondef`, owner, ACL, OID, volatility, security flag and search path. Stop if the deployed body differs from the reviewed baseline/rollback definition.
2. Obtain explicit approval for the target environment. Inspect migration history/pending migrations; apply **only this reviewed forward migration** through the normal release process. Do not run a blanket push that could apply unrelated legacy migrations.
3. Verify the function catalog properties and effective PUBLIC/anon/authenticated/service_role permissions remain identical. Confirm helper definitions and `sale_activity_page` are unchanged; re-run security advisors and investigate any new notice.
4. Re-run complete ordered-JSON parity against the saved baseline SELECT with identical claims/scopes, including inactive and mixed-access cases. Stop on any visibility/authorisation difference; do not weaken assertions.
5. Collect at least 20 comparable RPC samples and ten full deployed dashboard samples for all-building and representative single-building scopes, with real admin/external JWTs. Confirm payload hashes, source completeness, 27-call all-building inventory (scope-dependent calls can differ), workflow/history links, and initial/final access-revocation handling. Repeat paired SQL measurements and inspect for spills under representative large histories.
6. Accept only a repeatable material SQL reduction with unchanged contract/security. Report end-to-end benefit separately. Production promotion/merge remains a separate approval; neither is performed by this task.

## Rollback

[rollback.sql](rollback.sql) restores the exact pre-optimisation function body using CREATE OR REPLACE, preserving owner, OID and grants. It is deliberately outside the migrations directory so a normal migration run cannot undo the change.

After explicit approval, either execute it through the controlled incident procedure and reconcile migration history, or preferably generate a **new forward migration** containing that replacement. Never delete the applied migration record, drop/recreate the function, restore tables, or rewrite event/audit history. Re-run catalog, permission, ordered-JSON and workflow checks after rollback. The rollback SQL and preservation of additional ACL grants are tested locally.

References: [PostgreSQL CREATE OR REPLACE ownership/permissions](https://www.postgresql.org/docs/17/sql-createfunction.html), [CTE materialization](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).
