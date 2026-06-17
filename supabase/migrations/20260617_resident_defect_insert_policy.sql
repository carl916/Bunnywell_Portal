drop policy if exists "role aware snag inserts" on public.snags;

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
