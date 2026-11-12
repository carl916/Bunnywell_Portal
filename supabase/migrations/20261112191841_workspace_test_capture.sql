begin;
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
 or coalesce(a.buyer_person_name,'') not like 'Fictional Integration %' or coalesce(a.buyer_email,'') not like '%@example.invalid'
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
commit;
