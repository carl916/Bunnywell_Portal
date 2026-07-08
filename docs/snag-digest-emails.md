# Snag Digest Emails

The portal sends a scheduled developer-snag digest from `/api/cron/snag-digest`.

## Schedule

Vercel cron runs in UTC, so `vercel.json` calls the same endpoint at both `06:30` and `07:30` UTC. The endpoint sends only during the local London 07:00 hour, which allows for delayed cron delivery while still using a single `07:30` digest key to prevent duplicate emails.

- Daily digest: every day at 07:30 UK time.
- Weekly reminder: included in the Monday 07:30 UK time digest.

The daily section covers developer-snag activity from the previous 24 hours. The weekly section is a quieter reminder of outstanding developer-snag action buckets.

## What Is Included

Daily update sections are sent only when there is activity:

- New developer snags
- Ready for review
- Closed
- Rejected back to contractor
- More info requested
- Information supplied

Weekly reminder sections are sent only when there are outstanding items:

- Ready for review
- Needs more information
- Information supplied
- Rejected back to contractor
- Needs trade allocation

No email is sent when there are no digest-worthy updates or outstanding weekly actions.

## Recipients

Digest recipients are active portal users with one of these roles:

- Admin
- Developer
- Developer Representative
- Contractor

Admins and Developers receive all buildings. Developer Representatives and Contractors receive the buildings assigned to them in `user_building_access`.

Residents do not receive this digest.

## Required Environment Variables

Set these in Vercel for the environment where the digest should run:

```text
CRON_SECRET=long-random-secret
DIGEST_EMAILS_ENABLED=true
RESEND_API_KEY=...
DIGEST_FROM_EMAIL=Bunnywell Portal <no-reply@bunnywell.co.uk>
DIGEST_APP_URL=https://staging.bunnywell.co.uk
```

Useful safety controls:

```text
DIGEST_EMAILS_ENABLED=false
DIGEST_DRY_RUN_EMAIL=carl@example.com
DIGEST_RECIPIENT_ALLOWLIST=carl@example.com,another@example.com
```

Use `DIGEST_EMAILS_ENABLED=false` to disable an environment. Use `DIGEST_DRY_RUN_EMAIL` in staging if you want every generated email routed to one inbox instead of real users.

## Database

Run `supabase/migrations/20260702_digest_runs.sql` before enabling the cron in an environment.

`digest_runs` records each run so Vercel retries, delayed delivery, or duplicate UTC schedules do not send duplicate digest emails for the same local 07:30 run.
