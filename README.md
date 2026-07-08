# Bunnywell Portal

Proof-of-concept snagging and defects management system for residential developments.

## Current POC

- Responsive Next.js app with TypeScript and Tailwind CSS
- Seeded Forum House flats: 101-110, 201-210, 301-310
- Snag manager with search, status filter, and priority filter
- Standard user demo mode: create and view snags
- Admin demo mode: edit, delete, and change snag status
- Mobile-friendly photo capture/upload
- Freehand photo annotation with undo and clear
- Direct PDF report download for a selected flat
- Supabase Auth, Postgres, Storage, and admin-created users when credentials are configured

The first screen runs in local demo mode so the POC can be reviewed before Supabase credentials are configured.

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## System Guide

The current system guide lives at:

```text
docs/bunnywell-portal-system-guide.md
docs/bunnywell-portal-system-guide.pdf
```

When portal behaviour changes, update the Markdown guide in the same change and regenerate the PDF:

```bash
npm run docs:pdf
```

## Supabase Setup

Create a Supabase project, then run:

```text
supabase/schema.sql
supabase/seed.sql
```

Create a storage bucket for final snag images:

```text
snag-images
```

The schema also creates this bucket if the SQL is run with sufficient Supabase permissions.

Add the project credentials to `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Restart the dev server after adding `.env.local`.

### First Admin User

Create the first user in Supabase Auth, then make that user an admin:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin-email@example.com';
```

After that, the app's admin-only Create user panel can create more users.

## Production Schema Migration

The fuller MVP schema is in:

```text
supabase/migrations/20260606_production_schema.sql
```

Run this in the Supabase SQL Editor before deploying the production-schema UI. It preserves the original POC tables and data, adds the fuller buildings/units/areas/snags/handovers/meters structure, and relaxes old POC snag constraints so the newer workflow can use units instead of flats.

The migration also replaces the broad POC snag visibility policy with role-aware access:

- admin/developer users can see and manage snags
- contractor/trade users see snags assigned to their organisation
- leaseholders/agents see only leaseholder defects on units assigned to them

Then run:

```text
supabase/migrations/20260606b_unit_types_private_amenity.sql
```

This adds reusable unit types, room templates, and unit-linked private amenity areas. Unit creation can then generate required rooms from the selected type, while optional areas such as an ensuite or private garden can be added manually where they apply.

Then run:

```text
supabase/migrations/20260606c_building_floors.sql
```

This adds building-specific floor labels so units choose a controlled floor value instead of free text.

Then run:

```text
supabase/migrations/20260607_security_hardening.sql
```

This tightens row-level security so the database enforces role-aware access rather than relying on UI filtering alone.

## Environment Separation

Use separate Supabase projects for development/testing and production before inviting real users:

- local development and Vercel preview: development Supabase project
- production domain: production Supabase project

Keep the same environment variable names, but use different values in each environment:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

See:

```text
docs/security-and-environments.md
```

## Production Permission Model

- admin/developer users can manage buildings, units, rooms, users, and snags
- contractor/trade users can only see and update snags assigned to their organisation
- leaseholder/agent users can only see and create defects for units they are assigned to
- legacy user accounts have no back-office access
