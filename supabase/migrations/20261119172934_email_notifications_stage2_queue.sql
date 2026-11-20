-- Staging capture only. Activation/scheduling is a separate release step.
begin;
create table workspace_commands.notification_dispatch_state (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 activated_at timestamptz, worker uuid, lease_until timestamptz
);
insert into workspace_commands.notification_dispatch_state(singleton) values(true);
create table workspace_commands.notification_events (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 source_key text not null unique, event_id text not null,
 sale_id uuid not null references public.unit_sale_attempts(id), comment_id uuid references public.sale_comments(id),
 occurred_at timestamptz not null, audience jsonb not null, fanout_at timestamptz
);
create index notification_events_pending on workspace_commands.notification_events(sequence) where fanout_at is null;
create index notification_events_sale_pending on workspace_commands.notification_events(sale_id,occurred_at) where fanout_at is null;
create table workspace_commands.notification_explicit_mentions (
 comment_id uuid not null references public.sale_comments(id), user_id uuid not null references public.profiles(id),
 primary key(comment_id,user_id)
);
create table workspace_commands.notification_batches (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
 sale_id uuid not null references public.unit_sale_attempts(id), opened_at timestamptz not null, due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','captured','suppressed')), finished_at timestamptz,
 check(due_at=opened_at+interval '5 minutes'), unique(recipient_id,sale_id,opened_at)
);
create index notification_batches_due on workspace_commands.notification_batches(due_at) where status='pending';
create index notification_batches_window on workspace_commands.notification_batches(recipient_id,sale_id,opened_at,due_at);
create table workspace_commands.notification_batch_items (
 event_id uuid not null references workspace_commands.notification_events(id), recipient_id uuid not null references public.profiles(id),
 batch_id uuid not null references workspace_commands.notification_batches(id), primary key(event_id,recipient_id)
);
create index notification_items_batch on workspace_commands.notification_batch_items(batch_id);
create table workspace_commands.notification_captures (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null unique references workspace_commands.notification_batches(id),
 recipient_id uuid not null references public.profiles(id), recipient_email text not null,
 subject text not null, html_body text not null, text_body text not null, items jsonb not null,
 captured_at timestamptz not null default clock_timestamp(), delivery_status text not null default 'captured_test' check(delivery_status='captured_test'),
 external_delivery boolean not null default false check(not external_delivery)
);
create table workspace_commands.notification_worker_runs (
 id uuid primary key, started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 result jsonb, source text not null default 'staging_scheduler'
);
do $$ declare t text;begin
 foreach t in array array['notification_dispatch_state','notification_events','notification_explicit_mentions','notification_batches','notification_batch_items','notification_captures','notification_worker_runs'] loop
  execute format('alter table workspace_commands.%I enable row level security',t);
  execute format('revoke all on workspace_commands.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Move the existing trusted context implementation behind its service-only wrapper.
alter function public.workspace_email_notification_context(uuid,uuid) set schema workspace_commands;
alter function workspace_commands.workspace_email_notification_context(uuid,uuid) rename to email_notification_context;
-- Remove only the service-JWT check in the private helper, so transaction triggers
-- can snapshot eligible facts for an authenticated comment author.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('workspace_commands.email_notification_context(uuid,uuid)'::regprocedure);
 definition:=replace(definition, E' if auth.jwt()->>''role'' is distinct from ''service_role'' then\n   raise exception ''Server notification selection required.'' using errcode=''42501'';\n end if;', '');
 if definition like '%Server notification selection required.%' then raise exception 'Unexpected Stage 1 context definition';end if;
 execute definition;
end $$;
revoke all on function workspace_commands.email_notification_context(uuid,uuid) from public,anon,authenticated,service_role;
create function public.workspace_email_notification_context(p_sale uuid,p_comment uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server notification selection required.' using errcode='42501';end if;
 return workspace_commands.email_notification_context(p_sale,p_comment);
end $$;
revoke all on function public.workspace_email_notification_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_email_notification_context(uuid,uuid) to service_role;

-- SQL validation at the final capture boundary mirrors the pure Stage 1 selector.
-- The worker also calls resolveEmailNotificationRecipients immediately before capture.
create function workspace_commands.notification_reasons(p_context jsonb,p_event text,p_user uuid) returns text[]
language sql immutable set search_path='' as $$
 with person as (select c from jsonb_array_elements(p_context->'candidates') c where c->>'userId'=p_user::text),
 event as (select e from jsonb_array_elements(p_context->'settings'->'events') e where e->>'id'=p_event),
 eligible as (select c,e from person,event where (c->>'active')::boolean and (c->>'canAccessSale')::boolean
   and nullif(btrim(c->>'email'),'') is not null
   and (p_event not in ('comment_added','comment_mentioned') or ((c->>'canViewComment')::boolean and p_context->>'commentId' is not null)))
 select coalesce(array_agg(reason order by ordinal),'{}'::text[]) from (
  select p_event reason,1 ordinal from eligible where e->>'kind'='roles' and exists(select 1 from jsonb_array_elements_text(c->'roles') r where e->'roles' ? r)
  union all select 'comment_mentioned',2 from eligible where p_event in ('comment_added','comment_mentioned') and (c->>'mentioned')::boolean
   and exists(select 1 from jsonb_array_elements(p_context->'settings'->'events') m where m->>'id'='comment_mentioned' and (m->>'enabled')::boolean)
 ) reasons
$$;

-- Stage 3 entry point: call from the same transaction as an authorised business
-- transition, with a stable unique source key. Expand this allowlist deliberately.
create function workspace_commands.enqueue_notification(p_event text,p_source text,p_sale uuid,p_comment uuid default null,p_new_mentions uuid[] default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare context jsonb; event_time timestamptz; event_key uuid;
begin
 if p_event not in ('comment_added','comment_mentioned','reservation_approved') then raise exception 'Notification event is not activated';end if;
 if not exists(select 1 from workspace_commands.notification_dispatch_state where enabled and activated_at is not null) then return null;end if;
 -- Preserve staging's exact test-journey boundary.
 if not exists(select 1 from workspace_commands.test_journeys j join public.unit_sale_attempts a on a.id=j.sale_id and a.building_id=j.building_id and a.unit_id=j.unit_id where a.id=p_sale and a.redacted_at is null) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-sale:'||p_sale::text,0));
 event_time:=clock_timestamp();
 context:=workspace_commands.email_notification_context(p_sale,p_comment);
 if p_new_mentions is not null then
  context:=jsonb_set(context,'{candidates}',(select coalesce(jsonb_agg(c||jsonb_build_object('mentioned',(c->>'mentioned')::boolean and (c->>'userId')::uuid=any(p_new_mentions)) order by c->>'userId'),'[]') from jsonb_array_elements(context->'candidates') c));
 end if;
 insert into workspace_commands.notification_events(source_key,event_id,sale_id,comment_id,occurred_at,audience)
 values(p_source,p_event,p_sale,p_comment,event_time,context) on conflict(source_key) do nothing returning id into event_key;
 return coalesce(event_key,(select id from workspace_commands.notification_events where source_key=p_source));
end $$;

create function workspace_commands.queue_comment_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare added uuid[];
begin
 -- Only explicit IDs on the comment count. In-app notification rows are not inputs.
 with inserted as (
  insert into workspace_commands.notification_explicit_mentions(comment_id,user_id)
  select new.id,x from unnest(new.mention_ids) x
  where tg_op='INSERT' or not x=any(old.mention_ids)
  on conflict do nothing returning user_id
 ) select coalesce(array_agg(user_id),'{}') into added from inserted;
 if tg_op='INSERT' then
  perform workspace_commands.enqueue_notification('comment_added','comment:'||new.id::text,new.sale_attempt_id,new.id,added);
 elsif cardinality(added)>0 then
  perform workspace_commands.enqueue_notification('comment_mentioned','comment-tags:'||new.id::text||':'||new.version::text,new.sale_attempt_id,new.id,added);
 end if;
 return new;
end $$;
-- Record existing tags without producing historical events.
insert into workspace_commands.notification_explicit_mentions(comment_id,user_id)
 select c.id,p.id from public.sale_comments c join public.profiles p on p.id=any(c.mention_ids) on conflict do nothing;
create trigger queue_comment_email after insert or update of mention_ids on public.sale_comments for each row execute function workspace_commands.queue_comment_notification();

-- Keep the existing approval command intact; wrap its committed result and receipts.
alter function public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) set schema workspace_commands;
alter function workspace_commands.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) rename to reservation_command_before_notifications;
revoke all on function workspace_commands.reservation_command_before_notifications(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.workspace_reservation_command(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_expected timestamptz,p_payload jsonb default '{}',p_expected_terms jsonb default null,p_expected_defaults jsonb default null,p_terms jsonb default null,p_schedule jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; replay boolean;
begin
 select exists(select 1 from workspace_commands.receipts where id=p_request) into replay;
 result:=workspace_commands.reservation_command_before_notifications(p_building,p_unit,p_sale,p_actor,p_request,p_action,p_expected,p_payload,p_expected_terms,p_expected_defaults,p_terms,p_schedule);
 if p_action='approve_reservation' and not replay then
  perform workspace_commands.enqueue_notification('reservation_approved','reservation-approved:'||p_request::text,p_sale);
 end if;
 return result;
end $$;
revoke all on function public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

create function workspace_commands.notification_batch_context(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b workspace_commands.notification_batches%rowtype; data jsonb;
begin
 select * into strict b from workspace_commands.notification_batches where id=p_batch;
 select jsonb_build_object('batchId',b.id,'recipientId',b.recipient_id,'saleId',b.sale_id,'openedAt',b.opened_at,'dueAt',b.due_at,
  'buildingId',a.building_id,'unitId',a.unit_id,'building',building.name,'unit',u.unit_number,'email',p.email,
  'enrolled',exists(select 1 from workspace_commands.test_journeys j where j.sale_id=a.id and j.building_id=a.building_id and j.unit_id=a.unit_id),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventId',e.event_id,'occurredAt',e.occurred_at,'commentId',e.comment_id,'audience',e.audience,
   'current',case when a.redacted_at is null and (e.comment_id is null or exists(select 1 from public.sale_comments where id=e.comment_id and sale_attempt_id=a.id)) then workspace_commands.email_notification_context(a.id,e.comment_id) end,
   'comment',(select jsonb_build_object('body',c.body,'author',c.author_name,'version',c.version,'createdAt',c.created_at) from public.sale_comments c where c.id=e.comment_id and c.sale_attempt_id=a.id)) order by e.sequence)
   from workspace_commands.notification_batch_items i join workspace_commands.notification_events e on e.id=i.event_id where i.batch_id=b.id),'[]'::jsonb)) into data
 from public.unit_sale_attempts a join public.units u on u.id=a.unit_id join public.buildings building on building.id=a.building_id join public.profiles p on p.id=b.recipient_id where a.id=b.sale_id;
 return data||jsonb_build_object('revision',md5(data::text));
end $$;

-- One durable, expiring worker lease orders fanout. Every state change checks the
-- lease, and each fanout/capture is a separate atomic/idempotent transaction.
create function public.workspace_notification_worker(p_worker uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare state workspace_commands.notification_dispatch_state%rowtype; e workspace_commands.notification_events%rowtype;
 b workspace_commands.notification_batches%rowtype; person record; chosen uuid; context jsonb; eligible jsonb; response jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_worker is null then raise exception 'Server dispatcher required.' using errcode='42501';end if;
 select * into strict state from workspace_commands.notification_dispatch_state where singleton for update;
 if not state.enabled then return jsonb_build_object('enabled',false);end if;
 if p_action='claim' then
  if state.worker is not null and state.lease_until>clock_timestamp() then return jsonb_build_object('claimed',false);end if;
  update workspace_commands.notification_dispatch_state set worker=p_worker,lease_until=clock_timestamp()+interval '60 seconds' where singleton;
  insert into workspace_commands.notification_worker_runs(id) values(p_worker);
  return jsonb_build_object('claimed',true);
 end if;
 if state.worker is distinct from p_worker or state.lease_until<=clock_timestamp() then raise exception 'Dispatcher lease expired.' using errcode='40001';end if;
 update workspace_commands.notification_dispatch_state set lease_until=clock_timestamp()+interval '60 seconds' where singleton;
 if p_action='release' then
  update workspace_commands.notification_worker_runs set finished_at=clock_timestamp(),result=p_payload where id=p_worker;
  update workspace_commands.notification_dispatch_state set worker=null,lease_until=null where singleton;
  return jsonb_build_object('released',true);
 elsif p_action='next_event' then
  return (select to_jsonb(t) from workspace_commands.notification_events t where fanout_at is null order by sequence limit 1);
 elsif p_action='fanout' then
  select * into strict e from workspace_commands.notification_events where id=(p_payload->>'eventId')::uuid for update;
  if e.fanout_at is not null then return jsonb_build_object('done',true);end if;
  if exists(select 1 from workspace_commands.notification_events where fanout_at is null and sale_id=e.sale_id and sequence<e.sequence) then raise exception 'Process earlier sale events first';end if;
  for person in select (c->>'userId')::uuid id from jsonb_array_elements(e.audience->'candidates') c
   where cardinality(workspace_commands.notification_reasons(e.audience,e.event_id,(c->>'userId')::uuid))>0 loop
   if not (p_payload->'recipientIds' ? person.id::text) then raise exception 'Resolver omitted an eligible recipient';end if;
   select * into b from workspace_commands.notification_batches where recipient_id=person.id and sale_id=e.sale_id and opened_at<=e.occurred_at and due_at>e.occurred_at order by opened_at desc limit 1;
   if found and b.status<>'pending' then raise exception 'Earlier batch already finished';end if;
   if not found then
    insert into workspace_commands.notification_batches(recipient_id,sale_id,opened_at,due_at) values(person.id,e.sale_id,e.occurred_at,e.occurred_at+interval '5 minutes') returning * into b;
   end if;
   insert into workspace_commands.notification_batch_items(event_id,recipient_id,batch_id) values(e.id,person.id,b.id) on conflict do nothing;
  end loop;
  update workspace_commands.notification_events set fanout_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('done',true);
 elsif p_action='next_batch' then
  select t.id into chosen from workspace_commands.notification_batches t where t.status='pending' and t.due_at<=clock_timestamp()
   and not exists(select 1 from workspace_commands.notification_events x where x.sale_id=t.sale_id and x.fanout_at is null and x.occurred_at<t.due_at) order by t.due_at,t.id limit 1;
  if chosen is null then return null;end if;
  return workspace_commands.notification_batch_context(chosen);
 elsif p_action='capture' then
  select * into strict b from workspace_commands.notification_batches where id=(p_payload->>'batchId')::uuid for update;
  if b.status<>'pending' then return jsonb_build_object('status',b.status,'batchId',b.id,'replayed',true);end if;
  if b.due_at>clock_timestamp() then raise exception 'Batch is not due';end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-sale:'||b.sale_id::text,0));
  if exists(select 1 from workspace_commands.notification_events x where x.sale_id=b.sale_id and x.fanout_at is null and x.occurred_at<b.due_at) then raise exception 'Earlier events still pending' using errcode='40001';end if;
  context:=workspace_commands.notification_batch_context(b.id);
  if context->>'revision' is distinct from p_payload->>'revision' then raise exception 'Notification access, settings or content changed. Recheck before capture.' using errcode='40001';end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventId',v->>'id','reasons',reasons) order by ord),'[]'::jsonb) into eligible from (
   select v,ord,array(select x from unnest(workspace_commands.notification_reasons(v->'audience',v->>'eventId',b.recipient_id)) x where x=any(workspace_commands.notification_reasons(v->'current',v->>'eventId',b.recipient_id))) reasons
   from jsonb_array_elements(context->'events') with ordinality as events(v,ord) where (context->>'enrolled')::boolean
  ) matched where cardinality(reasons)>0;
  if eligible is distinct from p_payload->'items' then raise exception 'Recheck recipient eligibility before capture.' using errcode='40001';end if;
  if jsonb_array_length(eligible)=0 then
   update workspace_commands.notification_batches set status='suppressed',finished_at=clock_timestamp() where id=b.id;
   return jsonb_build_object('status','suppressed','batchId',b.id);
  end if;
  if nullif(p_payload->'mail'->>'subject','') is null or nullif(p_payload->'mail'->>'html','') is null or nullif(p_payload->'mail'->>'text','') is null then raise exception 'Rendered email required';end if;
  insert into workspace_commands.notification_captures(batch_id,recipient_id,recipient_email,subject,html_body,text_body,items)
  values(b.id,b.recipient_id,context->>'email',p_payload->'mail'->>'subject',p_payload->'mail'->>'html',p_payload->'mail'->>'text',eligible) on conflict(batch_id) do nothing;
  update workspace_commands.notification_batches set status='captured',finished_at=clock_timestamp() where id=b.id;
  return jsonb_build_object('status','captured','batchId',b.id,'externalDelivery',false);
 end if;
 raise exception 'Unknown dispatcher action';
end $$;
revoke all on function public.workspace_notification_worker(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_notification_worker(uuid,text,jsonb) to service_role;
revoke all on function workspace_commands.notification_reasons(jsonb,text,uuid),workspace_commands.enqueue_notification(text,text,uuid,uuid,uuid[]),workspace_commands.queue_comment_notification(),workspace_commands.notification_batch_context(uuid) from public,anon,authenticated,service_role;
commit;
