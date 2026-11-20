-- Staging only: controlled amendments reuse the existing commercial-save operation.
-- No existing sale data is changed by this migration.
CREATE OR REPLACE FUNCTION public.workspace_sale_operation(p_building uuid, p_unit uuid, p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'workspace_commands'
AS $function$
declare a unit_sale_attempts%rowtype; actor profiles%rowtype; prior workspace_commands.receipts%rowtype;
 current_terms unit_sale_terms%rowtype; t unit_sale_terms%rowtype;
 i unit_sale_invoices%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
 input jsonb; result jsonb; terms jsonb; defs jsonb; next_sale uuid; reason text; milestone text;
 doc_id uuid; version_id uuid; version_no integer; invoice_id uuid; expected_version uuid;
 approved_amendment boolean:=false; previous_terms jsonb; previous_schedule jsonb; amendment_terms unit_sale_terms%rowtype;
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
  if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm that the current sale attempt will end and a new sale attempt will be created.'; end if;
  perform public.return_pre_exchange_unit_for_sale(p_sale,p_actor,p_payload->>'reason','integration_workspace');
  next_sale:=public.prepare_unit_baseline_sale_record(p_unit,p_actor);
  insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by)
   values(next_sale,p_building,p_unit,'Staging replacement sale',p_actor)
   on conflict(sale_id) do nothing;
  result:=jsonb_build_object('saleAttemptId',next_sale,'previousSaleAttemptId',p_sale);
 elsif p_action='save_commercial' then
  approved_amendment:=a.reservation_approved_at is not null and a.reservation_approved_by_user_id is not null
   and a.workflow_status in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange');
  if a.exchanged_at is not null or a.completed_at is not null or a.legal_completed_at is not null
   or (not approved_amendment and a.workflow_status not in ('draft','rejected','reservation_query_raised')) then
   raise exception 'Commercial changes require an editable reservation or a developer-approved reservation awaiting exchange.'; end if;
  if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' and revoked_at is null and replaced_by is null) then
   raise exception 'Withdraw the existing authority to exchange before amending these terms. Fresh authority will be required.'; end if;
  if approved_amendment then
   reason:=nullif(btrim(p_payload->>'reason'),'');
   if reason is null or length(reason)>2000 or p_payload->'confirmed' is distinct from 'true'::jsonb then
    raise exception 'Provide an amendment reason and confirm the developer-authorised amendment.'; end if;
   if exists(select 1 from unit_sale_invoices where sale_attempt_id=p_sale)
    or exists(select 1 from sale_exchange_deposit_receipts where sale_attempt_id=p_sale)
    or exists(select 1 from sale_further_deposit_receipts where sale_attempt_id=p_sale) then
    raise exception 'Recorded invoices or deposit receipts require a separate financial correction before commercial terms can be amended.'; end if;
  end if;
  select * into current_terms from unit_sale_terms where sale_attempt_id=p_sale and is_current for update;
  select to_jsonb(x) into defs from building_sale_defaults x where building_id=p_building for share;
  if (case when current_terms.id is null then null else to_jsonb(current_terms) end) is distinct from nullif(p_payload->'expectedTerms','null'::jsonb) or defs is distinct from nullif(p_payload->'expectedDefaults','null'::jsonb) then raise exception 'Commercial terms or defaults changed. Reload before saving.'; end if;
  if approved_amendment then
   if current_terms.id is null then raise exception 'An approved commercial terms record is required.'; end if;
   previous_terms:=to_jsonb(current_terms);
   select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence_no),'[]'::jsonb) into previous_schedule from unit_sale_payment_schedule s where sale_attempt_id=p_sale;
   -- Keep the original commercial values and approval metadata on their own version.
   -- Schedules are unique per sale/sequence; preserve the exact former schedule in the amendment audit.
   update unit_sale_terms set is_current=false,status='superseded',superseded_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=current_terms.id;
   amendment_terms:=current_terms;
   amendment_terms.id:=gen_random_uuid();
   select coalesce(max(version_number),0)+1 into amendment_terms.version_number from unit_sale_terms where sale_attempt_id=p_sale;
   amendment_terms.is_current:=true;amendment_terms.status:='approved';amendment_terms.superseded_at:=null;
   amendment_terms.created_at:=now();amendment_terms.updated_at:=now();amendment_terms.created_by_user_id:=p_actor;amendment_terms.updated_by_user_id:=p_actor;
   amendment_terms.approved_at:=now();amendment_terms.approved_by_user_id:=p_actor;
   insert into unit_sale_terms select amendment_terms.*;
  end if;
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
  if approved_amendment then
   perform public.sales_legal_event(p_sale,p_actor,'commercial_terms_amended','Commercial terms amended: '||reason,
    jsonb_build_object('reason',reason,'previousTerms',previous_terms,'previousSchedule',previous_schedule,
     'termsId',amendment_terms.id,'versionNumber',amendment_terms.version_number,
     'terms',(select to_jsonb(x) from unit_sale_terms x where id=amendment_terms.id),
     'schedule',(select coalesce(jsonb_agg(to_jsonb(x) order by x.sequence_no),'[]'::jsonb) from unit_sale_payment_schedule x where x.sale_attempt_id=p_sale),
     'requiresFreshAuthority',true));
  end if;
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
end $function$
;

-- Legacy helpers are server-only; browser callers must pass authenticated workspace checks.
revoke execute on function public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb) from public, anon, authenticated;
grant execute on function public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb) to service_role;
revoke execute on function public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) from public, anon, authenticated;
grant execute on function public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) to service_role;
revoke execute on function public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb) from public, anon, authenticated;
grant execute on function public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb) to service_role;
