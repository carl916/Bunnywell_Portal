-- Let operational users resolve names for people attached to buildings they can access.
-- This keeps profile visibility scoped to existing building permissions instead of
-- exposing all users across the portal.

drop policy if exists "profiles visible to permitted users" on public.profiles;

create policy "profiles visible to permitted users"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_setup_admin()
  or organisation_id = public.current_organisation_id()
  or exists (
    select 1
    from public.user_building_access uba
    where uba.user_id = profiles.id
      and public.can_access_building(uba.building_id)
  )
  or (
    profiles.organisation_id is not null
    and exists (
      select 1
      from public.building_organisations bo
      where bo.organisation_id = profiles.organisation_id
        and coalesce(bo.active, true)
        and public.can_access_building(bo.building_id)
    )
  )
);
