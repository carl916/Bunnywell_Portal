CREATE OR REPLACE FUNCTION workspace_commands.reservation_command_before_notifications(p_building uuid, p_unit uuid, p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_expected timestamp with time zone, p_payload jsonb DEFAULT '{}'::jsonb, p_expected_terms jsonb DEFAULT NULL::jsonb, p_expected_defaults jsonb DEFAULT NULL::jsonb, p_terms jsonb DEFAULT NULL::jsonb, p_schedule jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'workspace_commands'
AS $function$
declare a unit_sale_attempts%rowtype; u units%rowtype; actor profiles%rowtype;
 t unit_sale_terms%rowtype; next_terms unit_sale_terms%rowtype; defs building_sale_defaults%rowtype;
 d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype; prior workspace_commands.receipts%rowtype;
 input jsonb; result jsonb; rd date; reason text; target text; event text; summary text; row jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer','sales_agent']);
 if p_request is null or p_action not in ('save_reservation_draft','save_reservation','approve_reservation','query_reservation','reject_reservation') then raise exception 'Reservation operation unavailable.'; end if;
 select * into actor from profiles where id=p_actor;
 if p_action in ('approve_reservation','query_reservation','reject_reservation') and actor.role not in ('admin','developer') then raise exception 'Only developers can review reservations.' using errcode='42501'; end if;
 select * into a from unit_sale_attempts where id=p_sale for update;
 if a.building_id is distinct from p_building or a.unit_id is distinct from p_unit or not a.is_active or a.redacted_at is not null then raise exception 'Exact active sale unavailable.' using errcode='42501'; end if;
 input:=jsonb_build_object('building',p_building,'unit',p_unit,'expected',p_expected,'payload',p_payload);
 select * into prior from workspace_commands.receipts where id=p_request;
 if found then
  if prior.sale_id<>p_sale or prior.actor_id<>p_actor or prior.action<>p_action or prior.input is distinct from input then raise exception 'Submission reference conflicts with the saved command.'; end if;
  return prior.result;
 end if;
 if a.exchanged_at is not null or a.legal_completed_at is not null or a.workflow_status in ('completed','fallen_through','superseded') then raise exception 'Reservation changes end at exchange.'; end if;
 if p_expected is null or a.updated_at is distinct from p_expected then raise exception 'This sale changed. Reload before saving.'; end if;
 select * into u from units where id=p_unit and building_id=p_building for update;
 if u.sale_status is distinct from 'for_sale' then raise exception 'This unit is not available for reservation work.'; end if;
 if p_action in ('save_reservation_draft','save_reservation') and a.workflow_status not in ('draft','rejected','reservation_query_raised') then raise exception 'This reservation is not editable.'; end if;
 if p_action in ('approve_reservation','query_reservation','reject_reservation') and a.workflow_status not in ('awaiting_approval','reservation_submitted') then raise exception 'A submitted reservation is required.'; end if;
 if p_action in ('save_reservation_draft','save_reservation') then
  if nullif(btrim(p_payload->>'buyerPersonName'),'') is null and nullif(btrim(p_payload->>'buyerCompanyName'),'') is null then raise exception 'Enter a buyer name or company.'; end if;
  if exists(select 1 from jsonb_each_text(p_payload) x where length(x.value)>5000) then raise exception 'Reservation field is too long.'; end if;
  if nullif(p_payload->>'reservationDate','') is not null then
   if p_payload->>'reservationDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the reservation date.'; end if;
   rd:=(p_payload->>'reservationDate')::date;
   if rd>(now() at time zone 'Europe/London')::date then raise exception 'Reservation date cannot be in the future.'; end if;
  end if;
  if p_action='save_reservation' and (rd is null or nullif(btrim(p_payload->>'buyerEmail'),'') is null or nullif(btrim(p_payload->>'buyerPhone'),'') is null or nullif(btrim(p_payload->>'buyerSolicitorName'),'') is null or p_payload->>'reservationTermsChecked' is distinct from 'true') then raise exception 'Buyer contact, solicitor, date and checked terms are required.'; end if;
 else
  rd:=a.reservation_date;
 end if;
 if p_action in ('save_reservation','approve_reservation') then
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type='reservation_form' and redacted_at is null and superseded_at is null for update;
  select * into v from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
  if v.id is null or v.id::text is distinct from p_payload->>'versionId' then raise exception 'Review the current reservation PDF before submitting or approving.'; end if;
 end if;
 if p_action='approve_reservation' and (rd is null or rd>(now() at time zone 'Europe/London')::date or coalesce(nullif(btrim(a.buyer_person_name),''),nullif(btrim(a.buyer_company_name),''),nullif(btrim(a.buyer_name),'')) is null or nullif(btrim(a.buyer_email),'') is null or nullif(btrim(a.buyer_phone),'') is null or nullif(btrim(a.buyer_solicitor_name),'') is null or not a.reservation_terms_checked) then raise exception 'Complete the buyer, contact, solicitor, date and checked terms before approval.'; end if;
 if p_action='save_reservation' then
  select * into t from unit_sale_terms where sale_attempt_id=p_sale and is_current for update;
  select * into defs from building_sale_defaults where building_id=p_building for share;
  if (case when t.id is null then null else to_jsonb(t) end) is distinct from p_expected_terms or (case when defs.building_id is null then null else to_jsonb(defs) end) is distinct from p_expected_defaults then raise exception 'Commercial terms changed. Reload before submitting.'; end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_terms) k where not k=any(array['list_price_at_offer','contract_price','parking_value','developer_contribution','developer_contribution_value','developer_contribution_value_type','agent_contribution','agent_contribution_value','agent_contribution_value_type','parking_contribution_value','parking_location_details','additional_special_conditions','reservation_fee','reservation_fee_holder','agent_fee_percent','exchange_agent_fee_percent','completion_agent_fee_percent','vat_rate','solicitor_fee','exchange_deposit_percent','further_deposit_timing','second_deposit_enabled','second_deposit_percent','second_deposit_months_after_exchange','completion_balance_percent','deposit_summary','commercial_summary'])) then raise exception 'Invalid calculated terms.'; end if;
  next_terms:=jsonb_populate_record(null::unit_sale_terms,p_terms);
  if next_terms.exchange_deposit_percent is null or next_terms.completion_balance_percent is null or next_terms.exchange_deposit_percent+coalesce(next_terms.second_deposit_percent,0)+next_terms.completion_balance_percent<>100 then raise exception 'Invalid payment schedule percentages.'; end if;
  if jsonb_typeof(p_schedule) is distinct from 'array' or jsonb_array_length(p_schedule) not between 2 and 3 then raise exception 'Calculated payment schedule required.'; end if;
  if t.id is null then
   insert into unit_sale_terms(sale_attempt_id,version_number,is_current,status,created_by_user_id) values(p_sale,1,true,'draft',p_actor) returning * into t;
  end if;
  update unit_sale_terms set list_price_at_offer=next_terms.list_price_at_offer,contract_price=next_terms.contract_price,parking_value=next_terms.parking_value,developer_contribution=next_terms.developer_contribution,developer_contribution_value=next_terms.developer_contribution_value,developer_contribution_value_type=next_terms.developer_contribution_value_type,agent_contribution=next_terms.agent_contribution,agent_contribution_value=next_terms.agent_contribution_value,agent_contribution_value_type=next_terms.agent_contribution_value_type,parking_contribution_value=next_terms.parking_contribution_value,parking_location_details=next_terms.parking_location_details,additional_special_conditions=next_terms.additional_special_conditions,reservation_fee=next_terms.reservation_fee,reservation_fee_holder=next_terms.reservation_fee_holder,agent_fee_percent=next_terms.agent_fee_percent,exchange_agent_fee_percent=next_terms.exchange_agent_fee_percent,completion_agent_fee_percent=next_terms.completion_agent_fee_percent,vat_rate=next_terms.vat_rate,solicitor_fee=next_terms.solicitor_fee,exchange_deposit_percent=next_terms.exchange_deposit_percent,further_deposit_timing=next_terms.further_deposit_timing,second_deposit_enabled=next_terms.second_deposit_enabled,second_deposit_percent=next_terms.second_deposit_percent,second_deposit_months_after_exchange=next_terms.second_deposit_months_after_exchange,completion_balance_percent=next_terms.completion_balance_percent,deposit_summary=next_terms.deposit_summary,commercial_summary=next_terms.commercial_summary,status='submitted',updated_by_user_id=p_actor,updated_at=now() where id=t.id;
  delete from unit_sale_payment_schedule where sale_attempt_id=p_sale;
  for row in select value from jsonb_array_elements(p_schedule) loop
   insert into unit_sale_payment_schedule(sale_attempt_id,sale_terms_id,sequence_no,payment_stage,label,due_event,due_offset_days,percent_of_contract_price,expected_amount,includes_reservation_fee,created_by_user_id,updated_by_user_id)
   values(p_sale,t.id,(row->>'sequenceNo')::integer,row->>'paymentStage',row->>'label',row->>'dueEvent',(row->>'dueOffsetDays')::integer,(row->>'percentOfContractPrice')::numeric,(row->>'expectedAmount')::numeric,(row->>'includesReservationFee')::boolean,p_actor,p_actor);
  end loop;
 end if;
 if p_action in ('save_reservation_draft','save_reservation') then
  update unit_sale_attempts set buyer_name=coalesce(nullif(btrim(p_payload->>'buyerPersonName'),''),nullif(btrim(p_payload->>'buyerCompanyName'),'')),buyer_person_name=nullif(btrim(p_payload->>'buyerPersonName'),''),buyer_company_name=nullif(btrim(p_payload->>'buyerCompanyName'),''),
   buyer_email=nullif(btrim(p_payload->>'buyerEmail'),''),buyer_phone=nullif(btrim(p_payload->>'buyerPhone'),''),buyer_solicitor_name=nullif(btrim(p_payload->>'buyerSolicitorName'),''),reservation_date=rd,reservation_terms_checked=coalesce((p_payload->>'reservationTermsChecked')::boolean,false),updated_by_user_id=p_actor,updated_at=now() where id=p_sale;
 end if;
 target:=a.workflow_status;
 if p_action='save_reservation_draft' then event:='reservation_draft_saved';summary:='Reservation draft saved.';
 elsif p_action='save_reservation' then
  target:='awaiting_approval';event:=case when a.workflow_status in ('rejected','reservation_query_raised') then 'reservation_resubmitted' else 'reservation_submitted' end;summary:='Reservation submitted for developer review.';
  update unit_sale_attempts set workflow_status=target,reservation_submitted_at=now(),reservation_submitted_by_user_id=p_actor,reservation_submitted_by_name=coalesce(actor.full_name,actor.name),reservation_submitted_by_email=actor.email,
   reservation_approved_at=null,reservation_approved_by_user_id=null,reservation_approved_by_name=null,reservation_approved_by_email=null,reservation_rejected_at=null,reservation_rejected_by_user_id=null,reservation_rejected_by_name=null,reservation_rejected_by_email=null,reservation_rejection_reason=null,stage_entered_at=now() where id=p_sale;
  update unit_sale_documents set status='under_review',query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
  perform public.sales_workflow_mark_unit_for_sale(p_unit,p_sale,p_actor,'reservation_submission');
  update units set reservation_date=null where id=p_unit;
 elsif p_action='approve_reservation' then
  target:='approved';event:='reservation_approved';summary:='Reservation approved. Unit marked Reserved.';
  update unit_sale_attempts set workflow_status=target,reservation_approved_at=now(),reservation_approved_by_user_id=p_actor,reservation_approved_by_name=coalesce(actor.full_name,actor.name),reservation_approved_by_email=actor.email,stage_entered_at=rd::timestamp at time zone 'UTC',updated_by_user_id=p_actor,updated_at=now() where id=p_sale;
  update unit_sale_terms set status='approved',approved_by_user_id=p_actor,approved_at=now(),updated_by_user_id=p_actor,updated_at=now() where sale_attempt_id=p_sale and is_current;
  update unit_sale_documents set status='approved',approved_version_id=v.id,approved_by_user_id=p_actor,approved_at=now(),updated_by_user_id=p_actor,updated_at=now() where id=d.id;
  perform public.sales_workflow_mark_unit_reserved(p_unit,p_sale,p_actor,'reservation_approval');
  update units set reservation_date=rd where id=p_unit;
 else
  reason:=nullif(btrim(p_payload->>'reason'),'');if reason is null or length(reason)>5000 then raise exception 'Enter a review reason of 1–5,000 characters.'; end if;
  target:=case when p_action='query_reservation' then 'reservation_query_raised' else 'rejected' end;event:=case when p_action='query_reservation' then 'reservation_query_raised' else 'reservation_rejected' end;summary:=case when p_action='query_reservation' then 'Reservation queried.' else 'Reservation rejected. Unit remains For sale.' end;
  update unit_sale_attempts set workflow_status=target,updated_by_user_id=p_actor,updated_at=now() where id=p_sale;
  update unit_sale_documents set status=case when p_action='query_reservation' then 'query_raised' else 'uploaded' end,query_note=case when p_action='query_reservation' then reason end,updated_by_user_id=p_actor,updated_at=now() where sale_attempt_id=p_sale and document_type='reservation_form' and redacted_at is null and superseded_at is null;
  if p_action='reject_reservation' then
   update unit_sale_attempts set reservation_terms_checked=false,reservation_rejected_at=now(),reservation_rejected_by_user_id=p_actor,reservation_rejected_by_name=coalesce(actor.full_name,actor.name),reservation_rejected_by_email=actor.email,reservation_rejection_reason=reason,stage_entered_at=now() where id=p_sale;
   update unit_sale_terms set status='draft',updated_by_user_id=p_actor,updated_at=now() where sale_attempt_id=p_sale and is_current;
   perform public.sales_workflow_mark_unit_for_sale(p_unit,p_sale,p_actor,'reservation_rejection');
   update units set reservation_date=null where id=p_unit;
  end if;
  insert into unit_sale_notes(sale_attempt_id,building_id,unit_id,category,visibility,body,created_by_user_id) values(p_sale,p_building,p_unit,'blocker','shared_sale_file',reason,p_actor);
 end if;
 perform public.sales_legal_event(p_sale,p_actor,event,summary,jsonb_strip_nulls(jsonb_build_object('commandId',p_request,'reservationDate',rd,'versionId',v.id,'reason',reason)));
 result:=jsonb_build_object('saleAttemptId',p_sale,'workflowStatus',target);
 insert into workspace_commands.receipts(id,sale_id,actor_id,action,input,result) values(p_request,p_sale,p_actor,p_action,input,result);
 return result;
end $function$
