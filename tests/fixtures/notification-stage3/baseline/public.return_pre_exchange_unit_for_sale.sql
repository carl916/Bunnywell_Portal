CREATE OR REPLACE FUNCTION public.return_pre_exchange_unit_for_sale(p_sale_attempt_id uuid, p_actor_user_id uuid, p_reason text, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attempt public.unit_sale_attempts%rowtype;
  v_unit public.units%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_now timestamptz := now();
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if v_reason is null or length(v_reason) > 5000 then
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
  if v_attempt.reservation_approved_at is null
    or v_attempt.reservation_approved_by_user_id is null
    or v_attempt.workflow_status not in (
      'approved', 'reservation_approved', 'awaiting_commercial_approval', 'ready_for_exchange'
    ) then
    raise exception 'Return to sale requires a developer-approved reservation.';
  end if;
  if v_attempt.exchanged_at is not null or v_attempt.completed_at is not null or v_attempt.legal_completed_at is not null then
    raise exception 'Exchanged or completed sales require a separate cancellation process.';
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
    buyer_name = null,
    buyer_person_name = null,
    buyer_company_name = null,
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

  update public.unit_sale_document_versions version
  set
    is_current = false,
    redacted_at = v_now,
    redacted_by_user_id = p_actor_user_id
  where version.document_id in (
    select document.id
    from public.unit_sale_documents document
    where document.sale_attempt_id = v_attempt.id
  )
    and version.redacted_at is null;

  update public.unit_sale_documents
  set
    status = 'redacted',
    redacted_at = v_now,
    redacted_by_user_id = p_actor_user_id,
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where sale_attempt_id = v_attempt.id;

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
    format('Unit %s returned to For sale. Buyer details and active documents redacted.', v_unit.unit_number),
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
$function$
