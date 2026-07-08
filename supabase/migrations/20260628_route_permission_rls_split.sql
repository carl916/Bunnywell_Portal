-- Split setup-admin access from operational access.
-- Admins and Developers can use Setup, People & access and Activity log.
-- Developer Representatives keep operational snag/building access only for assigned buildings.

create or replace function public.is_setup_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;

create or replace function public.is_operational_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer', 'developer_representative'), false)
$$;

create or replace function public.is_back_office_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_setup_admin()
$$;

create or replace function public.can_access_building(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_setup_admin()
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
    public.is_setup_admin()
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

drop policy if exists "role aware snag visibility" on public.snags;
drop policy if exists "role aware snag inserts" on public.snags;
drop policy if exists "role aware snag updates" on public.snags;
drop policy if exists "permitted users read snag photos" on public.snag_photos;
drop policy if exists "permitted users add snag photos" on public.snag_photos;
drop policy if exists "permitted users read snag events" on public.snag_events;
drop policy if exists "permitted users add snag events" on public.snag_events;

drop function if exists public.can_access_snag(uuid);
drop function if exists public.can_access_snag_row(text, uuid, uuid, uuid, uuid);

create or replace function public.can_access_snag_row(
  target_source_type text,
  target_building_id uuid,
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
    public.is_setup_admin()
    or target_created_by_user_id = auth.uid()
    or (
      public.current_app_role() = 'developer_representative'
      and (
        (target_building_id is not null and public.can_access_building(target_building_id))
        or (target_unit_id is not null and public.can_access_unit(target_unit_id))
      )
    )
    or (
      public.current_app_role() = 'contractor'
      and (
        (
          public.current_organisation_id() is not null
          and target_assigned_organisation_id = public.current_organisation_id()
        )
        or (target_building_id is not null and public.can_access_building(target_building_id))
        or (target_unit_id is not null and public.can_access_unit(target_unit_id))
      )
    )
    or (
      public.current_app_role() = 'resident'
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
        and public.can_access_snag_row(s.source_type, s.building_id, s.unit_id, s.assigned_to_organisation_id, s.created_by_user_id)
    ),
    false
  )
$$;

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

drop policy if exists "profiles visible to permitted users" on public.profiles;
create policy "profiles visible to permitted users"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_setup_admin()
  or organisation_id = public.current_organisation_id()
);

drop policy if exists "back office manage profiles" on public.profiles;
create policy "back office manage profiles"
on public.profiles for all
to authenticated
using (public.is_setup_admin())
with check (public.is_setup_admin());

drop policy if exists "permitted users read organisations" on public.organisations;
create policy "permitted users read organisations"
on public.organisations for select
to authenticated
using (
  public.is_setup_admin()
  or id = public.current_organisation_id()
);

drop policy if exists "user building access visible to owner and back office" on public.user_building_access;
create policy "user building access visible to owner and back office"
on public.user_building_access for select
to authenticated
using (user_id = auth.uid() or public.is_setup_admin());

drop policy if exists "user unit access visible to owner and back office" on public.user_unit_access;
create policy "user unit access visible to owner and back office"
on public.user_unit_access for select
to authenticated
using (user_id = auth.uid() or public.is_setup_admin());

create policy "role aware snag visibility"
on public.snags for select
to authenticated
using (
  public.can_access_snag_row(source_type, building_id, unit_id, assigned_to_organisation_id, created_by_user_id)
);

create policy "role aware snag inserts"
on public.snags for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and (
    (
      source_type = 'developer_snag'
      and (
        public.is_setup_admin()
        or (
          public.current_app_role() = 'developer_representative'
          and building_id is not null
          and public.can_access_building(building_id)
        )
      )
    )
    or (
      public.current_app_role() = 'resident'
      and source_type = 'leaseholder_defect'
      and unit_id is not null
      and area_id is not null
      and public.can_access_unit(unit_id)
      and exists (
        select 1
        from public.units u
        where u.id = unit_id
          and u.building_id = snags.building_id
      )
      and exists (
        select 1
        from public.areas a
        where a.id = area_id
          and a.unit_id = unit_id
      )
    )
  )
);

create policy "role aware snag updates"
on public.snags for update
to authenticated
using (
  public.is_setup_admin()
  or (
    public.current_app_role() = 'developer_representative'
    and building_id is not null
    and public.can_access_building(building_id)
  )
  or (
    public.current_app_role() = 'contractor'
    and (
      (
        public.current_organisation_id() is not null
        and assigned_to_organisation_id = public.current_organisation_id()
      )
      or (building_id is not null and public.can_access_building(building_id))
    )
  )
)
with check (
  public.is_setup_admin()
  or (
    public.current_app_role() = 'developer_representative'
    and building_id is not null
    and public.can_access_building(building_id)
  )
  or (
    public.current_app_role() = 'contractor'
    and (
      (
        public.current_organisation_id() is not null
        and assigned_to_organisation_id = public.current_organisation_id()
      )
      or (building_id is not null and public.can_access_building(building_id))
    )
  )
);

drop policy if exists "back office read audit events" on public.audit_events;
create policy "back office read audit events"
on public.audit_events for select
to authenticated
using (public.is_setup_admin());

drop policy if exists "back office add audit events" on public.audit_events;
create policy "back office add audit events"
on public.audit_events for insert
to authenticated
with check (
  public.is_setup_admin()
  and created_by_user_id = auth.uid()
);

drop policy if exists "back office manage resident access requests" on public.resident_access_requests;
create policy "back office manage resident access requests"
on public.resident_access_requests for all
to authenticated
using (public.is_setup_admin())
with check (public.is_setup_admin());

drop policy if exists "permitted users read handovers" on public.handovers;
create policy "permitted users read handovers"
on public.handovers for select
to authenticated
using (
  public.is_setup_admin()
  or public.can_access_unit(unit_id)
);

drop policy if exists "back office manage handovers" on public.handovers;
create policy "back office manage handovers"
on public.handovers for all
to authenticated
using (public.is_setup_admin())
with check (public.is_setup_admin());

drop policy if exists "permitted users read handover key items" on public.handover_key_items;
create policy "permitted users read handover key items"
on public.handover_key_items for select
to authenticated
using (
  exists (
    select 1
    from public.handovers h
    where h.id = handover_key_items.handover_id
      and public.can_access_unit(h.unit_id)
  )
);

drop policy if exists "permitted users read handover photos" on public.handover_photos;
create policy "permitted users read handover photos"
on public.handover_photos for select
to authenticated
using (
  exists (
    select 1
    from public.handovers h
    where h.id = handover_photos.handover_id
      and public.can_access_unit(h.unit_id)
  )
);

drop policy if exists "permitted users read meter readings" on public.meter_readings;
create policy "permitted users read meter readings"
on public.meter_readings for select
to authenticated
using (
  public.is_setup_admin()
  or public.can_access_unit(unit_id)
);
