-- Extend the legal workflow without rewriting historical dates, emails or actors.
begin;
alter table public.unit_sale_attempts
  add column completion_authority_requested_at timestamptz,
  add column completion_authority_requested_by uuid references public.profiles(id),
  add column completion_authority_given_at timestamptz,
  add column completion_authority_given_by uuid references public.profiles(id),
  add column completion_arrangements_confirmed_at timestamptz,
  add column completion_arrangements_confirmed_by uuid references public.profiles(id),
  add column completion_legacy_stage text check(completion_legacy_stage in ('authority','arrangements'));
alter table public.unit_sale_document_versions add column notice_submission_id uuid unique;

-- This one-time compatibility marker is not an authority or confirmation event.
update public.unit_sale_attempts a set completion_legacy_stage=case
  when a.contractual_completion_date is not null or a.completed_at is not null or a.workflow_status in ('completion_pending','completed')
    or exists(select 1 from unit_sale_documents d where d.sale_attempt_id=a.id and d.document_type in ('completion_statement','statement_of_account')) then 'arrangements'
  else 'authority' end
where a.contractual_completion_date is not null or a.completion_notice_issued_at is not null or a.completed_at is not null
  or a.workflow_status in ('completion_pending','completed')
  or exists(select 1 from unit_sale_documents d where d.sale_attempt_id=a.id and d.document_type in ('completion_correspondence','completion_statement','statement_of_account'))
  or exists(select 1 from sale_legal_emails e where e.sale_attempt_id=a.id and e.kind='completion_instruction' and e.sent_at is not null);

alter table public.sale_legal_emails drop constraint sale_legal_emails_kind_check;
alter table public.sale_legal_emails add constraint sale_legal_emails_kind_check check(kind in ('authority','completion_instruction','notice_authority'));
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.sale_legal_emails'::regclass and contype='c' and pg_get_constraintdef(oid) like '%proposed_completion_date%' loop
    execute format('alter table public.sale_legal_emails drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.sale_legal_emails add constraint sale_legal_emails_dates_check check(
  (kind='authority' and expires_at>issued_at) or (kind='completion_instruction' and proposed_completion_date is not null)
  or (kind='notice_authority' and proposed_completion_date is null and expires_at is null));

create function public.sales_notice_state_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' and (
    (tg_op='INSERT' and (new.completion_authority_requested_at is not null or new.completion_authority_requested_by is not null
      or new.completion_authority_given_at is not null or new.completion_authority_given_by is not null
      or new.completion_arrangements_confirmed_at is not null or new.completion_arrangements_confirmed_by is not null or new.completion_legacy_stage is not null))
    or (tg_op='UPDATE' and (new.completion_authority_requested_at,new.completion_authority_requested_by,new.completion_authority_given_at,new.completion_authority_given_by,
      new.completion_arrangements_confirmed_at,new.completion_arrangements_confirmed_by,new.completion_legacy_stage) is distinct from
      (old.completion_authority_requested_at,old.completion_authority_requested_by,old.completion_authority_given_at,old.completion_authority_given_by,
      old.completion_arrangements_confirmed_at,old.completion_arrangements_confirmed_by,old.completion_legacy_stage))) then
    raise exception 'Use the legal workflow for completion authority and confirmation.';
  end if;
  return new;
end $$;
create trigger notice_state_guard before insert or update on public.unit_sale_attempts for each row execute function public.sales_notice_state_guard();

-- The previous action implementation is private; browsers cannot bypass gates.
alter function public.sales_legal_action(uuid,text,jsonb,uuid) rename to sales_legal_action_before_notice;
revoke all on function public.sales_legal_action_before_notice(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; comment_id uuid; seq bigint; notice_date date; due_date date; e sale_legal_emails%rowtype; reason text;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if p_action='confirm_arrangements' then raise exception 'Submit both dates and the notice PDF together.'; end if;
  if p_action='cancel_notice_authority' then
    perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if reason is null then raise exception 'Add a cancellation reason.'; end if;
    select * into e from sale_legal_emails where id=(p_payload->>'emailId')::uuid and sale_attempt_id=p_sale and kind='notice_authority' for update;
    if e.id is null or e.sent_at is not null or e.revoked_at is not null then raise exception 'Only a pending notice authority can be cancelled.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Wait for the email send to finish before cancelling.'; end if;
    perform set_config('app.sales_legal_write','on',true);
    update sale_legal_emails set revoked_at=now(),revoked_by=p_actor,revocation_reason=reason where id=e.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_instruction_cancelled','Pending authority to serve notice cancelled',jsonb_build_object('emailId',e.id,'reason',reason));
    return jsonb_build_object('cancelled',true);
  end if;
  if p_action='request_notice_authority' then
    perform public.sales_legal_assert(p_sale,p_actor,array['sales_agent','conveyancer']);
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
    if a.completion_authority_given_at is not null or a.completion_legacy_stage is not null then raise exception 'Authority is already available.'; end if;
    if a.completion_authority_requested_at is not null then return jsonb_build_object('alreadyRequested',true); end if;
    perform set_config('app.sales_legal_write','on',true);
    update unit_sale_attempts set completion_authority_requested_at=now(),completion_authority_requested_by=p_actor where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'authority_notice_requested','Authority to serve notice requested');
    select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
    insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
      select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,
        'Authority to serve notice requested. Developer authority is required before the conveyancer records the notice.','completion',gen_random_uuid()
      from profiles where id=p_actor returning id into comment_id;
    insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
      select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
    return jsonb_build_object('requested',true);
  end if;
  if p_action in ('approve_statement','query_statement','confirm_completion','correct_completion_dates')
    and a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then
    raise exception 'Confirm completion arrangements and the notice PDF first.';
  end if;
  if p_action='correct_completion_dates' then
    perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
    if a.completed_at is not null then raise exception 'Legal completion has already been recorded.'; end if;
    if coalesce(p_payload->>'noticeDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Both calendar dates are required.'; end if;
    notice_date:=(p_payload->>'noticeDate')::date; due_date:=(p_payload->>'date')::date;
    if due_date<notice_date then raise exception 'Completion due date cannot be earlier than the notice issue date.'; end if;
    if (a.completion_notice_issued_at,a.contractual_completion_date) is distinct from
      (nullif(p_payload->>'previousNoticeDate','')::date,nullif(p_payload->>'previousDate','')::date) then raise exception 'Dates changed. Refresh before correcting them.'; end if;
    if (notice_date,due_date) is not distinct from (a.completion_notice_issued_at,a.contractual_completion_date) then return jsonb_build_object('unchanged',true); end if;
    perform set_config('app.sales_legal_write','on',true);
    update unit_sale_attempts set completion_notice_issued_at=notice_date,contractual_completion_date=due_date,updated_by_user_id=p_actor,updated_at=now() where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_dates_corrected','Completion arrangement dates corrected',
      jsonb_build_object('previousNoticeDate',a.completion_notice_issued_at,'previousCompletionDate',a.contractual_completion_date,'noticeDate',notice_date,'completionDate',due_date));
    return jsonb_build_object('corrected',true);
  end if;
  return public.sales_legal_action_before_notice(p_sale,p_action,p_payload,p_actor);
end $$;
revoke all on function public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;

alter function public.sales_legal_register_document(uuid,uuid,text,jsonb) rename to sales_legal_register_document_before_notice;
revoke all on function public.sales_legal_register_document_before_notice(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.sales_legal_register_document(p_sale uuid,p_actor uuid,p_type text,p_file jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_type='completion_correspondence' then raise exception 'Use the notice submission to save or replace the notice PDF.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  return public.sales_legal_register_document_before_notice(p_sale,p_actor,p_type,p_file);
end $$;
revoke all on function public.sales_legal_register_document(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sales_legal_register_document(uuid,uuid,text,jsonb) to service_role;

-- Only the API can call this function after checking the actual PDF bytes and
-- uploading to a unique path. Registration, dates and activity commit together.
create function public.sales_legal_submit_notice(p_sale uuid,p_actor uuid,p_request uuid,p_file jsonb,p_notice text default null,p_due text default null,p_replace boolean default false,p_expected uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; v unit_sale_document_versions%rowtype; current_id uuid; vid uuid; notice_date date; due_date date;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_request is null then raise exception 'A submission reference is required.'; end if;
  select * into v from unit_sale_document_versions where notice_submission_id=p_request;
  if found then
    if v.uploaded_by_user_id<>p_actor or not exists(select 1 from unit_sale_documents where id=v.document_id and sale_attempt_id=p_sale) then raise exception 'Submission reference conflict.'; end if;
    return jsonb_build_object('versionId',v.id,'path',v.storage_path,'duplicate',true);
  end if;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_authority_given_at is null and a.completion_legacy_stage is null then raise exception 'Awaiting developer authority to serve notice'; end if;
  if coalesce((p_file->>'size')::bigint,0) not between 1 and 10485760 or coalesce(p_file->>'name','') !~* '\.pdf$'
    or p_file->>'mime' is distinct from 'application/pdf' or coalesce(p_file->>'path','') not like a.building_id::text||'/'||p_sale::text||'/%' then raise exception 'Choose a PDF up to 10 MB.'; end if;
  select version.id into current_id from unit_sale_documents document join unit_sale_document_versions version on version.document_id=document.id
    where document.sale_attempt_id=p_sale and document.document_type='completion_correspondence' and document.redacted_at is null and document.superseded_at is null and version.is_current and version.redacted_at is null;
  if p_replace then
    if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements first.'; end if;
    if current_id is distinct from p_expected then raise exception 'Notice PDF changed. Refresh before replacing it.'; end if;
  else
    if a.completion_arrangements_confirmed_at is not null or a.completion_legacy_stage='arrangements' then raise exception 'Completion arrangements are already confirmed. Refresh to view them.'; end if;
    if coalesce(p_notice,'') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_due,'') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Both calendar dates are required.'; end if;
    notice_date:=p_notice::date; due_date:=p_due::date;
    if due_date<notice_date then raise exception 'Completion due date cannot be earlier than the notice issue date.'; end if;
  end if;
  vid:=public.sales_legal_register_document_before_notice(p_sale,p_actor,'completion_correspondence',p_file);
  update unit_sale_document_versions set notice_submission_id=p_request where id=vid;
  if not p_replace then
    update unit_sale_attempts set completion_notice_issued_at=notice_date,contractual_completion_date=due_date,
      completion_arrangements_confirmed_at=now(),completion_arrangements_confirmed_by=p_actor,updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_confirmed','Completion arrangements confirmed',jsonb_build_object('noticeDate',notice_date,'completionDate',due_date,'versionId',vid));
  end if;
  return jsonb_build_object('versionId',vid,'path',p_file->>'path');
end $$;
revoke all on function public.sales_legal_submit_notice(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.sales_legal_submit_notice(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) to service_role;

-- Keep stored PDFs immutable, including when trusted functions demote a version.
create function public.sales_notice_version_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from unit_sale_documents where id=old.document_id and document_type='completion_correspondence') then
    if tg_op='DELETE' or (to_jsonb(new)-array['is_current','notice_submission_id']) is distinct from (to_jsonb(old)-array['is_current','notice_submission_id'])
      or (old.notice_submission_id is not null and new.notice_submission_id is distinct from old.notice_submission_id) then raise exception 'Notice document versions are immutable.'; end if;
  end if;
  return new;
end $$;
create trigger notice_version_guard before update or delete on public.unit_sale_document_versions for each row execute function public.sales_notice_version_guard();

alter function public.sale_event_projection(public.unit_sale_workflow_events) rename to sale_event_projection_before_notice;
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if e.event_type in ('authority_notice_requested','authority_notice_given','completion_arrangements_dates_corrected') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_notice(e);
end $$;

-- Email functions below retain the established snapshot and delivery protocol.

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
  insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,sending_address,to_recipients,cc_recipients,approved_by,expires_at,proposed_completion_date)
    values(p_id,p_sale,p_kind,next_version,snap,p_email->>'subject',p_email->>'body',p_email->>'from',array[recipient],cc,p_actor,
      case when p_kind='authority' then p_date::timestamptz end,null) returning * into result;
  perform public.sales_legal_event(p_sale,p_actor,'legal_email_prepared','Email approved for sending',jsonb_build_object('emailId',p_id,'kind',p_kind,'versionNumber',next_version,'expiresAt',result.expires_at));
  return to_jsonb(result);
end $$;

create or replace function public.sales_legal_dispatch(p_id uuid,p_actor uuid,p_status text,p_message_id text default null) returns jsonb
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
    if e.kind='notice_authority' and exists(select 1 from unit_sale_attempts where id=e.sale_attempt_id and completion_authority_given_at is not null) then raise exception 'Authority to serve notice is already available.'; end if;
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
    elsif e.kind='notice_authority' then
      update unit_sale_attempts set completion_authority_given_at=now(),completion_authority_given_by=e.approved_by,updated_at=now() where id=e.sale_attempt_id;
    end if;
    perform public.sales_legal_event(e.sale_attempt_id,e.approved_by,case when e.kind='authority' and e.version>1 then 'authority_reissued' when e.kind='authority' then 'authority_issued' when e.kind='notice_authority' then 'authority_notice_given' else 'completion_instruction_sent' end,
      case when e.kind='authority' and e.version>1 then 'Fresh authority to exchange issued' when e.kind='authority' then 'Authority to exchange issued' when e.kind='notice_authority' then 'Authority to serve notice given' else 'Completion arrangements instructed' end,
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

create or replace function public.sales_legal_register_document_before_notice(p_sale uuid,p_actor uuid,p_type text,p_file jsonb) returns uuid
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
      values(p_sale,p_type,case p_type when 'completion_statement' then 'Completion statement' when 'statement_of_account' then 'Final statement of account' else 'Notice PDF' end,
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

commit;
