create table if not exists public.digest_runs (
  id uuid primary key default gen_random_uuid(),
  digest_key text not null unique,
  digest_type text not null default 'snag_digest' check (digest_type in ('snag_digest')),
  scheduled_for timestamptz not null,
  status text not null default 'started' check (status in ('started', 'sent', 'skipped', 'failed')),
  recipients_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists digest_runs_scheduled_for_idx on public.digest_runs (scheduled_for desc);
create index if not exists digest_runs_status_idx on public.digest_runs (status);

alter table public.digest_runs enable row level security;

drop policy if exists "setup admins read digest runs" on public.digest_runs;

create policy "setup admins read digest runs"
on public.digest_runs for select
to authenticated
using (public.is_setup_admin());
