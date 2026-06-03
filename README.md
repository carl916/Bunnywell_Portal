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

## POC Permission Model

- All authenticated users can view all snags
- All authenticated users can create snags
- Admin users can edit, delete, and change status
- Admin users can manage flats and users when the backend flow is connected
