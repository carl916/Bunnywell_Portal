create table if not exists public.resident_access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  resident_type text not null check (resident_type in ('leaseholder', 'tenant', 'letting_agent', 'managing_agent')),
  requested_units jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by_user_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resident_access_requests_status_idx on public.resident_access_requests(status);
create index if not exists resident_access_requests_email_idx on public.resident_access_requests(lower(email));

alter table public.resident_access_requests enable row level security;

drop policy if exists "back office manage resident access requests" on public.resident_access_requests;

create policy "back office manage resident access requests"
on public.resident_access_requests for all
to authenticated
using (public.is_back_office_user())
with check (public.is_back_office_user());
