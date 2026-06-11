-- Bunnywell Portal production schema expansion.
-- Safe path: preserve the POC tables, add production tables, and add compatibility columns.
-- Run 20260606a_enum_values.sql first, then run this file.

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('developer', 'contractor', 'managing_agent', 'sales_agent', 'solicitor', 'warranty_provider')),
  main_contact_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line_1 text,
  address_line_2 text,
  town text,
  postcode text,
  practical_completion_date date,
  defects_liability_end_date date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.building_organisations (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  role_on_project text,
  created_at timestamptz not null default now(),
  unique (building_id, organisation_id, role_on_project)
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_number text not null,
  floor text,
  unit_type text,
  size_sqft numeric,
  size_sqm numeric,
  sale_status text not null default 'for_sale' check (sale_status in ('for_sale', 'reserved', 'exchanged', 'completed', 'handed_over')),
  completion_date date,
  handover_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, unit_number)
);

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  area_type text not null check (area_type in ('unit_room', 'communal_area')),
  name text not null,
  floor text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists organisation_id uuid references public.organisations(id);
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles set name = coalesce(name, full_name) where name is null;

create table if not exists public.user_building_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  role_on_building text,
  created_at timestamptz not null default now(),
  unique (user_id, building_id)
);

create table if not exists public.user_unit_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  access_type text not null check (access_type in ('leaseholder', 'agent', 'representative')),
  created_at timestamptz not null default now(),
  unique (user_id, unit_id, access_type)
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  uploaded_by_user_id uuid references public.profiles(id),
  source_file_url text,
  source_type text not null check (source_type in ('professional_pdf', 'spreadsheet_import', 'manual_import')),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'imported', 'reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.snags add column if not exists building_id uuid references public.buildings(id);
alter table public.snags alter column flat_id drop not null;
alter table public.snags alter column created_by drop not null;
alter table public.snags alter column priority drop not null;
alter table public.snags add column if not exists unit_id uuid references public.units(id);
alter table public.snags add column if not exists area_id uuid references public.areas(id);
alter table public.snags add column if not exists source_type text not null default 'developer_snag' check (source_type in ('developer_snag', 'leaseholder_defect', 'imported_report'));
alter table public.snags add column if not exists created_by_user_id uuid references public.profiles(id);
alter table public.snags add column if not exists trade_id uuid references public.trades(id);
alter table public.snags add column if not exists priority_code text check (priority_code in ('P1', 'P2', 'P3'));
alter table public.snags add column if not exists assigned_to_organisation_id uuid references public.organisations(id);
alter table public.snags add column if not exists assigned_to_user_id uuid references public.profiles(id);
alter table public.snags add column if not exists sla_due_date timestamptz;
alter table public.snags add column if not exists import_batch_id uuid references public.import_batches(id);
alter table public.snags add column if not exists closed_at timestamptz;
update public.snags
set created_by_user_id = created_by
where created_by_user_id is null
  and created_by is not null;
update public.snags set priority_code = case priority when 1 then 'P1' when 2 then 'P2' when 3 then 'P3' else priority_code end where priority_code is null;

create table if not exists public.snag_photos (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  file_url text not null,
  photo_type text not null default 'annotated' check (photo_type in ('original', 'annotated', 'resolution_photo')),
  caption text,
  uploaded_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.snag_events (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  event_type text not null,
  old_value text,
  new_value text,
  comment text,
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.handovers (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  handover_by_user_id uuid references public.profiles(id),
  recipient_name text not null,
  recipient_email text,
  recipient_phone text,
  recipient_capacity text,
  number_of_keys integer not null default 0,
  signature_url text,
  handover_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  handover_id uuid references public.handovers(id) on delete set null,
  meter_type text not null check (meter_type in ('electricity', 'water', 'heat')),
  meter_serial_number text,
  reading_value text not null,
  reading_date date not null default current_date,
  photo_url text,
  created_by_user_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  report_type text not null,
  generated_by_user_id uuid references public.profiles(id),
  file_url text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.complete_handover_unit()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.units
    where id = new.unit_id and sale_status = 'completed'
  ) then
    raise exception 'Handovers can only be created for completed units.';
  end if;

  update public.units
  set sale_status = 'handed_over',
      handover_date = new.handover_date,
      updated_at = now()
  where id = new.unit_id;

  return new;
end;
$$;

drop trigger if exists handover_unit_status on public.handovers;
create trigger handover_unit_status
before insert on public.handovers
for each row execute function public.complete_handover_unit();

insert into public.buildings (name, address_line_1, town, status)
values ('Forum House', '', '', 'active')
on conflict do nothing;

insert into public.units (building_id, unit_number)
select b.id, f.flat_reference
from public.flats f
join public.buildings b on b.name = f.building_name
on conflict (building_id, unit_number) do nothing;

insert into public.areas (building_id, unit_id, area_type, name, sort_order)
select u.building_id, u.id, 'unit_room', room.name, room.sort_order
from public.units u
cross join (
  values
    ('Entrance / Hallway', 10),
    ('Kitchen', 20),
    ('Living Room', 30),
    ('Bedroom 1', 40),
    ('Bedroom 2', 50),
    ('Bathroom', 60)
) as room(name, sort_order)
on conflict do nothing;

insert into public.trades (name, sort_order)
values
  ('Decorating', 10),
  ('Electrical', 20),
  ('Plumbing', 30),
  ('Carpentry', 40),
  ('Flooring', 50),
  ('Cleaning', 60)
on conflict (name) do update set sort_order = excluded.sort_order;

update public.snags s
set unit_id = u.id,
    building_id = u.building_id
from public.flats f
join public.buildings b on b.name = f.building_name
join public.units u on u.building_id = b.id and u.unit_number = f.flat_reference
where s.flat_id = f.id
  and s.unit_id is null;

insert into public.snag_photos (snag_id, file_url, photo_type, uploaded_by_user_id)
select s.id, s.image_path, 'annotated', s.created_by_user_id
from public.snags s
where s.image_path is not null
  and not exists (select 1 from public.snag_photos p where p.snag_id = s.id and p.file_url = s.image_path);

alter table public.organisations enable row level security;
alter table public.buildings enable row level security;
alter table public.building_organisations enable row level security;
alter table public.units enable row level security;
alter table public.areas enable row level security;
alter table public.user_building_access enable row level security;
alter table public.user_unit_access enable row level security;
alter table public.trades enable row level security;
alter table public.import_batches enable row level security;
alter table public.snag_photos enable row level security;
alter table public.snag_events enable row level security;
alter table public.handovers enable row level security;
alter table public.meter_readings enable row level security;
alter table public.reports enable row level security;

-- Conservative POC policies. The app also filters by role client-side; tighten these further before wide production use.
drop policy if exists "authenticated users read buildings" on public.buildings;
drop policy if exists "admins manage buildings" on public.buildings;
drop policy if exists "authenticated users read units" on public.units;
drop policy if exists "admins manage units" on public.units;
drop policy if exists "authenticated users read areas" on public.areas;
drop policy if exists "admins manage areas" on public.areas;
drop policy if exists "authenticated users read trades" on public.trades;
drop policy if exists "admins manage trades" on public.trades;
drop policy if exists "authenticated users read snag photos" on public.snag_photos;
drop policy if exists "authenticated users add snag photos" on public.snag_photos;
drop policy if exists "authenticated users read snag events" on public.snag_events;
drop policy if exists "authenticated users add snag events" on public.snag_events;
drop policy if exists "admins manage handovers" on public.handovers;
drop policy if exists "authenticated users read handovers" on public.handovers;
drop policy if exists "authenticated users read meter readings" on public.meter_readings;
drop policy if exists "authenticated users add meter readings" on public.meter_readings;
drop policy if exists "authenticated users read organisations" on public.organisations;
drop policy if exists "admins manage organisations" on public.organisations;
drop policy if exists "snags are visible to authenticated users" on public.snags;
drop policy if exists "authenticated users create snags" on public.snags;
drop policy if exists "admins update snags" on public.snags;
drop policy if exists "admins delete snags" on public.snags;
create policy "authenticated users read buildings" on public.buildings for select to authenticated using (true);
create policy "admins manage buildings" on public.buildings for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
create policy "authenticated users read units" on public.units for select to authenticated using (true);
create policy "admins manage units" on public.units for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
create policy "authenticated users read areas" on public.areas for select to authenticated using (true);
create policy "admins manage areas" on public.areas for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
create policy "authenticated users read trades" on public.trades for select to authenticated using (true);
create policy "admins manage trades" on public.trades for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
create policy "authenticated users read snag photos" on public.snag_photos for select to authenticated using (true);
create policy "authenticated users add snag photos" on public.snag_photos for insert to authenticated with check (uploaded_by_user_id = auth.uid() or uploaded_by_user_id is null);
create policy "authenticated users read snag events" on public.snag_events for select to authenticated using (true);
create policy "authenticated users add snag events" on public.snag_events for insert to authenticated with check (created_by_user_id = auth.uid() or created_by_user_id is null);
create policy "admins manage handovers" on public.handovers for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
create policy "authenticated users read handovers" on public.handovers for select to authenticated using (true);
create policy "authenticated users read meter readings" on public.meter_readings for select to authenticated using (true);
create policy "authenticated users add meter readings" on public.meter_readings for insert to authenticated with check (created_by_user_id = auth.uid() or created_by_user_id is null);
create policy "authenticated users read organisations" on public.organisations for select to authenticated using (true);
create policy "admins manage organisations" on public.organisations for all to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer'))) with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));

create policy "role aware snag visibility"
on public.snags for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('admin', 'developer')
        or snags.created_by_user_id = auth.uid()
        or (
          p.role in ('contractor', 'trade')
          and p.organisation_id is not null
          and snags.assigned_to_organisation_id = p.organisation_id
        )
        or (
          p.role in ('leaseholder', 'agent')
          and snags.source_type = 'leaseholder_defect'
          and exists (
            select 1 from public.user_unit_access uua
            where uua.user_id = auth.uid()
              and uua.unit_id = snags.unit_id
          )
        )
      )
  )
);

create policy "role aware snag inserts"
on public.snags for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'developer', 'contractor', 'trade'))
    or (
      source_type = 'leaseholder_defect'
      and exists (
        select 1 from public.user_unit_access uua
        where uua.user_id = auth.uid()
          and uua.unit_id = snags.unit_id
      )
    )
  )
);

create policy "role aware snag updates"
on public.snags for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('admin', 'developer')
        or (
          p.role in ('contractor', 'trade')
          and p.organisation_id is not null
          and snags.assigned_to_organisation_id = p.organisation_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('admin', 'developer')
        or (
          p.role in ('contractor', 'trade')
          and p.organisation_id is not null
          and snags.assigned_to_organisation_id = p.organisation_id
        )
      )
  )
);

create policy "admins delete snags production"
on public.snags for delete
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
