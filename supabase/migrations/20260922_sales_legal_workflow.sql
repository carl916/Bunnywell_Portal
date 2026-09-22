-- Coordinated building routing and legal workflow. No contact or date backfill.
begin;

alter table public.organisations add column shared_system_email text;
alter table public.organisations add constraint organisations_shared_system_email_check check (
  shared_system_email is null or (length(shared_system_email)<=254 and length(split_part(shared_system_email,'@',1))<=64
    and split_part(shared_system_email,'@',1) not like '.%' and split_part(shared_system_email,'@',1) not like '%.' and position('..' in split_part(shared_system_email,'@',1))=0
    and shared_system_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$')
);
-- Conveyancer and sales_agent already belong to organisations.type.
alter table public.buildings
  add column conveyancer_organisation_id uuid references public.organisations(id),
  add column sales_agent_organisation_id uuid references public.organisations(id),
  add column seller_name text,
  add column completion_information text;
create index on public.buildings(conveyancer_organisation_id);
create index on public.buildings(sales_agent_organisation_id);
alter table public.unit_sale_attempts
  add column authority_requested_at timestamptz,
  add column contractual_completion_date date,
  add column completion_notice_issued_at date,
  add column legal_completed_at timestamptz,
  add column legal_completed_by uuid references public.profiles(id);
alter table public.unit_sale_documents add column approved_version_id uuid references public.unit_sale_document_versions(id);
alter table public.unit_sale_documents drop constraint unit_sale_documents_type_check;
alter table public.unit_sale_documents add constraint unit_sale_documents_type_check check(document_type in
  ('reservation_form','agent_invoice','completion_statement','statement_of_account','completion_correspondence','other'));

create function public.sales_contact_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='buildings' then
    if new.conveyancer_organisation_id is not null and not exists(select 1 from organisations where id=new.conveyancer_organisation_id and type='conveyancer') then raise exception 'Select a conveyancer organisation.'; end if;
    if new.sales_agent_organisation_id is not null and not exists(select 1 from organisations where id=new.sales_agent_organisation_id and type='sales_agent') then raise exception 'Select a sales agent organisation.'; end if;
  elsif new.type is distinct from old.type and exists(select 1 from buildings where
    (conveyancer_organisation_id=new.id and new.type<>'conveyancer') or (sales_agent_organisation_id=new.id and new.type<>'sales_agent')) then
    raise exception 'Remove this organisation from building Sales contacts before changing its type.';
  end if;
  return new;
end $$;
create trigger sales_contact_guard before insert or update on public.buildings for each row execute function public.sales_contact_guard();
create trigger sales_contact_type_guard before update of type on public.organisations for each row execute function public.sales_contact_guard();

create function public.sales_contact_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='buildings' and (to_jsonb(old)->'conveyancer_organisation_id',to_jsonb(old)->'sales_agent_organisation_id',to_jsonb(old)->'seller_name',to_jsonb(old)->'completion_information')
    is distinct from (to_jsonb(new)->'conveyancer_organisation_id',to_jsonb(new)->'sales_agent_organisation_id',to_jsonb(new)->'seller_name',to_jsonb(new)->'completion_information') then
    insert into audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id) values('building_sales_contacts_updated','building',new.id,'Building sales contacts updated',
      jsonb_build_object('previous',jsonb_build_object('conveyancer',to_jsonb(old)->'conveyancer_organisation_id','salesAgent',to_jsonb(old)->'sales_agent_organisation_id','seller',to_jsonb(old)->'seller_name','completion',to_jsonb(old)->'completion_information'),
        'next',jsonb_build_object('conveyancer',to_jsonb(new)->'conveyancer_organisation_id','salesAgent',to_jsonb(new)->'sales_agent_organisation_id','seller',to_jsonb(new)->'seller_name','completion',to_jsonb(new)->'completion_information')),auth.uid());
  elsif tg_table_name='organisations' and to_jsonb(old)->'shared_system_email' is distinct from to_jsonb(new)->'shared_system_email' then
    insert into audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id) values('organisation_system_email_updated','organisation',new.id,'Organisation shared system email updated',
      jsonb_build_object('previous',to_jsonb(old)->'shared_system_email','next',to_jsonb(new)->'shared_system_email'),auth.uid());
  end if;
  return new;
end $$;
create trigger sales_contact_audit after update on public.buildings for each row execute function public.sales_contact_audit();
create trigger sales_email_audit after update of shared_system_email on public.organisations for each row execute function public.sales_contact_audit();
-- Visibility of a selected contact is not a grant of building access.
create policy sales_routing_organisations_read on public.organisations for select to authenticated using(exists(
  select 1 from buildings b where organisations.id in (b.conveyancer_organisation_id,b.sales_agent_organisation_id) and public.can_access_sales_building(b.id)
));

create table public.sale_legal_emails (
  id uuid primary key,
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  kind text not null check(kind in ('authority','completion_instruction')),
  version integer not null check(version>0),
  snapshot jsonb not null,
  subject text not null, body text not null, sending_address text not null,
  to_recipients text[] not null, cc_recipients text[] not null default '{}',
  approved_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(), expires_at timestamptz,
  proposed_completion_date date,
  revoked_at timestamptz, revoked_by uuid references public.profiles(id), revocation_reason text,
  replaced_by uuid references public.sale_legal_emails(id), exchanged_at date,
  resend_message_id text, delivery_status text not null default 'pending',
  dispatch_started_at timestamptz, sent_at timestamptz, expiry_recorded_at timestamptz,
  unique(sale_attempt_id,kind,version),
  check(cardinality(to_recipients)=1),
  check((kind='authority' and expires_at>issued_at) or (kind='completion_instruction' and proposed_completion_date is not null))
);
alter table public.sale_legal_emails enable row level security;
grant select on public.sale_legal_emails to authenticated;
grant select,insert,update on public.sale_legal_emails to service_role;
create policy legal_emails_read on public.sale_legal_emails for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
revoke insert,update,delete on public.sale_legal_emails from authenticated,anon;

create function public.sales_legal_assert(p_sale uuid,p_actor uuid,p_roles text[] default null) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' and p_actor is distinct from auth.uid() then raise exception 'Actor access denied.' using errcode='42501'; end if;
  if not public.can_access_sale(p_sale,p_actor) or not exists(select 1 from profiles where id=p_actor and active is true
    and (p_roles is null or role::text=any(p_roles))) then raise exception 'Sale action access denied.' using errcode='42501'; end if;
end $$;

create function public.sales_legal_snapshot(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; sale_status text;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select jsonb_build_object('sale_id',a.id,'building',jsonb_build_object('id',b.id,'name',b.name,'seller_name',b.seller_name,'completion_information',b.completion_information),
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

create function public.sales_legal_event(p_sale uuid,p_actor uuid,p_type text,p_summary text,p_meta jsonb default '{}') returns void
language sql security definer set search_path=public as $$
  insert into unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
    select id,building_id,unit_id,p_type,workflow_status,workflow_status,p_summary,p_meta,p_actor from unit_sale_attempts where id=p_sale;
$$;

create function public.sales_legal_email_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Legal email history is immutable.'; end if;
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the legal workflow to change email state.'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['revoked_at','revoked_by','revocation_reason','replaced_by','exchanged_at','resend_message_id','delivery_status','dispatch_started_at','sent_at','expiry_recorded_at'])
    is distinct from (to_jsonb(old)-array['revoked_at','revoked_by','revocation_reason','replaced_by','exchanged_at','resend_message_id','delivery_status','dispatch_started_at','sent_at','expiry_recorded_at']) then
    raise exception 'Issued terms and email contents are immutable.';
  end if;
  return new;
end $$;
create trigger legal_email_guard before insert or update or delete on public.sale_legal_emails for each row execute function public.sales_legal_email_guard();

-- Only the server can persist a rendered email, after a fresh authorised preview.
create function public.sales_legal_prepare_email(p_sale uuid,p_actor uuid,p_id uuid,p_kind text,p_snapshot jsonb,p_email jsonb,p_date text) returns jsonb
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
  elsif p_kind='completion_instruction' then
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
  cc:=case when p_kind='authority' and snap#>>'{sales_agent,type}'='sales_agent' and snap#>>'{sales_agent,shared_system_email}' is not null then array[snap#>>'{sales_agent,shared_system_email}'] else '{}'::text[] end;
  select coalesce(max(version),0)+1 into next_version from sale_legal_emails where sale_attempt_id=p_sale and kind=p_kind;
  perform set_config('app.sales_legal_write','on',true);
  insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,sending_address,to_recipients,cc_recipients,approved_by,expires_at,proposed_completion_date)
    values(p_id,p_sale,p_kind,next_version,snap,p_email->>'subject',p_email->>'body',p_email->>'from',array[recipient],cc,p_actor,
      case when p_kind='authority' then p_date::timestamptz end,case when p_kind='completion_instruction' then p_date::date end) returning * into result;
  perform public.sales_legal_event(p_sale,p_actor,'legal_email_prepared','Email approved for sending',jsonb_build_object('emailId',p_id,'kind',p_kind,'versionNumber',next_version,'expiresAt',result.expires_at));
  return to_jsonb(result);
end $$;

create function public.sales_legal_dispatch(p_id uuid,p_actor uuid,p_status text,p_message_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e sale_legal_emails%rowtype;
begin
  select * into e from sale_legal_emails where id=p_id;
  perform public.sales_legal_assert(e.sale_attempt_id,p_actor,array['admin','developer']);
  perform 1 from unit_sale_attempts where id=e.sale_attempt_id for update;
  select * into e from sale_legal_emails where id=p_id for update;
  perform set_config('app.sales_legal_write','on',true);
  if p_status='sending' then
    if e.sent_at is not null then return to_jsonb(e); end if;
    if e.revoked_at is not null or e.replaced_by is not null or e.exchanged_at is not null or e.expires_at<=now() or not exists(select 1 from unit_sale_attempts where id=e.sale_attempt_id and is_active and redacted_at is null and completed_at is null and workflow_status not in ('fallen_through','superseded')) then raise exception 'This instruction is no longer available to send.'; end if;
    if e.issued_at<now()-interval '23 hours' then raise exception 'The safe email retry window has ended. Check Resend before revoking and reissuing.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Email sending is already in progress.'; end if;
    update sale_legal_emails set delivery_status='sending',dispatch_started_at=now() where id=p_id returning * into e;
  elsif p_status='sent' then
    if p_message_id is null then raise exception 'Resend message ID is required.'; end if;
    if e.sent_at is not null then return to_jsonb(e); end if;
    update sale_legal_emails set delivery_status='sent',resend_message_id=p_message_id,sent_at=now() where id=p_id returning * into e;
    if e.kind='authority' then
      update sale_legal_emails set replaced_by=e.id where sale_attempt_id=e.sale_attempt_id and kind='authority' and id<>e.id and replaced_by is null and revoked_at is null and exchanged_at is null;
      update unit_sale_attempts set commercial_approved_at=now(),commercial_approved_by_user_id=p_actor,workflow_status='ready_for_exchange',updated_at=now() where id=e.sale_attempt_id;
    end if;
    perform public.sales_legal_event(e.sale_attempt_id,p_actor,case when e.kind='authority' and e.version>1 then 'authority_reissued' when e.kind='authority' then 'authority_issued' else 'completion_instruction_sent' end,
      case when e.kind='authority' and e.version>1 then 'Fresh authority to exchange issued' when e.kind='authority' then 'Authority to exchange issued' else 'Completion arrangements instructed' end,
      jsonb_build_object('emailId',e.id,'versionNumber',e.version,'expiresAt',e.expires_at,'proposedCompletionDate',e.proposed_completion_date,'to',e.to_recipients,'cc',e.cc_recipients));
  elsif p_status in ('failed','unknown','delivered','delivery_delayed','bounced','complained','suppressed','opened','clicked') then
    if e.sent_at is not null and p_status in ('failed','unknown') then return to_jsonb(e); end if;
    if e.delivery_status is distinct from p_status then
      update sale_legal_emails set delivery_status=p_status where id=p_id returning * into e;
      perform public.sales_legal_event(e.sale_attempt_id,p_actor,'legal_email_delivery','Email delivery: '||p_status,jsonb_build_object('emailId',e.id,'deliveryStatus',p_status));
    end if;
  else raise exception 'Invalid delivery status.'; end if;
  return to_jsonb(e);
end $$;

create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
  actor_role text; reason text; actual_date date; actual_time timestamptz; comment_id uuid; seq bigint;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select role::text into actor_role from profiles where id=p_actor;
  if (p_action='request_authority' and actor_role not in ('sales_agent','conveyancer'))
    or (p_action in ('revoke_authority','cancel_instruction','approve_statement','query_statement') and actor_role not in ('admin','developer'))
    or (p_action in ('confirm_exchange','confirm_arrangements','confirm_completion') and actor_role<>'conveyancer') then raise exception 'Your role cannot perform this legal action.' using errcode='42501'; end if;
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  perform set_config('app.sales_legal_write','on',true);
  if p_action='request_authority' then
    if a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') or a.exchanged_at is not null then raise exception 'Approve the reservation before requesting authority.'; end if;
    if a.authority_requested_at is not null then return jsonb_build_object('alreadyRequested',true); end if;
    update unit_sale_attempts set authority_requested_at=now() where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'authority_requested','Exchange authority requested — this is not authority to exchange');
    -- Use the existing sale conversation notification inbox for developers.
    select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
    insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
      select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,'Exchange authority requested. Developer review and issued authority are required before exchange.','exchange',gen_random_uuid() from profiles where id=p_actor returning id into comment_id;
    insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
      select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
  elsif p_action in ('revoke_authority','cancel_instruction') then
    reason:=nullif(btrim(p_payload->>'reason'),''); if reason is null then raise exception 'Add a revocation reason.'; end if;
    select * into e from sale_legal_emails where id=(p_payload->>'emailId')::uuid and sale_attempt_id=p_sale and kind=case when p_action='revoke_authority' then 'authority' else 'completion_instruction' end for update;
    if e.id is null or e.revoked_at is not null or e.exchanged_at is not null or a.completed_at is not null or (e.kind='authority' and a.exchanged_at is not null) then raise exception 'Only an unexchanged, unrevoked authority or an instruction awaiting completion can be revoked.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Wait for the email send to finish before revoking.'; end if;
    update sale_legal_emails set revoked_at=now(),revoked_by=p_actor,revocation_reason=reason where id=e.id;
    perform public.sales_legal_event(p_sale,p_actor,case when e.kind='authority' then 'authority_revoked' else 'completion_instruction_cancelled' end,
      case when e.kind='authority' then 'Exchange authority revoked' else 'Completion instruction cancelled in the portal' end,jsonb_build_object('emailId',e.id,'versionNumber',e.version,'reason',reason));
  elsif p_action='confirm_exchange' then
    if a.exchanged_at is not null then return jsonb_build_object('alreadyExchanged',true); end if;
    actual_date:=(p_payload->>'date')::date;
    if actual_date is null or actual_date>current_date or p_payload->>'depositConfirmed' is distinct from 'true' then raise exception 'Enter the actual exchange date and confirm receipt of the exchange deposit.'; end if;
    select * into e from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' order by version desc limit 1 for update;
    if e.id is null or e.sent_at is null or e.revoked_at is not null or e.replaced_by is not null or e.expires_at<=now() or e.delivery_status in ('bounced','complained','suppressed','failed','unknown') then raise exception 'A sent, unexpired authority is required. Ask the developer to issue fresh authority.'; end if;
    if actual_date<(e.issued_at at time zone 'Europe/London')::date then raise exception 'Exchange cannot predate the authority.'; end if;
    update sale_legal_emails set exchanged_at=actual_date where id=e.id;
    update unit_sale_attempts set workflow_status='exchanged',exchanged_at=actual_date,stage_entered_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_workflow_mark_unit_exchanged(a.unit_id,p_sale,p_actor,'legal_authority_exchange');
    perform public.sales_legal_event(p_sale,p_actor,'exchange_recorded','Exchange confirmed by conveyancer',jsonb_build_object('exchangeDate',actual_date,'emailId',e.id,'versionNumber',e.version));
  elsif p_action='confirm_arrangements' then
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'Exchange must be confirmed before completion arrangements.'; end if;
    if not exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='completion_instruction' and sent_at is not null and revoked_at is null) then raise exception 'The developer must send completion instructions first.'; end if;
    actual_date:=(p_payload->>'date')::date;
    if actual_date is null or actual_date<a.exchanged_at then raise exception 'Enter the contractual completion date on or after exchange.'; end if;
    if nullif(p_payload->>'noticeDate','')::date>current_date then raise exception 'Notice or confirmation issue date cannot be in the future.'; end if;
    update unit_sale_attempts set contractual_completion_date=actual_date,completion_notice_issued_at=nullif(p_payload->>'noticeDate','')::date where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_confirmed','Contractual completion date confirmed',jsonb_build_object('completionDate',actual_date,'noticeDate',p_payload->>'noticeDate'));
  elsif p_action in ('approve_statement','query_statement') then
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
    select * into v from unit_sale_document_versions where id=(p_payload->>'versionId')::uuid and is_current and redacted_at is null for update;
    select * into d from unit_sale_documents where id=v.document_id and sale_attempt_id=p_sale and document_type='completion_statement' and redacted_at is null and superseded_at is null for update;
    if d.id is null then raise exception 'The completion statement version changed. Review the current version.'; end if;
    if p_action='approve_statement' and d.status='approved' and d.approved_version_id=v.id then return jsonb_build_object('alreadyApproved',true); end if;
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if p_action='query_statement' and reason is null then raise exception 'Add comments explaining the query or rejection.'; end if;
    update unit_sale_documents set status=case when p_action='approve_statement' then 'approved' else 'query_raised' end,
      approved_version_id=case when p_action='approve_statement' then v.id end,approved_at=case when p_action='approve_statement' then now() end,
      approved_by_user_id=case when p_action='approve_statement' then p_actor end,query_note=reason,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    update unit_sale_attempts set workflow_status=case when p_action='approve_statement' then 'completion_pending' else 'exchanged' end where id=p_sale;
  elsif p_action='confirm_completion' then
    if a.completed_at is not null then return jsonb_build_object('alreadyCompleted',true); end if;
    actual_time:=(p_payload->>'dateTime')::timestamptz;
    if a.exchanged_at is null or a.contractual_completion_date is null then raise exception 'Confirm the contractual completion date first.'; end if;
    if actual_time is null or actual_time>now() or (actual_time at time zone 'Europe/London')::date<a.exchanged_at then raise exception 'Enter the actual legal completion date and time, on or after exchange and not in the future.'; end if;
    if not exists(select 1 from unit_sale_documents document join unit_sale_document_versions version on version.id=document.approved_version_id and version.document_id=document.id
      where document.sale_attempt_id=p_sale and document.document_type='completion_statement' and document.status='approved' and version.is_current and version.redacted_at is null and document.redacted_at is null and document.superseded_at is null) then raise exception 'The developer must approve the current completion statement version.'; end if;
    update unit_sale_attempts set workflow_status='completed',completed_at=(actual_time at time zone 'Europe/London')::date,legal_completed_at=actual_time,legal_completed_by=p_actor,stage_entered_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_workflow_mark_unit_completed(a.unit_id,p_sale,p_actor,'legal_completion_confirmed');
    perform public.sales_legal_event(p_sale,p_actor,'completion_recorded','Legal completion confirmed — handover and key release available',jsonb_build_object('completionDate',actual_time,'legalCompletedAt',actual_time));
  else raise exception 'Unsupported legal workflow action.'; end if;
  return jsonb_build_object('saleAttemptId',p_sale);
end $$;

-- The server stores a file first; this transaction swaps the current version and
-- resets its approval atomically. Failed registration leaves no approval changes.
create function public.sales_legal_register_document(p_sale uuid,p_actor uuid,p_type text,p_file jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; vid uuid; n integer;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null then raise exception 'An active exchanged sale is required.'; end if;
  if p_type not in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Invalid completion document type.'; end if;
  if (p_type='statement_of_account' and a.completed_at is null) or (p_type<>'statement_of_account' and a.completed_at is not null) then raise exception 'Final accounts follow legal completion; statements and correspondence precede it.'; end if;
  perform set_config('app.sales_legal_write','on',true);
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=p_type and redacted_at is null and superseded_at is null for update;
  if d.id is null then
    insert into unit_sale_documents(sale_attempt_id,document_type,title,status,visibility,required,created_by_user_id,updated_by_user_id)
      values(p_sale,p_type,case p_type when 'completion_statement' then 'Completion statement' when 'statement_of_account' then 'Final statement of account' else 'Completion notice or correspondence' end,
        'uploaded','shared_sale_file',p_type='completion_statement',p_actor,p_actor) returning * into d;
  end if;
  select coalesce(max(version_number),0)+1 into n from unit_sale_document_versions where document_id=d.id;
  update unit_sale_document_versions set is_current=false where document_id=d.id and is_current;
  insert into unit_sale_document_versions(document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id)
    values(d.id,n,true,'sale-documents',p_file->>'path',p_file->>'name','application/pdf',(p_file->>'size')::bigint,p_actor) returning id into vid;
  update unit_sale_documents set status='uploaded',approved_version_id=null,approved_at=null,approved_by_user_id=null,query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
  if p_type='completion_statement' then update unit_sale_attempts set workflow_status='exchanged' where id=p_sale and completed_at is null; end if;
  return vid;
end $$;

-- Guard legacy REST/service routes as well as browser RLS. No unchecked writes to
-- confirmations, approvals or legal document versions may bypass the RPCs.
create function public.sales_legal_write_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare sale_id uuid; a unit_sale_attempts%rowtype; doc_type text;
begin
  if coalesce(current_setting('app.sales_legal_write',true),'')='on' then return new; end if;
  if tg_table_name='unit_sale_attempts' then
    if tg_op='INSERT' then
      if new.exchanged_at is not null or new.completed_at is not null or new.legal_completed_at is not null or new.contractual_completion_date is not null or new.authority_requested_at is not null or new.workflow_status in ('exchanged','completion_pending','completed') then raise exception 'Use the legal workflow for confirmations.'; end if;
    elsif (new.exchanged_at,new.completed_at,new.legal_completed_at,new.legal_completed_by,new.contractual_completion_date,new.completion_notice_issued_at,new.authority_requested_at)
      is distinct from (old.exchanged_at,old.completed_at,old.legal_completed_at,old.legal_completed_by,old.contractual_completion_date,old.completion_notice_issued_at,old.authority_requested_at)
      or (new.workflow_status is distinct from old.workflow_status and new.workflow_status in ('exchanged','completion_pending','completed')) then raise exception 'Use the legal workflow for confirmations.';
    end if;
    if tg_op='INSERT' or (new.buyer_name,new.buyer_person_name,new.buyer_company_name,new.is_active,new.redacted_at,new.workflow_status in ('fallen_through','superseded'))
      is not distinct from (old.buyer_name,old.buyer_person_name,old.buyer_company_name,old.is_active,old.redacted_at,old.workflow_status in ('fallen_through','superseded')) then return new; end if;
    sale_id:=new.id;
  elsif tg_table_name='unit_sale_documents' then
    if coalesce(new.document_type,old.document_type) in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Use the legal workflow for completion documents.'; end if; return coalesce(new,old);
  elsif tg_table_name='unit_sale_document_versions' then
    select document_type into doc_type from unit_sale_documents where id=coalesce(new.document_id,old.document_id);
    if doc_type in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Use the legal workflow for completion document versions.'; end if; return coalesce(new,old);
  else sale_id:=coalesce(new.sale_attempt_id,old.sale_attempt_id);
  end if;
  select * into a from unit_sale_attempts where id=sale_id for update;
  if a.exchanged_at is not null or exists(select 1 from sale_legal_emails where sale_attempt_id=sale_id and kind='authority' and revoked_at is null and replaced_by is null
    and (expires_at>now() or delivery_status in ('pending','sending','unknown'))) then raise exception 'Authorised terms are locked. Revoke unexchanged authority before changing the agreed terms.'; end if;
  return coalesce(new,old);
end $$;
create trigger legal_attempt_guard before insert or update on public.unit_sale_attempts for each row execute function public.sales_legal_write_guard();
create trigger legal_terms_guard before insert or update or delete on public.unit_sale_terms for each row execute function public.sales_legal_write_guard();
create trigger legal_schedule_guard before insert or update or delete on public.unit_sale_payment_schedule for each row execute function public.sales_legal_write_guard();
create trigger legal_document_guard before insert or update or delete on public.unit_sale_documents for each row execute function public.sales_legal_write_guard();
create trigger legal_version_guard before insert or update or delete on public.unit_sale_document_versions for each row execute function public.sales_legal_write_guard();

-- Retain the established event projection and extend it only for these typed events.
alter function public.sale_event_projection(public.unit_sale_workflow_events) rename to sale_event_projection_before_legal;
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if e.event_type in ('authority_requested','authority_issued','authority_reissued','authority_expired','authority_revoked','completion_instruction_sent','completion_instruction_cancelled','completion_arrangements_confirmed','legal_email_prepared','legal_email_delivery','completion_correspondence_uploaded','completion_correspondence_replaced') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',case when e.event_type='authority_expired' then 'System' else e.actor_name end,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_legal(e);
end $$;

-- Preserve older completed units and handovers; all new sold-unit completion
-- transitions need the conveyancer's recorded legal confirmation.
create function public.sales_legal_unit_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.sale_status in ('completed','handed_over') then raise exception 'New units must progress through legal completion before handover.'; end if;
  if new.sale_status='completed' and old.sale_status is distinct from new.sale_status and not exists(select 1 from unit_sale_attempts where unit_id=new.id and is_active and legal_completed_at is not null) then
    raise exception 'Conveyancer confirmation of legal completion is required before handover or key release.';
  end if;
  return new;
end $$;
create trigger legal_unit_guard before insert or update of sale_status on public.units for each row execute function public.sales_legal_unit_guard();

create function public.sales_legal_history_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.event_type,old.event_type) ~ '^(authority_|legal_email_|completion_instruction_|completion_arrangements_|exchange_recorded$|completion_recorded$|completion_documents_|completion_statement_|completion_correspondence_|statement_of_account_)' then
    if tg_op<>'INSERT' then raise exception 'Legal workflow history is immutable.'; end if;
    if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Legal events must be recorded by the legal workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;
create trigger legal_history_guard before insert or update or delete on public.unit_sale_workflow_events for each row execute function public.sales_legal_history_guard();

-- Expiry takes effect from the timestamp even if nobody opens the sale. On the
-- next read, project that expiry into activity once, dated at the actual expiry.
create function public.sales_legal_expire(p_sale uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
declare e sale_legal_emails%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  perform 1 from unit_sale_attempts where id=p_sale for update;
  perform set_config('app.sales_legal_write','on',true);
  for e in select * from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' and expires_at<=now()
    and expiry_recorded_at is null and exchanged_at is null and revoked_at is null and replaced_by is null and sent_at is not null for update loop
    update sale_legal_emails set expiry_recorded_at=now() where id=e.id;
    insert into unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,summary,metadata,created_at)
      select id,building_id,unit_id,'authority_expired','Authority to exchange expired',jsonb_build_object('emailId',e.id,'versionNumber',e.version,'expiresAt',e.expires_at),e.expires_at from unit_sale_attempts where id=p_sale;
  end loop;
end $$;
revoke all on function public.sales_legal_expire(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_legal_expire(uuid,uuid) to service_role;

-- Explicit grants: private actor/event/dispatch helpers cannot be invoked by browsers.
revoke all on function public.sales_legal_assert(uuid,uuid,text[]),public.sales_legal_event(uuid,uuid,text,text,jsonb),public.sales_legal_prepare_email(uuid,uuid,uuid,text,jsonb,jsonb,text),
  public.sales_legal_dispatch(uuid,uuid,text,text),public.sales_legal_register_document(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sales_legal_prepare_email(uuid,uuid,uuid,text,jsonb,jsonb,text),public.sales_legal_dispatch(uuid,uuid,text,text),public.sales_legal_register_document(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.sales_legal_snapshot(uuid,uuid),public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.sales_legal_snapshot(uuid,uuid),public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;
commit;
