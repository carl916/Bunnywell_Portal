-- A1/A2. Proposed staging patch: NOT applied remotely. Apply with its scoped-upload caller change.
begin;
CREATE OR REPLACE FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
  v_terms public.unit_sale_terms%rowtype;
  v_now timestamptz := now();
  v_row jsonb;
begin
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'Authorised server path required' USING errcode='42501'; END IF;
  perform public.assert_commercial_unit_actor(p_requester_id, ARRAY['admin','developer']);
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
$function$
;
CREATE OR REPLACE FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_developer_contribution_value numeric DEFAULT NULL::numeric, p_developer_contribution_value_type text DEFAULT 'amount'::text, p_agent_contribution_value numeric DEFAULT NULL::numeric, p_agent_contribution_value_type text DEFAULT 'amount'::text, p_parking_contribution_value numeric DEFAULT 0, p_parking_location_details text DEFAULT NULL::text, p_additional_special_conditions text[] DEFAULT '{}'::text[])
 RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
  v_terms public.unit_sale_terms%rowtype;
  v_now timestamptz := now();
  v_row jsonb;
begin
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'Authorised server path required' USING errcode='42501'; END IF;
  perform public.assert_commercial_unit_actor(p_requester_id, ARRAY['admin','developer']);
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
      developer_contribution_value = coalesce(p_developer_contribution_value, p_developer_contribution, 0),
      developer_contribution_value_type = coalesce(p_developer_contribution_value_type, 'amount'),
      agent_contribution_value = coalesce(p_agent_contribution_value, p_agent_contribution, 0),
      agent_contribution_value_type = coalesce(p_agent_contribution_value_type, 'amount'),
      parking_contribution_value = coalesce(p_parking_contribution_value, 0),
      parking_location_details = p_parking_location_details,
      additional_special_conditions = coalesce(p_additional_special_conditions, '{}'::text[]),
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
      developer_contribution_value,
      developer_contribution_value_type,
      agent_contribution_value,
      agent_contribution_value_type,
      parking_contribution_value,
      parking_location_details,
      additional_special_conditions,
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
      coalesce(p_developer_contribution_value, p_developer_contribution, 0),
      coalesce(p_developer_contribution_value_type, 'amount'),
      coalesce(p_agent_contribution_value, p_agent_contribution, 0),
      coalesce(p_agent_contribution_value_type, 'amount'),
      coalesce(p_parking_contribution_value, 0),
      p_parking_location_details,
      coalesce(p_additional_special_conditions, '{}'::text[]),
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
$function$
;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('save_unit_commercial_model','save_unit_commercial_model_with_agent_fees','save_unit_commercial_model_with_deposits') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
-- Active profile and exact path scope. Uses the same access predicates as snag/photo RLS.
CREATE OR REPLACE FUNCTION public.can_upload_snag_object(object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE parts text[]; category text; building uuid; unit uuid; record_id uuid; actor_role text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 actor_role:=public.current_app_role();
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND active IS TRUE) THEN RETURN false; END IF;
 parts:=string_to_array(object_name,'/');
 IF parts[1]='_derived' THEN parts:=parts[2:]; END IF;
 IF parts[1]='videos' THEN parts:=parts[2:]; END IF;
 category:=parts[1];
 IF category IN ('snag-updates','resolutions','rejections') THEN
  IF cardinality(parts)<>3 OR parts[2]!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  record_id:=parts[2]::uuid;
  RETURN public.can_access_snag(record_id);
 END IF;
 IF category NOT IN ('snags','defects') OR cardinality(parts)<>4 OR parts[2]!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 building:=parts[2]::uuid;
 IF parts[3]<>'communal' THEN
  IF parts[3]!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  unit:=parts[3]::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.units u WHERE u.id=unit AND u.building_id=building) THEN RETURN false; END IF;
 END IF;
 IF category='snags' THEN
  RETURN public.is_setup_admin() OR (actor_role='developer_representative' AND public.can_access_building(building));
 END IF;
 RETURN actor_role='resident' AND unit IS NOT NULL AND public.can_access_unit(unit) AND public.building_allows_resident_routine_snags(building);
END $$;
REVOKE ALL ON FUNCTION public.can_upload_snag_object(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_upload_snag_object(text) TO authenticated,service_role;
DROP POLICY IF EXISTS "authenticated users upload snag images hardened" ON storage.objects;
CREATE POLICY "authenticated users upload snag images hardened" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='snag-images' AND public.can_upload_snag_object(name));
-- Existing public reads and internal deletion rights stay intact. Replacements cannot move into an unauthorised scope.
DROP POLICY IF EXISTS "back office update snag images hardened" ON storage.objects;
CREATE POLICY "back office update snag images hardened" ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='snag-images' AND public.is_back_office_user())
WITH CHECK(bucket_id='snag-images' AND public.is_back_office_user());
-- Reports are building-private; signed links deliberately issued to report recipients still work.
CREATE OR REPLACE FUNCTION public.can_read_snag_report(object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE parts text[]:=string_to_array(object_name,'/'); b uuid; r text:=public.current_app_role();
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND active IS TRUE) THEN RETURN false; END IF;
 IF cardinality(parts)<>3 OR parts[1]<>'reports' OR parts[2]!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 b:=parts[2]::uuid;
 RETURN public.is_setup_admin() OR (r IN ('developer_representative','contractor') AND public.can_access_building(b));
END $$;
REVOKE ALL ON FUNCTION public.can_read_snag_report(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_snag_report(text) TO authenticated,service_role;
DROP POLICY IF EXISTS "authenticated users read snag report files" ON storage.objects;
CREATE POLICY "authenticated users read snag report files" ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='snag-reports' AND public.can_read_snag_report(name));
DROP POLICY "role aware snag inserts" ON public.snags;
CREATE POLICY "role aware snag inserts" ON public.snags FOR INSERT TO authenticated WITH CHECK ((created_by_user_id = auth.uid()) AND (((source_type = 'developer_snag'::text) AND (is_setup_admin() OR ((current_app_role() = 'developer_representative'::text) AND (building_id IS NOT NULL) AND can_access_building(building_id)))) OR ((current_app_role() = 'resident'::text) AND (source_type = 'leaseholder_defect'::text) AND (unit_id IS NOT NULL) AND (area_id IS NOT NULL) AND can_access_unit(unit_id) AND building_allows_resident_routine_snags(building_id) AND (EXISTS ( SELECT 1
   FROM units u
  WHERE ((u.id = snags.unit_id) AND (u.building_id = snags.building_id)))) AND (EXISTS ( SELECT 1
   FROM areas a
  WHERE ((a.id = snags.area_id) AND (a.unit_id = snags.unit_id) AND (a.building_id = snags.building_id)))))));
NOTIFY pgrst,'reload schema';
COMMIT;
