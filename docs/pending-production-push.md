# Pending Production Push

Do not push yet. Local functional changes are being batched before production deployment.

Remember to include the previous unpushed TSX changes plus the current user/workflow changes when copying to the GitHub repo and pushing to production.

Known changed files in this local batch:

- `src/components/portal/ProductionPortalApp.tsx`
- `src/app/api/admin/users/route.ts`
- `supabase/migrations/20260612_audit_events.sql`
- `docs/pending-production-push.md`

Before production push:

- Copy changed files from the Codex workspace into `C:\Users\carlg\Documents\GitHub\Bunnywell_Portal`.
- Test locally against the dev Supabase project.
- Push through GitHub Desktop after the local test passes.
