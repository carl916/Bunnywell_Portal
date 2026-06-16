alter table public.handovers
add column if not exists handover_datetime timestamptz,
add column if not exists recipient_relationship text,
add column if not exists recipient_relationship_other text,
add column if not exists declaration_accepted boolean not null default false;

update public.handovers
set handover_datetime = coalesce(handover_datetime, handover_date::timestamptz)
where handover_datetime is null;

create table if not exists public.handover_key_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers(id) on delete cascade,
  key_type text not null,
  quantity integer not null check (quantity > 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.handover_photos (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers(id) on delete cascade,
  file_url text not null,
  photo_type text not null default 'keys' check (photo_type in ('keys', 'other')),
  caption text,
  uploaded_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.handover_key_items enable row level security;
alter table public.handover_photos enable row level security;

drop policy if exists "admins manage handovers" on public.handovers;
drop policy if exists "back office manage handovers" on public.handovers;
create policy "back office manage handovers"
on public.handovers for all
to authenticated
using (public.is_back_office_user())
with check (public.is_back_office_user());

drop policy if exists "permitted users read handover key items" on public.handover_key_items;
drop policy if exists "permitted users add handover key items" on public.handover_key_items;
drop policy if exists "permitted users read handover photos" on public.handover_photos;
drop policy if exists "permitted users add handover photos" on public.handover_photos;

create policy "permitted users read handover key items"
on public.handover_key_items for select
to authenticated
using (
  (
    public.is_back_office_user()
    or public.current_app_role() = 'contractor'
  )
  and exists (
    select 1
    from public.handovers h
    where h.id = handover_key_items.handover_id
      and public.can_access_unit(h.unit_id)
  )
);

create policy "permitted users add handover key items"
on public.handover_key_items for insert
to authenticated
with check (
  public.is_back_office_user()
  and exists (
    select 1
    from public.handovers h
    where h.id = handover_key_items.handover_id
  )
);

create policy "permitted users read handover photos"
on public.handover_photos for select
to authenticated
using (
  (
    public.is_back_office_user()
    or public.current_app_role() = 'contractor'
  )
  and exists (
    select 1
    from public.handovers h
    where h.id = handover_photos.handover_id
      and public.can_access_unit(h.unit_id)
  )
);

create policy "permitted users add handover photos"
on public.handover_photos for insert
to authenticated
with check (
  uploaded_by_user_id = auth.uid()
  and public.is_back_office_user()
  and exists (
    select 1
    from public.handovers h
    where h.id = handover_photos.handover_id
  )
);

drop policy if exists "permitted users read handovers" on public.handovers;
create policy "permitted users read handovers"
on public.handovers for select
to authenticated
using (
  public.is_back_office_user()
  or (
    public.current_app_role() = 'contractor'
    and public.can_access_unit(unit_id)
  )
);

drop policy if exists "permitted users read meter readings" on public.meter_readings;
create policy "permitted users read meter readings"
on public.meter_readings for select
to authenticated
using (
  public.is_back_office_user()
  or (
    public.current_app_role() = 'contractor'
    and public.can_access_unit(unit_id)
  )
  or (
    handover_id is null
    and public.can_access_unit(unit_id)
  )
);
