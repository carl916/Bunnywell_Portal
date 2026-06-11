-- Allow contractor/trade users to access buildings and snags through their organisation's building assignment.

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
      from public.building_organisations bo
      where bo.building_id = target_building_id
        and bo.organisation_id = public.current_organisation_id()
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
      where u.id = target_unit_id
        and public.can_access_building(u.building_id)
    ),
    false
  )
$$;

create or replace function public.can_access_snag_row(
  target_source_type text,
  target_unit_id uuid,
  target_building_id uuid,
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
      and (
        (
          public.current_organisation_id() is not null
          and target_assigned_organisation_id = public.current_organisation_id()
        )
        or (
          target_building_id is not null
          and public.can_access_building(target_building_id)
        )
        or (
          target_unit_id is not null
          and public.can_access_unit(target_unit_id)
        )
      )
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
        and public.can_access_snag_row(s.source_type, s.unit_id, s.building_id, s.assigned_to_organisation_id, s.created_by_user_id)
    ),
    false
  )
$$;

drop policy if exists "role aware snag visibility" on public.snags;
drop policy if exists "role aware snag updates" on public.snags;

create policy "role aware snag visibility"
on public.snags for select
to authenticated
using (
  public.can_access_snag_row(source_type, unit_id, building_id, assigned_to_organisation_id, created_by_user_id)
);

create policy "role aware snag updates"
on public.snags for update
to authenticated
using (
  public.is_back_office_user()
  or (
    public.current_app_role() in ('contractor', 'trade')
    and (
      (
        public.current_organisation_id() is not null
        and assigned_to_organisation_id = public.current_organisation_id()
      )
      or public.can_access_building(building_id)
    )
  )
)
with check (
  public.is_back_office_user()
  or (
    public.current_app_role() in ('contractor', 'trade')
    and (
      (
        public.current_organisation_id() is not null
        and assigned_to_organisation_id = public.current_organisation_id()
      )
      or public.can_access_building(building_id)
    )
  )
);
