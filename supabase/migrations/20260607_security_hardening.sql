-- Bunnywell Portal security hardening.
-- Apply after the production schema migrations.

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function public.current_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_back_office_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;

create or replace function public.can_access_building(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_back_office_user()
    or exists (
      select 1
      from public.user_building_access uba
      where uba.user_id = auth.uid()
        and uba.building_id = target_building_id
    )
    or exists (
      select 1
      from public.user_unit_access uua
      join public.units u on u.id = uua.unit_id
      where uua.user_id = auth.uid()
        and u.building_id = target_building_id
    ),
    false
  )
$$;

create or replace function public.can_access_unit(target_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_back_office_user()
    or exists (
      select 1
      from public.user_unit_access uua
      where uua.user_id = auth.uid()
        and uua.unit_id = target_unit_id
    )
    or exists (
      select 1
      from public.units u
      join public.user_building_access uba on uba.building_id = u.building_id
      where u.id = target_unit_id
        and uba.user_id = auth.uid()
    ),
    false
  )
$$;

create or replace function public.can_access_snag_row(
  target_source_type text,
  target_unit_id uuid,
  target_assigned_organisation_id uuid,
  target_created_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_back_office_user()
    or target_created_by_user_id = auth.uid()
    or (
      public.current_app_role() in ('contractor', 'trade')
      and public.current_organisation_id() is not null
      and target_assigned_organisation_id = public.current_organisation_id()
    )
    or (
      public.current_app_role() in ('leaseholder', 'agent')
      and target_source_type = 'leaseholder_defect'
      and target_unit_id is not null
      and public.can_access_unit(target_unit_id)
    ),
    false
  )
$$;

create or replace function public.can_access_snag(target_snag_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.snags s
      where s.id = target_snag_id
        and public.can_access_snag_row(s.source_type, s.unit_id, s.assigned_to_organisation_id, s.created_by_user_id)
    ),
    false
  )
$$;

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "profiles visible to permitted users" on public.profiles;
drop policy if exists "back office manage profiles" on public.profiles;

create policy "profiles visible to permitted users"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_back_office_user()
  or organisation_id = public.current_organisation_id()
);

create policy "back office manage profiles"
on public.profiles for all
to authenticated
using (public.is_back_office_user())
with check (public.is_back_office_user());

drop policy if exists "authenticated users read buildings" on public.buildings;
drop policy if exists "authenticated users read units" on public.units;
drop policy if exists "authenticated users read areas" on public.areas;
drop policy if exists "authenticated users read trades" on public.trades;
drop policy if exists "authenticated users read organisations" on public.organisations;
drop policy if exists "authenticated users read snag photos" on public.snag_photos;
drop policy if exists "authenticated users add snag photos" on public.snag_photos;
drop policy if exists "authenticated users read snag events" on public.snag_events;
drop policy if exists "authenticated users add snag events" on public.snag_events;
drop policy if exists "authenticated users read handovers" on public.handovers;
drop policy if exists "authenticated users read meter readings" on public.meter_readings;
drop policy if exists "authenticated users add meter readings" on public.meter_readings;

drop policy if exists "permitted users read buildings" on public.buildings;
drop policy if exists "permitted users read units" on public.units;
drop policy if exists "permitted users read areas" on public.areas;
drop policy if exists "authenticated users read trades hardened" on public.trades;
drop policy if exists "permitted users read organisations" on public.organisations;
drop policy if exists "permitted users read snag photos" on public.snag_photos;
drop policy if exists "permitted users add snag photos" on public.snag_photos;
drop policy if exists "permitted users read snag events" on public.snag_events;
drop policy if exists "permitted users add snag events" on public.snag_events;
drop policy if exists "permitted users read handovers" on public.handovers;
drop policy if exists "permitted users read meter readings" on public.meter_readings;
drop policy if exists "permitted users add meter readings" on public.meter_readings;

create policy "permitted users read buildings"
on public.buildings for select
to authenticated
using (public.can_access_building(id));

create policy "permitted users read units"
on public.units for select
to authenticated
using (public.can_access_unit(id));

create policy "permitted users read areas"
on public.areas for select
to authenticated
using (
  public.is_back_office_user()
  or (unit_id is not null and public.can_access_unit(unit_id))
  or (unit_id is null and building_id is not null and public.can_access_building(building_id))
);

create policy "authenticated users read trades hardened"
on public.trades for select
to authenticated
using (true);

create policy "permitted users read organisations"
on public.organisations for select
to authenticated
using (
  public.is_back_office_user()
  or id = public.current_organisation_id()
);

create policy "permitted users read snag photos"
on public.snag_photos for select
to authenticated
using (public.can_access_snag(snag_id));

create policy "permitted users add snag photos"
on public.snag_photos for insert
to authenticated
with check (
  uploaded_by_user_id = auth.uid()
  and public.can_access_snag(snag_id)
);

create policy "permitted users read snag events"
on public.snag_events for select
to authenticated
using (public.can_access_snag(snag_id));

create policy "permitted users add snag events"
on public.snag_events for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and public.can_access_snag(snag_id)
);

create policy "permitted users read handovers"
on public.handovers for select
to authenticated
using (public.is_back_office_user() or public.can_access_unit(unit_id));

create policy "permitted users read meter readings"
on public.meter_readings for select
to authenticated
using (
  public.is_back_office_user()
  or exists (
    select 1
    from public.handovers h
    where h.id = meter_readings.handover_id
      and public.can_access_unit(h.unit_id)
  )
);

create policy "permitted users add meter readings"
on public.meter_readings for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and (
    public.is_back_office_user()
    or exists (
      select 1
      from public.handovers h
      where h.id = meter_readings.handover_id
        and public.can_access_unit(h.unit_id)
    )
  )
);

drop policy if exists "role aware snag visibility" on public.snags;
drop policy if exists "role aware snag inserts" on public.snags;
drop policy if exists "role aware snag updates" on public.snags;
drop policy if exists "admins delete snags production" on public.snags;

create policy "role aware snag visibility"
on public.snags for select
to authenticated
using (
  public.can_access_snag_row(source_type, unit_id, assigned_to_organisation_id, created_by_user_id)
);

create policy "role aware snag inserts"
on public.snags for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and (
    (
      public.is_back_office_user()
      and source_type = 'developer_snag'
    )
    or (
      public.current_app_role() in ('leaseholder', 'agent')
      and source_type = 'leaseholder_defect'
      and unit_id is not null
      and public.can_access_unit(unit_id)
    )
  )
);

create policy "role aware snag updates"
on public.snags for update
to authenticated
using (
  public.is_back_office_user()
  or (
    public.current_app_role() in ('contractor', 'trade')
    and public.current_organisation_id() is not null
    and assigned_to_organisation_id = public.current_organisation_id()
  )
)
with check (
  public.is_back_office_user()
  or (
    public.current_app_role() in ('contractor', 'trade')
    and public.current_organisation_id() is not null
    and assigned_to_organisation_id = public.current_organisation_id()
  )
);

create policy "admins delete snags production"
on public.snags for delete
to authenticated
using (public.is_back_office_user());

drop policy if exists "authenticated users read building floors" on public.building_floors;
drop policy if exists "permitted users read building floors" on public.building_floors;
create policy "permitted users read building floors"
on public.building_floors for select
to authenticated
using (public.can_access_building(building_id));

drop policy if exists "user building access visible to owner and back office" on public.user_building_access;
drop policy if exists "user unit access visible to owner and back office" on public.user_unit_access;

create policy "user building access visible to owner and back office"
on public.user_building_access for select
to authenticated
using (user_id = auth.uid() or public.is_back_office_user());

create policy "user unit access visible to owner and back office"
on public.user_unit_access for select
to authenticated
using (user_id = auth.uid() or public.is_back_office_user());

drop policy if exists "authenticated users upload snag images" on storage.objects;
drop policy if exists "admins update snag images" on storage.objects;
drop policy if exists "admins delete snag images" on storage.objects;
drop policy if exists "authenticated users upload snag images hardened" on storage.objects;
drop policy if exists "back office update snag images hardened" on storage.objects;
drop policy if exists "back office delete snag images hardened" on storage.objects;

create policy "authenticated users upload snag images hardened"
on storage.objects for insert
to authenticated
with check (bucket_id = 'snag-images');

create policy "back office update snag images hardened"
on storage.objects for update
to authenticated
using (bucket_id = 'snag-images' and public.is_back_office_user())
with check (bucket_id = 'snag-images' and public.is_back_office_user());

create policy "back office delete snag images hardened"
on storage.objects for delete
to authenticated
using (bucket_id = 'snag-images' and public.is_back_office_user());
