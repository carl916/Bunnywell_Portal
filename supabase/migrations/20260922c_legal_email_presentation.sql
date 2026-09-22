-- Preserve the exact approved HTML alongside text. Historical emails remain
-- unchanged and retry with their original payload. The existing immutable-email
-- guard also protects html_body (its allow-list contains only delivery fields).
begin;
alter table public.sale_legal_emails add column html_body text;

create or replace function public.sales_legal_snapshot(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; sale_status text;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select jsonb_build_object('sale_id',a.id,'unit_id',a.unit_id,'building',jsonb_build_object('id',b.id,'name',b.name,'seller_name',b.seller_name,'completion_information',b.completion_information),
    'plot',u.unit_number,'buyer',coalesce(nullif(concat_ws(' / ',nullif(a.buyer_person_name,''),nullif(a.buyer_company_name,'')),''),a.buyer_name),
    'terms',jsonb_build_object('id',t.id,'version_number',t.version_number,'contract_price',t.contract_price,'reservation_fee',t.reservation_fee,'reservation_fee_holder',t.reservation_fee_holder,
      'exchange_deposit_percent',t.exchange_deposit_percent,'deposit_summary',t.deposit_summary,'second_deposit_enabled',to_jsonb(t)->'second_deposit_enabled',
      'second_deposit_percent',to_jsonb(t)->'second_deposit_percent','second_deposit_months_after_exchange',to_jsonb(t)->'second_deposit_months_after_exchange',
      'completion_balance_percent',to_jsonb(t)->'completion_balance_percent','developer_contribution',t.developer_contribution,'agent_contribution',t.agent_contribution,
      'other_concessions',t.other_concessions,'parking_value',t.parking_value,'parking_contribution_value',t.parking_contribution_value,'parking_location_details',t.parking_location_details,
      'additional_special_conditions',t.additional_special_conditions,'commercial_summary',t.commercial_summary),
    'schedule',coalesce((select jsonb_agg(jsonb_build_object('payment_stage',s.payment_stage,'label',s.label,'due_event',s.due_event,'due_offset_days',s.due_offset_days,
      'percent_of_contract_price',s.percent_of_contract_price,'fixed_amount',s.fixed_amount,'expected_amount',s.expected_amount,'includes_reservation_fee',s.includes_reservation_fee,'notes',s.notes) order by s.sequence_no)
      from unit_sale_payment_schedule s where s.sale_attempt_id=a.id and (s.sale_terms_id=t.id or s.sale_terms_id is null)),'[]'),
    'conveyancer',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.name,'type',c.type,'shared_system_email',c.shared_system_email) end,
    'sales_agent',case when g.id is not null then jsonb_build_object('id',g.id,'name',g.name,'type',g.type,'shared_system_email',g.shared_system_email) end,
    'approver',jsonb_build_object('id',p.id,'name',coalesce(nullif(p.full_name,''),nullif(p.name,''),'Unknown user')))
  into result from unit_sale_attempts a join buildings b on b.id=a.building_id join units u on u.id=a.unit_id
    left join unit_sale_terms t on t.sale_attempt_id=a.id and t.is_current
    left join organisations c on c.id=b.conveyancer_organisation_id left join organisations g on g.id=b.sales_agent_organisation_id
    join profiles p on p.id=p_actor where a.id=p_sale;
  select workflow_status into sale_status from unit_sale_attempts where id=p_sale;
  if not exists(select 1 from profiles where id=p_actor and role in ('admin','developer')) and sale_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange','exchanged','completion_pending','completed') then
    result:=jsonb_set(jsonb_set(result,'{terms}','{}'),'{schedule}','[]');
  end if;
  return result;
end $$;

create or replace function public.sales_legal_prepare_email(p_sale uuid,p_actor uuid,p_id uuid,p_kind text,p_snapshot jsonb,p_email jsonb,p_date text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; result sale_legal_emails%rowtype; snap jsonb; recipient text; cc text[]; next_version integer;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  select * into result from sale_legal_emails where id=p_id;
  if found then
    if result.sale_attempt_id<>p_sale or result.approved_by<>p_actor then raise exception 'Email reference conflict.'; end if;
    return to_jsonb(result);
  end if;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and delivery_status in ('pending','sending','unknown') and revoked_at is null) then raise exception 'Resolve or revoke the outstanding email before issuing another instruction.'; end if;
  if p_kind='authority' then
    if a.exchanged_at is not null or a.completed_at is not null or a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') then raise exception 'An approved, unexchanged reservation is required.'; end if;
    if p_date::timestamptz<=now() then raise exception 'Authority expiry must be in the future.'; end if;
  elsif p_kind='notice_authority' then
    if a.completion_authority_given_at is not null or a.completion_legacy_stage is not null then raise exception 'Authority to serve notice is already available.'; end if;
    if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='notice_authority' and revoked_at is null) then raise exception 'Resolve or cancel the existing notice authority email first.'; end if;
    if nullif(p_date,'') is not null then raise exception 'No date is required for authority to serve notice.'; end if;
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
  else raise exception 'Invalid email kind.'; end if;
  -- Serialise building/organisation changes with snapshot validation.
  perform 1 from buildings where id=a.building_id for share;
  perform 1 from organisations where id in(select conveyancer_organisation_id from buildings where id=a.building_id union select sales_agent_organisation_id from buildings where id=a.building_id) for share;
  snap:=public.sales_legal_snapshot(p_sale,p_actor);
  if snap is distinct from p_snapshot then raise exception 'Sale terms or recipients changed. Refresh the email preview.'; end if;
  recipient:=snap#>>'{conveyancer,shared_system_email}';
  if recipient is null or snap#>>'{conveyancer,type}'<>'conveyancer' then raise exception 'Configure the building conveyancer shared system email.'; end if;
  if nullif(btrim(snap#>>'{building,seller_name}'),'') is null then raise exception 'Configure the legal seller/SPV.'; end if;
  if p_kind='authority' and (snap#>>'{terms,contract_price}' is null or (snap#>>'{terms,contract_price}')::numeric<=0) then raise exception 'Agreed contract price is required.'; end if;
  cc:=case when p_kind in ('authority','notice_authority') and snap#>>'{sales_agent,type}'='sales_agent' and snap#>>'{sales_agent,shared_system_email}' is not null then array[snap#>>'{sales_agent,shared_system_email}'] else '{}'::text[] end;
  select coalesce(max(version),0)+1 into next_version from sale_legal_emails where sale_attempt_id=p_sale and kind=p_kind;
  perform set_config('app.sales_legal_write','on',true);
  insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,html_body,sending_address,to_recipients,cc_recipients,approved_by,expires_at,proposed_completion_date)
    values(p_id,p_sale,p_kind,next_version,snap,p_email->>'subject',p_email->>'body',p_email->>'html',p_email->>'from',array[recipient],cc,p_actor,
      case when p_kind='authority' then p_date::timestamptz end,null) returning * into result;
  perform public.sales_legal_event(p_sale,p_actor,'legal_email_prepared','Email approved for sending',jsonb_build_object('emailId',p_id,'kind',p_kind,'versionNumber',next_version,'expiresAt',result.expires_at));
  return to_jsonb(result);
end $$;

commit;
