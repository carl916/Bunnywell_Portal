-- Production catch-up prepared 2026-09-06 from staging 4a6015c.
-- Based on production schema captured 07:34 UTC and preflight at 07:38 UTC.
-- This WRITES to the database. Confirm the production project and a recoverable
-- backup; rehearse on an isolated production restore before the live cutover.
-- Pause application writes during the cutover: unit permissions and guards change.
-- Run the ENTIRE file together, with no selection, in Supabase SQL Editor.
-- One transaction: an error prevents the batch from committing. Stop on failure.
-- Do not run seed/reset/cleandown scripts. Do not rerun after confirmed success.
-- Original migration text below is unchanged. SHA-256 hashes identify source files.
-- After success, rerun production-migration-audit.sql and return the export.
-- This bundle has been checked against its source files, not executed on Postgres.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- BEGIN MIGRATION 1/11: 20260804_reservation_approval_workflow.sql
-- SHA-256: a56437330e60f98aa03371607cf8ef713c0f307cdfa869b43523039c6a27d5b3
alter table public.units
  add column if not exists reservation_date date;

alter table public.unit_sale_attempts
  add column if not exists reservation_date date,
  add column if not exists reservation_approved_by_name text,
  add column if not exists reservation_approved_by_email text,
  add column if not exists reservation_rejected_at timestamptz,
  add column if not exists reservation_rejected_by_user_id uuid references public.profiles(id),
  add column if not exists reservation_rejected_by_name text,
  add column if not exists reservation_rejected_by_email text,
  add column if not exists reservation_rejection_reason text;

do $$
begin
  alter table public.unit_sale_attempts
    drop constraint if exists unit_sale_attempts_workflow_status_check;

  alter table public.unit_sale_attempts
    add constraint unit_sale_attempts_workflow_status_check check (workflow_status in (
      'draft',
      'awaiting_approval',
      'approved',
      'rejected',
      'reservation_submitted',
      'reservation_query_raised',
      'reservation_approved',
      'awaiting_commercial_approval',
      'ready_for_exchange',
      'exchanged',
      'completion_pending',
      'completed',
      'fallen_through',
      'superseded'
    ));

  alter table public.unit_sale_attempts
    drop constraint if exists unit_sale_attempts_buyer_identity_check;

  alter table public.unit_sale_attempts
    add constraint unit_sale_attempts_buyer_identity_check check (
      workflow_status not in (
        'awaiting_approval',
        'approved',
        'reservation_submitted',
        'reservation_approved',
        'awaiting_commercial_approval',
        'ready_for_exchange',
        'exchanged',
        'completion_pending',
        'completed'
      )
      or nullif(trim(coalesce(buyer_person_name, '')), '') is not null
      or nullif(trim(coalesce(buyer_company_name, '')), '') is not null
    );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'unit_sale_attempts_reservation_date_not_future'
      and conrelid = 'public.unit_sale_attempts'::regclass
  ) then
    alter table public.unit_sale_attempts
      add constraint unit_sale_attempts_reservation_date_not_future
      check (reservation_date is null or reservation_date <= current_date)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'units_reservation_date_not_future'
      and conrelid = 'public.units'::regclass
  ) then
    alter table public.units
      add constraint units_reservation_date_not_future
      check (reservation_date is null or reservation_date <= current_date)
      not valid;
  end if;
end $$;

-- END MIGRATION: 20260804_reservation_approval_workflow.sql

-- BEGIN MIGRATION 2/11: 20260828_commercial_unit_allocation.sql
-- SHA-256: ddd73d0b99fac854131d1adc0005a47e9630120836b15e60beef8eef97be21b4
-- Commercial unit allocation foundation.
-- Sales position and rental-portfolio participation are deliberately separate dimensions.

alter table public.units
  drop constraint if exists units_sale_status_check;

alter table public.units
  add constraint units_sale_status_check
  check (sale_status in (
    'not_released',
    'not_for_sale',
    'for_sale',
    'reserved',
    'exchanged',
    'completed',
    'handed_over'
  ));

alter table public.units
  add column if not exists rental_portfolio_status text;

update public.units
set rental_portfolio_status = 'not_in_portfolio'
where rental_portfolio_status is null;

alter table public.units
  alter column rental_portfolio_status set default 'not_in_portfolio',
  alter column rental_portfolio_status set not null,
  drop constraint if exists units_rental_portfolio_status_check;

alter table public.units
  add constraint units_rental_portfolio_status_check
  check (rental_portfolio_status in ('not_in_portfolio', 'active', 'exited'));

create index if not exists units_building_sale_status_idx
  on public.units (building_id, sale_status, unit_number);

create index if not exists units_building_rental_portfolio_status_idx
  on public.units (building_id, rental_portfolio_status, unit_number);

alter table public.organisations
  drop constraint if exists organisations_type_check;

alter table public.organisations
  add constraint organisations_type_check
  check (type in (
    'developer_representative',
    'contractor',
    'supporting_trade',
    'sales_agent',
    'conveyancer',
    'letting_agent',
    'managing_agent'
  ));

alter table public.building_organisations
  drop constraint if exists building_organisations_role_on_project_check;

alter table public.building_organisations
  add constraint building_organisations_role_on_project_check
  check (
    role_on_project is null
    or role_on_project in (
      'main_contractor',
      'developer_representative',
      'supporting_trade',
      'sales_agent',
      'conveyancer',
      'letting_agent',
      'managing_agent'
    )
  );

-- The old FOR ALL policy left generic table updates available to setup admins.
-- Unit creation and deletion remain available, but all updates now use scoped server paths.
drop policy if exists "admins manage units" on public.units;
drop policy if exists "setup admins create units" on public.units;
drop policy if exists "setup admins delete units" on public.units;

create policy "setup admins create units"
on public.units for insert
to authenticated
with check (
  public.is_setup_admin()
  and sale_status = 'for_sale'
  and rental_portfolio_status = 'not_in_portfolio'
);

create policy "setup admins delete units"
on public.units for delete
to authenticated
using (public.is_setup_admin());

revoke update on table public.units from authenticated;

create or replace function public.assert_commercial_unit_actor(
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_active boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Commercial unit changes must use an authorised server path.';
  end if;

  select profile.role::text, profile.active
  into v_role, v_active
  from public.profiles profile
  where profile.id = p_actor_user_id;

  if coalesce(v_active, false) is not true or not (coalesce(v_role, '') = any(p_allowed_roles)) then
    raise exception 'You do not have permission to change commercial unit allocation.';
  end if;

  return v_role;
end;
$$;

revoke all on function public.assert_commercial_unit_actor(uuid, text[]) from public, anon, authenticated;
grant execute on function public.assert_commercial_unit_actor(uuid, text[]) to service_role;

create or replace function public.prevent_direct_unit_commercial_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    old.sale_status is distinct from new.sale_status
    or old.rental_portfolio_status is distinct from new.rental_portfolio_status
  )
  and coalesce(current_setting('app.unit_commercial_mutation', true), '') <> 'on'
  and coalesce(current_setting('app.handover_completion', true), '') <> 'on'
  then
    raise exception 'Sale and rental allocation can only be changed through a protected workflow.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_direct_unit_commercial_status_change on public.units;
create trigger prevent_direct_unit_commercial_status_change
before update of sale_status, rental_portfolio_status on public.units
for each row execute function public.prevent_direct_unit_commercial_status_change();

-- Lock the unit when an active sale file is first created/reactivated. This closes
-- the race between sale-file entry and administrative allocation changes.
create or replace function public.validate_active_sale_attempt_entry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sale_status text;
begin
  if new.is_active is not true
     or (tg_op = 'UPDATE' and old.is_active is true and old.unit_id = new.unit_id) then
    return new;
  end if;

  select unit.sale_status
  into v_sale_status
  from public.units unit
  where unit.id = new.unit_id
  for update;

  if v_sale_status is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_sale_status <> 'for_sale' then
    raise exception 'A new sale file can only be created for a unit that is For sale.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_active_sale_attempt_entry on public.unit_sale_attempts;
create trigger validate_active_sale_attempt_entry
before insert or update of is_active, unit_id on public.unit_sale_attempts
for each row execute function public.validate_active_sale_attempt_entry();

create or replace function public.set_unit_sales_availability(
  p_unit_ids uuid[],
  p_target_status text,
  p_actor_user_id uuid,
  p_source text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_changed integer := 0;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
    raise exception 'Choose at least one unit.';
  end if;
  if p_target_status not in ('not_released', 'not_for_sale', 'for_sale') then
    raise exception 'Choose a valid administrative sales availability.';
  end if;
  if (select count(*) from unnest(p_unit_ids) requested(id)) <> (select count(distinct id) from unnest(p_unit_ids) requested(id)) then
    raise exception 'The unit selection contains duplicates.';
  end if;
  if (select count(*) from public.units unit where unit.id = any(p_unit_ids)) <> array_length(p_unit_ids, 1) then
    raise exception 'One or more selected units could not be found.';
  end if;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
    for update
  loop
    if exists (
      select 1
      from public.unit_sale_attempts attempt
      where attempt.unit_id = v_unit.id
        and attempt.is_active is true
    ) then
      raise exception 'Unit % has an active sale file. Resolve the sale workflow before changing its sales availability.', v_unit.unit_number;
    end if;

    if v_unit.sale_status not in ('not_released', 'not_for_sale', 'for_sale') then
      raise exception 'Unit % is controlled by the formal sales workflow and cannot be changed through Unit Allocation.', v_unit.unit_number;
    end if;
  end loop;

  perform set_config('app.unit_commercial_mutation', 'on', true);

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.sale_status is distinct from p_target_status then
      update public.units
      set sale_status = p_target_status,
          updated_at = now()
      where id = v_unit.id;

      insert into public.audit_events (
        event_type,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_by_user_id
      ) values (
        'unit_sales_availability_changed',
        'unit',
        v_unit.id,
        format('Unit %s sales availability changed from %s to %s.', v_unit.unit_number, v_unit.sale_status, p_target_status),
        jsonb_build_object(
          'building_id', v_unit.building_id,
          'unit_id', v_unit.id,
          'unit_number', v_unit.unit_number,
          'old_sale_status', v_unit.sale_status,
          'new_sale_status', p_target_status,
          'old_rental_portfolio_status', v_unit.rental_portfolio_status,
          'new_rental_portfolio_status', v_unit.rental_portfolio_status,
          'source', coalesce(nullif(trim(p_source), ''), 'unit_allocation'),
          'acting_user', p_actor_user_id,
          'batch_identifier', v_batch_id,
          'related_sale_attempt', null
        ),
        p_actor_user_id
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

revoke all on function public.set_unit_sales_availability(uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_unit_sales_availability(uuid[], text, uuid, text) to service_role;

create or replace function public.set_unit_rental_portfolio_status(
  p_unit_ids uuid[],
  p_target_status text,
  p_actor_user_id uuid,
  p_source text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_changed integer := 0;
  v_event_type text;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
    raise exception 'Choose at least one unit.';
  end if;
  if p_target_status not in ('active', 'exited') then
    raise exception 'Choose a valid rental-portfolio action.';
  end if;
  if (select count(*) from unnest(p_unit_ids) requested(id)) <> (select count(distinct id) from unnest(p_unit_ids) requested(id)) then
    raise exception 'The unit selection contains duplicates.';
  end if;
  if (select count(*) from public.units unit where unit.id = any(p_unit_ids)) <> array_length(p_unit_ids, 1) then
    raise exception 'One or more selected units could not be found.';
  end if;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
    for update
  loop
    if p_target_status = 'active'
       and v_unit.sale_status not in ('not_for_sale', 'for_sale', 'reserved', 'exchanged') then
      raise exception 'Unit % cannot enter the rental portfolio while its sales position is %.', v_unit.unit_number, v_unit.sale_status;
    end if;
    if p_target_status = 'exited' and v_unit.rental_portfolio_status <> 'active' then
      raise exception 'Unit % is not currently in the rental portfolio.', v_unit.unit_number;
    end if;
  end loop;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  v_event_type := case when p_target_status = 'active' then 'unit_added_to_rental_portfolio' else 'unit_exited_rental_portfolio' end;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.rental_portfolio_status is distinct from p_target_status then
      update public.units
      set rental_portfolio_status = p_target_status,
          updated_at = now()
      where id = v_unit.id;

      insert into public.audit_events (
        event_type,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_by_user_id
      ) values (
        v_event_type,
        'unit',
        v_unit.id,
        case when p_target_status = 'active'
          then format('Unit %s added to the rental portfolio.', v_unit.unit_number)
          else format('Unit %s exited the rental portfolio.', v_unit.unit_number)
        end,
        jsonb_build_object(
          'building_id', v_unit.building_id,
          'unit_id', v_unit.id,
          'unit_number', v_unit.unit_number,
          'old_sale_status', v_unit.sale_status,
          'new_sale_status', v_unit.sale_status,
          'old_rental_portfolio_status', v_unit.rental_portfolio_status,
          'new_rental_portfolio_status', p_target_status,
          'source', coalesce(nullif(trim(p_source), ''), 'unit_allocation'),
          'acting_user', p_actor_user_id,
          'batch_identifier', v_batch_id,
          'related_sale_attempt', null
        ),
        p_actor_user_id
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

revoke all on function public.set_unit_rental_portfolio_status(uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_unit_rental_portfolio_status(uuid[], text, uuid, text) to service_role;

create or replace function public.sales_workflow_mark_unit_for_sale(
  p_unit_id uuid,
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_workflow_status text;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'sales_agent', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  select attempt.workflow_status into v_workflow_status
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id;

  if v_unit.id is null or v_workflow_status is null then raise exception 'Sale unit or sale attempt not found.'; end if;
  if v_workflow_status not in ('draft', 'awaiting_approval', 'reservation_submitted', 'rejected', 'reservation_query_raised', 'fallen_through') then
    raise exception 'The sale file is not in a state that can return the unit to For sale.';
  end if;
  if v_unit.sale_status in ('not_released', 'not_for_sale', 'completed', 'handed_over') then
    raise exception 'This unit cannot enter the sales workflow from its current sales position.';
  end if;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'for_sale', updated_at = now() where id = p_unit_id;
end;
$$;

create or replace function public.sales_workflow_mark_unit_reserved(
  p_unit_id uuid,
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true
      and attempt.workflow_status in ('approved', 'reservation_approved')
  ) then raise exception 'An approved active sale file is required before marking a unit Reserved.'; end if;
  if v_unit.sale_status <> 'for_sale' then raise exception 'Only a For sale unit can be marked Reserved.'; end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'reserved', updated_at = now() where id = p_unit_id;
end;
$$;

create or replace function public.sales_workflow_mark_unit_exchanged(
  p_unit_id uuid,
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true and attempt.workflow_status = 'exchanged'
  ) then raise exception 'An exchanged active sale file is required before marking a unit Exchanged.'; end if;
  if v_unit.sale_status not in ('reserved', 'exchanged') then raise exception 'Only a Reserved unit can progress to Exchanged.'; end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'exchanged', updated_at = now() where id = p_unit_id;
end;
$$;

create or replace function public.sales_workflow_mark_unit_completed(
  p_unit_id uuid,
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true and attempt.workflow_status = 'completed'
  ) then raise exception 'A completed active sale file is required before marking a unit Completed.'; end if;
  if v_unit.sale_status not in ('exchanged', 'completed') then raise exception 'Only an Exchanged unit can progress to Completed.'; end if;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units
  set sale_status = 'completed',
      rental_portfolio_status = case when rental_portfolio_status = 'active' then 'exited' else rental_portfolio_status end,
      updated_at = now()
  where id = p_unit_id;

  if v_unit.rental_portfolio_status = 'active' then
    insert into public.audit_events (
      event_type, entity_type, entity_id, summary, metadata, created_by_user_id
    ) values (
      'unit_exited_rental_portfolio',
      'unit',
      v_unit.id,
      format('Unit %s exited the rental portfolio on legal completion.', v_unit.unit_number),
      jsonb_build_object(
        'building_id', v_unit.building_id,
        'unit_id', v_unit.id,
        'unit_number', v_unit.unit_number,
        'old_sale_status', v_unit.sale_status,
        'new_sale_status', 'completed',
        'old_rental_portfolio_status', 'active',
        'new_rental_portfolio_status', 'exited',
        'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow_completion'),
        'acting_user', p_actor_user_id,
        'batch_identifier', v_batch_id,
        'related_sale_attempt', p_sale_attempt_id
      ),
      p_actor_user_id
    );
  end if;
end;
$$;

revoke all on function public.sales_workflow_mark_unit_for_sale(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sales_workflow_mark_unit_reserved(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sales_workflow_mark_unit_exchanged(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sales_workflow_mark_unit_completed(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sales_workflow_mark_unit_for_sale(uuid, uuid, uuid, text) to service_role;
grant execute on function public.sales_workflow_mark_unit_reserved(uuid, uuid, uuid, text) to service_role;
grant execute on function public.sales_workflow_mark_unit_exchanged(uuid, uuid, uuid, text) to service_role;
grant execute on function public.sales_workflow_mark_unit_completed(uuid, uuid, uuid, text) to service_role;

create or replace function public.initialize_imported_unit_sale_status(
  p_unit_id uuid,
  p_sale_status text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Imported unit status initialization requires the service role.';
  end if;
  if p_sale_status not in ('not_released', 'not_for_sale', 'for_sale', 'reserved', 'exchanged', 'completed') then
    raise exception 'Unsupported imported unit sale status.';
  end if;
  if exists (select 1 from public.unit_sale_attempts attempt where attempt.unit_id = p_unit_id) then
    raise exception 'Imported status cannot overwrite a unit with sale history.';
  end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = p_sale_status, updated_at = now() where id = p_unit_id;
  if not found then raise exception 'Imported unit not found.'; end if;
end;
$$;

revoke all on function public.initialize_imported_unit_sale_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.initialize_imported_unit_sale_status(uuid, text, text) to service_role;

-- Prospective fee rows require current sales-route stock. Actual invoices/payments remain
-- visible after withdrawal so historical financial positions can still be resolved.
create or replace function public.get_agent_fee_portfolio(p_requester_id uuid)
returns table (
  sale_attempt_id uuid,
  building_id uuid,
  building_name text,
  unit_id uuid,
  unit_number text,
  unit_sale_status text,
  workflow_status text,
  sales_agent_organisation_id uuid,
  sales_agent_name text,
  contract_price numeric,
  exchange_fee_percent numeric,
  completion_fee_percent numeric,
  vat_rate numeric,
  exchange_invoice jsonb,
  completion_invoice jsonb,
  exchange_active_payments jsonb,
  completion_active_payments jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requester_role text;
  v_requester_active boolean;
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot view the Agent Fees portfolio.';
  end if;

  select profile.role, profile.active
  into v_requester_role, v_requester_active
  from public.profiles profile
  where profile.id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer') then
    raise exception 'Only developers or admins can view the Agent Fees portfolio.';
  end if;

  return query
  select
    attempt.id,
    attempt.building_id,
    building.name,
    attempt.unit_id,
    unit.unit_number,
    unit.sale_status::text,
    attempt.workflow_status,
    attempt.sales_agent_organisation_id,
    agent.name,
    terms.contract_price,
    terms.exchange_agent_fee_percent,
    terms.completion_agent_fee_percent,
    terms.vat_rate,
    case when exchange_invoice.id is null then null else jsonb_build_object(
      'id', exchange_invoice.id,
      'status', exchange_invoice.status,
      'approved_at', exchange_invoice.approved_at,
      'gross_amount', exchange_invoice.gross_amount,
      'expected_payable_amount', exchange_invoice.expected_payable_amount,
      'reservation_fee_deduction', exchange_invoice.reservation_fee_deduction,
      'agent_contribution_deduction', exchange_invoice.agent_contribution_deduction
    ) end,
    case when completion_invoice.id is null then null else jsonb_build_object(
      'id', completion_invoice.id,
      'status', completion_invoice.status,
      'approved_at', completion_invoice.approved_at,
      'gross_amount', completion_invoice.gross_amount,
      'expected_payable_amount', completion_invoice.expected_payable_amount,
      'reservation_fee_deduction', completion_invoice.reservation_fee_deduction,
      'agent_contribution_deduction', completion_invoice.agent_contribution_deduction
    ) end,
    coalesce(exchange_payments.payments, '[]'::jsonb),
    coalesce(completion_payments.payments, '[]'::jsonb)
  from public.unit_sale_attempts attempt
  join public.units unit on unit.id = attempt.unit_id
  join public.buildings building on building.id = attempt.building_id
  left join public.organisations agent on agent.id = attempt.sales_agent_organisation_id
  left join lateral (
    select sale_terms.* from public.unit_sale_terms sale_terms
    where sale_terms.sale_attempt_id = attempt.id
    order by sale_terms.is_current desc, sale_terms.version_number desc limit 1
  ) terms on true
  left join lateral (
    select invoice.* from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'exchange' and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc limit 1
  ) exchange_invoice on true
  left join lateral (
    select invoice.* from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'completion' and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc limit 1
  ) completion_invoice on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = exchange_invoice.id and payment.payment_source <> 'reservation_fee' and payment.voided_at is null
  ) exchange_payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = completion_invoice.id and payment.payment_source <> 'reservation_fee' and payment.voided_at is null
  ) completion_payments on true
  where (
    (
      attempt.is_active is true
      and attempt.workflow_status not in ('fallen_through', 'superseded')
      and unit.sale_status in ('for_sale', 'reserved', 'exchanged', 'completed', 'handed_over')
    )
    or exchange_invoice.id is not null
    or completion_invoice.id is not null
  )
    and (auth.role() = 'service_role' or public.can_access_sales_building(attempt.building_id))
  order by building.name, unit.unit_number, attempt.attempt_number;
end;
$$;

revoke all on function public.get_agent_fee_portfolio(uuid) from public;
grant execute on function public.get_agent_fee_portfolio(uuid) to authenticated, service_role;

-- END MIGRATION: 20260828_commercial_unit_allocation.sql

-- BEGIN MIGRATION 3/11: 20260829_unit_allocation_pristine_drafts.sql
-- SHA-256: 29f5cbbc2f87a53fea0bea5eedb739229ba7b47df2aac9325e5c8964af97f80c
-- Refine Unit Allocation so unused system-created draft sale records do not
-- prevent an administrator from changing a unit's sales availability.

alter table public.units
  alter column sale_status set default 'not_released';

drop policy if exists "setup admins create units" on public.units;
create policy "setup admins create units"
on public.units for insert
to authenticated
with check (
  public.is_setup_admin()
  and sale_status = 'not_released'
  and rental_portfolio_status = 'not_in_portfolio'
);

create or replace function public.sale_attempt_blocks_unit_allocation(
  p_sale_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when attempt.is_active is not true then false
      when attempt.workflow_status in ('fallen_through', 'superseded') then false
      when attempt.workflow_status <> 'draft' then true
      else (
        nullif(trim(coalesce(attempt.buyer_name, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_person_name, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_company_name, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_email, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_phone, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_solicitor_name, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_solicitor_email, '')), '') is not null
        or nullif(trim(coalesce(attempt.buyer_solicitor_phone, '')), '') is not null
        or attempt.sales_agent_organisation_id is not null
        or attempt.conveyancer_organisation_id is not null
        or attempt.reservation_date is not null
        or attempt.reservation_terms_checked is true
        or attempt.reservation_submitted_at is not null
        or attempt.reservation_approved_at is not null
        or attempt.commercial_approved_at is not null
        or attempt.exchanged_at is not null
        or attempt.completed_at is not null
        or exists (
          select 1
          from public.unit_sale_terms terms
          where terms.sale_attempt_id = attempt.id
            and (
              terms.status <> 'draft'
              or terms.created_by_user_id is not null
              or terms.updated_by_user_id is not null
              or terms.approved_by_user_id is not null
              or terms.approved_at is not null
              or nullif(trim(coalesce(terms.commercial_summary, '')), '') is not null
              or nullif(trim(coalesce(terms.parking_location_details, '')), '') is not null
              or cardinality(coalesce(terms.additional_special_conditions, '{}'::text[])) > 0
              or coalesce(terms.developer_contribution_value, terms.developer_contribution, 0) <> 0
              or coalesce(terms.agent_contribution_value, terms.agent_contribution, 0) <> 0
              or coalesce(terms.parking_contribution_value, 0) <> 0
              or coalesce(terms.other_concessions, 0) <> 0
              or (
                terms.list_price_at_offer is not null
                and terms.contract_price is distinct from terms.list_price_at_offer
              )
            )
        )
        or exists (
          select 1
          from public.unit_sale_payment_schedule schedule
          where schedule.sale_attempt_id = attempt.id
            and (
              schedule.status <> 'pending'
              or schedule.created_by_user_id is not null
              or schedule.updated_by_user_id is not null
              or nullif(trim(coalesce(schedule.notes, '')), '') is not null
            )
        )
        or exists (
          select 1
          from public.unit_sale_documents document
          where document.sale_attempt_id = attempt.id
            and (
              document.status <> 'not_uploaded'
              or document.approved_by_user_id is not null
              or nullif(trim(coalesce(document.query_note, '')), '') is not null
              or exists (
                select 1
                from public.unit_sale_document_versions version
                where version.document_id = document.id
              )
            )
        )
        or exists (
          select 1
          from public.unit_sale_invoices invoice
          where invoice.sale_attempt_id = attempt.id
        )
        or exists (
          select 1
          from public.unit_sale_invoice_payments payment
          where payment.sale_attempt_id = attempt.id
        )
        or exists (
          select 1
          from public.unit_sale_notes note
          where note.sale_attempt_id = attempt.id
            and note.category <> 'system'
        )
        or exists (
          select 1
          from public.unit_sale_workflow_events event
          where event.sale_attempt_id = attempt.id
        )
      )
    end
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$$;

revoke all on function public.sale_attempt_blocks_unit_allocation(uuid) from public, anon, authenticated;
grant execute on function public.sale_attempt_blocks_unit_allocation(uuid) to service_role;

create or replace function public.get_unit_allocation_sale_workflows(
  p_actor_user_id uuid
)
returns table (
  id uuid,
  unit_id uuid,
  workflow_status text,
  is_active boolean,
  blocks_allocation boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  return query
  select
    attempt.id,
    attempt.unit_id,
    attempt.workflow_status,
    attempt.is_active,
    public.sale_attempt_blocks_unit_allocation(attempt.id)
  from public.unit_sale_attempts attempt
  where attempt.is_active is true;
end;
$$;

revoke all on function public.get_unit_allocation_sale_workflows(uuid) from public, anon, authenticated;
grant execute on function public.get_unit_allocation_sale_workflows(uuid) to service_role;

create or replace function public.validate_active_sale_attempt_entry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sale_status text;
  v_requires_for_sale boolean := false;
begin
  if new.is_active is not true then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_requires_for_sale := true;
  elsif old.is_active is not true or old.unit_id is distinct from new.unit_id then
    v_requires_for_sale := true;
  elsif old.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
        and new.workflow_status not in ('draft', 'rejected', 'reservation_query_raised', 'fallen_through', 'superseded') then
    v_requires_for_sale := true;
  end if;

  if v_requires_for_sale is not true then
    return new;
  end if;

  select unit.sale_status
  into v_sale_status
  from public.units unit
  where unit.id = new.unit_id
  for update;

  if v_sale_status is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_sale_status <> 'for_sale' then
    raise exception 'A reservation or new sale file can only start for a unit that is For sale.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_active_sale_attempt_entry on public.unit_sale_attempts;
create trigger validate_active_sale_attempt_entry
before insert or update of is_active, unit_id, workflow_status on public.unit_sale_attempts
for each row execute function public.validate_active_sale_attempt_entry();

create or replace function public.validate_sale_draft_substantive_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_unit_number text;
  v_sale_status text;
begin
  select unit.unit_number, unit.sale_status
  into v_unit_number, v_sale_status
  from public.unit_sale_attempts attempt
  join public.units unit on unit.id = attempt.unit_id
  where attempt.id = new.sale_attempt_id
    and attempt.is_active is true
    and attempt.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
  for update of unit;

  if found and v_sale_status <> 'for_sale' then
    raise exception 'Unit % must be For sale before sales preparation can continue.', v_unit_number;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_sale_draft_terms_write on public.unit_sale_terms;
create trigger validate_sale_draft_terms_write
before insert or update on public.unit_sale_terms
for each row execute function public.validate_sale_draft_substantive_write();

drop trigger if exists validate_sale_draft_document_write on public.unit_sale_documents;
create trigger validate_sale_draft_document_write
before insert or update on public.unit_sale_documents
for each row execute function public.validate_sale_draft_substantive_write();

create or replace function public.set_unit_sales_availability(
  p_unit_ids uuid[],
  p_target_status text,
  p_actor_user_id uuid,
  p_source text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_changed integer := 0;
  v_blocking_unit_numbers text;
  v_blocking_count integer := 0;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
    raise exception 'Choose at least one unit.';
  end if;
  if p_target_status not in ('not_released', 'not_for_sale', 'for_sale') then
    raise exception 'Choose a valid administrative sales availability.';
  end if;
  if (select count(*) from unnest(p_unit_ids) requested(id)) <> (select count(distinct id) from unnest(p_unit_ids) requested(id)) then
    raise exception 'The unit selection contains duplicates.';
  end if;
  if (select count(*) from public.units unit where unit.id = any(p_unit_ids)) <> array_length(p_unit_ids, 1) then
    raise exception 'One or more selected units could not be found.';
  end if;

  -- Lock every unit and active attempt in a stable order before validating. The
  -- same transaction either changes and audits the full selection or changes none.
  perform unit.id
  from public.units unit
  where unit.id = any(p_unit_ids)
  order by unit.id
  for update;

  perform attempt.id
  from public.unit_sale_attempts attempt
  where attempt.unit_id = any(p_unit_ids)
    and attempt.is_active is true
  order by attempt.id
  for update;

  select count(*), string_agg(unit.unit_number, ', ' order by unit.unit_number)
  into v_blocking_count, v_blocking_unit_numbers
  from public.units unit
  where unit.id = any(p_unit_ids)
    and exists (
      select 1
      from public.unit_sale_attempts attempt
      where attempt.unit_id = unit.id
        and attempt.is_active is true
        and public.sale_attempt_blocks_unit_allocation(attempt.id)
    );

  if v_blocking_count = 1 then
    raise exception 'Unit % has a sales workflow in progress. Resolve the sales workflow before changing its sales availability.', v_blocking_unit_numbers;
  elsif v_blocking_count > 1 then
    raise exception 'Units % have sales workflows in progress. Resolve those sales workflows before changing their sales availability.', v_blocking_unit_numbers;
  end if;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.sale_status not in ('not_released', 'not_for_sale', 'for_sale') then
      raise exception 'Unit % is controlled by the formal sales workflow and cannot be changed through Unit Allocation.', v_unit.unit_number;
    end if;
  end loop;

  perform set_config('app.unit_commercial_mutation', 'on', true);

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.sale_status is distinct from p_target_status then
      update public.units
      set sale_status = p_target_status,
          updated_at = now()
      where id = v_unit.id;

      insert into public.audit_events (
        event_type,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_by_user_id
      ) values (
        'unit_sales_availability_changed',
        'unit',
        v_unit.id,
        format('Unit %s sales availability changed from %s to %s.', v_unit.unit_number, v_unit.sale_status, p_target_status),
        jsonb_build_object(
          'building_id', v_unit.building_id,
          'unit_id', v_unit.id,
          'unit_number', v_unit.unit_number,
          'old_sale_status', v_unit.sale_status,
          'new_sale_status', p_target_status,
          'old_rental_portfolio_status', v_unit.rental_portfolio_status,
          'new_rental_portfolio_status', v_unit.rental_portfolio_status,
          'source', coalesce(nullif(trim(p_source), ''), 'unit_allocation'),
          'acting_user', p_actor_user_id,
          'batch_identifier', v_batch_id,
          'related_sale_attempt', null
        ),
        p_actor_user_id
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

revoke all on function public.set_unit_sales_availability(uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_unit_sales_availability(uuid[], text, uuid, text) to service_role;

-- END MIGRATION: 20260829_unit_allocation_pristine_drafts.sql

-- BEGIN MIGRATION 4/11: 20260830_unit_allocation_runtime_refinement.sql
-- SHA-256: f2e293b62e95682e49e1ebcd8197c1c02a0d1d0b6f5e41aba702d2ae50a243ac
-- Separate Building Structure's generated unit-price baseline from intentional
-- sale preparation, then keep the database helper authoritative for allocation.

alter table public.unit_sale_attempts
  add column if not exists is_system_baseline boolean not null default false;

create or replace function public.sale_attempt_has_meaningful_activity(
  p_sale_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      attempt.workflow_status <> 'draft'
      or nullif(trim(coalesce(attempt.buyer_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_person_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_company_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_phone, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_phone, '')), '') is not null
      or attempt.sales_agent_organisation_id is not null
      or attempt.conveyancer_organisation_id is not null
      or attempt.reservation_date is not null
      or attempt.reservation_terms_checked is true
      or attempt.reservation_submitted_at is not null
      or attempt.reservation_approved_at is not null
      or attempt.commercial_approved_at is not null
      or attempt.exchanged_at is not null
      or attempt.completed_at is not null
      or exists (
        select 1
        from public.unit_sale_terms terms
        where terms.sale_attempt_id = attempt.id
          and (
            terms.status <> 'draft'
            or terms.approved_by_user_id is not null
            or terms.approved_at is not null
            or nullif(trim(coalesce(terms.commercial_summary, '')), '') is not null
            or nullif(trim(coalesce(terms.parking_location_details, '')), '') is not null
            or cardinality(coalesce(terms.additional_special_conditions, '{}'::text[])) > 0
            or coalesce(terms.developer_contribution_value, terms.developer_contribution, 0) <> 0
            or coalesce(terms.agent_contribution_value, terms.agent_contribution, 0) <> 0
            or coalesce(terms.parking_contribution_value, 0) <> 0
            or coalesce(terms.other_concessions, 0) <> 0
            or (
              terms.list_price_at_offer is not null
              and terms.contract_price is distinct from terms.list_price_at_offer
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_payment_schedule schedule
        where schedule.sale_attempt_id = attempt.id
          and (
            schedule.status <> 'pending'
            or nullif(trim(coalesce(schedule.notes, '')), '') is not null
          )
      )
      or exists (
        select 1
        from public.unit_sale_documents document
        where document.sale_attempt_id = attempt.id
          and (
            document.status <> 'not_uploaded'
            or document.approved_by_user_id is not null
            or nullif(trim(coalesce(document.query_note, '')), '') is not null
            or exists (
              select 1
              from public.unit_sale_document_versions version
              where version.document_id = document.id
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_invoices invoice
        where invoice.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_invoice_payments payment
        where payment.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_notes note
        where note.sale_attempt_id = attempt.id
          and note.category <> 'system'
      )
      or exists (
        select 1
        from public.unit_sale_workflow_events event
        where event.sale_attempt_id = attempt.id
      )
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$$;

revoke all on function public.sale_attempt_has_meaningful_activity(uuid) from public, anon, authenticated;
grant execute on function public.sale_attempt_has_meaningful_activity(uuid) to service_role;

-- The earlier implementation wrote ordinary generated terms and payment rows
-- under the current administrator. Those actor IDs and timestamps do not make
-- the records substantive. Mark every content-pristine historical draft as the
-- same kind of generated baseline used by the corrected creation path.
update public.unit_sale_attempts attempt
set is_system_baseline = true
where attempt.is_active is true
  and attempt.workflow_status = 'draft'
  and public.sale_attempt_has_meaningful_activity(attempt.id) is false;

create or replace function public.sale_attempt_blocks_unit_allocation(
  p_sale_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when attempt.is_active is not true then false
      when attempt.workflow_status in ('fallen_through', 'superseded') then false
      when attempt.workflow_status <> 'draft' then true
      else attempt.is_system_baseline is not true
        or public.sale_attempt_has_meaningful_activity(attempt.id)
    end
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$$;

revoke all on function public.sale_attempt_blocks_unit_allocation(uuid) from public, anon, authenticated;
grant execute on function public.sale_attempt_blocks_unit_allocation(uuid) to service_role;

create or replace function public.prepare_unit_baseline_sale_record(
  p_unit_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  select *
  into v_unit
  from public.units unit
  where unit.id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit not found.';
  end if;
  if v_unit.sale_status not in ('not_released', 'not_for_sale', 'for_sale') then
    raise exception 'Unit % is controlled by the formal sales workflow.', v_unit.unit_number;
  end if;

  select *
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.unit_id = p_unit_id
    and attempt.is_active is true
  order by attempt.attempt_number desc
  limit 1
  for update;

  if found then
    if v_attempt.workflow_status <> 'draft'
       or public.sale_attempt_has_meaningful_activity(v_attempt.id) then
      raise exception 'Unit % already has sales preparation in progress.', v_unit.unit_number;
    end if;

    update public.unit_sale_attempts
    set is_system_baseline = true,
        updated_at = now()
    where id = v_attempt.id;

    return v_attempt.id;
  end if;

  perform set_config('app.unit_baseline_initialization', 'on', true);

  insert into public.unit_sale_attempts (
    building_id,
    unit_id,
    attempt_number,
    workflow_status,
    is_active,
    is_system_baseline,
    stage_entered_at,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_unit.building_id,
    v_unit.id,
    coalesce((
      select max(attempt.attempt_number) + 1
      from public.unit_sale_attempts attempt
      where attempt.unit_id = v_unit.id
    ), 1),
    'draft',
    true,
    true,
    now(),
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into v_attempt;

  return v_attempt.id;
end;
$$;

revoke all on function public.prepare_unit_baseline_sale_record(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_unit_baseline_sale_record(uuid, uuid) to service_role;

create or replace function public.mark_sale_attempt_substantive(
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  select *
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id
    and attempt.is_active is true
  for update;

  if not found then
    raise exception 'Active sale attempt not found.';
  end if;

  update public.unit_sale_attempts
  set is_system_baseline = false,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = v_attempt.id;

  insert into public.unit_sale_workflow_events (
    sale_attempt_id,
    building_id,
    unit_id,
    event_type,
    from_status,
    to_status,
    summary,
    metadata,
    created_by_user_id
  ) values (
    v_attempt.id,
    v_attempt.building_id,
    v_attempt.unit_id,
    coalesce(nullif(trim(p_event_type), ''), 'commercial_model_saved'),
    v_attempt.workflow_status,
    v_attempt.workflow_status,
    coalesce(nullif(trim(p_summary), ''), 'Commercial sale model saved.'),
    jsonb_build_object('source', 'sales_workspace'),
    p_actor_user_id
  );
end;
$$;

revoke all on function public.mark_sale_attempt_substantive(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_sale_attempt_substantive(uuid, uuid, text, text) to service_role;

create or replace function public.prevent_direct_sale_baseline_marker_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and new.is_system_baseline is true then
    if tg_op = 'INSERT' then
      raise exception 'System sale baselines can only be managed through an authorised server path.';
    elsif old.is_system_baseline is distinct from new.is_system_baseline then
      raise exception 'System sale baselines can only be managed through an authorised server path.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_direct_sale_baseline_marker_change on public.unit_sale_attempts;
create trigger prevent_direct_sale_baseline_marker_change
before insert or update of is_system_baseline on public.unit_sale_attempts
for each row execute function public.prevent_direct_sale_baseline_marker_change();

create or replace function public.validate_active_sale_attempt_entry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sale_status text;
  v_requires_for_sale boolean := false;
begin
  if new.is_active is not true then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_requires_for_sale := true;
  elsif old.is_active is not true or old.unit_id is distinct from new.unit_id then
    v_requires_for_sale := true;
  elsif old.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
        and new.workflow_status not in ('draft', 'rejected', 'reservation_query_raised', 'fallen_through', 'superseded') then
    v_requires_for_sale := true;
  end if;

  if v_requires_for_sale is not true then
    return new;
  end if;

  select unit.sale_status
  into v_sale_status
  from public.units unit
  where unit.id = new.unit_id
  for update;

  if v_sale_status is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_sale_status <> 'for_sale'
     and not (
       coalesce(current_setting('app.unit_baseline_initialization', true), '') = 'on'
       and new.is_system_baseline is true
       and new.workflow_status = 'draft'
       and v_sale_status in ('not_released', 'not_for_sale')
     ) then
    raise exception 'A reservation or new sale file can only start for a unit that is For sale.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_active_sale_attempt_entry on public.unit_sale_attempts;
create trigger validate_active_sale_attempt_entry
before insert or update of is_active, unit_id, workflow_status on public.unit_sale_attempts
for each row execute function public.validate_active_sale_attempt_entry();

create or replace function public.validate_sale_draft_substantive_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_unit_number text;
  v_sale_status text;
  v_is_system_baseline boolean;
  v_is_baseline_write boolean := false;
begin
  select unit.unit_number, unit.sale_status, attempt.is_system_baseline
  into v_unit_number, v_sale_status, v_is_system_baseline
  from public.unit_sale_attempts attempt
  join public.units unit on unit.id = attempt.unit_id
  where attempt.id = new.sale_attempt_id
    and attempt.is_active is true
    and attempt.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
  for update of unit;

  if not found then
    return new;
  end if;

  -- A direct authenticated write is itself intentional sales preparation. The
  -- portal's two server paths use service_role and explicitly decide whether a
  -- write is baseline setup or substantive Sales work.
  if auth.role() <> 'service_role' then
    update public.unit_sale_attempts
    set is_system_baseline = false,
        updated_at = now()
    where id = new.sale_attempt_id;
  end if;

  if v_sale_status = 'for_sale' then
    return new;
  end if;

  if tg_table_name = 'unit_sale_terms' then
    v_is_baseline_write :=
      auth.role() = 'service_role'
      and
      v_is_system_baseline is true
      and new.status = 'draft'
      and new.approved_by_user_id is null
      and new.approved_at is null
      and nullif(trim(coalesce(new.commercial_summary, '')), '') is null
      and nullif(trim(coalesce(new.parking_location_details, '')), '') is null
      and cardinality(coalesce(new.additional_special_conditions, '{}'::text[])) = 0
      and coalesce(new.developer_contribution_value, new.developer_contribution, 0) = 0
      and coalesce(new.agent_contribution_value, new.agent_contribution, 0) = 0
      and coalesce(new.parking_contribution_value, 0) = 0
      and coalesce(new.other_concessions, 0) = 0
      and (
        new.list_price_at_offer is null
        or new.contract_price is not distinct from new.list_price_at_offer
      );
  elsif tg_table_name = 'unit_sale_payment_schedule' then
    v_is_baseline_write :=
      auth.role() = 'service_role'
      and
      v_is_system_baseline is true
      and new.status = 'pending'
      and nullif(trim(coalesce(new.notes, '')), '') is null;
  end if;

  if not v_is_baseline_write then
    raise exception 'Unit % must be For sale before sales preparation can continue.', v_unit_number;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_sale_draft_terms_write on public.unit_sale_terms;
create trigger validate_sale_draft_terms_write
before insert or update on public.unit_sale_terms
for each row execute function public.validate_sale_draft_substantive_write();

drop trigger if exists validate_sale_draft_schedule_write on public.unit_sale_payment_schedule;
create trigger validate_sale_draft_schedule_write
before insert or update on public.unit_sale_payment_schedule
for each row execute function public.validate_sale_draft_substantive_write();

drop trigger if exists validate_sale_draft_document_write on public.unit_sale_documents;
create trigger validate_sale_draft_document_write
before insert or update on public.unit_sale_documents
for each row execute function public.validate_sale_draft_substantive_write();

-- END MIGRATION: 20260830_unit_allocation_runtime_refinement.sql

-- BEGIN MIGRATION 5/11: 20260830b_reservation_actor_identity_backfill.sql
-- SHA-256: 27638b520f7c95392aeff57f8a8a8814204d0a56a9e9a69803c79a73d43840e2
-- Backfill point-in-time reservation actor labels for records created before
-- reservation submission, approval and rejection identity snapshots existed.

update public.unit_sale_attempts attempt
set
  reservation_submitted_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_submitted_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_submitted_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_submitted_by_email = coalesce(
    nullif(trim(attempt.reservation_submitted_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_submitted_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_submitted_by_name), '') is null
    or trim(attempt.reservation_submitted_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_submitted_by_email), '') is null
  );

update public.unit_sale_attempts attempt
set
  reservation_approved_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_approved_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_approved_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_approved_by_email = coalesce(
    nullif(trim(attempt.reservation_approved_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_approved_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_approved_by_name), '') is null
    or trim(attempt.reservation_approved_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_approved_by_email), '') is null
  );

update public.unit_sale_attempts attempt
set
  reservation_rejected_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_rejected_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_rejected_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_rejected_by_email = coalesce(
    nullif(trim(attempt.reservation_rejected_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_rejected_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_rejected_by_name), '') is null
    or trim(attempt.reservation_rejected_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_rejected_by_email), '') is null
  );

-- END MIGRATION: 20260830b_reservation_actor_identity_backfill.sql

-- BEGIN MIGRATION 6/11: 20260830c_return_pre_exchange_unit_for_sale.sql
-- SHA-256: 7cb017bbe527ce779f4b52c575eb48e47c26360adca7dae596483d679ddf99dd
-- End an active pre-exchange sale attempt and atomically make its unit
-- available for sale again. Exchanged and later sale files remain immutable.

create or replace function public.return_pre_exchange_unit_for_sale(
  p_sale_attempt_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
  v_unit public.units%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_now timestamptz := now();
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if v_reason is null then
    raise exception 'Add a reason for returning the unit to For sale.';
  end if;

  select attempt.*
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'Sale attempt not found.';
  end if;
  if v_attempt.is_active is not true then
    raise exception 'Only an active sale attempt can return a unit to For sale.';
  end if;
  if v_attempt.workflow_status not in (
    'draft',
    'awaiting_approval',
    'reservation_submitted',
    'rejected',
    'reservation_query_raised',
    'approved',
    'reservation_approved',
    'awaiting_commercial_approval',
    'ready_for_exchange'
  ) then
    raise exception 'Only a sale attempt that has not exchanged can return the unit to For sale.';
  end if;

  select unit.*
  into v_unit
  from public.units unit
  where unit.id = v_attempt.unit_id
  for update;

  if v_unit.id is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_unit.sale_status not in ('for_sale', 'reserved') then
    raise exception 'Unit % cannot return to For sale from its current sales position.', v_unit.unit_number;
  end if;

  update public.unit_sale_attempts
  set
    buyer_email = null,
    buyer_phone = null,
    buyer_solicitor_name = null,
    buyer_solicitor_email = null,
    buyer_solicitor_phone = null,
    is_active = false,
    workflow_status = 'fallen_through',
    fall_through_reason = v_reason,
    fallen_through_at = v_now,
    stage_entered_at = v_now,
    redacted_at = v_now,
    redacted_by_user_id = p_actor_user_id,
    redaction_note = v_reason,
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where id = v_attempt.id;

  update public.unit_sale_terms
  set
    status = 'superseded',
    is_current = false,
    superseded_at = v_now,
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where sale_attempt_id = v_attempt.id
    and is_current is true;

  update public.unit_sale_invoices
  set
    status = 'redacted',
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where sale_attempt_id = v_attempt.id;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units
  set
    sale_status = 'for_sale',
    reservation_date = null,
    updated_at = v_now
  where id = v_unit.id;

  insert into public.unit_sale_workflow_events (
    sale_attempt_id,
    building_id,
    unit_id,
    event_type,
    from_status,
    to_status,
    summary,
    metadata,
    created_by_user_id
  ) values (
    v_attempt.id,
    v_attempt.building_id,
    v_attempt.unit_id,
    'unit_returned_to_for_sale',
    v_attempt.workflow_status,
    'fallen_through',
    format('Unit %s returned to For sale. Buyer contact details cleared; reservation record retained.', v_unit.unit_number),
    jsonb_build_object('reason', v_reason, 'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow')),
    p_actor_user_id
  );

  insert into public.audit_events (
    event_type,
    entity_type,
    entity_id,
    summary,
    metadata,
    created_by_user_id
  ) values (
    'unit_returned_to_for_sale',
    'unit',
    v_unit.id,
    format('Unit %s returned to For sale from %s.', v_unit.unit_number, v_attempt.workflow_status),
    jsonb_build_object(
      'building_id', v_unit.building_id,
      'unit_id', v_unit.id,
      'unit_number', v_unit.unit_number,
      'sale_attempt_id', v_attempt.id,
      'old_sale_status', v_unit.sale_status,
      'new_sale_status', 'for_sale',
      'old_workflow_status', v_attempt.workflow_status,
      'new_workflow_status', 'fallen_through',
      'reason', v_reason,
      'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow')
    ),
    p_actor_user_id
  );

  return v_unit.id;
end;
$$;

revoke all on function public.return_pre_exchange_unit_for_sale(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.return_pre_exchange_unit_for_sale(uuid, uuid, text, text) to service_role;

-- END MIGRATION: 20260830c_return_pre_exchange_unit_for_sale.sql

-- BEGIN MIGRATION 7/11: 20260831_rentals_tenancies.sql
-- SHA-256: 24e53fa20fe1c526665a10576c6c33df6efccfb5dd3a11e6e38060d478952230
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

-- END MIGRATION: 20260831_rentals_tenancies.sql

-- BEGIN MIGRATION 8/11: 20260831b_audit_log_structure.sql
-- SHA-256: f3de0c9520ed660a6423039b882136b1b31bc15976cd493b61d00c00147808db
-- Add optional, queryable audit context without changing or discarding historic events.
alter table public.audit_events
  add column if not exists category text,
  add column if not exists actor_organisation_id uuid references public.organisations(id) on delete set null,
  add column if not exists building_id uuid references public.buildings(id) on delete set null,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists affected_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists field_name text,
  add column if not exists previous_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists action_id uuid,
  add column if not exists source text;

create index if not exists audit_events_category_created_at_idx
  on public.audit_events (category, created_at desc);
create index if not exists audit_events_building_created_at_idx
  on public.audit_events (building_id, created_at desc)
  where building_id is not null;
create index if not exists audit_events_unit_created_at_idx
  on public.audit_events (unit_id, created_at desc)
  where unit_id is not null;
create index if not exists audit_events_affected_user_created_at_idx
  on public.audit_events (affected_user_id, created_at desc)
  where affected_user_id is not null;
create index if not exists audit_events_action_id_idx
  on public.audit_events (action_id)
  where action_id is not null;

update public.audit_events
set category = case
  when lower(event_type || ' ' || entity_type) ~ '(password|login|security|auth)' then 'security'
  when lower(event_type || ' ' || entity_type) ~ '(report|digest)' then 'reports'
  when lower(event_type || ' ' || entity_type) ~ '(tenan|rental|rent_)' then 'rentals'
  when lower(event_type || ' ' || entity_type) ~ '(sale|reservation|exchange|completion|deal)' then 'sales'
  when lower(event_type || ' ' || entity_type) ~ '(user|profile|access_request)' then 'users'
  when lower(event_type || ' ' || entity_type) ~ '(building|organisation|handover|trade|unit)' then 'setup'
  else 'system'
end
where category is null;

update public.audit_events
set source = metadata ->> 'source'
where source is null and nullif(metadata ->> 'source', '') is not null;

update public.audit_events
set building_id = coalesce(nullif(metadata ->> 'building_id', ''), nullif(metadata ->> 'buildingId', ''))::uuid
where building_id is null
  and coalesce(nullif(metadata ->> 'building_id', ''), nullif(metadata ->> 'buildingId', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.buildings
    where id = coalesce(nullif(audit_events.metadata ->> 'building_id', ''), nullif(audit_events.metadata ->> 'buildingId', ''))::uuid
  );

update public.audit_events
set unit_id = coalesce(nullif(metadata ->> 'unit_id', ''), nullif(metadata ->> 'unitId', ''))::uuid
where unit_id is null
  and coalesce(nullif(metadata ->> 'unit_id', ''), nullif(metadata ->> 'unitId', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.units
    where id = coalesce(nullif(audit_events.metadata ->> 'unit_id', ''), nullif(audit_events.metadata ->> 'unitId', ''))::uuid
  );

update public.audit_events
set affected_user_id = entity_id
where affected_user_id is null
  and entity_type in ('user', 'profile')
  and exists (select 1 from public.profiles where id = audit_events.entity_id);

update public.audit_events
set action_id = coalesce(nullif(metadata ->> 'action_id', ''), nullif(metadata ->> 'actionId', ''), nullif(metadata ->> 'batch_identifier', ''))::uuid
where action_id is null
  and coalesce(nullif(metadata ->> 'action_id', ''), nullif(metadata ->> 'actionId', ''), nullif(metadata ->> 'batch_identifier', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

create or replace function public.populate_audit_event_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate text;
begin
  if new.category is null then
    new.category := case
      when lower(new.event_type || ' ' || new.entity_type) ~ '(password|login|security|auth)' then 'security'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(report|digest)' then 'reports'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(tenan|rental|rent_)' then 'rentals'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(sale|reservation|exchange|completion|deal)' then 'sales'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(user|profile|access_request)' then 'users'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(building|organisation|handover|trade|unit)' then 'setup'
      else 'system'
    end;
  end if;

  if new.actor_organisation_id is null and new.created_by_user_id is not null then
    select organisation_id into new.actor_organisation_id
    from public.profiles
    where id = new.created_by_user_id;
  end if;

  new.source := coalesce(new.source, nullif(new.metadata ->> 'source', ''));

  if new.building_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'building_id', ''), nullif(new.metadata ->> 'buildingId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.buildings where id = candidate::uuid) then
      new.building_id := candidate::uuid;
    elsif new.entity_type = 'building' and exists (select 1 from public.buildings where id = new.entity_id) then
      new.building_id := new.entity_id;
    end if;
  end if;

  if new.unit_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'unit_id', ''), nullif(new.metadata ->> 'unitId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.units where id = candidate::uuid) then
      new.unit_id := candidate::uuid;
    elsif new.entity_type = 'unit' and exists (select 1 from public.units where id = new.entity_id) then
      new.unit_id := new.entity_id;
    end if;
  end if;

  if new.affected_user_id is null and new.entity_type in ('user', 'profile')
    and exists (select 1 from public.profiles where id = new.entity_id) then
    new.affected_user_id := new.entity_id;
  end if;

  if new.action_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'action_id', ''), nullif(new.metadata ->> 'actionId', ''), nullif(new.metadata ->> 'batch_identifier', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      new.action_id := candidate::uuid;
    end if;
  end if;

  if new.field_name is null and new.metadata ? 'old_sale_status' and new.metadata ? 'new_sale_status' then
    new.field_name := 'sale_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_sale_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_sale_status');
  elsif new.field_name is null and new.metadata ? 'old_rental_portfolio_status' and new.metadata ? 'new_rental_portfolio_status' then
    new.field_name := 'rental_portfolio_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_rental_portfolio_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_rental_portfolio_status');
  end if;

  return new;
end;
$$;

drop trigger if exists audit_events_populate_context on public.audit_events;
create trigger audit_events_populate_context
before insert on public.audit_events
for each row execute function public.populate_audit_event_context();

-- END MIGRATION: 20260831b_audit_log_structure.sql

-- BEGIN MIGRATION 9/11: 20260901_rental_arrears_risk.sql
-- SHA-256: 302529c51bf3e7a3d8497a691ac6af19d52dcd6e3e2c76bee5bae7033326ef25
-- Management-intelligence records for material rent-risk changes only.
-- This deliberately does not create a rent ledger, statement-line model or
-- payment-allocation workflow; the letting agent remains the definitive source.

create table if not exists public.rental_arrears_episodes (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.unit_tenancies(id) on delete restrict,
  agent_tenancy_reference text,
  first_reported_at timestamptz not null,
  last_reported_at timestamptz not null,
  cleared_at timestamptz,
  initial_reported_amount numeric(12, 2) not null check (initial_reported_amount >= 0),
  maximum_reported_amount numeric(12, 2) not null check (maximum_reported_amount >= initial_reported_amount),
  latest_reported_amount numeric(12, 2) check (latest_reported_amount is null or latest_reported_amount >= 0),
  status text not null check (status in ('open', 'cleared', 'closed_reconciliation_review', 'ended_unreconciled')),
  intervention_level text not null check (intervention_level in ('information', 'watch', 'action_required')),
  owner_action_required boolean not null default false,
  resolution_basis text,
  management_summary text not null check (length(trim(management_summary)) > 0),
  source_reference text not null check (length(trim(source_reference)) > 0),
  source_import_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_arrears_episode_report_dates_check check (last_reported_at >= first_reported_at),
  constraint rental_arrears_episode_clearance_check check (
    (status = 'cleared' and cleared_at is not null and cleared_at >= first_reported_at)
    or (status <> 'cleared' and cleared_at is null)
  ),
  constraint rental_arrears_episode_latest_amount_check check (
    latest_reported_amount is null or maximum_reported_amount >= latest_reported_amount
  )
);

create index if not exists rental_arrears_episodes_tenancy_idx
  on public.rental_arrears_episodes (tenancy_id, first_reported_at desc);
create index if not exists rental_arrears_episodes_open_idx
  on public.rental_arrears_episodes (last_reported_at desc)
  where status = 'open';
create index if not exists rental_arrears_episodes_attention_idx
  on public.rental_arrears_episodes (intervention_level, last_reported_at desc)
  where intervention_level in ('watch', 'action_required');

drop trigger if exists set_rental_arrears_episodes_updated_at on public.rental_arrears_episodes;
create trigger set_rental_arrears_episodes_updated_at
before update on public.rental_arrears_episodes
for each row execute function public.set_updated_at();

create table if not exists public.rental_arrears_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.rental_arrears_episodes(id) on delete restrict,
  event_at timestamptz not null,
  event_type text not null check (event_type in (
    'first_arrears_notification',
    'balance_changed',
    'payment_or_clearance_evidence',
    'tenancy_ended_or_relet',
    'recovery_outcome',
    'owner_decision_requested'
  )),
  reported_amount numeric(12, 2) check (reported_amount is null or reported_amount >= 0),
  summary text not null check (length(trim(summary)) > 0),
  source_reference text not null check (length(trim(source_reference)) > 0),
  source_kind text,
  evidence_confidence text not null check (evidence_confidence in ('low', 'medium', 'high')),
  source_import_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists rental_arrears_events_episode_idx
  on public.rental_arrears_events (episode_id, event_at desc);

create or replace function public.prevent_rental_arrears_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Rental arrears events are append-only; record a new material event instead.';
end;
$$;

drop trigger if exists rental_arrears_events_append_only on public.rental_arrears_events;
create trigger rental_arrears_events_append_only
before update or delete on public.rental_arrears_events
for each row execute function public.prevent_rental_arrears_event_mutation();

create table if not exists public.rental_import_runs (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id) on delete set null,
  source_reference text not null check (length(trim(source_reference)) > 0),
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  data_as_of timestamptz,
  episodes_imported integer not null default 0 check (episodes_imported >= 0),
  events_imported integer not null default 0 check (events_imported >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  data_quality_issue_count integer not null default 0 check (data_quality_issue_count >= 0),
  data_quality_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(data_quality_issues) = 'array'),
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_import_runs_completion_check check (
    (status = 'started' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

create index if not exists rental_import_runs_success_idx
  on public.rental_import_runs (completed_at desc)
  where status = 'succeeded';
create index if not exists rental_import_runs_building_idx
  on public.rental_import_runs (building_id, completed_at desc);

drop trigger if exists set_rental_import_runs_updated_at on public.rental_import_runs;
create trigger set_rental_import_runs_updated_at
before update on public.rental_import_runs
for each row execute function public.set_updated_at();

alter table public.rental_arrears_episodes enable row level security;
alter table public.rental_arrears_events enable row level security;
alter table public.rental_import_runs enable row level security;

drop policy if exists "rental managers read arrears episodes" on public.rental_arrears_episodes;
create policy "rental managers read arrears episodes"
on public.rental_arrears_episodes for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and exists (
    select 1
    from public.unit_tenancies tenancy
    where tenancy.id = rental_arrears_episodes.tenancy_id
      and public.can_access_building(tenancy.building_id)
  )
);

drop policy if exists "rental managers read arrears events" on public.rental_arrears_events;
create policy "rental managers read arrears events"
on public.rental_arrears_events for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and exists (
    select 1
    from public.rental_arrears_episodes episode
    join public.unit_tenancies tenancy on tenancy.id = episode.tenancy_id
    where episode.id = rental_arrears_events.episode_id
      and public.can_access_building(tenancy.building_id)
  )
);

drop policy if exists "rental managers read import health" on public.rental_import_runs;
create policy "rental managers read import health"
on public.rental_import_runs for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and (building_id is null or public.can_access_building(building_id))
);

revoke insert, update, delete on public.rental_arrears_episodes from anon, authenticated;
revoke insert, update, delete on public.rental_arrears_events from anon, authenticated;
revoke insert, update, delete on public.rental_import_runs from anon, authenticated;
grant select on public.rental_arrears_episodes to authenticated;
grant select on public.rental_arrears_events to authenticated;
grant select on public.rental_import_runs to authenticated;

revoke all on function public.prevent_rental_arrears_event_mutation() from public, anon, authenticated;

-- END MIGRATION: 20260901_rental_arrears_risk.sql

-- BEGIN MIGRATION 10/11: 20260902_rental_arrears_tenancy_attribution.sql
-- SHA-256: cf84daaf41364dae292f6c53387b440067e7912f7cef852ada280776b172c28f
-- Keep rent-risk reporting tenancy-specific. Ambiguous historical attribution is
-- retained for review but excluded from operational reporting.

alter table public.rental_arrears_episodes
  add column if not exists attribution_status text not null default 'matched',
  add column if not exists attribution_review_reason text;

alter table public.rental_arrears_episodes
  drop constraint if exists rental_arrears_episode_attribution_status_check;

alter table public.rental_arrears_episodes
  add constraint rental_arrears_episode_attribution_status_check check (
    (attribution_status = 'matched' and attribution_review_reason is null)
    or (
      attribution_status = 'review_required'
      and nullif(btrim(attribution_review_reason), '') is not null
    )
  );

-- Correct an existing attribution only when the episode date identifies exactly
-- one tenancy on the same unit. This includes the Unit 78 episode dated
-- 7 August 2025, whose unique date match is the tenancy ending 28 August 2025.
with episode_candidates as (
  select
    episode.id as episode_id,
    candidate.id as candidate_tenancy_id,
    count(*) over (partition by episode.id) as candidate_count
  from public.rental_arrears_episodes episode
  join public.unit_tenancies linked_tenancy on linked_tenancy.id = episode.tenancy_id
  join public.unit_tenancies candidate
    on candidate.unit_id = linked_tenancy.unit_id
   and candidate.tenancy_start_date <= episode.first_reported_at::date
   and (candidate.tenancy_end_date is null or candidate.tenancy_end_date >= episode.first_reported_at::date)
), unique_candidates as (
  select episode_id, candidate_tenancy_id
  from episode_candidates
  where candidate_count = 1
)
update public.rental_arrears_episodes episode
set
  tenancy_id = candidate.candidate_tenancy_id,
  attribution_status = 'matched',
  attribution_review_reason = null
from unique_candidates candidate
where episode.id = candidate.episode_id;

with candidate_counts as (
  select
    episode.id as episode_id,
    count(candidate.id) as candidate_count
  from public.rental_arrears_episodes episode
  join public.unit_tenancies linked_tenancy on linked_tenancy.id = episode.tenancy_id
  left join public.unit_tenancies candidate
    on candidate.unit_id = linked_tenancy.unit_id
   and candidate.tenancy_start_date <= episode.first_reported_at::date
   and (candidate.tenancy_end_date is null or candidate.tenancy_end_date >= episode.first_reported_at::date)
  group by episode.id
)
update public.rental_arrears_episodes episode
set
  attribution_status = 'review_required',
  attribution_review_reason = format(
    'Episode date matched %s tenancies on the recorded unit; review attribution before reporting.',
    candidate.candidate_count
  )
from candidate_counts candidate
where episode.id = candidate.episode_id
  and candidate.candidate_count <> 1;

create index if not exists rental_arrears_episodes_matched_tenancy_idx
  on public.rental_arrears_episodes (tenancy_id, first_reported_at desc)
  where attribution_status = 'matched';


-- END MIGRATION: 20260902_rental_arrears_tenancy_attribution.sql

-- BEGIN MIGRATION 11/11: 20260903_user_last_active.sql
-- SHA-256: 65abb6aa852c1c7e24eb1107596e7b4a55daa3295ffe305125e9dc92403681e4
alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- A successful sign-in is also known portal activity, so retain it as the
-- initial baseline until each user next opens the portal.
update public.profiles as profile
set last_active_at = auth_user.last_sign_in_at
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.last_active_at is null
  and auth_user.last_sign_in_at is not null;

create index if not exists profiles_last_active_at_idx
  on public.profiles (last_active_at desc nulls last);

-- END MIGRATION: 20260903_user_last_active.sql

commit;
