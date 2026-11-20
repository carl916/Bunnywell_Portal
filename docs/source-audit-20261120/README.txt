Source preservation and staging reconciliation — 20 November 2026

Scope and findings
Audited all 18 registered worktrees and all local branch tips. The initial local
staging branch was 0a1ee76; origin/staging was bed77db. Live staging pointed to
dpl_GTKiohY3KUZDFFcwEtr8h3JnBKiz, a CLI source snapshot with no Git commit SHA.
The accepted workspace, Setup, reservation, authority, notification and snagging
changes existed in temporary deployment source snapshots rather than staging Git.

Local reconciliation
Commit 4ee3062 captures the latest manifest-verified staging source plus the
exchange/completion refinements. The subsequent normal merge of origin/staging
preserves the conveyancer payment-access commits and restores their migration
and tests. Existing uncommitted DisplayValue/AuthorityTerms work was retained.
No branch or worktree was deleted, reset, rebased or force-pushed.

Restored 20261118143432_staging_workspace.sql from the release snapshot and
compared its complete SQL with the staging migration-history entry: identical
after line-ending normalization. Four other local migrations had identical SQL
but different timestamps; filenames now match their actual applied staging
versions (see migration-version-map.json). They must not be replayed.
The refinement and verifier-boundary migrations were applied to staging as
20261120133511 and 20261120133747. Their local filenames match applied history.

Preservation
branch-inventory.json records every initial branch tip, remote containment and
commits absent from the original local staging history. Six formerly local-only branches were preserved remotely: building-workspace-contracts, notice-read-only-context,
p1-integration-review, sales-team-work-tidy, wider-workspace-integration and
experiment/sales-workspace-redesign. Their original local refs remain intact.
Verified archive refs use codex/archive-20261120/<original-name-with-dashes>.
The accepted workspace descendants are represented by the newer deployed source;
the sales-team-work-tidy change also has its accepted staging variant 315be1f.
Do not blindly merge old snapshots over the newer implementation.

Diagnostic phase2d/region trial branches and production release/workbook branches
remain separate; they are already retained by remote refs. Diagnostic commits
marked 'do not merge' were not introduced into staging.

The only loose source outside the main checkout was four untracked migrations in
Bunnywell_Portal_staging_check. Exact copies are under recovered-migrations/ for
review and preservation, deliberately outside the executable migration directory.
One is an explicitly scoped historical fixture cleanup; none was executed.
Other worktree changes were reports/lint outputs, not application source.
The main checkout's loose diagnostic/import scripts and completion reports are
preserved in Git. Existing private artifacts, temporary snapshots and the edited
cleanup workbook remain local; they are not release inputs.

Local recovery files (ignored, not uploaded)
artifacts/source-audit-20261120/all-local-refs.bundle contains all original Git refs.
artifacts/source-audit-20261120/inventory.json contains the initial worktree audit.
artifacts/exchange-completion-refinements-20261120/before/ preserves the original
uncommitted files before source reconciliation.
artifacts/source-audit-20261120/uncommitted-cleanup-template.xlsx backs up the
edited workbook without publishing its possible business data.
These local recovery files are not an off-machine backup.

Reproducibility and verification
Notification tests now read the current application source; required schema-only
fixtures live in tests/fixtures/notification-stage3 rather than tmp/. No fixture
contains database rows or credentials. Generated output, temporary source copies
and private diagnostics are excluded from accidental Git/Vercel uploads.
TypeScript passed. The reconciled application previously passed a Next Webpack
production build; the subsequent remote merge changed only tests and migration.
The affected 95-test contract suite and 97-test notification/permissions/dashboard
suite pass. A broader run and the original origin/staging baseline were compared.
The original baseline has 9 failing tests (646/655 pass); see test-results.txt for
the final reconciled count and the unresolved baseline failures. This is not a
claim that the entire legacy suite is green or that live browser workflows passed.

Publication status
GitHub preservation was explicitly approved and completed. All 55 local branch
tips are reachable from remote refs; six dedicated archive refs retain local-only
histories. The earlier automatic approval block was resolved by user approval.

See release-verification.txt for the deployed application revision, migrations,
browser checks and final production-alias comparison.
