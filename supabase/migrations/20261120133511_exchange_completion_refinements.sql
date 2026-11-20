-- Staging workflow refinements. Apply only with the matching application release.
alter table public.building_sale_defaults add column notice_working_days integer not null default 10 check (notice_working_days between 1 and 90), add column notice_service_provision text not null default '';
alter table public.unit_sale_attempts add column completion_service_date date, add column completion_basis text check (completion_basis in ('on_notice','fixed_date')), add column completion_deadline_reason text;

create function workspace_commands.notice_deadline(p_service date,p_days integer) returns date language plpgsql immutable set search_path='' as $$
declare d date:=p_service; n integer:=p_days;
begin
 if p_service is null or p_days not between 1 and 90 then return null;end if;
 while n>0 loop
  d:=d+1;
  if extract(year from d) not between 2019 and 2028 then return null;end if;
  if extract(isodow from d)<6 and not d=any(array['2019-01-01'::date,'2019-04-19'::date,'2019-04-22'::date,'2019-05-06'::date,'2019-05-27'::date,'2019-08-26'::date,'2019-12-25'::date,'2019-12-26'::date,'2020-01-01'::date,'2020-04-10'::date,'2020-04-13'::date,'2020-05-08'::date,'2020-05-25'::date,'2020-08-31'::date,'2020-12-25'::date,'2020-12-28'::date,'2021-01-01'::date,'2021-04-02'::date,'2021-04-05'::date,'2021-05-03'::date,'2021-05-31'::date,'2021-08-30'::date,'2021-12-27'::date,'2021-12-28'::date,'2022-01-03'::date,'2022-04-15'::date,'2022-04-18'::date,'2022-05-02'::date,'2022-06-02'::date,'2022-06-03'::date,'2022-08-29'::date,'2022-09-19'::date,'2022-12-26'::date,'2022-12-27'::date,'2023-01-02'::date,'2023-04-07'::date,'2023-04-10'::date,'2023-05-01'::date,'2023-05-08'::date,'2023-05-29'::date,'2023-08-28'::date,'2023-12-25'::date,'2023-12-26'::date,'2024-01-01'::date,'2024-03-29'::date,'2024-04-01'::date,'2024-05-06'::date,'2024-05-27'::date,'2024-08-26'::date,'2024-12-25'::date,'2024-12-26'::date,'2025-01-01'::date,'2025-04-18'::date,'2025-04-21'::date,'2025-05-05'::date,'2025-05-26'::date,'2025-08-25'::date,'2025-12-25'::date,'2025-12-26'::date,'2026-01-01'::date,'2026-04-03'::date,'2026-04-06'::date,'2026-05-04'::date,'2026-05-25'::date,'2026-08-31'::date,'2026-12-25'::date,'2026-12-28'::date,'2027-01-01'::date,'2027-03-26'::date,'2027-03-29'::date,'2027-05-03'::date,'2027-05-31'::date,'2027-08-30'::date,'2027-12-27'::date,'2027-12-28'::date,'2028-01-03'::date,'2028-04-14'::date,'2028-04-17'::date,'2028-05-01'::date,'2028-05-29'::date,'2028-08-28'::date,'2028-12-25'::date,'2028-12-26'::date]) then n:=n-1;end if;
 end loop;return d;
end $$;
revoke all on function workspace_commands.notice_deadline(date,integer) from public,anon,authenticated;

create function workspace_commands.validate_notice(p_sale uuid,p_notice date,p_due date,p_terms jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare days integer; service date; expected date; reason text:=btrim(coalesce(p_terms->>'reason','')); basis text:=p_terms->>'basis';
begin
 select coalesce(d.notice_working_days,10) into days from public.unit_sale_attempts a left join public.building_sale_defaults d on d.building_id=a.building_id where a.id=p_sale;
 if p_notice is null or p_due is null or basis is null or basis not in ('on_notice','fixed_date') then raise exception 'Valid notice dates and completion basis required.';end if;
 if length(reason)>2000 then raise exception 'Reason must be at most 2000 characters.';end if;
 if basis='fixed_date' then
  if reason='' then raise exception 'Record the fixed-date agreement reference.';end if;
 else
  service:=nullif(p_terms->>'serviceDate','')::date;
  if service is null or service<p_notice or p_terms->>'serviceConfirmed' is distinct from 'true' then raise exception 'Confirm valid service against the contract.';end if;
  if p_due<=service then raise exception 'Completion deadline must follow valid service.';end if;
  expected:=workspace_commands.notice_deadline(service,days);
  if (expected is null or p_due<>expected) and reason='' then raise exception 'A contractual deadline override requires a reason.';end if;
 end if;
 return jsonb_build_object('serviceDate',service,'basis',basis,'reason',reason,'workingDays',days,'calculatedDeadline',expected,'overridden',basis='on_notice' and p_due is distinct from expected,'filenameMismatchConfirmed',p_terms->'filenameMismatchConfirmed');
end $$;
revoke all on function workspace_commands.validate_notice(uuid,date,date,jsonb) from public,anon,authenticated;

alter function public.sales_legal_submit_notice(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) rename to sales_legal_submit_notice_before_contract;
revoke all on function public.sales_legal_submit_notice_before_contract(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_submit_notice(p_sale uuid,p_actor uuid,p_request uuid,p_file jsonb,p_notice text default null,p_due text default null,p_replace boolean default false,p_expected uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare terms jsonb; result jsonb;
begin
 perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
 perform 1 from public.unit_sale_attempts where id=p_sale for update;
 if exists(select 1 from public.unit_sale_document_versions where notice_submission_id=p_request) then return public.sales_legal_submit_notice_before_contract(p_sale,p_actor,p_request,p_file,p_notice,p_due,p_replace,p_expected);end if;
 if not p_replace then
  terms:=workspace_commands.validate_notice(p_sale,p_notice::date,p_due::date,p_file->'noticeTerms');
  perform set_config('app.notice_contract',terms::text,true);
 end if;
 result:=public.sales_legal_submit_notice_before_contract(p_sale,p_actor,p_request,p_file,p_notice,p_due,p_replace,p_expected);
 if not p_replace then update public.unit_sale_attempts set completion_service_date=(terms->>'serviceDate')::date,completion_basis=terms->>'basis',completion_deadline_reason=terms->>'reason' where id=p_sale;end if;
 perform set_config('app.notice_contract','',true);
 return result;
end $$;
revoke all on function public.sales_legal_submit_notice(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.sales_legal_submit_notice(uuid,uuid,uuid,jsonb,text,text,boolean,uuid) to service_role;

alter function public.sales_legal_action(uuid,text,jsonb,uuid) rename to sales_legal_action_before_contract;
revoke all on function public.sales_legal_action_before_contract(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb language plpgsql security definer set search_path='' as $$
declare terms jsonb; result jsonb; previous jsonb;
begin
 if p_action='correct_completion_dates' then
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select to_jsonb(a) into previous from public.unit_sale_attempts a where id=p_sale for update;
  if btrim(coalesce(p_payload->>'reason',''))='' then raise exception 'A correction reason is required.';end if;
  terms:=workspace_commands.validate_notice(p_sale,(p_payload->>'noticeDate')::date,(p_payload->>'date')::date,p_payload)||jsonb_build_object('previousServiceDate',previous->'completion_service_date','previousBasis',previous->'completion_basis','previousReason',previous->'completion_deadline_reason');
  perform set_config('app.notice_contract',terms::text,true);
 end if;
 result:=public.sales_legal_action_before_contract(p_sale,p_action,p_payload,p_actor);
 if p_action='correct_completion_dates' then
  perform set_config('app.sales_legal_write','on',true);
  if result->>'unchanged'='true' and (previous->>'completion_service_date',previous->>'completion_basis',previous->>'completion_deadline_reason') is distinct from (terms->>'serviceDate',terms->>'basis',terms->>'reason') then
   perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_dates_corrected','Contractual service details corrected',terms||jsonb_build_object('noticeDate',p_payload->>'noticeDate','completionDate',p_payload->>'date'));
  end if;
  update public.unit_sale_attempts set completion_service_date=(terms->>'serviceDate')::date,completion_basis=terms->>'basis',completion_deadline_reason=terms->>'reason' where id=p_sale;
  perform set_config('app.notice_contract','',true);
 end if;
 return result;
end $$;
revoke all on function public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;

-- Snapshot only meaningful lifecycle data; never copy arbitrary commercial metadata.
create function workspace_commands.lifecycle_details() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.unit_sale_attempts%rowtype; details jsonb;
begin
 select * into a from public.unit_sale_attempts where id=new.sale_attempt_id;
 if new.event_type in ('exchange_recorded','completion_recorded') then new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('purchaser',coalesce(nullif(a.buyer_person_name,''),nullif(a.buyer_company_name,'')));end if;
 if new.event_type in ('completion_arrangements_confirmed','completion_arrangements_dates_corrected') then
  details:=nullif(current_setting('app.notice_contract',true),'')::jsonb;
  new.metadata:=coalesce(new.metadata,'{}')||coalesce(details,'{}');
 end if;
 return new;
end $$;
revoke all on function workspace_commands.lifecycle_details() from public,anon,authenticated;
create trigger lifecycle_details before insert on public.unit_sale_workflow_events for each row execute function workspace_commands.lifecycle_details();

-- Extend the existing building defaults write, retaining its locks and audit.
do $patch$
declare d text;
begin
 select pg_get_functiondef('public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb)'::regprocedure) into d;
 if position('defaults_value:=p_payload->''defaults'';' in d)=0 then raise exception 'Setup definition changed';end if;
 d:=replace(d,'defaults_value:=p_payload->''defaults'';','defaults_value:=p_payload->''defaults''; if coalesce((defaults_value->>''notice_working_days'')::integer,10) not between 1 and 90 then raise exception ''Notice period must be 1–90 working days.'';end if;');
 d:=replace(d,'further_deposit_timing)'||chr(10),'further_deposit_timing,notice_working_days,notice_service_provision)'||chr(10));
 d:=replace(d,'defaults_value->''further_deposit_timing'')','defaults_value->''further_deposit_timing'',coalesce((defaults_value->>''notice_working_days'')::integer,10),coalesce(defaults_value->>''notice_service_provision'',''''))');
 d:=replace(d,'further_deposit_timing=excluded.further_deposit_timing,updated_at=now()','further_deposit_timing=excluded.further_deposit_timing,notice_working_days=excluded.notice_working_days,notice_service_provision=excluded.notice_service_provision,updated_at=now()');
 execute d;
end $patch$;

alter table workspace_commands.notification_events add column details jsonb;
create or replace function workspace_commands.completion_date_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare source text; actor text; terms jsonb;
begin
 if new.contractual_completion_date is not null and new.contractual_completion_date is distinct from old.contractual_completion_date then
  source:='completion-date:'||gen_random_uuid()::text;
  select coalesce(nullif(full_name,''),nullif(name,'')) into actor from public.profiles where id=new.updated_by_user_id;
  terms:=nullif(current_setting('app.notice_contract',true),'')::jsonb;
  perform workspace_commands.enqueue_notification('contractual_completion_date_changed',source,new.id);
  update workspace_commands.notification_events set details=jsonb_strip_nulls(jsonb_build_object('actor',actor,'oldDate',old.contractual_completion_date,'newDate',new.contractual_completion_date,'noticeDate',new.completion_notice_issued_at,'serviceDate',terms->>'serviceDate','basis',terms->>'basis','noticeRecorded',old.completion_arrangements_confirmed_at is null and new.completion_arrangements_confirmed_at is not null)) where source_key=source and sale_id=new.id;
 end if;return new;
end $$;

-- A bounded projection from persisted event data; recipient eligibility is unchanged.
do $patch$
declare d text; marker text:='''occurredAt'',e.occurred_at,';
begin
 select pg_get_functiondef('workspace_commands.notification_batch_context(uuid)'::regprocedure) into d;
 if position(marker in d)=0 then raise exception 'Notification context changed';end if;
 d:=replace(d,marker,marker||'''details'',coalesce(e.details,(select jsonb_strip_nulls(jsonb_build_object(''actor'',coalesce(nullif(p.full_name,''''),nullif(w.actor_name,''''),nullif(p.name,'''')),''exchangeDate'',w.metadata->>''exchangeDate'',''completionDate'',w.metadata->>''completionDate'',''purchaser'',w.metadata->>''purchaser'',''fileName'',w.metadata->>''fileName'',''versionNumber'',w.metadata->>''versionNumber'',''documentType'',w.metadata->>''documentType'')) from public.unit_sale_workflow_events w left join public.profiles p on p.id=w.created_by_user_id where e.source_key=''workflow:''||w.id::text and w.sale_attempt_id=a.id)),');
 execute d;
end $patch$;

-- New contractual fields use the same command-only write gate as existing dates.
create function workspace_commands.notice_fields_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.completion_service_date,new.completion_basis,new.completion_deadline_reason) is distinct from (old.completion_service_date,old.completion_basis,old.completion_deadline_reason) and coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the legal workflow to change contractual service details.';end if;
 return new;
end $$;
revoke all on function workspace_commands.notice_fields_guard() from public,anon,authenticated;
create trigger notice_fields_guard before update of completion_service_date,completion_basis,completion_deadline_reason on public.unit_sale_attempts for each row execute function workspace_commands.notice_fields_guard();
