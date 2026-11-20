-- Staging-only activation is deliberately separate from this additive migration.
alter table workspace_commands.notification_dispatch_state
 add column stage3_active boolean not null default false,
 add column delivery_enabled_at timestamptz;


CREATE OR REPLACE FUNCTION workspace_commands.enqueue_notification(p_event text, p_source text, p_sale uuid, p_comment uuid DEFAULT NULL::uuid, p_new_mentions uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb; event_time timestamptz; event_key uuid;
begin
 if not exists(select 1 from jsonb_array_elements(workspace_commands.email_notification_catalogue()) e where e->>'id'=p_event) then raise exception 'Unknown notification event';end if;
 if p_event not in ('comment_added','comment_mentioned','reservation_approved') and not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active) then return null;end if;
 if not exists(select 1 from workspace_commands.notification_dispatch_state where enabled and activated_at is not null) then return null;end if;
 -- Preserve staging's exact test-journey boundary.
 if not exists(select 1 from workspace_commands.test_journeys j join public.unit_sale_attempts a on a.id=j.sale_id and a.building_id=j.building_id and a.unit_id=j.unit_id where a.id=p_sale and (a.redacted_at is null or (p_event='sale_fallen_through' and a.workflow_status='fallen_through'))) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-sale:'||p_sale::text,0));
 event_time:=clock_timestamp();
 context:=workspace_commands.email_notification_context(p_sale,p_comment);
 if p_new_mentions is not null then
  context:=jsonb_set(context,'{candidates}',(select coalesce(jsonb_agg(c||jsonb_build_object('mentioned',(c->>'mentioned')::boolean and (c->>'userId')::uuid=any(p_new_mentions)) order by c->>'userId'),'[]') from jsonb_array_elements(context->'candidates') c));
 end if;
 insert into workspace_commands.notification_events(source_key,event_id,sale_id,comment_id,occurred_at,audience)
 values(p_source,p_event,p_sale,p_comment,event_time,context) on conflict(source_key) do nothing returning id into event_key;
 return coalesce(event_key,(select id from workspace_commands.notification_events where source_key=p_source));
end $function$;

CREATE OR REPLACE FUNCTION workspace_commands.email_notification_context(p_sale uuid, p_comment uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare comment_record public.sale_comments%rowtype; candidates jsonb;
begin

 if not exists(select 1 from public.unit_sale_attempts where id=p_sale and (redacted_at is null or (p_comment is null and workflow_status='fallen_through'))) then
   raise exception 'Sale unavailable.' using errcode='22023';
 end if;
 if p_comment is not null then
   select * into comment_record from public.sale_comments where id=p_comment and sale_attempt_id=p_sale;
   if not found then raise exception 'Comment unavailable on this sale.' using errcode='22023'; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'userId',p.id,'email',p.email,'active',p.active,
   'roles',jsonb_build_array(case when p.role::text='admin' then 'developer' else p.role::text end),
   'canAccessSale',true,
   'canViewComment',p_comment is not null and public.sale_discussion_access(p_sale,p.id),
   'mentioned',p_comment is not null and p.id=any(coalesce(comment_record.mention_ids,'{}'::uuid[]))
 ) order by p.id),'[]'::jsonb) into candidates
 from public.profiles p
 where p.active and nullif(btrim(p.email),'') is not null
   and p.role::text in ('admin','developer','sales_agent','conveyancer')
   and public.can_access_sale(p_sale,p.id);
 return jsonb_build_object('settings',workspace_commands.email_notification_configuration(),
   'saleId',p_sale,'commentId',p_comment,'candidates',candidates);
end $function$;

CREATE OR REPLACE FUNCTION workspace_commands.notification_batch_context(p_batch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b workspace_commands.notification_batches%rowtype; data jsonb;
begin
 select * into strict b from workspace_commands.notification_batches where id=p_batch;
 select jsonb_build_object('batchId',b.id,'recipientId',b.recipient_id,'saleId',b.sale_id,'openedAt',b.opened_at,'dueAt',b.due_at,
  'buildingId',a.building_id,'unitId',a.unit_id,'building',building.name,'unit',u.unit_number,'email',p.email,'recipientName',coalesce(nullif(p.full_name,''),p.name),'recipientRole',p.role::text,
  'enrolled',exists(select 1 from workspace_commands.test_journeys j where j.sale_id=a.id and j.building_id=a.building_id and j.unit_id=a.unit_id),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventId',e.event_id,'occurredAt',e.occurred_at,'commentId',e.comment_id,'audience',e.audience,'label',(select c->>'label' from jsonb_array_elements(workspace_commands.email_notification_catalogue()) c where c->>'id'=e.event_id),
   'current',case when (a.redacted_at is null or (e.event_id='sale_fallen_through' and a.workflow_status='fallen_through')) and (e.comment_id is null or exists(select 1 from public.sale_comments where id=e.comment_id and sale_attempt_id=a.id)) then workspace_commands.email_notification_context(a.id,e.comment_id) end,
   'comment',(select jsonb_build_object('body',c.body,'author',c.author_name,'version',c.version,'createdAt',c.created_at) from public.sale_comments c where c.id=e.comment_id and c.sale_attempt_id=a.id)) order by e.sequence)
   from workspace_commands.notification_batch_items i join workspace_commands.notification_events e on e.id=i.event_id where i.batch_id=b.id),'[]'::jsonb)) into data
 from public.unit_sale_attempts a join public.units u on u.id=a.unit_id join public.buildings building on building.id=a.building_id join public.profiles p on p.id=b.recipient_id where a.id=b.sale_id;
 return data||jsonb_build_object('revision',md5(data::text));
end $function$;

-- Successful domain commands insert these audit events in their own transaction.
-- The event UUID is the occurrence identity, not a timestamp or current buyer.
create or replace function workspace_commands.workflow_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare event text; source text; pair text;
begin
 if not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active) then return new;end if;
 event:=case new.event_type
  when 'reservation_submitted' then 'reservation_submitted'
  when 'reservation_resubmitted' then 'reservation_submitted'
  when 'reservation_query_raised' then 'reservation_queried'
  when 'reservation_rejected' then 'reservation_queried'
  when 'authority_requested' then 'exchange_authority_requested'
  when 'authority_expired' then 'exchange_authority_expired'
  when 'authority_revoked' then 'exchange_authority_revoked'
  when 'exchange_recorded' then 'unit_exchanged'
  when 'authority_notice_requested' then 'notice_authority_requested'
  when 'completion_statement_uploaded' then 'completion_documents_uploaded'
  when 'completion_statement_replaced' then 'completion_documents_uploaded'
  when 'completion_draft_statement_of_account_uploaded' then 'completion_documents_uploaded'
  when 'completion_draft_statement_of_account_replaced' then 'completion_documents_uploaded'
  when 'completion_documents_query_raised' then 'completion_document_queried'
  when 'completion_documents_approved' then 'completion_documents_approved'
  when 'completion_recorded' then 'unit_legally_completed'
  when 'unit_returned_to_for_sale' then 'sale_fallen_through' end;
 if event is null then return new;end if;
 source:='workflow:'||new.id::text;
 if event='completion_documents_approved' then
  -- Both approved pointers must refer to the current, visible versions. Commands
  -- serialize approval/replacement on the sale row; pair identity also deduplicates.
  select string_agg(v.id::text,':' order by d.document_type) into pair
  from public.unit_sale_documents d join public.unit_sale_document_versions v on v.document_id=d.id
   and v.id=d.approved_version_id and v.is_current and v.redacted_at is null
  where d.sale_attempt_id=new.sale_attempt_id and d.document_type in ('completion_statement','draft_statement_of_account')
   and d.status='approved' and d.redacted_at is null and d.superseded_at is null
  having count(distinct d.document_type)=2;
  if pair is null then return new;end if;
  source:='completion-pair:'||new.sale_attempt_id::text||':'||pair;
 elsif event='exchange_authority_expired' then source:='authority-expiry:'||(new.metadata->>'emailId');
 elsif event='exchange_authority_revoked' then source:='authority-revoked:'||(new.metadata->>'emailId');
 end if;
 perform workspace_commands.enqueue_notification(event,source,new.sale_attempt_id);
 return new;
end $$;
create trigger sales_workflow_email_notification after insert on public.unit_sale_workflow_events
 for each row execute function workspace_commands.workflow_notification();

create or replace function workspace_commands.completion_date_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.contractual_completion_date is not null and new.contractual_completion_date is distinct from old.contractual_completion_date then
  -- A new occurrence ID allows A -> B -> A, while no-op/replayed commands do nothing.
  perform workspace_commands.enqueue_notification('contractual_completion_date_changed','completion-date:'||gen_random_uuid()::text,new.id);
 end if;
 return new;
end $$;
create trigger sales_completion_date_email_notification after update of contractual_completion_date on public.unit_sale_attempts
 for each row execute function workspace_commands.completion_date_notification();

create or replace function workspace_commands.handover_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare sale uuid;
begin
 select a.id into sale from public.unit_sale_attempts a where a.unit_id=new.unit_id and a.is_active and a.redacted_at is null
  and a.completed_at is not null order by a.created_at desc limit 1;
 if sale is not null then perform workspace_commands.enqueue_notification('handover_completed','handover:'||new.id::text,sale);end if;
 return new;
end $$;
create trigger sales_handover_email_notification after insert on public.handovers for each row execute function workspace_commands.handover_notification();

create or replace function workspace_commands.expire_notification_authorities() returns void
language plpgsql security definer set search_path='' as $$
declare candidate record; e public.sale_legal_emails%rowtype; a public.unit_sale_attempts%rowtype;
begin
 for candidate in select id,sale_attempt_id from public.sale_legal_emails where kind='authority' and expires_at<=clock_timestamp()
  and expiry_recorded_at is null and revoked_at is null and replaced_by is null and exchanged_at is null
  and (sent_at is not null or delivery_status='captured_test') order by expires_at limit 100 loop
  -- Same lock order as issue/revoke/exchange. Recheck after obtaining the lock.
  select * into a from public.unit_sale_attempts where id=candidate.sale_attempt_id for update;
  select * into e from public.sale_legal_emails where id=candidate.id for update;
  if a.is_active and a.redacted_at is null and a.exchanged_at is null and a.completed_at is null
   and e.expiry_recorded_at is null and e.revoked_at is null and e.replaced_by is null and e.exchanged_at is null and e.expires_at<=clock_timestamp() then
   perform set_config('app.sales_legal_write','on',true);
   update public.sale_legal_emails set expiry_recorded_at=clock_timestamp() where id=e.id;
   -- No historical expiry replay on activation. Mark older deadlines only.
   if e.expires_at>=(select delivery_enabled_at from workspace_commands.notification_dispatch_state where singleton) then
    insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,summary,metadata,created_at)
     values(a.id,a.building_id,a.unit_id,'authority_expired','Authority to exchange expired',jsonb_build_object('emailId',e.id,'versionNumber',e.version,'expiresAt',e.expires_at),e.expires_at);
   end if;
  end if;
 end loop;
end $$;


-- Captures remain independent of real delivery. No historical records are copied.
create table workspace_commands.sales_email_deliveries (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('routine','legal')),
 source_id uuid not null, sale_id uuid not null references public.unit_sale_attempts(id),
 recipient_id uuid references public.profiles(id), intended jsonb not null,
 original_mail jsonb not null, actual_destination text not null default 'carl@accoladeproperties.co.uk'
  check(actual_destination='carl@accoladeproperties.co.uk'),
 status text not null default 'queued' check(status in ('queued','sending','unknown','failed','accepted','delivered','bounced','complained','suppressed','reconciliation_required')),
 provider_payload jsonb, provider_id text, first_attempt_at timestamptz, accepted_at timestamptz, delivered_at timestamptz,
 attempts integer not null default 0, last_error text, next_attempt_at timestamptz not null default clock_timestamp(),
 worker uuid, lease_until timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(kind,source_id)
);
alter table workspace_commands.sales_email_deliveries enable row level security;
create index sales_email_deliveries_pending on workspace_commands.sales_email_deliveries(next_attempt_at) where status in ('queued','sending','unknown','failed','accepted');

create or replace function workspace_commands.capture_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare b workspace_commands.notification_batches%rowtype; person public.profiles%rowtype;
begin
 if not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active and delivery_enabled_at<=new.captured_at) then return new;end if;
 select * into b from workspace_commands.notification_batches where id=new.batch_id;
 select * into person from public.profiles where id=new.recipient_id;
 insert into workspace_commands.sales_email_deliveries(kind,source_id,sale_id,recipient_id,intended,original_mail)
 values('routine',new.batch_id,b.sale_id,new.recipient_id,
  jsonb_build_object('to',jsonb_build_array(jsonb_build_object('email',new.recipient_email,'name',coalesce(nullif(person.full_name,''),person.name),'role',person.role::text)),'cc','[]'::jsonb,'bcc','[]'::jsonb),
  jsonb_build_object('subject',new.subject,'text',new.text_body,'html',new.html_body)) on conflict(kind,source_id) do nothing;
 return new;
end $$;
create trigger notification_capture_delivery after insert on workspace_commands.notification_captures
 for each row execute function workspace_commands.capture_delivery();

create or replace function workspace_commands.queue_legal_test_delivery(p_email uuid,p_extra jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.sale_legal_emails%rowtype; result uuid; intended jsonb;
begin
 select * into strict e from public.sale_legal_emails where id=p_email;
 if not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active and delivery_enabled_at<=e.issued_at) then return null;end if;
 intended:=jsonb_build_object(
  'to',(select coalesce(jsonb_agg(jsonb_build_object('email',x,'name',e.snapshot#>>'{conveyancer,name}','role','Conveyancer')),'[]'::jsonb) from unnest(e.to_recipients) x),
  'cc',(select coalesce(jsonb_agg(jsonb_build_object('email',x,'name',e.snapshot#>>'{sales_agent,name}','role','Sales Agent')),'[]'::jsonb) from unnest(e.cc_recipients) x),
  'bcc',coalesce(p_extra->'bcc','[]'::jsonb));
 insert into workspace_commands.sales_email_deliveries(kind,source_id,sale_id,intended,original_mail)
 values('legal',e.id,e.sale_attempt_id,intended,jsonb_build_object('subject',e.subject,'text',e.body,'html',e.html_body,'from',e.sending_address,
  'attachments',coalesce(p_extra->'attachments','[]'::jsonb))) on conflict(kind,source_id) do nothing returning id into result;
 return coalesce(result,(select id from workspace_commands.sales_email_deliveries where kind='legal' and source_id=e.id));
end $$;

create or replace function workspace_commands.current_notification_items(context jsonb,p_recipient uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('eventId',v->>'id','reasons',reasons) order by ord),'[]'::jsonb) from (
  select v,ord,array(select x from unnest(workspace_commands.notification_reasons(v->'audience',v->>'eventId',p_recipient)) x
   where x=any(workspace_commands.notification_reasons(v->'current',v->>'eventId',p_recipient))) reasons
  from jsonb_array_elements(context->'events') with ordinality events(v,ord) where (context->>'enrolled')::boolean
 ) matched where cardinality(reasons)>0
$$;

create or replace function public.workspace_sales_email_delivery(p_worker uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare d workspace_commands.sales_email_deliveries%rowtype; context jsonb; eligible jsonb; e public.sale_legal_emails%rowtype; payload jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_worker is null then raise exception 'Server delivery required.' using errcode='42501';end if;
 if not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active and delivery_enabled_at is not null) then return null;end if;
 if p_action='claim' then
  select * into d from workspace_commands.sales_email_deliveries where
   (nullif(p_payload->>'id','') is null or id=(p_payload->>'id')::uuid)
   and status in ('queued','sending','unknown','failed','accepted') and next_attempt_at<=clock_timestamp()
   and (worker is null or lease_until<=clock_timestamp()) order by created_at for update skip locked limit 1;
  if not found then return null;end if;
  update workspace_commands.sales_email_deliveries set worker=p_worker,lease_until=clock_timestamp()+interval '60 seconds' where id=d.id returning * into d;
  if d.kind='routine' then context:=workspace_commands.notification_batch_context(d.source_id);end if;
  return to_jsonb(d)||jsonb_build_object('context',context);
 end if;
 select * into strict d from workspace_commands.sales_email_deliveries where id=(p_payload->>'id')::uuid for update;
 if d.worker is distinct from p_worker or d.lease_until<=clock_timestamp() then raise exception 'Delivery lease expired.' using errcode='40001';end if;
 if p_action='release_for_send' then
  if d.provider_id is not null then return jsonb_build_object('send',false,'providerId',d.provider_id);end if;
  if d.first_attempt_at<clock_timestamp()-interval '23 hours' then
   update workspace_commands.sales_email_deliveries set status='reconciliation_required',worker=null,lease_until=null,last_error='Provider idempotency window ended; reconcile before any further send.' where id=d.id;
   return jsonb_build_object('send',false);
  end if;
  if d.kind='routine' then
   perform pg_advisory_xact_lock(hashtextextended('notification-sale:'||d.sale_id::text,0));
   context:=workspace_commands.notification_batch_context(d.source_id);
   eligible:=workspace_commands.current_notification_items(context,d.recipient_id);
   if jsonb_array_length(eligible)=0 or (d.first_attempt_at is not null and eligible is distinct from (select items from workspace_commands.notification_captures where batch_id=d.source_id)) then
    update workspace_commands.sales_email_deliveries set status=case when first_attempt_at is null then 'suppressed' else 'reconciliation_required' end,worker=null,lease_until=null,last_error='Recipient eligibility changed before release.' where id=d.id;
    return jsonb_build_object('send',false);
   end if;
   if d.first_attempt_at is null then
    if context->>'revision' is distinct from p_payload->>'revision' or eligible is distinct from p_payload->'items' then raise exception 'Recheck delivery eligibility.' using errcode='40001';end if;
    update workspace_commands.notification_captures set subject=p_payload#>>'{mail,subject}',text_body=p_payload#>>'{mail,text}',html_body=p_payload#>>'{mail,html}',items=eligible,recipient_email=context->>'email' where batch_id=d.source_id;
    d.original_mail:=p_payload->'mail';
    d.intended:=jsonb_build_object('to',jsonb_build_array(jsonb_build_object('email',context->>'email','name',context->>'recipientName','role',context->>'recipientRole')),'cc','[]'::jsonb,'bcc','[]'::jsonb);
   end if;
  else
   select * into e from public.sale_legal_emails where id=d.source_id;
   if e.revoked_at is not null or e.replaced_by is not null or e.expires_at<=clock_timestamp() then
    update workspace_commands.sales_email_deliveries set status=case when first_attempt_at is null then 'suppressed' else 'reconciliation_required' end,worker=null,lease_until=null,last_error='Formal instruction is no longer available.' where id=d.id;
    return jsonb_build_object('send',false);
   end if;
  end if;
  payload:=coalesce(d.provider_payload,p_payload->'providerPayload');
  if payload->'to' is distinct from '["carl@accoladeproperties.co.uk"]'::jsonb or payload->'cc' is distinct from '[]'::jsonb or payload->'bcc' is distinct from '[]'::jsonb
   or payload->>'reply_to' is distinct from 'carl@accoladeproperties.co.uk' or payload->>'subject' not like '[STAGING] %' then raise exception 'Unsafe staging provider payload.';end if;
  update workspace_commands.sales_email_deliveries set provider_payload=payload,original_mail=d.original_mail,intended=d.intended,
   first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),attempts=attempts+1,status='sending',updated_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('send',true,'payload',payload,'idempotencyKey','staging-sales/'||d.kind||'/'||d.source_id::text);
 elsif p_action='result' then
  if p_payload->>'status' not in ('unknown','failed','accepted','delivered','bounced','complained') then raise exception 'Unsupported delivery result';end if;
  if p_payload->>'status' in ('accepted','delivered') and coalesce(d.provider_id,p_payload->>'providerId') is null then raise exception 'Provider ID required';end if;
  update workspace_commands.sales_email_deliveries set status=p_payload->>'status',provider_id=coalesce(provider_id,p_payload->>'providerId'),
   accepted_at=case when p_payload->>'status' in ('accepted','delivered') then coalesce(accepted_at,clock_timestamp()) else accepted_at end,
   delivered_at=case when p_payload->>'status'='delivered' then coalesce(delivered_at,clock_timestamp()) else delivered_at end,
   last_error=left(p_payload->>'error',200),next_attempt_at=clock_timestamp()+interval '1 minute',worker=null,lease_until=null,updated_at=clock_timestamp() where id=d.id returning * into d;
  return jsonb_build_object('id',d.id,'status',d.status,'actualDestination',d.actual_destination,'acceptedAt',d.accepted_at,'deliveredAt',d.delivered_at);
 end if;
 raise exception 'Unknown delivery action';
end $$;
revoke all on function public.workspace_sales_email_delivery(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_sales_email_delivery(uuid,text,jsonb) to service_role;

create or replace function public.workspace_legal_test_delivery(p_sale uuid,p_actor uuid,p_action text default 'status',p_email uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501';end if;
 perform public.sales_legal_assert(p_sale,p_actor);
 if p_action='retry' then
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  if not exists(select 1 from workspace_commands.sales_email_deliveries where kind='legal' and source_id=p_email and sale_id=p_sale) then raise exception 'No redirected delivery exists. Historical correspondence is not replayed.';end if;
  update workspace_commands.sales_email_deliveries set next_attempt_at=clock_timestamp() where kind='legal' and source_id=p_email and sale_id=p_sale and status in ('queued','failed','unknown','accepted');
 elsif p_action<>'status' then raise exception 'Invalid delivery operation';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'emailId',source_id,'status',status,'actualDestination',actual_destination,'intended',intended,'acceptedAt',accepted_at,'deliveredAt',delivered_at,'lastError',last_error) order by created_at),'[]'::jsonb) into result
  from workspace_commands.sales_email_deliveries where kind='legal' and sale_id=p_sale;
 return result;
end $$;
revoke all on function public.workspace_legal_test_delivery(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.workspace_legal_test_delivery(uuid,uuid,text,uuid) to service_role;


alter function public.workspace_notification_worker(uuid,text,jsonb) rename to workspace_notification_worker_v2;
revoke all on function public.workspace_notification_worker_v2(uuid,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.workspace_notification_worker(p_worker uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare active boolean; result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server dispatcher required.' using errcode='42501';end if;
 select stage3_active into active from workspace_commands.notification_dispatch_state where singleton;
 if active and p_payload->>'protocol' is distinct from '3' then return jsonb_build_object('claimed',false,'upgradeRequired',true);end if;
 result:=public.workspace_notification_worker_v2(p_worker,p_action,p_payload);
 if p_action='claim' and (result->>'claimed')::boolean and active then perform workspace_commands.expire_notification_authorities();end if;
 return result;
end $$;
revoke all on function public.workspace_notification_worker(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_notification_worker(uuid,text,jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.workspace_capture_legal_email(p_sale uuid, p_actor uuid, p_request uuid, p_kind text, p_snapshot jsonb, p_email jsonb, p_date text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'workspace_commands'
AS $function$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; prior workspace_commands.test_deliveries%rowtype; logical_input jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
 select * into a from unit_sale_attempts where id=p_sale for update;
 if not exists(select 1 from workspace_commands.notification_dispatch_state where stage3_active) then raise exception 'Staging issue is not activated.';end if;
 if p_kind not in ('authority','notice_authority') or p_request is null then raise exception 'Unsupported test capture.'; end if;
 logical_input:=jsonb_build_object('kind',p_kind,'snapshot',p_snapshot,'email',p_email,'date',p_date);
 select * into prior from workspace_commands.test_deliveries where email_id=p_request;
 if found then
  if prior.sale_id<>p_sale or prior.actor_id<>p_actor or prior.request_input is distinct from logical_input then raise exception 'Capture reference conflict.'; end if;
  return jsonb_build_object('emailId',p_request,'deliveryStatus','captured_test','sent',false);
 end if;
 if exists(select 1 from sale_legal_emails where id=p_request) then raise exception 'Capture reference already belongs to another operation.'; end if;

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
 perform public.sales_legal_event(p_sale,p_actor,'integration_correspondence_captured','Staging test copy issued to carl@accoladeproperties.co.uk; intended recipients were not served',jsonb_build_object('emailId',e.id,'kind',p_kind,'deliveryStatus','captured_test','actualDestination','carl@accoladeproperties.co.uk','intendedRecipientsServed',false));
 perform workspace_commands.queue_legal_test_delivery(e.id,p_email);
 return jsonb_build_object('emailId',e.id,'deliveryStatus','captured_test','sent',false);
end $function$;

CREATE OR REPLACE FUNCTION workspace_commands.captured_authority(p_id uuid, p_sale uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from workspace_commands.test_deliveries c

 join public.sale_legal_emails e on e.id=c.email_id
 where e.id=p_id and c.sale_id=p_sale and e.sale_attempt_id=p_sale
 and (exists(select 1 from workspace_commands.test_journeys j where j.sale_id=c.sale_id) or exists(select 1 from workspace_commands.sales_email_deliveries x where x.kind='legal' and x.source_id=e.id and x.sale_id=p_sale)) and e.delivery_status='captured_test' and e.sent_at is null and e.resend_message_id is null);
$function$;

-- Private helpers have no externally callable surface.
revoke all on function workspace_commands.workflow_notification(),workspace_commands.completion_date_notification(),workspace_commands.handover_notification(),workspace_commands.expire_notification_authorities(),workspace_commands.capture_delivery(),workspace_commands.queue_legal_test_delivery(uuid,jsonb),workspace_commands.current_notification_items(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on workspace_commands.sales_email_deliveries from public,anon,authenticated,service_role;
