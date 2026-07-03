-- Phase 1: building-level responsible organisations for developer snags.
-- Buildings can have one main contractor, one developer representative and optional supporting trades.

alter table public.organisations drop constraint if exists organisations_type_check;

update public.organisations
set type = case
  when type in ('agent', 'developer representative') then 'developer_representative'
  when type in ('trade', 'supporting trade') then 'supporting_trade'
  when type in ('main contractor', 'contractor') then 'contractor'
  else type
end;

alter table public.organisations
  add constraint organisations_type_check
  check (type in ('developer_representative', 'contractor', 'supporting_trade'));

alter table public.building_organisations
  add column if not exists trade_type text,
  add column if not exists active boolean not null default true,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

update public.building_organisations
set role_on_project = case
  when role_on_project in ('contractor', 'main contractor') then 'main_contractor'
  when role_on_project in ('agent', 'developer representative') then 'developer_representative'
  when role_on_project in ('trade', 'supporting trade') then 'supporting_trade'
  else role_on_project
end
where role_on_project is not null;

alter table public.building_organisations
  drop constraint if exists building_organisations_role_on_project_check;

alter table public.building_organisations
  add constraint building_organisations_role_on_project_check
  check (
    role_on_project is null
    or role_on_project in ('main_contractor', 'developer_representative', 'supporting_trade')
  );

create unique index if not exists building_organisations_one_main_contractor_per_building
  on public.building_organisations (building_id)
  where role_on_project = 'main_contractor' and active is true;

create unique index if not exists building_organisations_one_developer_rep_per_building
  on public.building_organisations (building_id)
  where role_on_project = 'developer_representative' and active is true;

drop policy if exists "permitted users read building organisations" on public.building_organisations;
create policy "permitted users read building organisations"
on public.building_organisations for select
to authenticated
using (
  public.is_setup_admin()
  or public.can_access_building(building_id)
  or organisation_id = public.current_organisation_id()
);

drop policy if exists "setup admins manage building organisations" on public.building_organisations;
create policy "setup admins manage building organisations"
on public.building_organisations for all
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
  or exists (
    select 1
    from public.building_organisations bo
    where bo.organisation_id = organisations.id
      and coalesce(bo.active, true)
      and public.can_access_building(bo.building_id)
  )
);

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
    )
    or exists (
      select 1
      from public.building_organisations bo
      where bo.building_id = target_building_id
        and bo.organisation_id = public.current_organisation_id()
        and coalesce(bo.active, true)
        and public.current_app_role() in ('developer_representative', 'contractor')
    ),
    false
  )
$$;

create or replace function public.contractor_can_access_developer_snag(
  target_building_id uuid,
  target_assigned_organisation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() = 'contractor'
    and public.current_organisation_id() is not null
    and target_building_id is not null
    and exists (
      select 1
      from public.building_organisations bo
      where bo.building_id = target_building_id
        and bo.organisation_id = public.current_organisation_id()
        and bo.role_on_project = 'main_contractor'
        and coalesce(bo.active, true)
    )
    and (
      target_assigned_organisation_id is null
      or target_assigned_organisation_id = public.current_organisation_id()
    ),
    false
  )
$$;

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
    or public.contractor_can_access_developer_snag(target_building_id, target_assigned_organisation_id)
    or (
      public.current_app_role() = 'resident'
      and target_source_type = 'leaseholder_defect'
      and target_unit_id is not null
      and public.can_access_unit(target_unit_id)
    ),
    false
  )
$$;

drop policy if exists "role aware snag visibility" on public.snags;
create policy "role aware snag visibility"
on public.snags for select
to authenticated
using (
  public.can_access_snag_row(source_type, building_id, unit_id, assigned_to_organisation_id, created_by_user_id)
);

drop policy if exists "role aware snag updates" on public.snags;
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
  or public.contractor_can_access_developer_snag(building_id, assigned_to_organisation_id)
)
with check (
  public.is_setup_admin()
  or (
    public.current_app_role() = 'developer_representative'
    and building_id is not null
    and public.can_access_building(building_id)
  )
  or public.contractor_can_access_developer_snag(building_id, assigned_to_organisation_id)
);
