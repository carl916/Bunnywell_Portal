-- Unit type templates and private amenity support.

create table if not exists public.unit_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.unit_type_areas (
  id uuid primary key default gen_random_uuid(),
  unit_type_id uuid not null references public.unit_types(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  optional boolean not null default false,
  created_at timestamptz not null default now(),
  unique (unit_type_id, name)
);

alter table public.units add column if not exists unit_type_id uuid references public.unit_types(id);
alter table public.units drop column if exists size_sqft;

alter table public.areas
drop constraint if exists areas_area_type_check;

alter table public.areas
add constraint areas_area_type_check
check (area_type in ('unit_room', 'communal_area', 'private_amenity'));

insert into public.unit_types (name, description)
values
  ('1-bed', 'One bedroom apartment'),
  ('1-bed + study', 'One bedroom apartment with study'),
  ('2-bed', 'Two bedroom apartment')
on conflict (name) do update set description = excluded.description;

insert into public.unit_type_areas (unit_type_id, name, sort_order, optional)
select unit_types.id, area.name, area.sort_order, area.optional
from public.unit_types
join (
  values
    ('1-bed', 'Kitchen', 10, false),
    ('1-bed', 'Lounge', 20, false),
    ('1-bed', 'Store', 30, false),
    ('1-bed', 'Bathroom', 40, false),
    ('1-bed', 'Bedroom', 50, false),
    ('1-bed + study', 'Kitchen', 10, false),
    ('1-bed + study', 'Lounge', 20, false),
    ('1-bed + study', 'Store', 30, false),
    ('1-bed + study', 'Bathroom', 40, false),
    ('1-bed + study', 'Bedroom', 50, false),
    ('1-bed + study', 'Study', 60, false),
    ('2-bed', 'Kitchen', 10, false),
    ('2-bed', 'Lounge', 20, false),
    ('2-bed', 'Store', 30, false),
    ('2-bed', 'Bathroom', 40, false),
    ('2-bed', 'Bedroom 1', 50, false),
    ('2-bed', 'Bedroom 2', 60, false),
    ('2-bed', 'Ensuite', 70, true),
    ('2-bed', 'Private garden', 80, true)
) as area(type_name, name, sort_order, optional)
on area.type_name = unit_types.name
on conflict (unit_type_id, name) do update
set sort_order = excluded.sort_order,
    optional = excluded.optional;

alter table public.unit_types enable row level security;
alter table public.unit_type_areas enable row level security;

drop policy if exists "authenticated users read unit types" on public.unit_types;
drop policy if exists "admins manage unit types" on public.unit_types;
drop policy if exists "authenticated users read unit type areas" on public.unit_type_areas;
drop policy if exists "admins manage unit type areas" on public.unit_type_areas;

create policy "authenticated users read unit types"
on public.unit_types for select
to authenticated
using (true);

create policy "admins manage unit types"
on public.unit_types for all
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')))
with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));

create policy "authenticated users read unit type areas"
on public.unit_type_areas for select
to authenticated
using (true);

create policy "admins manage unit type areas"
on public.unit_type_areas for all
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')))
with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
