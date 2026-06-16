update public.profiles
set
  role = 'developer_representative',
  resident_type = null
where role::text = 'agent';

update public.profiles
set
  role = 'resident',
  resident_type = coalesce(resident_type, 'leaseholder')
where role::text = 'leaseholder';

update public.profiles
set
  role = 'contractor',
  resident_type = null
where role::text = 'trade';

update public.profiles
set resident_type = null
where role::text <> 'resident';

alter table public.organisations
drop constraint if exists organisations_type_check;

update public.organisations
set type = case
  when type = 'agent' then 'developer_representative'
  when type = 'trade' then 'contractor'
  else type
end;

alter table public.user_unit_access
drop constraint if exists user_unit_access_access_type_check;

update public.user_unit_access
set access_type = case
  when access_type = 'agent' then 'managing_agent'
  when access_type = 'representative' then 'managing_agent'
  else access_type
end;

alter table public.profiles
drop constraint if exists profiles_role_final_check;

alter table public.profiles
add constraint profiles_role_final_check
check (role::text in ('admin', 'developer', 'developer_representative', 'contractor', 'resident', 'user'));

alter table public.user_unit_access
add constraint user_unit_access_access_type_check
check (access_type in ('leaseholder', 'tenant', 'letting_agent', 'managing_agent', 'representative'));

alter table public.organisations
add constraint organisations_type_check
check (type in ('developer_representative', 'contractor'));

create or replace function public.is_back_office_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer', 'developer_representative'), false)
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
      public.current_app_role() = 'contractor'
      and public.current_organisation_id() is not null
      and target_assigned_organisation_id = public.current_organisation_id()
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

drop policy if exists "role aware snag inserts" on public.snags;
drop policy if exists "role aware snag updates" on public.snags;

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
      public.current_app_role() = 'resident'
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
    public.current_app_role() = 'contractor'
    and public.current_organisation_id() is not null
    and assigned_to_organisation_id = public.current_organisation_id()
  )
)
with check (
  public.is_back_office_user()
  or (
    public.current_app_role() = 'contractor'
    and public.current_organisation_id() is not null
    and assigned_to_organisation_id = public.current_organisation_id()
  )
);
