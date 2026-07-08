alter table public.buildings
add column if not exists pc_date date,
add column if not exists pc_confirmed boolean not null default false;

update public.buildings
set pc_date = coalesce(pc_date, practical_completion_date)
where practical_completion_date is not null;

update public.buildings
set pc_confirmed = true
where pc_confirmed = false
  and pc_date is not null
  and pc_date <= current_date;

alter table public.buildings
drop constraint if exists buildings_pc_confirmed_requires_date;

alter table public.buildings
add constraint buildings_pc_confirmed_requires_date
check (pc_confirmed = false or pc_date is not null);

create or replace function public.validate_building_pc_confirmation()
returns trigger
language plpgsql
as $$
begin
  if new.pc_confirmed = true and new.pc_date is null then
    raise exception 'Enter the Practical Completion date before confirming PC.';
  end if;

  if new.pc_confirmed = true and new.pc_date > current_date then
    raise exception 'PC can only be confirmed once Practical Completion has actually occurred. Enter today''s date or a past date.';
  end if;

  new.practical_completion_date = new.pc_date;

  if new.pc_confirmed = true and new.pc_date is not null then
    new.defects_liability_end_date = (new.pc_date + interval '12 months')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_building_pc_confirmation on public.buildings;
create trigger validate_building_pc_confirmation
before insert or update of pc_date, pc_confirmed
on public.buildings
for each row execute function public.validate_building_pc_confirmation();

create or replace function public.building_initial_defects_reporting_end(target_building_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case
    when b.pc_confirmed = true and b.pc_date is not null and b.pc_date <= current_date
      then (b.pc_date + interval '12 months')::date
    else null
  end
  from public.buildings b
  where b.id = target_building_id
$$;

create or replace function public.building_closing_notice_start(target_building_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.building_initial_defects_reporting_end(target_building_id) is not null
      then (public.building_initial_defects_reporting_end(target_building_id) - interval '2 months')::date
    else null
  end
$$;

create or replace function public.building_derived_lifecycle_status(target_building_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when b.status = 'archived' then 'archived'
        when b.pc_confirmed = false or b.pc_date is null or b.pc_date > current_date then 'pre_pc'
        when current_date >= (b.pc_date + interval '12 months')::date then 'post_dlp_readonly'
        when current_date >= ((b.pc_date + interval '12 months') - interval '2 months')::date then 'dlp_closing'
        else 'dlp_active'
      end
      from public.buildings b
      where b.id = target_building_id
    ),
    'pre_pc'
  )
$$;

create or replace function public.building_allows_resident_routine_snags(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.building_derived_lifecycle_status(target_building_id) in ('dlp_active', 'dlp_closing')
$$;

create or replace function public.building_allows_flat_handover(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select b.status <> 'archived'
        and b.pc_confirmed = true
        and b.pc_date is not null
        and b.pc_date <= current_date
      from public.buildings b
      where b.id = target_building_id
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

create or replace function public.complete_handover_unit()
returns trigger
language plpgsql
as $$
declare
  target_building_id uuid;
begin
  select u.building_id
  into target_building_id
  from public.units u
  where u.id = new.unit_id
    and u.sale_status = 'completed';

  if target_building_id is null then
    raise exception 'Handovers can only be created for completed units.';
  end if;

  if not public.building_allows_flat_handover(target_building_id) then
    raise exception 'Flat handover can only be completed once Practical Completion has been confirmed.';
  end if;

  perform set_config('app.handover_completion', 'on', true);

  update public.units
  set sale_status = 'handed_over',
      handover_date = new.handover_date,
      updated_at = now()
  where id = new.unit_id;

  return new;
end;
$$;
