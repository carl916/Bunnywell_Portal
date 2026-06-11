-- Contractors/trades are assigned at building level for the POC.
-- This updates the hardening helpers and snag update policy to reflect that.

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
      and (
        (
          public.current_organisation_id() is not null
          and target_assigned_organisation_id = public.current_organisation_id()
        )
        or (
          target_unit_id is not null
          and exists (
            select 1
            from public.units u
            join public.user_building_access uba on uba.building_id = u.building_id
            where u.id = target_unit_id
              and uba.user_id = auth.uid()
          )
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

drop policy if exists "role aware snag updates" on public.snags;

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
