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
