# Staging review and rollback

1. Review the PR into `staging`, especially the accepted agency-access gap, source rules, validation limits and legacy date/unit warnings. Do not merge automatically.
2. Verify the Vercel project ID `prj_4s8vIyfrGh9DSGJcixTU5slevr5P`, team `team_x65ctL8Fot37UcabAkdh8f72`, Git repository `carl916/Bunnywell_Portal`, branch, commit SHA and preview target. A similarly named deployment is insufficient.
3. Verify the application's actual Supabase host is `vxkpvdtrldwwqiddoyof.supabase.co` before authenticating or writing. Do not print keys. Never use production resources for this review. An unverified branch preview is not an authorised mutation target.
4. The shared staging deployment inspected before this work was `dpl_E4i96wk3WWNUz7RJ83MEcXvY1fDU`, commit `1dfbeea0430739f69a9a324b822d90cce7619314`, preview target. It does not contain this feature until an approved staging merge/deployment occurs. Check the final PR/release evidence for any later branch preview; local tests do not update shared staging.
5. Use dedicated fixtures and test accounts from the existing test arrangements. Credentials stay in the local protected environment, never in PR text or screenshots. UPLOAD-3 has been advanced through synthetic document review and date correction and is **not** a fresh repeatable fixture. Its inconsistent unit stage intentionally remains visible. Diagnostic scripts guard against blindly rerunning approved document cases. Temporary dashboard accounts are disabled/banned and are not review logins.
6. Review both responsibility tabs as Admin/Developer and permitted external Sales roles. Check exact documents/query versions, explicit building scope, mobile context, refresh, back navigation, absence of internal modules for external roles and no internal Dashboard for residents. Resolve the remaining live workflow/contractor coverage in the validation matrix with fresh valid fixtures before treating end-to-end acceptance as complete.
7. Keep legal provider operations inside the existing authorised workflow and existing test recipient arrangements. Dashboard viewing must never issue an authority, resend, reconcile provider status or create notifications. No new email setup is required by this feature.

For local read-only validation:

```powershell
$env:DASHBOARD_TEST_STAGING='1'
$env:DASHBOARD_TEST_ORIGIN='http://localhost:3011'
node scripts/diagnostics/dashboard-read.mjs
```

The opt-in `dashboard-handoffs.mjs` script performs real synthetic writes and creates then disables temporary accounts. Read its guards and fixture state before running; its completion branch only succeeds on a valid existing unit stage. It must not be pointed at a production database or unverified preview. It is not an automatic CI job.

Rollback is a normal revert of the feature commit(s) followed by an explicitly approved staging deployment. No new schema or migration requires rollback. Keep synthetic business history intact; test accounts remain disabled. The dashboard is a projection, so reverting it does not erase or change the workflows it displayed. Do not restore an old database or change production for this rollback.

## Verified branch preview

[Draft PR #28](https://github.com/carl916/Bunnywell_Portal/pull/28) targets staging. The Git integration built [this isolated preview](https://bunnywell-portal-pv9ed7zux-carl-gilbert-s-projects.vercel.app) from `eb9445b24af55536fa635beacb73a4ececf5cf07`: deployment `dpl_6CEi1W2JK3c4cXNKMqhxV2wwxaPo`, READY, preview target, matching project/repository/branch. Its compiled public JavaScript points only to the verified staging Supabase host. Anonymous dashboard requests return 401. Authenticated read-only checks returned all nine sources ready. This deployment uses the existing `iad1` configuration; no region or environment change was made. Evidence-only documentation commits after this hash do not change application code. Verify the exact new deployment if using a later automatically built preview.
