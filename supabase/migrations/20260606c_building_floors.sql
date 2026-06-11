-- Building-specific floor labels for unit setup.

create table if not exists public.building_floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, name)
);

insert into public.building_floors (building_id, name, sort_order)
select b.id, floor.name, floor.sort_order
from public.buildings b
join (
  values
    ('Lower ground', 0),
    ('Ground', 10),
    ('First', 20),
    ('Second', 30),
    ('Third', 40)
) as floor(name, sort_order)
on b.name = 'Forum House'
on conflict (building_id, name) do update set sort_order = excluded.sort_order;

alter table public.building_floors enable row level security;

drop policy if exists "authenticated users read building floors" on public.building_floors;
drop policy if exists "admins manage building floors" on public.building_floors;

create policy "authenticated users read building floors"
on public.building_floors for select
to authenticated
using (true);

create policy "admins manage building floors"
on public.building_floors for all
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')))
with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'developer')));
