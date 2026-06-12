# Backup and Recovery

## Purpose

This document describes how Bunnywell Portal data should be protected and recovered if something goes wrong.

The current application does not expose delete actions for snags or photos. That reduces day-to-day risk, but backups are still needed for database corruption, bad migrations, accidental admin changes, failed deployments, or platform issues.

## Systems Covered

| System | Holds | Recovery method |
| --- | --- | --- |
| Supabase Postgres | users, buildings, units, areas, snags, comments, audit history, metadata | Supabase database backup or corrective SQL |
| Supabase Storage | snag photos and report images | Storage object recovery/export process |
| Vercel | deployed app code | redeploy or roll back deployment |
| GitHub | source code and migrations | branch, pull request, revert, or redeploy |

## Environments

Local development and Vercel Preview use:

```text
Bunnywell Portal Dev
```

Production uses:

```text
Bunnywell Portal
```

Backups and recovery actions for production must be performed against the production Supabase project only after confirming the active project name.

## Current Backup Position

Supabase database backups depend on the project plan.

- Free projects should be treated as having no reliable automatic backup for production use.
- Pro projects include daily database backups.
- Point-in-Time Recovery is available as a paid add-on on eligible plans.

Supabase database backups cover the Postgres database. They do not restore Storage files themselves, so snag photos need separate consideration if they become business-critical.

## Recommended Backup Policy

For the current POC / early production phase:

- Keep production on a Supabase plan with daily database backups before inviting real users.
- Export production data manually before major schema changes.
- Apply migrations to Dev first, then Production.
- Keep all schema changes in `supabase/migrations`.
- Keep GitHub as the source of truth for application code.
- Use Vercel deployment history for app rollback.

For mature production:

- Enable Supabase Point-in-Time Recovery.
- Add a regular Storage export process for snag photos.
- Test restoring production backup into a temporary or dev Supabase project at least monthly.

## Before Running Production Migrations

Before applying SQL to production:

1. Confirm the SQL has already been run successfully on Dev.
2. Confirm Preview has been tested.
3. Confirm the active Supabase project is the production project.
4. Check whether a recent database backup exists.
5. Save a copy of the migration SQL in the repo.
6. Run the migration during a quiet period.
7. Test login, snags, reports, and role access immediately after.

## Recovery Scenarios

### Bad App Deployment

Use Vercel rollback.

1. Open Vercel.
2. Go to Bunnywell Portal.
3. Open Deployments.
4. Select the last known good Production deployment.
5. Redeploy or promote it.
6. Confirm `https://defects.bunnywell.co.uk` works.

### Bad Preview Deployment

No production recovery is needed.

1. Fix the branch.
2. Push a new commit.
3. Let Vercel create a new Preview deployment.

### Bad Database Migration

Preferred route:

1. Stop applying further migrations.
2. Identify the affected tables.
3. If small, apply a corrective migration.
4. If severe, restore from Supabase backup.
5. Test restore in Dev or a temporary project before restoring Production where possible.

### Incorrect Data Entered

Preferred route:

1. Correct the data in the app if possible.
2. If the app cannot correct it, use a targeted SQL update.
3. Avoid full database restore for small data mistakes.

### Missing Snag or Photo

The app currently does not expose delete controls for snags or photos.

If a snag appears missing:

1. Check filters, building selection, unit selection, and role access first.
2. Check the `snags` table in Supabase.
3. Check row-level security by testing with an admin account.
4. Check whether the photo exists in Supabase Storage.

If a Storage file has been removed, database backup alone may not recover the file.

### User Locked Out

1. Use Supabase Authentication to confirm the user exists.
2. Check the `profiles` row has the correct role.
3. Check `user_building_access` or `user_unit_access`.
4. Send/reset password through Supabase if required.

## Manual Backup Checklist

Before major changes:

- Export production database or confirm recent Supabase backup.
- Confirm production environment variables point to production Supabase.
- Confirm Preview environment variables point to Dev Supabase.
- Confirm the latest code is committed to GitHub.
- Confirm migrations are committed to GitHub.

## Monthly Recovery Test

Once the system is used by real users, perform a monthly restore test:

1. Pick a recent production backup.
2. Restore it into a temporary Supabase project or Dev if safe.
3. Point local `.env.local` at the restored project.
4. Confirm login works.
5. Confirm buildings, units, snags, photos, and reports work.
6. Record the date and any issues found.

## Ownership

Production recovery should be performed only by someone with access to:

- Supabase production project
- Vercel production project
- GitHub repository
- Bunnywell domain/DNS if required

For now, this is a manual operational process. Automation can be added later when the app usage justifies it.
