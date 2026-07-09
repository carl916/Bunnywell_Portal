# Staging Playwright Data

The Playwright e2e tests run the portal locally at `http://localhost:3000`, but they use the Supabase project configured in GitHub Actions secrets.

The current GitHub Actions Playwright setup points at the Bunnywell staging database. This means write tests create real staging records, including `[E2E ...]` developer snags and uploaded snag photos.

## Current Staging Test Accounts

The following users are expected to exist in staging and have matching GitHub Actions secrets:

| Role | Email | Staging allocation |
| --- | --- | --- |
| Admin | `carl.gilbert@gmail.com` | All buildings |
| Developer Representative | `devrep@bunnywell.co.uk` | Airey Miller, Forum House only |
| Contractor | `contractor@bunnywell.co.uk` | Benchmark Construction, Forum House only |
| Resident | `resident@bunnywell.co.uk` | Forum House flats 101 and 201 |

Required GitHub Actions secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PLAYWRIGHT_ADMIN_EMAIL
PLAYWRIGHT_ADMIN_PASSWORD
PLAYWRIGHT_CONTRACTOR_EMAIL
PLAYWRIGHT_CONTRACTOR_PASSWORD
PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL
PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD
PLAYWRIGHT_RESIDENT_EMAIL
PLAYWRIGHT_RESIDENT_PASSWORD
```

Resident journey coverage should stay light until the resident workflow is fully built. Current resident e2e coverage should only check that residents can sign in and can/cannot see the correct navigation areas.

## Snag Photo Fixtures

Snagging workflow tests use image files committed under:

```text
tests/fixtures/snag-photos
```

GitHub Actions can upload these files because they are included in the repository checkout. Keep the fixture images small and non-sensitive.

## Optional Local Seed

Run the staging seed after schema migrations, after rotating test passwords, or whenever the staging data has drifted.

```powershell
npm.cmd run seed:staging
```

The command reads these values from `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PLAYWRIGHT_ADMIN_EMAIL
PLAYWRIGHT_ADMIN_PASSWORD
PLAYWRIGHT_CONTRACTOR_EMAIL
PLAYWRIGHT_CONTRACTOR_PASSWORD
PLAYWRIGHT_RESIDENT_EMAIL
PLAYWRIGHT_RESIDENT_PASSWORD
```

It creates or updates:

- The legacy admin, contractor, and resident Playwright auth users.
- Matching `profiles` rows with `admin`, `contractor`, and `resident` roles.
- Forum House staging building, units, rooms, trades, and contractor organisation.
- Building access for admin and contractor.
- Unit access for the resident.
- Predictable `[E2E]` snags and snag events.

The current CI baseline also expects the Developer Representative staging account above. If the staging seed script is used, confirm that `devrep@bunnywell.co.uk` still exists afterwards and remains allocated to Forum House.

The seed is designed to be repeatable. It recreates only snags with titles starting `[E2E]` and leaves other staging records alone.

Do not run this against the production Supabase project.
