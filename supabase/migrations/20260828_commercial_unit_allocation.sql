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
