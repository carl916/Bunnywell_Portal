# Staging Seed

The Playwright e2e tests rely on known staging users and known portal data.

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

- The three Playwright auth users.
- Matching `profiles` rows with `admin`, `contractor`, and `resident` roles.
- Forum House staging building, units, rooms, trades, and contractor organisation.
- Building access for admin and contractor.
- Unit access for the resident.
- Predictable `[E2E]` snags and snag events.

The seed is designed to be repeatable. It recreates only snags with titles starting `[E2E]` and leaves other staging records alone.

Do not run this against the production Supabase project.
