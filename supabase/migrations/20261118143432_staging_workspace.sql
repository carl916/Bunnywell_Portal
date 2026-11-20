BEGIN;
SET LOCAL lock_timeout='5s';
-- Source: baseline/workspace-reads.sql

-- Request-local access snapshot; caller JWT/RLS, no security-definer bypass and no cache.
create function public.workspace_access_context() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('profile',(select jsonb_build_object('id',id,'role',role,'organisation_id',organisation_id,'active',active) from public.profiles where id=auth.uid()),
'units',coalesce((select jsonb_agg(x) from (select unit_id from public.user_unit_access where user_id=auth.uid()) x),'[]'::jsonb),
'buildings',coalesce((select jsonb_agg(x) from (select building_id from public.user_building_access where user_id=auth.uid()) x),'[]'::jsonb),
'links',coalesce((select jsonb_agg(x) from (select building_id,organisation_id,role_on_project,active from public.building_organisations where organisation_id=(select organisation_id from public.profiles where id=auth.uid())) x),'[]'::jsonb));
$$;
revoke all on function public.workspace_access_context() from public,anon;
grant execute on function public.workspace_access_context() to authenticated,service_role;
-- Minimal facts from one building, one PostgreSQL statement snapshot, evaluated under caller RLS.
-- All action, responsibility and money calculations remain in the existing canonical TypeScript helpers.
create function public.workspace_building_facts(p_building uuid,p_unit uuid default null,p_sale uuid default null,p_include_snags boolean default true)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r text:=public.current_app_role(); result jsonb;
begin
 if r is null or r not in ('admin','developer','developer_representative','contractor','sales_agent','conveyancer') or not exists(select 1 from public.buildings where id=p_building) then raise exception 'Building unavailable' using errcode='42501'; end if;
 if p_sale is not null and (p_unit is null or not exists(select 1 from public.unit_sale_attempts where id=p_sale and unit_id=p_unit and building_id=p_building and redacted_at is null)) then raise exception 'Exact sale unavailable' using errcode='42501'; end if;
 if (select count(*) from public.units where building_id=p_building and (p_unit is null or id=p_unit))>20000 then raise exception 'Building source exceeds bounded read'; end if;
 with b as(select id,name,status,pc_date,pc_confirmed,practical_completion_date,conveyancer_organisation_id,sales_agent_organisation_id from public.buildings where id=p_building),
 u as(select id,building_id,unit_number,floor,sale_status,rental_portfolio_status,completion_date,handover_date from public.units where building_id=p_building and (p_unit is null or id=p_unit)),
 a as(select id,building_id,unit_id,is_active,workflow_status,sales_agent_organisation_id,conveyancer_organisation_id,reservation_submitted_at,reservation_rejected_at,reservation_rejection_reason,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at,legal_completed_at,redacted_at,authority_requested_at,completion_authority_requested_at,completion_authority_given_at,completion_arrangements_confirmed_at,completion_legacy_stage,completion_notice_issued_at,contractual_completion_date,created_at,buyer_person_name,buyer_company_name from public.unit_sale_attempts where building_id=p_building and (p_unit is null or unit_id=p_unit) and (p_sale is null or id=p_sale) and redacted_at is null and r in ('admin','developer','sales_agent','conveyancer')),
 i as(select id,sale_attempt_id,invoice_type,status,fee_milestone,gross_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction,approved_at,created_at from public.unit_sale_invoices where sale_attempt_id in(select id from a) and r in ('admin','developer','sales_agent')),
 teams as(select id,building_id,organisation_id,role_on_project,active from public.building_organisations where building_id=p_building)
 select jsonb_build_object(
 'buildings',coalesce((select jsonb_agg(x) from (select * from b) x),'[]'::jsonb),'units',coalesce((select jsonb_agg(x) from (select * from u) x),'[]'::jsonb),'sales',coalesce((select jsonb_agg(x) from (select * from a) x),'[]'::jsonb),
 'floors',coalesce((select jsonb_agg(x) from (select id,building_id,name,sort_order from public.building_floors where building_id=p_building) x),'[]'::jsonb),
 'buildingOrganisations',coalesce((select jsonb_agg(x) from (select * from teams) x),'[]'::jsonb),
 'organisations',coalesce((select jsonb_agg(x) from (select id,name from public.organisations where id in(select organisation_id from teams union select conveyancer_organisation_id from b union select sales_agent_organisation_id from b)) x),'[]'::jsonb),
 'terms',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,is_current,version_number,contract_price,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate from public.unit_sale_terms where sale_attempt_id in(select id from a) and r in ('admin','developer','sales_agent')) x),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(x) from (select * from i) x),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(x) from (select id,invoice_id,payment_source,payer_type,amount,paid_at,voided_at from public.unit_sale_invoice_payments where invoice_id in(select id from i)) x),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(x) from (select d.id,d.sale_attempt_id,d.document_type,d.status,d.query_note,d.approved_version_id,d.approved_at,d.updated_at,d.updated_by_user_id,coalesce((select jsonb_agg(x) from (select v.id,v.is_current,v.redacted_at,v.uploaded_at from public.unit_sale_document_versions v where v.document_id=d.id and v.is_current and v.redacted_at is null) x),'[]'::jsonb) as unit_sale_document_versions from public.unit_sale_documents d where d.sale_attempt_id in(select id from a where is_active) and d.redacted_at is null and d.superseded_at is null and d.document_type in ('completion_statement','draft_statement_of_account','completion_correspondence')) x),'[]'::jsonb),
 'authorities',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,resend_message_id from public.sale_legal_emails where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'deposits',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,source_id,expected_amount,received_amount from public.sale_exchange_deposit_receipts where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'depositSources',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,source_kind,expected_amount from public.sale_exchange_deposit_sources where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'furtherDeposits',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,required,percent,expected_amount,received_amount,timing,months_after_exchange,exchanged_at,pc_date,deadline,terms_version from public.sale_further_deposit_facts where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'snags',coalesce((select jsonb_agg(x) from (select s.id,s.building_id,s.unit_id,s.source_type,s.title,s.status,s.trade_id,s.assigned_to_organisation_id,s.assigned_to_user_id,s.priority_code,s.sla_due_date,s.created_at,s.closed_at,coalesce((select jsonb_agg(x) from (select e.id,e.snag_id,e.event_type,e.old_value,e.new_value,e.comment,e.created_by_user_id,e.created_at from public.snag_events e where e.snag_id=s.id and e.event_type in ('status_change','triage') order by e.created_at desc,e.id desc limit 1) x),'[]'::jsonb) as snag_events from public.snags s where p_include_snags and p_unit is null and s.building_id=p_building and r in ('admin','developer','developer_representative','contractor') and s.source_type in ('developer_snag','leaseholder_defect') and s.status not in ('closed','resolved')) x),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.workspace_building_facts(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.workspace_building_facts(uuid,uuid,uuid,boolean) to authenticated,service_role;
notify pgrst,'reload schema';

-- Source: migrations/20261112183641_completion_verifier_boundary.sql

-- Integration prerequisite for the existing verified server operations.
-- These functions were explicitly service-only in their original migrations;
-- broad baseline/default grants must not expose verifier or predecessor paths.
do $$
declare f record; n integer:=0;
begin
 for f in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname=any(array['sales_completion_upload','sales_completion_upload_session','sales_completion_upload_cleanup','sales_legal_action','sales_legal_action_before_deposit','sales_legal_action_before_notice','sales_legal_action_before_package','sales_legal_action_before_renewal','sales_legal_dispatch','sales_legal_event','sales_legal_expire','sales_legal_prepare_email','sales_legal_register_document','sales_legal_register_document_before_notice','sales_legal_register_document_before_package','sales_legal_submit_notice'])
 loop
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.args);
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.args);
  n:=n+1;
 end loop;
 if n<>16 then raise exception 'Unexpected Completion function inventory: %',n; end if;
end $$;

-- Source: migrations/20261112184548_workspace_sales_commands.sql

create schema if not exists workspace_commands;
revoke all on schema workspace_commands from public,anon,authenticated;
create table workspace_commands.receipts(
 id uuid primary key, sale_id uuid not null references public.unit_sale_attempts(id),
 actor_id uuid not null references public.profiles(id), action text not null,
 input jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table workspace_commands.receipts enable row level security;
revoke all on workspace_commands.receipts from public,anon,authenticated;

-- Existing Reservation rules run as one transaction. The server supplies
-- calculations from reservation-terms.ts; client commercial overrides are not used.
create function public.workspace_reservation_command(
 p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,
 p_expected timestamptz,p_payload jsonb default '{}',p_expected_terms jsonb default null,
 p_expected_defaults jsonb default null,p_terms jsonb default null,p_schedule jsonb default null
) returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
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
 input:=jsonb_build_object('building',p_building,'unit',p_unit,'expected',p_expected,'payload',p_payload,'expectedTerms',p_expected_terms,'expectedDefaults',p_expected_defaults,'terms',p_terms,'schedule',p_schedule);
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
end $$;
revoke all on function public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Source: migrations/20261112191841_workspace_test_capture.sql

-- Private, explicit test journeys only. No historical sale is automatically enrolled.
create table workspace_commands.test_journeys (
 sale_id uuid primary key references public.unit_sale_attempts(id),
 building_id uuid not null references public.buildings(id),
 unit_id uuid not null references public.units(id),
 purpose text not null,
 enrolled_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
alter table workspace_commands.test_journeys enable row level security;
revoke all on workspace_commands.test_journeys from public,anon,authenticated;
create table workspace_commands.test_deliveries (
 email_id uuid primary key references public.sale_legal_emails(id),
 sale_id uuid not null references public.unit_sale_attempts(id),
 captured_at timestamptz not null default now(),
 actor_id uuid not null references public.profiles(id),
 request_input jsonb not null
);
alter table workspace_commands.test_deliveries enable row level security;
revoke all on workspace_commands.test_deliveries from public,anon,authenticated;
create function workspace_commands.captured_authority(p_id uuid,p_sale uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from workspace_commands.test_deliveries c
 join workspace_commands.test_journeys j on j.sale_id=c.sale_id
 join public.sale_legal_emails e on e.id=c.email_id
 where e.id=p_id and c.sale_id=p_sale and e.sale_attempt_id=p_sale
 and e.delivery_status='captured_test' and e.sent_at is null and e.resend_message_id is null);
$$;
revoke all on function workspace_commands.captured_authority(uuid,uuid) from public,anon,authenticated;
-- Preparation and test capture share one transaction; a capture is never marked sent.
create function public.workspace_capture_legal_email(p_sale uuid,p_actor uuid,p_request uuid,p_kind text,p_snapshot jsonb,p_email jsonb,p_date text default null)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; prior workspace_commands.test_deliveries%rowtype; logical_input jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
 select * into a from unit_sale_attempts where id=p_sale for update;
 if not exists(select 1 from workspace_commands.test_journeys where sale_id=p_sale and building_id=a.building_id and unit_id=a.unit_id)
 then raise exception 'Only explicitly designated fictional integration journeys can capture correspondence.'; end if;
 if p_kind not in ('authority','notice_authority') or p_request is null then raise exception 'Unsupported test capture.'; end if;
 logical_input:=jsonb_build_object('kind',p_kind,'snapshot',p_snapshot,'email',p_email,'date',p_date);
 select * into prior from workspace_commands.test_deliveries where email_id=p_request;
 if found then
  if prior.sale_id<>p_sale or prior.actor_id<>p_actor or prior.request_input is distinct from logical_input then raise exception 'Capture reference conflict.'; end if;
  return jsonb_build_object('emailId',p_request,'deliveryStatus','captured_test','sent',false);
 end if;
 if exists(select 1 from sale_legal_emails where id=p_request) then raise exception 'Capture reference already belongs to another operation.'; end if;
 if coalesce(p_email->>'subject','') not like '[INTEGRATION TEST]%' or coalesce(p_email->>'body','') not like 'TEST CAPTURE ONLY%' then raise exception 'Test correspondence must be labelled.'; end if;
 perform public.sales_legal_prepare_email(p_sale,p_actor,p_request,p_kind,p_snapshot,p_email,p_date);
 select * into e from sale_legal_emails where id=p_request for update;
 perform set_config('app.sales_legal_write','on',true);
 update sale_legal_emails set delivery_status='captured_test' where id=e.id;
 insert into workspace_commands.test_deliveries(email_id,sale_id,actor_id,request_input) values(e.id,p_sale,p_actor,logical_input);
 if p_kind='authority' then
  update sale_legal_emails set replaced_by=e.id where sale_attempt_id=p_sale and kind='authority' and id<>e.id and replaced_by is null and revoked_at is null and exchanged_at is null;
  update unit_sale_attempts set commercial_approved_at=now(),commercial_approved_by_user_id=p_actor,workflow_status='ready_for_exchange',updated_at=now() where id=p_sale;
 else
  update unit_sale_attempts set completion_authority_given_at=now(),completion_authority_given_by=p_actor,updated_at=now() where id=p_sale;
 end if;
 perform public.sales_legal_event(p_sale,p_actor,'integration_correspondence_captured','Integration test correspondence captured; no external delivery',jsonb_build_object('emailId',e.id,'kind',p_kind,'deliveryStatus','captured_test','externalDelivery',false));
 return jsonb_build_object('emailId',e.id,'deliveryStatus','captured_test','sent',false);
end $$;
revoke all on function public.workspace_capture_legal_email(uuid,uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.workspace_capture_legal_email(uuid,uuid,uuid,text,jsonb,jsonb,text) to service_role;

-- Atomic registration for a verified Reservation PDF, shared by scripted setup and the hosted adapter.
create function public.workspace_reservation_file(p_sale uuid,p_actor uuid,p_request uuid,p_expected uuid,p_file jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; current_id uuid; vid uuid; n integer; prior workspace_commands.receipts%rowtype; input jsonb; result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer','sales_agent']);
 select * into a from unit_sale_attempts where id=p_sale for update;
 if a.redacted_at is not null or not a.is_active then raise exception 'Active sale required.'; end if;
 input:=jsonb_build_object('expected',p_expected,'file',p_file);
 select * into prior from workspace_commands.receipts where id=p_request;
 if found then
  if prior.sale_id<>p_sale or prior.actor_id<>p_actor or prior.action<>'reservation_file' or prior.input is distinct from input then raise exception 'Upload reference conflict.'; end if;
  return prior.result;
 end if;
 if p_request is null or a.exchanged_at is not null or a.workflow_status not in ('draft','rejected','reservation_query_raised')
 or not exists(select 1 from units where id=a.unit_id and sale_status='for_sale') then raise exception 'An available, editable reservation is required.'; end if;
 if coalesce(p_file->>'path','') is distinct from a.building_id::text||'/'||p_sale::text||'/reservation-'||p_request::text||'/reservation_form.pdf'
 or coalesce((p_file->>'size')::bigint,0) not between 5 and 10485760 or p_file->>'mime' is distinct from 'application/pdf'
 or length(coalesce(p_file->>'name','')) not between 5 and 200 or p_file->>'name' !~* '\.pdf$' then raise exception 'Choose a PDF up to 10 MiB.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='sale-documents' and name=p_file->>'path' and (metadata->>'size')::bigint=(p_file->>'size')::bigint and metadata->>'mimetype'='application/pdf') then raise exception 'Verified PDF missing.'; end if;
 select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type='reservation_form' and redacted_at is null and superseded_at is null for update;
 select id into current_id from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null;
 if current_id is distinct from p_expected then raise exception 'Reservation PDF changed. Reload before replacing it.'; end if;
 if d.id is null then
  insert into unit_sale_documents(sale_attempt_id,document_type,title,status,visibility,required,created_by_user_id,updated_by_user_id)
   values(p_sale,'reservation_form','Reservation form','uploaded','shared_sale_file',true,p_actor,p_actor) returning * into d;
 end if;
 select coalesce(max(version_number),0)+1 into n from unit_sale_document_versions where document_id=d.id;
 update unit_sale_document_versions set is_current=false where document_id=d.id and is_current;
 insert into unit_sale_document_versions(document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id)
 values(d.id,n,true,'sale-documents',p_file->>'path',p_file->>'name','application/pdf',(p_file->>'size')::bigint,p_actor) returning id into vid;
 update unit_sale_documents set status='uploaded',query_note=null,approved_version_id=null,approved_at=null,approved_by_user_id=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
 perform public.sales_legal_event(p_sale,p_actor,'reservation_form_uploaded','Reservation form PDF uploaded',jsonb_build_object('versionId',vid,'versionNumber',n,'commandId',p_request));
 result:=jsonb_build_object('versionId',vid,'path',p_file->>'path');
 insert into workspace_commands.receipts(id,sale_id,actor_id,action,input,result) values(p_request,p_sale,p_actor,'reservation_file',input,result);
 return result;
end $$;
revoke all on function public.workspace_reservation_file(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_reservation_file(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Narrowly extend the existing canonical exchange check. All date, role, access,
-- expiration, revocation, source-freezing and transaction rules stay in place.
do $$
declare definition text; old_check text := 'e.sent_at is null'; replacement text := '(e.sent_at is null and not workspace_commands.captured_authority(e.id,p_sale))';
begin
 select pg_get_functiondef('public.sales_legal_action_before_renewal(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,old_check,'')))/length(old_check)<>1 then raise exception 'Unexpected canonical exchange definition.'; end if;
 execute replace(definition,old_check,replacement);
 -- Replay identity consists of caller intent. Derived commercial snapshots can
 -- change as a result of the first committed submission.
 select pg_get_functiondef('public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 old_check:='''payload'',p_payload,''expectedTerms'',p_expected_terms,''expectedDefaults'',p_expected_defaults,''terms'',p_terms,''schedule'',p_schedule';
 if position(old_check in definition)=0 then raise exception 'Unexpected reservation receipt definition.'; end if;
 execute replace(definition,old_check,'''payload'',p_payload');
end $$;

-- Source: migrations/20261112201315_workspace_comment_sequence.sql

-- Legal workflow comments already hold the sale row lock but may leave the
-- ordinary-comment counter behind. Allocate beyond both without rewriting history.
do $$
declare definition text; old text:='comment_sequence=comment_sequence+1';
begin
 select pg_get_functiondef('public.sale_comment_write(uuid,text,uuid,uuid,text,uuid[],uuid,integer)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected comment allocator definition.'; end if;
 execute replace(definition,old,'comment_sequence=greatest(comment_sequence,coalesce((select max(c.sequence) from public.sale_comments c where c.sale_attempt_id=p_sale),0))+1');
end $$;

-- Source: migrations/20261112203256_workspace_core_sales.sql

create function public.workspace_reservation_inputs(p_sale uuid,p_actor uuid,p_building uuid,p_unit uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform sales_legal_assert(p_sale,p_actor,array['admin','developer','sales_agent']);
 select * into a from unit_sale_attempts where id=p_sale;
 if a.building_id is distinct from p_building or a.unit_id is distinct from p_unit or a.redacted_at is not null or not a.is_active then raise exception 'Exact active sale required.';end if;
 return jsonb_build_object('terms',(select to_jsonb(t) from unit_sale_terms t where t.sale_attempt_id=p_sale and t.is_current),'defaults',(select to_jsonb(d) from building_sale_defaults d where d.building_id=p_building));
end $$;
revoke all on function public.workspace_reservation_inputs(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_reservation_inputs(uuid,uuid,uuid,uuid) to service_role;
create policy "visible reservation PDF versions are readable" on storage.objects for select to authenticated using (
 bucket_id='sale-documents'
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
 and exists(select 1 from public.unit_sale_document_versions v join public.unit_sale_documents d on d.id=v.document_id
 join public.unit_sale_attempts a on a.id=d.sale_attempt_id
 where v.storage_bucket=objects.bucket_id and v.storage_path=objects.name and v.redacted_at is null and d.redacted_at is null
 and a.redacted_at is null and public.can_access_sale_attempt(d.sale_attempt_id)
 and (d.visibility='shared_sale_file' or public.is_sales_internal_user() or d.visibility=public.current_app_role())
 and d.document_type='reservation_form'));

-- Source: migrations/20261112204951_workspace_capture_activity.sql

-- Explicit test capture projection; historical events and permissions stay intact.
do $patch$
declare definition text; marker text:='  return public.sale_event_projection_before_further_deposit(e);'; added text:=$body$
  if e.event_type='integration_correspondence_captured' then
    if not public.can_access_sale_attempt(e.sale_attempt_id) then return null; end if;
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,
      'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,'from_status',e.from_status,'to_status',e.to_status,
      'summary','Integration test authority captured; no external delivery',
      'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,
      'metadata',jsonb_build_object('kind',e.metadata->'kind','deliveryStatus','captured_test','externalDelivery',false));
  end if;
$body$;
begin
 select pg_get_functiondef('public.sale_event_projection(public.unit_sale_workflow_events)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Unexpected activity projection; stop for review.';end if;
 execute replace(definition,marker,added||marker);
end $patch$;

-- Source: migrations/20261113123605_workspace_extended_sales.sql

-- Extended Sales uses the existing canonical operations inside a receipt-backed
-- transaction. Only explicitly enrolled integration journeys may be mutated.
create function public.workspace_sale_operation(
 p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,
 p_action text,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare a unit_sale_attempts%rowtype; actor profiles%rowtype; prior workspace_commands.receipts%rowtype;
 current_terms unit_sale_terms%rowtype; t unit_sale_terms%rowtype;
 i unit_sale_invoices%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
 input jsonb; result jsonb; terms jsonb; defs jsonb; next_sale uuid; reason text; milestone text;
 doc_id uuid; version_id uuid; version_no integer; invoice_id uuid; expected_version uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then
  raise exception 'Verified server actor required.' using errcode='42501'; end if;
 select * into actor from profiles where id=p_actor and active;
 if actor.id is null or not public.sales_building_access(p_building,p_actor) then raise exception 'Sales access denied.' using errcode='42501'; end if;
 if p_request is null or jsonb_typeof(p_payload)<>'object' then raise exception 'A submission reference and fields are required.'; end if;
 if p_action in ('save_commercial','return_for_sale','approve_agent_invoice','query_agent_invoice','void_agent_payment','revoke_authority','cancel_notice_authority','confirm_further_deadline') then
  if actor.role not in ('admin','developer') then raise exception 'Developer review required.' using errcode='42501'; end if;
 elsif p_action='register_agent_invoice' then
  if actor.role not in ('admin','developer','sales_agent') then raise exception 'Agent invoice upload denied.' using errcode='42501'; end if;
 elsif p_action='record_agent_payment' then
  if actor.role not in ('admin','developer','conveyancer') then raise exception 'Payment recording denied.' using errcode='42501'; end if;
 elsif p_action in ('confirm_exchange_deposit','correct_exchange_deposit_date','record_further_receipt','correct_further_receipt','void_further_receipt','correct_completion_dates') then
  if actor.role<>'conveyancer' then raise exception 'Conveyancer required.' using errcode='42501'; end if;
 else raise exception 'Sales operation unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into a from unit_sale_attempts where id=p_sale for update;
 if a.id is null or a.building_id<>p_building or a.unit_id<>p_unit then raise exception 'Exact sale required.' using errcode='42501'; end if;
 input:=p_payload-array['calculatedTerms','schedule','expectedTerms','expectedDefaults','invoiceValues'];
 select * into prior from workspace_commands.receipts where id=p_request;
 if found then
  if prior.sale_id<>p_sale or prior.actor_id<>p_actor or prior.action<>p_action or prior.input is distinct from input then raise exception 'Submission reference conflicts with the saved operation.'; end if;
  return prior.result;
 end if;
 perform public.sales_legal_assert(p_sale,p_actor);
 if not exists(select 1 from workspace_commands.test_journeys j where j.sale_id=p_sale and j.unit_id=p_unit and j.building_id=p_building) then raise exception 'Use a designated integration test journey for these writes.'; end if;
 if not a.is_active or a.redacted_at is not null then raise exception 'An active visible sale is required.'; end if;
 if p_action in ('confirm_exchange_deposit','correct_exchange_deposit_date','correct_completion_dates','revoke_authority','cancel_notice_authority') then
  if p_action='cancel_notice_authority' and a.completion_arrangements_confirmed_at is not null then raise exception 'Completion arrangements are already confirmed; correct or replace the notice instead.'; end if;
  result:=public.sales_legal_action(p_sale,p_action,p_payload,p_actor);
  if p_action='cancel_notice_authority' and a.completion_arrangements_confirmed_at is null then
   update unit_sale_attempts set completion_authority_given_at=null,completion_authority_given_by=null,completion_authority_requested_at=null,completion_authority_requested_by=null,updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
  end if;
 elsif p_action in ('record_further_receipt','correct_further_receipt','void_further_receipt','confirm_further_deadline') then
  result:=public.sales_further_deposit_action(p_sale,p_action,p_payload||jsonb_build_object('requestId',p_request),p_actor);
 elsif p_action='return_for_sale' then
  perform public.return_pre_exchange_unit_for_sale(p_sale,p_actor,p_payload->>'reason','integration_workspace');
  next_sale:=public.prepare_unit_baseline_sale_record(p_unit,p_actor);
  insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by)
   values(next_sale,p_building,p_unit,'Staging replacement sale',p_actor)
   on conflict(sale_id) do nothing;
  result:=jsonb_build_object('saleAttemptId',next_sale,'previousSaleAttemptId',p_sale);
 elsif p_action='save_commercial' then
  if a.workflow_status not in ('draft','rejected','reservation_query_raised') or a.exchanged_at is not null then raise exception 'Commercial changes require an editable reservation.'; end if;
  select * into current_terms from unit_sale_terms where sale_attempt_id=p_sale and is_current for update;
  select to_jsonb(x) into defs from building_sale_defaults x where building_id=p_building for share;
  if (case when current_terms.id is null then null else to_jsonb(current_terms) end) is distinct from nullif(p_payload->'expectedTerms','null'::jsonb) or defs is distinct from nullif(p_payload->'expectedDefaults','null'::jsonb) then raise exception 'Commercial terms or defaults changed. Reload before saving.'; end if;
  t:=jsonb_populate_record(null::unit_sale_terms,p_payload->'calculatedTerms');
  select to_jsonb(x) into result from public.save_unit_commercial_model_with_deposits(
   p_unit_id=>p_unit,p_requester_id=>p_actor,p_list_price_at_offer=>t.list_price_at_offer,p_contract_price=>t.contract_price,
   p_parking_value=>t.parking_value,p_developer_contribution=>t.developer_contribution,p_agent_contribution=>t.agent_contribution,
   p_reservation_fee=>t.reservation_fee,p_reservation_fee_holder=>t.reservation_fee_holder,p_agent_fee_percent=>t.agent_fee_percent,
   p_exchange_agent_fee_percent=>t.exchange_agent_fee_percent,p_completion_agent_fee_percent=>t.completion_agent_fee_percent,p_vat_rate=>t.vat_rate,
   p_solicitor_fee=>t.solicitor_fee,p_exchange_deposit_percent=>t.exchange_deposit_percent,p_second_deposit_enabled=>t.second_deposit_enabled,
   p_second_deposit_percent=>t.second_deposit_percent,p_second_deposit_months_after_exchange=>t.second_deposit_months_after_exchange,
   p_completion_balance_percent=>t.completion_balance_percent,p_deposit_summary=>t.deposit_summary,p_commercial_summary=>t.commercial_summary,
   p_payment_schedule=>p_payload->'schedule',p_developer_contribution_value=>t.developer_contribution_value,
   p_developer_contribution_value_type=>t.developer_contribution_value_type,p_agent_contribution_value=>t.agent_contribution_value,
   p_agent_contribution_value_type=>t.agent_contribution_value_type,p_parking_contribution_value=>t.parking_contribution_value,
   p_parking_location_details=>t.parking_location_details,p_additional_special_conditions=>t.additional_special_conditions,p_further_deposit_timing=>t.further_deposit_timing
  ) x;
  perform public.mark_sale_attempt_substantive(p_sale,p_actor,'commercial_model_saved','Commercial sale model saved in the Sales workspace.');
  result:=result||jsonb_build_object('saleAttemptId',p_sale);
 elsif p_action in ('record_agent_payment','void_agent_payment') then
  if p_action='record_agent_payment' then
   select * into i from unit_sale_invoices where id=(p_payload->>'invoiceId')::uuid and sale_attempt_id=p_sale for update;
   if i.id is null then raise exception 'Invoice unavailable for this sale.'; end if;
   select to_jsonb(x) into result from public.record_unit_sale_invoice_payment(i.id,coalesce(nullif(p_payload->>'payer',''),'other'),(p_payload->>'amount')::numeric,(p_payload->>'date')::date,nullif(p_payload->>'note',''),p_request,p_actor) x;
  else
   if not exists(select 1 from unit_sale_invoice_payments where id=(p_payload->>'paymentId')::uuid and sale_attempt_id=p_sale) then raise exception 'Payment unavailable for this sale.'; end if;
   select to_jsonb(x) into result from public.void_unit_sale_invoice_payment((p_payload->>'paymentId')::uuid,p_payload->>'reason',p_actor) x;
  end if;
 else
  milestone:=p_payload->>'milestone';
  if milestone not in ('exchange','completion') or milestone is null then raise exception 'Choose an invoice milestone.'; end if;
  if (milestone='completion' and a.workflow_status not in ('exchanged','completion_pending','completed')) or
   (milestone='exchange' and a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange','exchanged','completion_pending','completed')) then raise exception 'Invoice work is unavailable at this sale stage.'; end if;
  select * into i from unit_sale_invoices where sale_attempt_id=p_sale and invoice_type='sales_agent' and fee_milestone=milestone for update;
  if p_action='register_agent_invoice' then
   if i.id is not null and i.status<>'query_raised' then raise exception 'An active milestone invoice already exists. Request a correction first.'; end if;
   select * into current_terms from unit_sale_terms where sale_attempt_id=p_sale and is_current for share;
   if to_jsonb(current_terms) is distinct from p_payload->'expectedTerms' then raise exception 'Invoice terms changed. Reload before uploading.'; end if;
   if coalesce((case when milestone='completion' then current_terms.completion_agent_fee_percent else coalesce(current_terms.exchange_agent_fee_percent,current_terms.agent_fee_percent) end),0)<=0 then raise exception 'No milestone agent fee is configured.'; end if;
   if nullif(btrim(p_payload->>'reference'),'') is null or (p_payload->>'date')::date is null or (p_payload->>'date')::date>(now() at time zone 'Europe/London')::date or coalesce((p_payload->>'gross')::numeric,0)<=0 then raise exception 'Invoice reference, date and positive total are required.'; end if;
   if p_payload#>>'{file,path}' is distinct from p_building::text||'/'||p_sale::text||'/invoice-'||p_request::text||'/agent_invoice.pdf' then raise exception 'Invalid invoice upload path.'; end if;
   if not exists(select 1 from storage.objects where bucket_id='sale-documents' and name=p_payload#>>'{file,path}') then raise exception 'Upload the invoice PDF first.'; end if;
   select * into d from unit_sale_documents where id=i.document_id and sale_attempt_id=p_sale and redacted_at is null for update;
   select * into v from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
   expected_version:=nullif(p_payload->>'expectedVersionId','')::uuid;
   if v.id is distinct from expected_version then raise exception 'Invoice version changed. Reload before uploading.'; end if;
   doc_id:=coalesce(d.id,gen_random_uuid());version_id:=gen_random_uuid();version_no:=coalesce(v.version_number,0)+1;
   if d.id is null then
    insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status,visibility,created_by_user_id,updated_by_user_id)
     values(doc_id,p_sale,'agent_invoice',initcap(milestone)||' agent invoice','uploaded','shared_sale_file',p_actor,p_actor);
   else
    update unit_sale_documents set status='uploaded',query_note=null,approved_at=null,approved_by_user_id=null,approved_version_id=null,updated_at=now(),updated_by_user_id=p_actor where id=doc_id;
    update unit_sale_document_versions set is_current=false where id=v.id;
   end if;
   insert into unit_sale_document_versions(id,document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id)
    values(version_id,doc_id,version_no,true,'sale-documents',p_payload#>>'{file,path}',p_payload#>>'{file,name}','application/pdf',(p_payload#>>'{file,size}')::bigint,p_actor);
   invoice_id:=coalesce(i.id,gen_random_uuid());
   insert into unit_sale_invoices(id,sale_attempt_id,document_id,invoice_type,fee_milestone,fee_percentage,supplier_organisation_id,invoice_reference,invoice_date,net_amount,vat_amount,gross_amount,expected_gross_amount,reservation_fee_deduction,agent_contribution_deduction,expected_payable_amount,status,created_by_user_id,updated_by_user_id)
   values(invoice_id,p_sale,doc_id,'sales_agent',milestone,(p_payload#>>'{invoiceValues,feePercent}')::numeric,a.sales_agent_organisation_id,p_payload->>'reference',(p_payload->>'date')::date,
    (p_payload#>>'{invoiceValues,netAmount}')::numeric,(p_payload#>>'{invoiceValues,vatAmount}')::numeric,(p_payload->>'gross')::numeric,(p_payload#>>'{invoiceValues,grossAmount}')::numeric,
    (p_payload#>>'{invoiceValues,reservationFeeDeduction}')::numeric,(p_payload#>>'{invoiceValues,agentContributionDeduction}')::numeric,(p_payload#>>'{invoiceValues,expectedPayableAmount}')::numeric,'uploaded',p_actor,p_actor)
   on conflict(id) do update set document_id=excluded.document_id,invoice_reference=excluded.invoice_reference,invoice_date=excluded.invoice_date,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,gross_amount=excluded.gross_amount,expected_gross_amount=excluded.expected_gross_amount,reservation_fee_deduction=excluded.reservation_fee_deduction,agent_contribution_deduction=excluded.agent_contribution_deduction,expected_payable_amount=excluded.expected_payable_amount,status='uploaded',approved_at=null,approved_by_user_id=null,updated_at=now(),updated_by_user_id=p_actor;
   perform public.sales_legal_event(p_sale,p_actor,case when milestone='completion' then 'completion_agent_invoice_uploaded' else 'agent_invoice_uploaded' end,initcap(milestone)||' agent invoice uploaded',jsonb_build_object('invoiceId',invoice_id,'documentId',doc_id,'versionId',version_id,'feeMilestone',milestone));
   result:=jsonb_build_object('invoiceId',invoice_id,'documentId',doc_id,'versionId',version_id);
  else
   if i.id is null or i.document_id is null then raise exception 'Upload the invoice first.'; end if;
   select * into v from unit_sale_document_versions where document_id=i.document_id and is_current and redacted_at is null for update;
   if v.id is null or v.id::text is distinct from p_payload->>'versionId' then raise exception 'Review the current invoice PDF first.'; end if;
   if i.status in ('approved','part_paid','paid','reconciled') then raise exception 'This invoice has already been approved.'; end if;
   if i.status='query_raised' then raise exception 'Upload a revised invoice before reviewing again.'; end if;
   reason:=nullif(btrim(p_payload->>'reason'),'');
   if p_action='query_agent_invoice' and reason is null then raise exception 'Add an invoice query reason.'; end if;
   update unit_sale_documents set status=case when p_action='approve_agent_invoice' then 'approved' else 'query_raised' end,
    approved_version_id=case when p_action='approve_agent_invoice' then v.id end,approved_by_user_id=case when p_action='approve_agent_invoice' then p_actor end,
    approved_at=case when p_action='approve_agent_invoice' then now() end,query_note=reason,updated_at=now(),updated_by_user_id=p_actor where id=i.document_id;
   update unit_sale_invoices set status=case when p_action='approve_agent_invoice' then 'approved' else 'query_raised' end,query_note=reason,
    approved_by_user_id=case when p_action='approve_agent_invoice' then p_actor end,approved_at=case when p_action='approve_agent_invoice' then now() end,updated_at=now(),updated_by_user_id=p_actor where id=i.id;
   perform public.sales_legal_event(p_sale,p_actor,case when milestone='completion' then 'completion_' else '' end||case when p_action='approve_agent_invoice' then 'agent_invoice_approved' else 'agent_invoice_rejected' end,
    initcap(milestone)||' agent invoice '||case when p_action='approve_agent_invoice' then 'approved' else 'queried' end,jsonb_build_object('invoiceId',i.id,'feeMilestone',milestone,'reason',reason));
   result:=jsonb_build_object('invoiceId',i.id,'saleAttemptId',p_sale);
  end if;
 end if;
 insert into workspace_commands.receipts(id,sale_id,actor_id,action,input,result) values(p_request,p_sale,p_actor,p_action,input,coalesce(result,'{}'));
 return coalesce(result,'{}');
end $$;
revoke all on function public.workspace_sale_operation(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_sale_operation(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.workspace_sale_test_context(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,workspace_commands as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform public.sales_legal_assert(p_sale,p_actor);
 if not exists(select 1 from unit_sale_attempts where id=p_sale and unit_id=p_unit and building_id=p_building and redacted_at is null) then raise exception 'Exact visible sale required.'; end if;
 return jsonb_build_object('enrolled',exists(select 1 from workspace_commands.test_journeys where sale_id=p_sale and unit_id=p_unit and building_id=p_building));
end $$;
revoke all on function public.workspace_sale_test_context(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_sale_test_context(uuid,uuid,uuid,uuid) to service_role;

create function public.workspace_sale_receipt(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,workspace_commands as $$
declare r workspace_commands.receipts%rowtype;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor
 or not exists(select 1 from profiles where id=p_actor and active) or not public.sales_building_access(p_building,p_actor)
 then raise exception 'Verified Sales actor required.' using errcode='42501'; end if;
 if not exists(select 1 from unit_sale_attempts where id=p_sale and unit_id=p_unit and building_id=p_building) then raise exception 'Exact sale required.' using errcode='42501'; end if;
 select * into r from workspace_commands.receipts where id=p_request;
 if not found then return null; end if;
 if r.sale_id<>p_sale or r.actor_id<>p_actor or r.action<>p_action or r.input is distinct from (p_payload-array['calculatedTerms','schedule','expectedTerms','expectedDefaults','invoiceValues']) then raise exception 'Submission reference conflicts with the saved operation.'; end if;
 return jsonb_build_object('result',r.result);
end $$;
revoke all on function public.workspace_sale_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_sale_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
-- Exact visible document versions, including history; never a whole-bucket grant.
create policy "visible invoice PDF versions are readable" on storage.objects for select to authenticated using (
 bucket_id='sale-documents' and exists(select 1 from public.profiles where id=auth.uid() and active)
 and exists(select 1 from public.unit_sale_document_versions v join public.unit_sale_documents d on d.id=v.document_id
 join public.unit_sale_attempts a on a.id=d.sale_attempt_id
 where v.storage_bucket=objects.bucket_id and v.storage_path=objects.name and v.redacted_at is null and d.redacted_at is null
 and a.redacted_at is null and public.can_access_sale_attempt(d.sale_attempt_id)
 and (d.visibility='shared_sale_file' or public.is_sales_internal_user() or d.visibility=public.current_app_role())
 and d.document_type='agent_invoice'));

-- Source: migrations/20261113140117_workspace_operations.sql

-- The new workspace exposes administration only for explicitly fictional records.
create table workspace_commands.test_entities(
 kind text not null check(kind in ('building','organisation','profile','trade','unit_type')),
 entity_id uuid not null,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),primary key(kind,entity_id)
);
create table workspace_commands.operation_receipts(
 id uuid primary key,actor_id uuid not null references public.profiles(id),action text not null,
 target_id uuid,input jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create table workspace_commands.snag_media_intents(
 id uuid primary key,actor_id uuid not null references public.profiles(id),building_id uuid not null references public.buildings(id),
 snag_id uuid references public.snags(id),action text not null,path text not null unique,name text not null,
 mime text not null,size bigint not null,created_at timestamptz not null default now()
);
alter table workspace_commands.test_entities enable row level security;
alter table workspace_commands.operation_receipts enable row level security;
alter table workspace_commands.snag_media_intents enable row level security;
revoke all on workspace_commands.test_entities,workspace_commands.operation_receipts,workspace_commands.snag_media_intents from public,anon,authenticated,service_role;

create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor
 or not exists(select 1 from profiles where id=p_actor and active and role in ('admin','developer'))
 then raise exception 'Verified Setup administrator required.' using errcode='42501';end if;
end $$;
revoke all on function workspace_commands.setup_actor(uuid) from public,anon,authenticated,service_role;

create function public.workspace_setup_context(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
begin
 perform workspace_commands.setup_actor(p_actor);
 return jsonb_build_object('entities',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',entity_id)) from workspace_commands.test_entities),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)) from buildings b join workspace_commands.test_entities e on e.kind='building' and e.entity_id=b.id),'[]'::jsonb),
 'organisations',coalesce((select jsonb_agg(to_jsonb(o)) from organisations o join workspace_commands.test_entities e on e.kind='organisation' and e.entity_id=o.id),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('buildingIds',coalesce((select jsonb_agg(building_id) from user_building_access where user_id=p.id),'[]'::jsonb))) from profiles p join workspace_commands.test_entities e on e.kind='profile' and e.entity_id=p.id),'[]'::jsonb),
 'trades',coalesce((select jsonb_agg(to_jsonb(t)) from trades t join workspace_commands.test_entities e on e.kind='trade' and e.entity_id=t.id),'[]'::jsonb),
 'types',coalesce((select jsonb_agg(to_jsonb(t)) from unit_types t join workspace_commands.test_entities e on e.kind='unit_type' and e.entity_id=t.id),'[]'::jsonb));
end $$;
revoke all on function public.workspace_setup_context(uuid) from public,anon,authenticated;
grant execute on function public.workspace_setup_context(uuid) to service_role;

create function public.workspace_setup_operation(p_actor uuid,p_request uuid,p_action text,p_target uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare prior workspace_commands.operation_receipts%rowtype; b uuid; entity_kind text; existing jsonb; result jsonb;
 f building_floors%rowtype; u units%rowtype; a areas%rowtype; o organisations%rowtype; org uuid; ids uuid[]; sale uuid; defaults_value jsonb; n integer; old_name text;
begin
 perform workspace_commands.setup_actor(p_actor);
 if p_request is null or p_target is null or jsonb_typeof(p_payload)<>'object' then raise exception 'A record, fields and submission reference are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from workspace_commands.operation_receipts where id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.action<>p_action or prior.target_id<>p_target or prior.input is distinct from (p_payload-array['defaults','schedule','expectedDefaults']) then raise exception 'Submission reference conflicts with the saved operation.'; end if;
  return prior.result;
 end if;
 if p_action in ('create_building','save_building') then entity_kind:='building';
 elsif p_action in ('create_organisation','save_organisation') then entity_kind:='organisation';
 elsif p_action in ('create_trade','save_trade') then entity_kind:='trade';
 elsif p_action in ('create_type','save_type') then entity_kind:='unit_type';
 elsif p_action in ('prepare_user','save_person','set_person_status') then entity_kind:='profile';
 elsif p_action in ('save_floor','delete_floor','reorder_floors','save_unit','save_area','delete_area','save_team','remove_team','save_defaults') then
  b:=(p_payload->>'buildingId')::uuid;
  if not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=b) then raise exception 'Only fictional test-building configuration can be changed.'; end if;
  perform 1 from buildings where id=b for update;
 else raise exception 'Setup operation unavailable.'; end if;
 if entity_kind is not null then
  if p_action like 'create_%' or p_action='prepare_user' then
   if exists(select 1 from workspace_commands.test_entities where kind=entity_kind and entity_id=p_target) then raise exception 'Test record already exists. Reload before saving.'; end if;
   if p_payload->>'fictional' is distinct from 'true' then raise exception 'Confirm this is fictional test data.'; end if;
   insert into workspace_commands.test_entities(kind,entity_id,created_by) values(entity_kind,p_target,p_actor);
  elsif not exists(select 1 from workspace_commands.test_entities where kind=entity_kind and entity_id=p_target) then raise exception 'Imported reference records remain read-only.'; end if;
 end if;
 if p_action in ('create_building','save_building') then
  select to_jsonb(t) into existing from buildings t where id=p_target for update;
  if p_action='create_building' and existing is not null then raise exception 'Building already exists.'; end if;
  if p_action='save_building' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Building changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a building name.'; end if;
  if p_action='create_building' then
   insert into buildings(id,name,address_line_1,town,postcode,status,lifecycle_status,allow_resident_access_requests,seller_name,created_at,updated_at)
    values(p_target,'Integration test · '||btrim(p_payload->>'name'),p_payload->>'address',p_payload->>'town',p_payload->>'postcode','active','pre_handover',false,'Fictional Integration Seller',now(),now());
  else
   update buildings set name=btrim(p_payload->>'name'),
    address_line_1=p_payload->>'address',town=p_payload->>'town',postcode=p_payload->>'postcode',notes=p_payload->>'notes',
    pc_date=nullif(p_payload->>'pcDate','')::date,pc_confirmed=coalesce((p_payload->>'pcConfirmed')::boolean,false),
    seller_name=nullif(btrim(p_payload->>'sellerName'),''),completion_information=p_payload->>'completionInformation',
    updated_at=now() where id=p_target;
  end if;
 elsif p_action in ('create_organisation','save_organisation') then
  select to_jsonb(t) into existing from organisations t where id=p_target for update;
  if p_action='create_organisation' and existing is not null then raise exception 'Organisation already exists.'; end if;
  if p_action='save_organisation' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Organisation changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null or p_payload->>'type' not in ('developer_representative','contractor','supporting_trade','sales_agent','conveyancer','letting_agent','managing_agent') then raise exception 'Enter an organisation name and valid type.'; end if;
  if p_action='create_organisation' and coalesce(p_payload->>'email','')<>'' and lower(p_payload->>'email') not like '%@example.invalid' then raise exception 'Use an example.invalid test email address.'; end if;
  insert into organisations(id,name,type,main_contact_name,email,phone,shared_system_email)
   values(p_target,btrim(p_payload->>'name'),p_payload->>'type',p_payload->>'contact',nullif(lower(p_payload->>'email'),''),p_payload->>'phone',nullif(lower(p_payload->>'email'),''))
  on conflict(id) do update set name=excluded.name,type=excluded.type,main_contact_name=excluded.main_contact_name,email=excluded.email,phone=excluded.phone,shared_system_email=excluded.shared_system_email,updated_at=now();
 elsif p_action in ('create_trade','save_trade','create_type','save_type') then
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a name.'; end if;
  if entity_kind='trade' then
   select to_jsonb(t) into existing from trades t where id=p_target for update;
   if p_action='save_trade' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Trade changed. Reload before saving.'; end if;
   if p_action='create_trade' and existing is not null then raise exception 'Trade already exists.';end if;
   insert into trades(id,name,sort_order,active) values(p_target,btrim(p_payload->>'name'),coalesce((p_payload->>'sortOrder')::integer,0),coalesce((p_payload->>'active')::boolean,true))
    on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,active=excluded.active,updated_at=now();
  else
   select to_jsonb(t) into existing from unit_types t where id=p_target for update;
   if p_action='save_type' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Unit type changed. Reload before saving.'; end if;
   if p_action='create_type' and existing is not null then raise exception 'Unit type already exists.';end if;
   insert into unit_types(id,name,description) values(p_target,btrim(p_payload->>'name'),p_payload->>'description')
    on conflict(id) do update set name=excluded.name,description=excluded.description,updated_at=now();
  end if;
 elsif p_action in ('prepare_user','save_person') then
  org:=nullif(p_payload->>'organisationId','')::uuid;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'buildingIds','[]'::jsonb));
  if (p_action='prepare_user' and lower(p_payload->>'email') not like '%@example.invalid') or nullif(btrim(p_payload->>'name'),'') is null
   or p_payload->>'role' not in ('developer_representative','contractor','sales_agent','conveyancer') then raise exception 'Use a fictional name, example.invalid email and operational test role.'; end if;
  if not exists(select 1 from workspace_commands.test_entities where kind='organisation' and entity_id=org)
   or not exists(select 1 from organisations where id=org and (type=p_payload->>'role' or (p_payload->>'role'='contractor' and type='supporting_trade')))
   or cardinality(ids)=0 or exists(select 1 from unnest(ids) id where not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=id)) then raise exception 'Assign a test organisation and at least one fictional test building.'; end if;
  if p_action='prepare_user' then
   if exists(select 1 from auth.users where id=p_target or lower(email)=lower(p_payload->>'email')) then raise exception 'This test account already exists. Edit it in People and access.'; end if;
   result:=jsonb_build_object('id',p_target,'prepared',true);
  else
   select to_jsonb(t) into existing from profiles t where id=p_target for update;
   if existing is null or lower(existing->>'email') is distinct from lower(p_payload->>'email') then raise exception 'Test account unavailable.'; end if;
   if p_payload ? 'provisionRequest' then
    if not exists(select 1 from workspace_commands.operation_receipts where id=(p_payload->>'provisionRequest')::uuid and target_id=p_target and actor_id=p_actor and action='prepare_user')
     or not exists(select 1 from auth.users where id=p_target and raw_app_meta_data->>'workspace_test_request'=p_payload->>'provisionRequest') then raise exception 'Test account provision does not match.'; end if;
   elsif existing->>'updated_at' is distinct from p_payload->>'expected' then raise exception 'Person or access changed. Reload before saving.'; end if;
   perform public.save_portal_user_access(p_target,jsonb_build_object('email',lower(p_payload->>'email'),'name',btrim(p_payload->>'name'),'full_name',btrim(p_payload->>'name'),'role',p_payload->>'role','organisation_id',org,'active',true),ids,'[]'::jsonb);
   update profiles set updated_at=now() where id=p_target;
  end if;
 elsif p_action='set_person_status' then
  if p_target=p_actor or jsonb_typeof(p_payload->'active')<>'boolean' then raise exception 'Choose a test account and active status.'; end if;
  select to_jsonb(t) into existing from profiles t where id=p_target for update;
  if existing is null or existing->>'updated_at' is distinct from p_payload->>'expected' then raise exception 'Person changed. Reload before saving.'; end if;
  update profiles set active=(p_payload->>'active')::boolean,updated_at=now() where id=p_target;
 elsif p_action='save_floor' then
  select * into f from building_floors where id=p_target for update;
  if f.id is not null and (f.building_id<>b or f.updated_at::text::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Floor changed or belongs to another building.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a floor name.'; end if;
  if exists(select 1 from building_floors where building_id=b and id<>p_target and lower(btrim(name))=lower(btrim(p_payload->>'name'))) then raise exception 'A floor with this name already exists in this building.';end if;
  old_name:=f.name;
  insert into building_floors(id,building_id,name,sort_order) values(p_target,b,btrim(p_payload->>'name'),coalesce((p_payload->>'sortOrder')::integer,0))
   on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,updated_at=now();
  if old_name is not null and old_name<>btrim(p_payload->>'name') then
   update units set floor=btrim(p_payload->>'name'),updated_at=now() where building_id=b and floor=old_name;
   update areas set floor=btrim(p_payload->>'name'),updated_at=now() where building_id=b and floor=old_name;
  end if;
 elsif p_action='delete_floor' then
  select * into f from building_floors where id=p_target and building_id=b for update;
  if f.id is null or f.updated_at is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Floor changed. Reload before removing.'; end if;
  if exists(select 1 from units where building_id=b and floor=f.name) or exists(select 1 from areas where building_id=b and floor=f.name) then raise exception 'Move this floor’s units and areas before removing it.';end if;
  delete from building_floors where id=p_target;
 elsif p_action='reorder_floors' then
  if p_target<>b then raise exception 'Exact building required.';end if;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(p_payload->'ids');
  if cardinality(ids)<>(select count(*) from building_floors where building_id=b) or cardinality(ids)<>(select count(distinct x) from unnest(ids)x)
   or exists(select 1 from unnest(ids) picked(entity_id) where not exists(select 1 from building_floors f2 where f2.building_id=b and f2.id=picked.entity_id)) then raise exception 'Floor list changed. Reload before reordering.'; end if;
  if exists(select 1 from building_floors where building_id=b and updated_at is distinct from (p_payload#>>array['expected',id::text])::timestamptz) then raise exception 'Floor order changed. Reload before reordering.';end if;
  update building_floors floor_row set sort_order=ordered.ord::integer-1,updated_at=now() from unnest(ids) with ordinality ordered(id,ord) where floor_row.id=ordered.id and floor_row.building_id=b;
 elsif p_action='save_unit' then
  select * into u from units where id=p_target for update;
  if u.id is not null and (u.building_id<>b or u.updated_at is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Unit changed or belongs to another building.'; end if;
  if nullif(btrim(p_payload->>'number'),'') is null or not exists(select 1 from building_floors where building_id=b and name=p_payload->>'floor') then raise exception 'Choose a unit number and configured floor.'; end if;
  if exists(select 1 from units where building_id=b and id<>p_target and lower(btrim(unit_number))=lower(btrim(p_payload->>'number'))) then raise exception 'This unit number already exists in the building.';end if;
  if nullif(p_payload->>'typeId','') is not null and not exists(select 1 from workspace_commands.test_entities where kind='unit_type' and entity_id=(p_payload->>'typeId')::uuid) then raise exception 'Choose a fictional test unit type.'; end if;
  if u.id is null then
   insert into units(id,building_id,unit_number,floor,unit_type_id,unit_type,size_sqm,sale_status,rental_portfolio_status)
    values(p_target,b,btrim(p_payload->>'number'),p_payload->>'floor',nullif(p_payload->>'typeId','')::uuid,(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),nullif(p_payload->>'size','')::numeric,'for_sale','not_in_portfolio');
   sale:=public.prepare_unit_baseline_sale_record(p_target,p_actor);
   insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by) values(sale,b,p_target,'Staging building sale',p_actor) on conflict(sale_id) do nothing;
   result:=jsonb_build_object('id',p_target,'saleAttemptId',sale);
  else
   update units set unit_number=btrim(p_payload->>'number'),floor=p_payload->>'floor',unit_type_id=nullif(p_payload->>'typeId','')::uuid,unit_type=(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),size_sqm=nullif(p_payload->>'size','')::numeric,updated_at=now() where id=p_target;
   update areas set floor=p_payload->>'floor',updated_at=now() where unit_id=p_target;
  end if;
 elsif p_action in ('save_area','delete_area') then
  select * into a from areas where id=p_target for update;
  if a.id is not null and (a.building_id<>b or a.updated_at is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Area changed or belongs to another building.'; end if;
  if p_action='delete_area' then
   if a.id is null or exists(select 1 from snags where area_id=p_target) then raise exception 'Area unavailable or has snag history; it cannot be removed.'; end if;
   delete from areas where id=p_target;
  else
   if a.id is not null and a.unit_id is distinct from nullif(p_payload->>'unitId','')::uuid and exists(select 1 from snags where area_id=p_target) then raise exception 'An area with snag history cannot be moved to another unit.';end if;
   if nullif(btrim(p_payload->>'name'),'') is null or p_payload->>'type' not in ('unit_room','communal_area','private_amenity') then raise exception 'Enter an area name and type.'; end if;
   if nullif(p_payload->>'unitId','') is not null then select * into u from units where id=(p_payload->>'unitId')::uuid and building_id=b; if u.id is null then raise exception 'Choose a unit in this building.';end if;
   elsif p_payload->>'type'='unit_room' then raise exception 'Choose a unit for a room.';end if;
   if u.id is null and not exists(select 1 from building_floors where building_id=b and name=p_payload->>'floor') then raise exception 'Choose a configured floor.';end if;
   insert into areas(id,building_id,unit_id,area_type,name,floor,sort_order) values(p_target,b,u.id,p_payload->>'type',btrim(p_payload->>'name'),coalesce(u.floor,p_payload->>'floor'),coalesce((p_payload->>'sortOrder')::integer,0))
    on conflict(id) do update set unit_id=excluded.unit_id,area_type=excluded.area_type,name=excluded.name,floor=excluded.floor,sort_order=excluded.sort_order,updated_at=now();
  end if;
 elsif p_action in ('save_team','remove_team') then
  if p_action='remove_team' then
   select to_jsonb(t) into existing from building_organisations t where id=p_target and building_id=b for update;
   if existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Team assignment changed. Reload before removing.';end if;
   update building_organisations set active=false,updated_at=now() where id=p_target;
   if existing->>'role_on_project'='sales_agent' then update buildings set sales_agent_organisation_id=null,updated_at=now() where id=b;end if;
   if existing->>'role_on_project'='conveyancer' then update buildings set conveyancer_organisation_id=null,updated_at=now() where id=b;end if;
  else
   org:=(p_payload->>'organisationId')::uuid;
   select * into o from organisations where id=org;
   if not exists(select 1 from workspace_commands.test_entities where kind='organisation' and entity_id=org)
    or (case p_payload->>'role' when 'main_contractor' then 'contractor' else p_payload->>'role' end) is distinct from o.type
    or p_payload->>'role' not in ('main_contractor','developer_representative','supporting_trade','sales_agent','conveyancer') then raise exception 'Choose a matching fictional test organisation and role.';end if;
   select to_jsonb(t) into existing from building_organisations t where id=p_target for update;
   if existing is not null and ((existing->>'building_id')::uuid<>b or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Team assignment changed.';end if;
   if p_payload->>'role'<>'supporting_trade' then update building_organisations set active=false,updated_at=now() where building_id=b and role_on_project=p_payload->>'role' and id<>p_target and active;end if;
   insert into building_organisations(id,building_id,organisation_id,role_on_project,active,trade_type) values(p_target,b,org,p_payload->>'role',true,p_payload->>'tradeType')
    on conflict(id) do update set organisation_id=excluded.organisation_id,role_on_project=excluded.role_on_project,active=true,trade_type=excluded.trade_type,updated_at=now();
   if p_payload->>'role'='sales_agent' then update buildings set sales_agent_organisation_id=org,updated_at=now() where id=b;end if;
   if p_payload->>'role'='conveyancer' then update buildings set conveyancer_organisation_id=org,updated_at=now() where id=b;end if;
  end if;
 elsif p_action='save_defaults' then
  -- Server supplies the existing validated commercial calculation; the database
  -- retains deposit inheritance triggers and atomically replaces its schedule.
  select to_jsonb(t) into existing from building_sale_defaults t where building_id=b for update;
  if existing is distinct from nullif(p_payload->'expectedDefaults','null'::jsonb) then raise exception 'Building defaults changed. Reload before saving.';end if;
  defaults_value:=p_payload->'defaults';
  insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent,default_exchange_agent_fee_percent,default_completion_agent_fee_percent,reservation_fee,reservation_fee_holder_default,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,second_deposit_months_after_exchange,further_deposit_timing)
   values(b,(defaults_value->>'build_cost')::numeric,(defaults_value->>'default_agent_fee_percent')::numeric,(defaults_value->>'default_exchange_agent_fee_percent')::numeric,(defaults_value->>'default_completion_agent_fee_percent')::numeric,(defaults_value->>'reservation_fee')::numeric,defaults_value->>'reservation_fee_holder_default',(defaults_value->>'exchange_deposit_percent')::numeric,(defaults_value->>'second_deposit_enabled')::boolean,(defaults_value->>'second_deposit_percent')::numeric,(defaults_value->>'second_deposit_months_after_exchange')::integer,defaults_value->'further_deposit_timing')
   on conflict(building_id) do update set build_cost=excluded.build_cost,default_agent_fee_percent=excluded.default_agent_fee_percent,default_exchange_agent_fee_percent=excluded.default_exchange_agent_fee_percent,default_completion_agent_fee_percent=excluded.default_completion_agent_fee_percent,reservation_fee=excluded.reservation_fee,reservation_fee_holder_default=excluded.reservation_fee_holder_default,exchange_deposit_percent=excluded.exchange_deposit_percent,second_deposit_enabled=excluded.second_deposit_enabled,second_deposit_percent=excluded.second_deposit_percent,second_deposit_months_after_exchange=excluded.second_deposit_months_after_exchange,further_deposit_timing=excluded.further_deposit_timing,updated_at=now();
  -- Match the existing blank, unreserved-unit fee cascade, inside this transaction.
  -- A deposit-only defaults edit must retain unit-specific fee settings.
  if row(existing->'default_agent_fee_percent',existing->'default_exchange_agent_fee_percent',existing->'default_completion_agent_fee_percent',existing->'reservation_fee',existing->'reservation_fee_holder_default')
     is distinct from row(defaults_value->'default_agent_fee_percent',defaults_value->'default_exchange_agent_fee_percent',defaults_value->'default_completion_agent_fee_percent',defaults_value->'reservation_fee',defaults_value->'reservation_fee_holder_default') then
   update unit_sale_terms t set reservation_fee=(defaults_value->>'reservation_fee')::numeric,
    reservation_fee_holder=defaults_value->>'reservation_fee_holder_default',
    agent_fee_percent=(defaults_value->>'default_agent_fee_percent')::numeric,
    exchange_agent_fee_percent=(defaults_value->>'default_exchange_agent_fee_percent')::numeric,
    completion_agent_fee_percent=(defaults_value->>'default_completion_agent_fee_percent')::numeric,
    vat_rate=(defaults_value->>'default_vat_rate')::numeric,solicitor_fee=(defaults_value->>'default_sales_solicitor_fee')::numeric,
    updated_by_user_id=p_actor,updated_at=now()
   from unit_sale_attempts attempt join units unit on unit.id=attempt.unit_id
   where t.sale_attempt_id=attempt.id and t.is_current and attempt.building_id=b and attempt.is_active
    and unit.sale_status='for_sale' and attempt.workflow_status='draft'
    and attempt.reservation_date is null and attempt.reservation_submitted_at is null
    and attempt.reservation_approved_at is null and attempt.commercial_approved_at is null
    and attempt.exchanged_at is null and attempt.completed_at is null and attempt.legal_completed_at is null
    and nullif(btrim(concat(attempt.buyer_name,attempt.buyer_person_name,attempt.buyer_company_name,attempt.buyer_email,attempt.buyer_phone,attempt.buyer_solicitor_name)),'') is null
    and not exists(select 1 from unit_sale_documents doc where doc.sale_attempt_id=attempt.id and doc.document_type='reservation_form' and doc.status<>'redacted' and doc.redacted_at is null)
    and not exists(select 1 from unit_sale_invoices invoice where invoice.sale_attempt_id=attempt.id)
    and not exists(select 1 from sale_legal_emails email where email.sale_attempt_id=attempt.id);
  end if;
  delete from building_sale_default_payment_schedule where building_id=b;
  insert into building_sale_default_payment_schedule(building_id,sequence_no,payment_stage,label,due_offset_days,percent_of_contract_price,includes_reservation_fee)
   select b,(r->>'sequenceNo')::integer,r->>'paymentStage',r->>'label',(r->>'dueOffsetDays')::integer,(r->>'percentOfContractPrice')::numeric,(r->>'includesReservationFee')::boolean from jsonb_array_elements(p_payload->'schedule') r;
 end if;
 result:=coalesce(result,jsonb_build_object('id',p_target));
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,p_actor,p_action,p_target,p_payload-array['defaults','schedule','expectedDefaults'],result);
 return result;
end $$;
revoke all on function public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb) to service_role;

create function workspace_commands.snag_actor(p_building uuid,p_snag uuid,p_action text) returns public.profiles
language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;s snags%rowtype;
begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role not in ('admin','developer','developer_representative','contractor') or not public.can_access_building(p_building) then raise exception 'Authorised Snags account required.' using errcode='42501';end if;
 if not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=p_building) then raise exception 'Snag writes are limited to the fictional test building.'; end if;
 if p_snag is null then
  if actor.role not in ('admin','developer','developer_representative') or p_action not in ('create_snag','context') then raise exception 'Developer snag creation required.' using errcode='42501';end if;
 else
  select * into s from snags where id=p_snag and building_id=p_building;
  if s.id is null or not public.can_access_snag(p_snag) then raise exception 'Snag unavailable in this building.' using errcode='42501';end if;
  if actor.role='contractor' and (not public.contractor_can_access_developer_snag(s.building_id,s.assigned_to_organisation_id) or p_action not in ('resolve_snag','request_snag_info','snag_comment','add_snag_media','context')) then raise exception 'This snag operation requires developer review.' using errcode='42501';end if;
 end if;
 return actor;
end $$;
revoke all on function workspace_commands.snag_actor(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.workspace_snag_context(p_building uuid,p_snag uuid default null) returns jsonb
language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;editable boolean;
begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role not in ('admin','developer','developer_representative','contractor') or not public.can_access_building(p_building) then raise exception 'Authorised Snags account required.' using errcode='42501';end if;
 if p_snag is not null and not exists(select 1 from snags where id=p_snag and building_id=p_building and public.can_access_snag(id)) then raise exception 'Exact snag unavailable.';end if;
 editable:=exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=p_building);
 return jsonb_build_object('editable',editable,'role',actor.role,
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',id,'building_id',building_id,'unit_number',unit_number,'floor',floor)) from units where building_id=p_building),'[]'::jsonb),
 'floors',coalesce((select jsonb_agg(to_jsonb(f) order by sort_order) from building_floors f where building_id=p_building),'[]'::jsonb),
 'areas',coalesce((select jsonb_agg(to_jsonb(a) order by sort_order) from areas a where building_id=p_building),'[]'::jsonb),
 'trades',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order) from trades where active),'[]'::jsonb),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',t.role_on_project)) from building_organisations t join organisations o on o.id=t.organisation_id where t.building_id=p_building and t.active and t.role_on_project in ('main_contractor','supporting_trade','developer_representative')),'[]'::jsonb),
 'snag',case when p_snag is null then null else (select to_jsonb(s) from snags s where id=p_snag) end);
end $$;
revoke all on function public.workspace_snag_context(uuid,uuid) from public,anon,service_role;
grant execute on function public.workspace_snag_context(uuid,uuid) to authenticated;

create function public.workspace_snag_media(p_building uuid,p_snag uuid,p_request uuid,p_action text,p_name text,p_mime text,p_size bigint)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;intent workspace_commands.snag_media_intents%rowtype;ext text;path text;
begin
 actor:=workspace_commands.snag_actor(p_building,p_snag,p_action);
 if p_request is null or p_action not in ('create_snag','resolve_snag','reject_snag','add_snag_media') or p_size<8 or p_size>4194304 or length(p_name)>200 or p_name~'[\\/]' then raise exception 'Choose supported test evidence up to 4 MiB.';end if;
 ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end;
 if ext is null then raise exception 'Use JPEG, PNG, WebP, MP4 or WebM evidence.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into intent from workspace_commands.snag_media_intents where id=p_request;
 if found then
  if intent.actor_id<>actor.id or intent.building_id<>p_building or intent.snag_id is distinct from p_snag or intent.action<>p_action or intent.name<>p_name or intent.mime<>p_mime or intent.size<>p_size then raise exception 'Evidence submission reference conflicts.';end if;
  return jsonb_build_object('path',intent.path);
 end if;
 path:=p_building::text||'/'||p_request::text||'/evidence.'||ext;
 insert into workspace_commands.snag_media_intents(id,actor_id,building_id,snag_id,action,path,name,mime,size) values(p_request,actor.id,p_building,p_snag,p_action,path,p_name,p_mime,p_size);
 return jsonb_build_object('path',path);
end $$;
revoke all on function public.workspace_snag_media(uuid,uuid,uuid,text,text,text,bigint) from public,anon,service_role;
grant execute on function public.workspace_snag_media(uuid,uuid,uuid,text,text,text,bigint) to authenticated;

create function public.workspace_snag_operation(p_building uuid,p_snag uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;s snags%rowtype;prior workspace_commands.operation_receipts%rowtype;intent workspace_commands.snag_media_intents%rowtype;
 target uuid:=p_snag;unit_id uuid;area areas%rowtype;org uuid;trade uuid;note text;patch jsonb;next_status text;result jsonb;
begin
 actor:=workspace_commands.snag_actor(p_building,p_snag,p_action);
 if p_request is null or jsonb_typeof(p_payload)<>'object' or p_action not in ('create_snag','resolve_snag','request_snag_info','close_snag','reject_snag','answer_snag_info','assign_snag','snag_comment','add_snag_media') then raise exception 'Choose a snag operation and submission reference.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from workspace_commands.operation_receipts where id=p_request;
 if found then
  if prior.actor_id<>actor.id or prior.action<>p_action or prior.target_id is distinct from p_snag or prior.input is distinct from p_payload||jsonb_build_object('buildingId',p_building) then raise exception 'Submission reference conflicts with the saved snag operation.';end if;
  return prior.result;
 end if;
 note:=nullif(btrim(p_payload->>'comment'),'');
 if length(note)>5000 then raise exception 'Use up to 5,000 characters.';end if;
 if p_action in ('snag_comment','request_snag_info','reject_snag','answer_snag_info') and note is null then raise exception 'Enter a comment explaining this action.';end if;
 if p_payload->>'withMedia'='true' then
  select * into intent from workspace_commands.snag_media_intents where id=p_request and actor_id=actor.id and building_id=p_building and snag_id is not distinct from p_snag and action=p_action for update;
  if intent.id is null or not exists(select 1 from storage.objects where bucket_id='workspace-snag-media' and name=intent.path) then raise exception 'Upload this submission’s evidence first.';end if;
 end if;
 if p_action='create_snag' then
  if p_snag is not null or nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>240 or length(p_payload->>'description')>10000 or intent.id is null then raise exception 'A title, location and evidence are required for a new snag.';end if;
  unit_id:=nullif(p_payload->>'unitId','')::uuid;
  select * into area from areas where id=(p_payload->>'areaId')::uuid and building_id=p_building;
  if area.id is null or area.unit_id is distinct from unit_id or (unit_id is not null and not exists(select 1 from units where id=unit_id and building_id=p_building)) then raise exception 'Choose a location in this building.';end if;
  org:=nullif(p_payload->>'organisationId','')::uuid;trade:=nullif(p_payload->>'tradeId','')::uuid;
  if org is not null and not exists(select 1 from building_organisations where building_id=p_building and organisation_id=org and active and role_on_project in ('main_contractor','supporting_trade')) then raise exception 'Choose a contractor assigned to this building.';end if;
  if trade is not null and not exists(select 1 from trades where id=trade and active) then raise exception 'Choose an active trade.';end if;
  target:=gen_random_uuid();
  insert into snags(id,building_id,unit_id,area_id,source_type,created_by,created_by_user_id,title,description,trade_id,assigned_to_organisation_id,priority,priority_code,status)
   values(target,p_building,unit_id,area.id,'developer_snag',actor.id,actor.id,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'description'),''),trade,org,null,null,'open');
 else
  select * into s from snags where id=p_snag and building_id=p_building for update;
  if p_action not in ('snag_comment','add_snag_media') and s.updated_at is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Snag changed. Reload before saving.';end if;
  if p_action='snag_comment' then
   insert into snag_events(snag_id,event_type,comment,created_by_user_id) values(target,'note',note,actor.id);
  elsif p_action='add_snag_media' then
   if intent.id is null then raise exception 'Choose evidence to add.';end if;
  elsif p_action='assign_snag' then
   if actor.role='contractor' then raise exception 'Developer allocation required.' using errcode='42501';end if;
   org:=nullif(p_payload->>'organisationId','')::uuid;trade:=nullif(p_payload->>'tradeId','')::uuid;
   if org is not null and not exists(select 1 from building_organisations where building_id=p_building and organisation_id=org and active and role_on_project in ('main_contractor','supporting_trade')) then raise exception 'Choose a building contractor.';end if;
   if trade is not null and not exists(select 1 from trades where id=trade and active) then raise exception 'Choose an active trade.';end if;
   if nullif(p_payload->>'priority','') is not null and p_payload->>'priority' not in ('P1','P2','P3') then raise exception 'Choose a valid priority.';end if;
   patch:=jsonb_build_object('assigned_to_organisation_id',org,'assigned_to_user_id',null,'trade_id',trade,'priority_code',nullif(p_payload->>'priority',''),'sla_due_date',nullif(p_payload->>'due',''));
   perform public.change_snag(target,patch,note);
  else
   if s.status::text='closed' then raise exception 'This snag is already closed.';end if;
   next_status:=case p_action when 'resolve_snag' then 'resolved_by_contractor' when 'request_snag_info' then 'needs_more_info' when 'close_snag' then 'closed' when 'reject_snag' then 'rejected_back_to_contractor' when 'answer_snag_info' then 'open' end;
   if p_action in ('close_snag','reject_snag','answer_snag_info') and actor.role='contractor' then raise exception 'Developer review required.' using errcode='42501';end if;
   if p_action='reject_snag' and s.status::text<>'resolved_by_contractor' then raise exception 'Only resolved snags can be returned to the contractor.';end if;
   if p_action='answer_snag_info' and s.status::text<>'needs_more_info' then raise exception 'This snag is not awaiting more information.';end if;
   if p_action in ('resolve_snag','request_snag_info') and s.status::text in ('resolved_by_contractor','needs_more_info') then raise exception 'This snag is awaiting developer review.';end if;
   perform public.change_snag(target,jsonb_build_object('status',next_status,'closed_at',case when next_status='closed' then now() end),note);
  end if;
 end if;
 if intent.id is not null then
  insert into snag_photos(snag_id,file_url,photo_type,caption,uploaded_by_user_id,media_type,storage_path,mime_type,file_size_bytes)
   values(target,'private:'||intent.path,case when p_action='resolve_snag' then 'resolution_photo' else 'annotated' end,note,actor.id,case when intent.mime like 'video/%' then 'video' else 'image' end,intent.path,intent.mime,intent.size);
  insert into snag_events(snag_id,event_type,comment,created_by_user_id) values(target,'photo_added',coalesce(note,'Test evidence added.'),actor.id);
 end if;
 result:=jsonb_build_object('id',target);
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,actor.id,p_action,p_snag,p_payload||jsonb_build_object('buildingId',p_building),result);
 return result;
end $$;
revoke all on function public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('workspace-snag-media','workspace-snag-media',false,4194304,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create policy "exact visible workspace snag evidence" on storage.objects for select to authenticated using(
 bucket_id='workspace-snag-media' and exists(select 1 from public.profiles where id=auth.uid() and active)
 and exists(select 1 from public.snag_photos p join public.snags s on s.id=p.snag_id where p.storage_path=objects.name and p.file_url='private:'||objects.name and public.can_access_building(s.building_id) and public.can_access_snag(p.snag_id))
);


create function public.workspace_setup_receipt(p_actor uuid,p_request uuid,p_action text,p_target uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare r workspace_commands.operation_receipts%rowtype;
begin
 perform workspace_commands.setup_actor(p_actor);
 select * into r from workspace_commands.operation_receipts where id=p_request;
 if not found then return null;end if;
 if r.actor_id<>p_actor or r.action<>p_action or r.target_id<>p_target or r.input is distinct from (p_payload-array['defaults','schedule','expectedDefaults']) then raise exception 'Submission reference conflicts with the saved operation.';end if;
 return jsonb_build_object('result',r.result);
end $$;
revoke all on function public.workspace_setup_receipt(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_setup_receipt(uuid,uuid,text,uuid,jsonb) to service_role;


-- Source: migrations/20261113154033_workspace_defaults_fields.sql

-- Persist every field produced by the existing validated defaults helper.
-- This replaces only the reviewed function text and does not rewrite any records.
do $migration$
declare definition text; original text;
begin
 select pg_get_functiondef('public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb)'::regprocedure) into definition;
 original:=definition;
 if position('insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent' in definition)=0 then raise exception 'Unexpected Setup function version';end if;
 definition:=replace(definition,
  'insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent',
  'insert into building_sale_defaults(building_id,build_cost,default_vat_rate,default_sales_solicitor_fee,default_agent_fee_percent');
 definition:=replace(definition,
  'values(b,(defaults_value->>''build_cost'')::numeric,(defaults_value->>''default_agent_fee_percent'')::numeric',
  'values(b,(defaults_value->>''build_cost'')::numeric,(defaults_value->>''default_vat_rate'')::numeric,(defaults_value->>''default_sales_solicitor_fee'')::numeric,(defaults_value->>''default_agent_fee_percent'')::numeric');
 definition:=replace(definition,
  'on conflict(building_id) do update set build_cost=excluded.build_cost,default_agent_fee_percent',
  'on conflict(building_id) do update set build_cost=excluded.build_cost,default_vat_rate=excluded.default_vat_rate,default_sales_solicitor_fee=excluded.default_sales_solicitor_fee,default_agent_fee_percent');
 if definition=original then raise exception 'Defaults fields were not added';end if;
 execute definition;
end $migration$;


do $$ declare actor uuid; begin
 select id into actor from public.profiles where role='admin' and active order by created_at,id limit 1;
 if actor is null then raise exception 'Existing staging administrator required'; end if;
 insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by)
 select id,building_id,unit_id,'Existing staging sale; external delivery disabled',actor from public.unit_sale_attempts where redacted_at is null;
 insert into workspace_commands.test_entities(kind,entity_id,created_by)
 select 'building',id,actor from public.buildings union all select 'organisation',id,actor from public.organisations
 union all select 'profile',id,actor from public.profiles where role in ('contractor','developer_representative','sales_agent','conveyancer')
 union all select 'trade',id,actor from public.trades union all select 'unit_type',id,actor from public.unit_types;
end $$;
create function workspace_commands.enroll_staging_sale() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by)
 select new.id,new.building_id,new.unit_id,'Staging sale; external delivery disabled',e.created_by
 from workspace_commands.test_entities e where e.kind='building' and e.entity_id=new.building_id on conflict(sale_id) do nothing;
 return new;
end $$;
revoke all on function workspace_commands.enroll_staging_sale() from public,anon,authenticated,service_role;
create trigger enroll_staging_workspace_sale after insert on public.unit_sale_attempts for each row execute function workspace_commands.enroll_staging_sale();

COMMIT;
