-- Snag reports are generated from the existing snag report filters.
-- They record the generated PDF, included snags and contractor recipients.

insert into storage.buckets (id, name, public)
values ('snag-reports', 'snag-reports', false)
on conflict (id) do update set public = false;

create table if not exists public.snag_reports (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  communal_area_id uuid references public.areas(id) on delete set null,
  location_type text not null check (location_type in ('unit', 'communal')),
  location_label text not null,
  include_photos boolean not null default true,
  include_closed_snags boolean not null default false,
  snag_count integer not null default 0,
  file_path text,
  file_url text,
  sent_by_user_id uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.snag_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.snag_reports(id) on delete cascade,
  snag_id uuid not null references public.snags(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (report_id, snag_id)
);

create table if not exists public.snag_report_recipients (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.snag_reports(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  email text not null,
  name text,
  organisation_id uuid references public.organisations(id) on delete set null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists snag_reports_building_created_idx on public.snag_reports (building_id, created_at desc);
create index if not exists snag_report_items_report_idx on public.snag_report_items (report_id, sort_order);
create index if not exists snag_report_items_snag_idx on public.snag_report_items (snag_id);
create index if not exists snag_report_recipients_report_idx on public.snag_report_recipients (report_id);
create index if not exists snag_report_recipients_user_idx on public.snag_report_recipients (user_id);

alter table public.snag_reports enable row level security;
alter table public.snag_report_items enable row level security;
alter table public.snag_report_recipients enable row level security;

drop policy if exists "operational users read snag reports" on public.snag_reports;
create policy "operational users read snag reports"
on public.snag_reports for select
to authenticated
using (
  public.is_operational_user()
  and public.can_access_building(building_id)
);

drop policy if exists "operational users add snag reports" on public.snag_reports;
create policy "operational users add snag reports"
on public.snag_reports for insert
to authenticated
with check (
  public.is_operational_user()
  and public.can_access_building(building_id)
);

drop policy if exists "operational users read snag report items" on public.snag_report_items;
create policy "operational users read snag report items"
on public.snag_report_items for select
to authenticated
using (
  exists (
    select 1
    from public.snag_reports sr
    where sr.id = snag_report_items.report_id
      and public.is_operational_user()
      and public.can_access_building(sr.building_id)
  )
);

drop policy if exists "operational users add snag report items" on public.snag_report_items;
create policy "operational users add snag report items"
on public.snag_report_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.snag_reports sr
    where sr.id = snag_report_items.report_id
      and public.is_operational_user()
      and public.can_access_building(sr.building_id)
  )
);

drop policy if exists "operational users read snag report recipients" on public.snag_report_recipients;
create policy "operational users read snag report recipients"
on public.snag_report_recipients for select
to authenticated
using (
  exists (
    select 1
    from public.snag_reports sr
    where sr.id = snag_report_recipients.report_id
      and public.is_operational_user()
      and public.can_access_building(sr.building_id)
  )
);

drop policy if exists "operational users add snag report recipients" on public.snag_report_recipients;
create policy "operational users add snag report recipients"
on public.snag_report_recipients for insert
to authenticated
with check (
  exists (
    select 1
    from public.snag_reports sr
    where sr.id = snag_report_recipients.report_id
      and public.is_operational_user()
      and public.can_access_building(sr.building_id)
  )
);

drop policy if exists "authenticated users read snag report files" on storage.objects;
create policy "authenticated users read snag report files"
on storage.objects for select
to authenticated
using (bucket_id = 'snag-reports');
