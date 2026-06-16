alter table public.buildings
add column if not exists photo_url text,
add column if not exists documents_url text,
add column if not exists home_user_guide_url text;

alter table public.units
add column if not exists parking_bays integer[];

drop policy if exists "permitted users read meter readings" on public.meter_readings;
drop policy if exists "permitted users add meter readings" on public.meter_readings;

create policy "permitted users read meter readings"
on public.meter_readings for select
to authenticated
using (
  public.is_back_office_user()
  or public.can_access_unit(unit_id)
);

create policy "permitted users add meter readings"
on public.meter_readings for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and public.can_access_unit(unit_id)
  and meter_type in ('electricity', 'water')
  and photo_url is not null
);
