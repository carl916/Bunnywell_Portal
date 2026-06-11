# Security and Environment Separation

## Recommended Environments

Bunnywell Portal should use separate Supabase projects for development/testing and production.

| Environment | App URL | Supabase project | Purpose |
| --- | --- | --- | --- |
| Local development | `http://localhost:3000` | Bunnywell Portal Dev | Building and testing changes |
| Vercel Preview | Vercel preview URLs | Bunnywell Portal Dev | Testing branches before production |
| Production | `https://defects.bunnywell.co.uk` | Bunnywell Portal Production | Real users and live defect data |

Do not point local development at the production Supabase project once real users or real defects are in the system.

## Environment Variables

Use the same variable names in every environment, but different values per Supabase project:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Local development:

- Store these in `.env.local`.
- Use the dev Supabase project values.

Vercel Preview:

- Set these in Vercel project environment variables for Preview.
- Use the dev Supabase project values.

Vercel Production:

- Set these in Vercel project environment variables for Production.
- Use the production Supabase project values.

## Deployment Flow

1. Make code and schema changes locally.
2. Apply database migrations to the dev Supabase project.
3. Test with multiple roles in the dev project.
4. Push to GitHub.
5. Check the Vercel preview deployment.
6. Apply the same migration to the production Supabase project.
7. Promote/deploy to production.

## Access Control Model

The database should enforce the same access rules as the UI:

- `admin` and `developer`: full back-office access.
- `contractor` and `trade`: only snags assigned to their organisation.
- `leaseholder` and `agent`: only leaseholder defects for units they can access.
- legacy `user`: no back-office access.

The migration `supabase/migrations/20260607_security_hardening.sql` adds database helper functions and tighter row-level security policies for this model.

## Storage Note

The current app uses public URLs from the `snag-images` bucket so PDF generation and image display are simple for the POC.

Before production data is sensitive, decide whether snag photos should remain public-by-URL or move to private storage with signed URLs. Moving to private storage is more secure, but requires app changes because stored image URLs would need to be generated on demand.

## Manual Checks Before Real Users

- Confirm row-level security is enabled on all production tables.
- Confirm the hardening migration has been run on the correct Supabase project.
- Test at least one account for each role.
- Confirm a leaseholder cannot see another unit.
- Confirm a contractor cannot see another contractor's snags.
- Confirm only admin/developer users can manage buildings, units, rooms, organisations, and users.
- Confirm the service role key exists only in server-side environments, never in browser code.
