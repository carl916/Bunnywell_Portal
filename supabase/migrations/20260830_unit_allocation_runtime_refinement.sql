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
