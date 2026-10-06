# Staging audit increment

Starting point: `3bf458d` and the read-only assessment in task
`01a1104d-26cc-72d2-9f94-22d8b36f08be`, retrieved before editing.
Scope: staging project `vxkpvdtrldwwqiddoyof` only. Production was neither
queried nor changed in this increment; its migration state is not assumed.

## Writer trace before editing

| Path | Existing writer | Boundary / gap |
| --- | --- | --- |
| Users | `api/admin/users`, then browser `recordAudit` | Auth API and profile/access writes are separate; browser history can fail. |
| Access requests | `api/access-requests`, then browser `recordAudit` | Auth invitations, grants and request state are separate. |
| Unit creation/deletion | Browser `units` writes | No structural audit; room/price operations happen separately. |
| Unit structure | `api/buildings/units/[unitId]` service-role update | No authenticated database actor or event. |
| Allocation | SQL allocation RPCs | Already transactional general audit; preserve these histories. |
| Reservation | `api/sales/reservations`, `insertEvent` | Multiple commits; event errors ignored. |
| Commercial model | Commercial RPC | Already transactional terms/history; preserve. |
| Payment | `record_unit_sale_invoice_payment`, then `insertEvent` | Business dedupe exists; creation event is outside transaction. Void event already transactional. |
| Legal workflow | Legal SQL RPCs and document triggers | Already transactional; preserve legal semantics and email delivery. |
| Snag | Browser update/insert, then `snag_events` insert | Can lose essential history or claim a failed change succeeded. |
| Authentication | Supabase Auth | Database audit log empty at inspection; heartbeat is presence only. |

## Coverage and verification

`20261006134823_reliable_audit_increment.sql` was applied using the connected
Supabase migration tool to **staging only**, version `20261006134823`. The
complete migration was rehearsed in a rolled-back transaction first. The
post-application diagnostic `scripts/database/staging-audit-verify.sql` passed
and rolled back all its synthetic unit/snag changes. The daily retention job is
active at 02:17 UTC. Do not replay historical migrations or this migration on
production as part of this PR.

Follow-up `20261006135625_preserve_legacy_audit_actors.sql` is also applied to
staging. It preserves explicit actor IDs supplied by existing trusted service
RPCs during rollout; ordinary JWT inserts are still attributed to `auth.uid()`.
The tenancy route now carries its verified actor header too. The compatibility
test and tenancy suite passed (16 tests).

| Coverage | Record and atomic boundary |
| --- | --- |
| Profiles and effective building/unit access | Database triggers append general audit in the row transaction; profile and effective access edits use one service-only RPC. No-op access saves produce no essential history. |
| Access-request status/reviewer/notes | Database change event in the same row transaction; note contents withheld. |
| Units and room/area structure | Create/change/delete event in the row transaction, including deleted IDs; only structural values copied. Prices/allocation retain existing writers. |
| Sale attempt, terms and invoice fields | Essential `sale_record_changed` in existing workflow history in the row transaction. Names/contact/free-text fields have changed names only. Existing higher-level workflow events remain. |
| Agent fee payment creation/fully paid | Trigger within the existing payment RPC transaction; its existing lock/client-reference deduplication is preserved. Void history remains the existing atomic writer. |
| Snag creation, status, priority, trade, assignment and dates | Trigger within mutation; status reason is passed through invoker RPC in the same transaction. Existing note/media events remain. Old secondary transition writes are suppressed; nonempty reasons become ordinary notes. |
| Legal workflow/document history | Existing transactional RPCs/triggers unchanged; verified server actor is attached to service requests. |
| Unit opens | Separate optional stream: deliberate sale/rental file selection and unit structure edit, after visible paint. Initial URL loads, refresh, prefetch and rerenders do not arm an intent. One-minute intent expiry; five-minute per actor/unit database deduplication, including concurrent tabs. |

Actors come from authenticated `auth.uid()` or a service request header set
only after server `auth.getUser(token)` verification. An ordinary JWT cannot
impersonate another actor through that header. Time comes from PostgreSQL.
General/snag histories snapshot actor name and role; sale history keeps its
existing snapshots. Unattributed service maintenance is not attributed to the
last editor. Existing historical records are not rewritten.

The admin/developer feed queries guarded SQL with 50 visible rows plus one
lookahead, using a `(time,id,source)` cursor. Date, actor, building, unit, sale,
snag and event-type filters execute on the server. Authentication and unit views
are separate streams. Existing role-filtered sale activity remains unchanged;
new generic field events follow its existing internal-only unknown-type rules.
TRUNCATE and other destructive grants are revoked on all three existing history
tables for anon/authenticated/service_role. Unit view writes are RPC-only and
read RLS is admin/developer-only. Private configuration/provider imports have
RLS enabled with deliberately no client policies.

Tests: 276 sales regressions passed; 44 targeted audit/agent-fee tests passed,
including real PostgreSQL trigger execution in PGlite, spoofed attribution,
rollback when essential history fails, no-op/retry/failed mutation behavior,
admin/developer versus other/inactive roles, pagination, filters, payment
history, tracking disable and retention. TypeScript, targeted ESLint and a
Next.js build passed. Staging SQL separately verified actual RLS, grants,
attribution, failed actions, snag retries, view deduplication and pagination.
PGlite omits only managed pg_cron installation; staging verified it. The
security advisor reports expected guarded authenticated definer RPCs and
private default-deny tables; existing unrelated advisories remain.

### Remaining boundaries — not complete atomic coverage

Auth account creation/invitation/ban/deletion and portal profile/access changes
span separate provider/database calls. Access-request invitation, grants and
request state also span calls. Reservation submit/review/failure and some
invoice/document operations still make multiple database/storage commits;
each covered row has essential atomic history, but the entire business action
has not been converted to a transaction or a new idempotent command. New
reservation/user creation retries can still require reconciliation after a
lost response; payment client-reference retries and unchanged field/snags
are deduplicated. Unit edits plus prices/rooms and snag rejection plus media
are also multi-commit operations. Storage and email cannot join a PostgreSQL
transaction. Their existing legal/permission/email semantics were preserved.

Failed or denied changes return their existing errors and create **no success
event**. This increment does not introduce a durable denied-attempt log, nor
invent a failure record inside a rolled-back transaction. Legacy best-effort
workflow descriptions remain supplementary; essential database events are the
evidence of the actual field change. Legacy browser general reports are
labelled `client_reported`/`reported`, not asserted as authoritative changes.

### Authentication evidence and limitation

At inspection `auth.audit_log_entries` contained zero records. Staging's
external `auth_audit_logs` did contain provider-generated `login`/`logout`
entries. A validated **236-record snapshot**, spanning 5 October 14:43 UTC to
6 October 13:43 UTC, was imported with original provider IDs, actor IDs,
timestamps and action only. Provider IDs deduplicate imports. Neither tokens,
emails, IPs, user agents nor full payloads were imported. The feed explicitly
labels these `provider_recorded`, rather than inferring successful logins.

Database provider logs are queried live if present. External provider imports
are a snapshot, **not a continuous future-login feed**. No Auth configuration
was changed. Provider-plan retention/configuration was unavailable through the
connected management tools; only this observed 24-hour availability is
verified. Imported minimal records expire after **90 days**, enforced by the
same purge job; this does not change provider retention. For a subsequent
snapshot, use the staging log query with only audit_log_id, actor_id,
created_at and action, validate UUID/time and login/logout, then insert into
`portal_audit.auth_events ON CONFLICT(id) DO NOTHING` through the migration/SQL
management process. Do not infer missing sign-outs from inactivity or restored
sessions. Refreshes and five-minute activity updates are excluded.

### Performance

The repeatable scripts in `scripts/diagnostics/audit-staging-*-performance.mjs`
save sanitised measurements under `artifacts/audit`. Baseline used latest
staging `3bf458d`: 20 alternating deliberate switches between authorised
Forum House units 107/108, and 20 HTTP structural updates on a newly created
synthetic unit that was deleted afterward. No diagnostic sale was mutated.
Baseline opening p50/p95: **9.53/10.89 ms**, zero requests for these cached
switches; mutation: **618.57/1314.56 ms**, one browser request per update.
The immutable feature preview tested was
`bunnywell-portal-9k6qxsapv-carl-gilbert-s-projects.vercel.app`, commit `aa3c3fb`,
target preview, region `iad1`. Browser interception blocked every non-staging
Supabase hostname before authentication; the preview's staging configuration
was verified without changing any environment setting.

| 20 samples per batch | Baseline p50 / p95 ms | Increment p50 / p95 ms | Added browser requests |
| --- | --- | --- | --- |
| Cached unit selection → heading visible | 9.53 / 10.89 | 8.25 / 13.78 | One async RPC on each first deliberate open; 2 across 20 selections, 0 on repeats |
| Unit structural PATCH → response received | 618.57 / 1314.56 | 1001.16 / 1402.28 | 0: still one HTTP PATCH; the same four remote server operations (Auth verification, profile, type, update) |

The first mutation batch shows a **382.60 ms higher median and 87.72 ms higher
p95**. A repeat baseline using the unchanged staging application after schema
application measured **857.18 / 1245.37 ms**; its unbound legacy route does not
emit new essential structural history during rollout. These sequential small
batches show sizeable network/platform variability and do not establish how
much of the difference is auditing. A rolled-back staging EXPLAIN on a new
synthetic unit measured **1.015 ms** for `essential_audit_change`, **1.318 ms**
for the entire database update. No claim of zero mutation overhead is made.
Opening measures cached draft test files and visible content, not document
downloads or optional audit completion. It cannot be generalised to cold sale
or rental loads. All benchmark units were cleaned up; rollback diagnostics left
no synthetic units.

Live smoke verification also passed: anonymous/contractor/resident denied,
admin business/Auth/view feeds readable, cursor pages nonoverlapping, exactly
two persisted opens, no views in the business feed, and the audit UI renders
all three streams. Only sanitised counts/timings/booleans are committed in
`artifacts/audit`; no credentials, request bodies or provider identity export.
Use `npm run test:audit` for local audit regression tests. The smoke script
expects the authorised staging test credentials and a verified feature-preview
URL; performance scripts also require the private authorised fixture scope
file `.next/performance/staging-test-sales.json` (recreate after a Next build).

## Retention proposal

Business histories retain their existing retention and parent-deletion semantics.
Optional unit opens: **30 days**, separate table, excluded from the business
feed. At the expected 30 opens/day this retains approximately **900 rows**,
before five-minute repeat deduplication. A daily database job purges expired
rows; reads also exclude expired rows. No document contents, URLs, tokens,
buyer contacts, email bodies or arbitrary request payloads belong in this stream.
