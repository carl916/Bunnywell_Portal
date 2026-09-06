-- First Rentals module: tenancy history, protected CRUD and overlap prevention.

create extension if not exists btree_gist;

create table if not exists public.unit_tenancies (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id),
  unit_id uuid not null references public.units(id),
  tenant_name text not null check (length(trim(tenant_name)) > 0),
  tenancy_start_date date not null,
  fixed_term_end_date date,
  tenancy_end_date date,
  monthly_rent numeric(12, 2) not null check (monthly_rent >= 0),
  rent_due_day integer check (rent_due_day between 1 and 31),
  deposit_amount numeric(12, 2) check (deposit_amount >= 0),
  letting_agent_organisation_id uuid references public.organisations(id),
  notes text,
  source_type text not null default 'manual' check (source_type in ('manual', 'spreadsheet_import', 'document', 'email')),
  source_reference text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_tenancies_fixed_term_dates_check check (fixed_term_end_date is null or fixed_term_end_date >= tenancy_start_date),
  constraint unit_tenancies_actual_end_dates_check check (tenancy_end_date is null or tenancy_end_date >= tenancy_start_date)
);

create index if not exists unit_tenancies_building_idx on public.unit_tenancies (building_id, tenancy_start_date desc);
create index if not exists unit_tenancies_unit_idx on public.unit_tenancies (unit_id, tenancy_start_date desc);
create index if not exists unit_tenancies_agent_idx on public.unit_tenancies (letting_agent_organisation_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'unit_tenancies_no_overlapping_occupancy'
  ) then
    alter table public.unit_tenancies
      add constraint unit_tenancies_no_overlapping_occupancy
      exclude using gist (
        unit_id with =,
        daterange(tenancy_start_date, coalesce(tenancy_end_date, 'infinity'::date), '[]') with &&
      );
  end if;
end;
$$;

drop trigger if exists set_unit_tenancies_updated_at on public.unit_tenancies;
create trigger set_unit_tenancies_updated_at
before update on public.unit_tenancies
for each row execute function public.set_updated_at();

create or replace function public.validate_unit_tenancy_relations()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_agent_type text;
begin
  select * into v_unit from public.units where id = new.unit_id;
  if v_unit.id is null or v_unit.building_id <> new.building_id then
    raise exception 'The tenancy unit does not belong to the selected building.';
  end if;

  if new.letting_agent_organisation_id is not null then
    select type into v_agent_type from public.organisations where id = new.letting_agent_organisation_id;
    if v_agent_type is distinct from 'letting_agent' then
      raise exception 'Choose an organisation with type Letting agent.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_unit_tenancy_relations on public.unit_tenancies;
create trigger validate_unit_tenancy_relations
before insert or update on public.unit_tenancies
for each row execute function public.validate_unit_tenancy_relations();

alter table public.unit_tenancies enable row level security;

drop policy if exists "rental administrators read tenancies" on public.unit_tenancies;
create policy "rental administrators read tenancies"
on public.unit_tenancies for select
to authenticated
using (public.current_app_role() in ('admin', 'developer'));

revoke insert, update, delete on public.unit_tenancies from anon, authenticated;
grant select on public.unit_tenancies to authenticated;

create or replace function public.assert_tenancy_manager(p_actor_user_id uuid, p_admin_only boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_active boolean;
begin
  select lower(trim(role)), active into v_role, v_active
  from public.profiles where id = p_actor_user_id;

  if coalesce(v_active, false) is not true
    or (p_admin_only and v_role <> 'admin')
    or (not p_admin_only and v_role not in ('admin', 'developer')) then
    raise exception 'You do not have permission to manage tenancies.';
  end if;
end;
$$;

create or replace function public.validate_tenancy_unit_eligibility(
  p_unit_id uuid,
  p_tenancy_start_date date,
  p_tenancy_end_date date
)
returns public.units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if v_unit.id is null then raise exception 'Unit not found.'; end if;
  if v_unit.rental_portfolio_status not in ('active', 'exited') then
    raise exception 'The unit is not part of the current or historical rental portfolio.';
  end if;
  if (p_tenancy_end_date is null or p_tenancy_end_date >= current_date)
    and v_unit.rental_portfolio_status <> 'active' then
    raise exception 'Current and future tenancies require an active rental-portfolio unit.';
  end if;
  return v_unit;
end;
$$;

create or replace function public.create_unit_tenancy(
  p_actor_user_id uuid,
  p_building_id uuid,
  p_unit_id uuid,
  p_tenant_name text,
  p_tenancy_start_date date,
  p_fixed_term_end_date date,
  p_tenancy_end_date date,
  p_monthly_rent numeric,
  p_rent_due_day integer,
  p_deposit_amount numeric,
  p_letting_agent_organisation_id uuid,
  p_notes text,
  p_source_type text,
  p_source_reference text
)
returns public.unit_tenancies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_created public.unit_tenancies%rowtype;
begin
  perform public.assert_tenancy_manager(p_actor_user_id);
  v_unit := public.validate_tenancy_unit_eligibility(p_unit_id, p_tenancy_start_date, p_tenancy_end_date);
  if v_unit.building_id <> p_building_id then raise exception 'Unit does not belong to the selected building.'; end if;

  insert into public.unit_tenancies (
    building_id, unit_id, tenant_name, tenancy_start_date, fixed_term_end_date, tenancy_end_date,
    monthly_rent, rent_due_day, deposit_amount, letting_agent_organisation_id, notes,
    source_type, source_reference, created_by_user_id, updated_by_user_id
  ) values (
    p_building_id, p_unit_id, trim(p_tenant_name), p_tenancy_start_date, p_fixed_term_end_date, p_tenancy_end_date,
    p_monthly_rent, p_rent_due_day, p_deposit_amount, p_letting_agent_organisation_id, nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source_type), ''), 'manual'), nullif(trim(p_source_reference), ''), p_actor_user_id, p_actor_user_id
  ) returning * into v_created;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_created', 'unit_tenancy', v_created.id, format('Tenancy created for Unit %s.', v_unit.unit_number), jsonb_build_object('tenancy', to_jsonb(v_created)), p_actor_user_id);
  return v_created;
end;
$$;

create or replace function public.update_unit_tenancy(
  p_actor_user_id uuid,
  p_tenancy_id uuid,
  p_tenant_name text,
  p_tenancy_start_date date,
  p_fixed_term_end_date date,
  p_tenancy_end_date date,
  p_monthly_rent numeric,
  p_rent_due_day integer,
  p_deposit_amount numeric,
  p_letting_agent_organisation_id uuid,
  p_notes text,
  p_source_type text,
  p_source_reference text
)
returns public.unit_tenancies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.unit_tenancies%rowtype;
  v_updated public.unit_tenancies%rowtype;
  v_unit public.units%rowtype;
begin
  perform public.assert_tenancy_manager(p_actor_user_id);
  select * into v_old from public.unit_tenancies where id = p_tenancy_id for update;
  if v_old.id is null then raise exception 'Tenancy not found.'; end if;
  select * into v_unit from public.units where id = v_old.unit_id for update;
  if v_unit.id is null or v_unit.rental_portfolio_status not in ('active', 'exited') then
    raise exception 'The unit is not part of the current or historical rental portfolio.';
  end if;

  update public.unit_tenancies set
    tenant_name = trim(p_tenant_name), tenancy_start_date = p_tenancy_start_date,
    fixed_term_end_date = p_fixed_term_end_date, tenancy_end_date = p_tenancy_end_date,
    monthly_rent = p_monthly_rent, rent_due_day = p_rent_due_day, deposit_amount = p_deposit_amount,
    letting_agent_organisation_id = p_letting_agent_organisation_id, notes = nullif(trim(p_notes), ''),
    source_type = coalesce(nullif(trim(p_source_type), ''), 'manual'), source_reference = nullif(trim(p_source_reference), ''),
    updated_by_user_id = p_actor_user_id
  where id = p_tenancy_id returning * into v_updated;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_updated', 'unit_tenancy', v_updated.id, format('Tenancy updated for Unit %s.', v_unit.unit_number), jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_updated)), p_actor_user_id);
  return v_updated;
end;
$$;

create or replace function public.delete_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.unit_tenancies%rowtype;
  v_unit_number text;
begin
  perform public.assert_tenancy_manager(p_actor_user_id, true);
  if nullif(trim(p_reason), '') is null then raise exception 'A deletion reason is required.'; end if;
  select * into v_old from public.unit_tenancies where id = p_tenancy_id for update;
  if v_old.id is null then raise exception 'Tenancy not found.'; end if;
  select unit_number into v_unit_number from public.units where id = v_old.unit_id;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_deleted', 'unit_tenancy', v_old.id, format('Erroneous tenancy deleted for Unit %s.', v_unit_number), jsonb_build_object('reason', trim(p_reason), 'deleted_tenancy', to_jsonb(v_old)), p_actor_user_id);
  delete from public.unit_tenancies where id = p_tenancy_id;
  return p_tenancy_id;
end;
$$;

revoke all on function public.assert_tenancy_manager(uuid, boolean) from public, anon, authenticated;
revoke all on function public.validate_tenancy_unit_eligibility(uuid, date, date) from public, anon, authenticated;
revoke all on function public.create_unit_tenancy(uuid, uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.update_unit_tenancy(uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_unit_tenancy(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_unit_tenancy(uuid, uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text) to service_role;
grant execute on function public.update_unit_tenancy(uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text) to service_role;
grant execute on function public.delete_unit_tenancy(uuid, uuid, text) to service_role;
