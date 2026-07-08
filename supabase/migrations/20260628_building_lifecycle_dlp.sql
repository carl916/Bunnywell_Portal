alter table public.buildings
add column if not exists dlp_end_date date,
add column if not exists dlp_closing_notice_start_date date,
add column if not exists archive_date date,
add column if not exists lifecycle_status text not null default 'dlp_active'
  check (lifecycle_status in ('pre_handover', 'handover_active', 'dlp_active', 'dlp_closing', 'post_dlp_readonly', 'archived'));

update public.buildings
set dlp_end_date = coalesce(dlp_end_date, defects_liability_end_date)
where defects_liability_end_date is not null;

create or replace function public.building_allows_resident_routine_snags(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        b.lifecycle_status in ('handover_active', 'dlp_active', 'dlp_closing')
        and (
          b.lifecycle_status != 'post_dlp_readonly'
          and (b.dlp_end_date is null or current_date <= b.dlp_end_date)
        )
      from public.buildings b
      where b.id = target_building_id
        and b.status != 'archived'
    ),
    false
  )
$$;

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
      and public.building_allows_resident_routine_snags(building_id)
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

