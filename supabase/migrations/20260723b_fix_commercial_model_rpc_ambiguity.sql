create or replace function public.save_unit_commercial_model(
  p_unit_id uuid,
  p_requester_id uuid,
  p_list_price_at_offer numeric,
  p_contract_price numeric,
  p_parking_value numeric,
  p_developer_contribution numeric,
  p_agent_contribution numeric,
  p_reservation_fee numeric,
  p_reservation_fee_holder text,
  p_agent_fee_percent numeric,
  p_vat_rate numeric,
  p_solicitor_fee numeric,
  p_exchange_deposit_percent numeric,
  p_second_deposit_enabled boolean,
  p_second_deposit_percent numeric,
  p_second_deposit_months_after_exchange integer,
  p_completion_balance_percent numeric,
  p_deposit_summary text,
  p_commercial_summary text,
  p_payment_schedule jsonb default '[]'::jsonb
)
returns table (sale_attempt_id uuid, sale_terms_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
  v_terms public.unit_sale_terms%rowtype;
  v_now timestamptz := now();
  v_row jsonb;
begin
  select *
  into v_unit
  from public.units
  where public.units.id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit not found.';
  end if;

  select *
  into v_attempt
  from public.unit_sale_attempts
  where public.unit_sale_attempts.unit_id = p_unit_id
    and public.unit_sale_attempts.is_active is true
  order by public.unit_sale_attempts.attempt_number desc
  limit 1
  for update;

  if not found then
    insert into public.unit_sale_attempts (
      building_id,
      unit_id,
      attempt_number,
      workflow_status,
      is_active,
      stage_entered_at,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_unit.building_id,
      v_unit.id,
      coalesce((select max(usa.attempt_number) + 1 from public.unit_sale_attempts usa where usa.unit_id = v_unit.id), 1),
      'draft',
      true,
      v_now,
      p_requester_id,
      p_requester_id
    )
    returning * into v_attempt;
  end if;

  if v_attempt.workflow_status in ('fallen_through', 'superseded', 'completed') then
    raise exception 'This commercial model cannot be edited.';
  end if;

  select *
  into v_terms
  from public.unit_sale_terms
  where public.unit_sale_terms.sale_attempt_id = v_attempt.id
    and public.unit_sale_terms.is_current is true
  limit 1
  for update;

  if found then
    update public.unit_sale_terms
    set
      list_price_at_offer = p_list_price_at_offer,
      contract_price = p_contract_price,
      parking_value = coalesce(p_parking_value, 0),
      developer_contribution = coalesce(p_developer_contribution, 0),
      agent_contribution = coalesce(p_agent_contribution, 0),
      reservation_fee = p_reservation_fee,
      reservation_fee_holder = p_reservation_fee_holder,
      agent_fee_percent = p_agent_fee_percent,
      vat_rate = coalesce(p_vat_rate, 20),
      solicitor_fee = p_solicitor_fee,
      exchange_deposit_percent = p_exchange_deposit_percent,
      second_deposit_enabled = coalesce(p_second_deposit_enabled, false),
      second_deposit_percent = p_second_deposit_percent,
      second_deposit_months_after_exchange = p_second_deposit_months_after_exchange,
      completion_balance_percent = p_completion_balance_percent,
      deposit_summary = p_deposit_summary,
      commercial_summary = p_commercial_summary,
      updated_by_user_id = p_requester_id,
      updated_at = v_now
    where public.unit_sale_terms.id = v_terms.id
    returning * into v_terms;
  else
    insert into public.unit_sale_terms (
      sale_attempt_id,
      version_number,
      is_current,
      status,
      list_price_at_offer,
      contract_price,
      parking_value,
      developer_contribution,
      agent_contribution,
      reservation_fee,
      reservation_fee_holder,
      agent_fee_percent,
      vat_rate,
      solicitor_fee,
      exchange_deposit_percent,
      second_deposit_enabled,
      second_deposit_percent,
      second_deposit_months_after_exchange,
      completion_balance_percent,
      deposit_summary,
      commercial_summary,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      1,
      true,
      case when v_attempt.workflow_status = 'draft' then 'draft' else 'submitted' end,
      p_list_price_at_offer,
      p_contract_price,
      coalesce(p_parking_value, 0),
      coalesce(p_developer_contribution, 0),
      coalesce(p_agent_contribution, 0),
      p_reservation_fee,
      p_reservation_fee_holder,
      p_agent_fee_percent,
      coalesce(p_vat_rate, 20),
      p_solicitor_fee,
      p_exchange_deposit_percent,
      coalesce(p_second_deposit_enabled, false),
      p_second_deposit_percent,
      p_second_deposit_months_after_exchange,
      p_completion_balance_percent,
      p_deposit_summary,
      p_commercial_summary,
      p_requester_id,
      p_requester_id
    )
    returning * into v_terms;
  end if;

  delete from public.unit_sale_payment_schedule
  where public.unit_sale_payment_schedule.sale_attempt_id = v_attempt.id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payment_schedule, '[]'::jsonb))
  loop
    insert into public.unit_sale_payment_schedule (
      sale_attempt_id,
      sale_terms_id,
      sequence_no,
      payment_stage,
      label,
      due_event,
      due_offset_days,
      percent_of_contract_price,
      fixed_amount,
      expected_amount,
      includes_reservation_fee,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      v_terms.id,
      (v_row ->> 'sequenceNo')::integer,
      v_row ->> 'paymentStage',
      v_row ->> 'label',
      v_row ->> 'dueEvent',
      nullif(v_row ->> 'dueOffsetDays', '')::integer,
      nullif(v_row ->> 'percentOfContractPrice', '')::numeric,
      nullif(v_row ->> 'fixedAmount', '')::numeric,
      nullif(v_row ->> 'expectedAmount', '')::numeric,
      coalesce((v_row ->> 'includesReservationFee')::boolean, false),
      p_requester_id,
      p_requester_id
    );
  end loop;

  sale_attempt_id := v_attempt.id;
  sale_terms_id := v_terms.id;
  return next;
end;
$$;
