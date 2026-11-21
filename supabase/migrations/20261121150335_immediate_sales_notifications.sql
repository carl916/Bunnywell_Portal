-- Keep existing batch/capture identities and their historical deadlines. New
-- envelopes each carry one event and become available at once.
alter table workspace_commands.notification_batches
  add column transaction_event_id uuid references workspace_commands.notification_events(id),
  add column dispatch_at timestamptz generated always as (
    case when transaction_event_id is null then due_at else opened_at end
  ) stored;

create unique index notification_transaction_recipient
  on workspace_commands.notification_batches(transaction_event_id, recipient_id)
  where transaction_event_id is not null;
create index notification_dispatch_due
  on workspace_commands.notification_batches(dispatch_at, id) where status = 'pending';

create or replace function workspace_commands.enqueue_notification(
  p_event text, p_source text, p_sale uuid, p_comment uuid default null, p_new_mentions uuid[] default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  event_time timestamptz;
  event_key uuid;
begin
  if not exists (select 1 from jsonb_array_elements(workspace_commands.email_notification_catalogue()) e
                 where e->>'id' = p_event) then
    raise exception 'Unknown notification event';
  end if;
  if not exists (select 1 from workspace_commands.notification_dispatch_state
                 where enabled and stage3_active and activated_at is not null) then
    return null;
  end if;
  if not exists (select 1 from public.unit_sale_attempts a where a.id = p_sale and
                 (a.redacted_at is null or (p_event = 'sale_fallen_through' and a.workflow_status = 'fallen_through'))) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-sale:' || p_sale::text, 0));
  event_time := clock_timestamp();
  context := workspace_commands.email_notification_context(p_sale, p_comment);
  if p_new_mentions is not null then
    context := jsonb_set(context, '{candidates}', (
      select coalesce(jsonb_agg(c || jsonb_build_object(
        'mentioned', (c->>'mentioned')::boolean and (c->>'userId')::uuid = any(p_new_mentions)
      ) order by c->>'userId'), '[]')
      from jsonb_array_elements(context->'candidates') c
    ));
  end if;
  insert into workspace_commands.notification_events(source_key, event_id, sale_id, comment_id, occurred_at, audience)
  values(p_source, p_event, p_sale, p_comment, event_time, context)
  on conflict(source_key) do nothing returning id into event_key;
  return coalesce(event_key, (select id from workspace_commands.notification_events where source_key = p_source));
end $$;

create or replace function workspace_commands.notification_batch_context(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b workspace_commands.notification_batches%rowtype;
  data jsonb;
begin
  select * into strict b from workspace_commands.notification_batches where id = p_batch;
  select jsonb_build_object(
    'batchId', b.id, 'recipientId', b.recipient_id, 'saleId', b.sale_id,
    'openedAt', b.opened_at, 'dueAt', b.dispatch_at,
    'buildingId', a.building_id, 'unitId', a.unit_id, 'building', building.name,
    'unit', u.unit_number, 'email', p.email, 'recipientName', coalesce(nullif(p.full_name, ''), p.name),
    'recipientRole', p.role::text,
    'enrolled', b.transaction_event_id is not null or exists (
      select 1 from workspace_commands.test_journeys j
      where j.sale_id = a.id and j.building_id = a.building_id and j.unit_id = a.unit_id
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'eventId', e.event_id, 'occurredAt', e.occurred_at, 'occurrence', w.event_type,
        'commentId', e.comment_id, 'audience', e.audience,
        'label', (select c->>'label' from jsonb_array_elements(workspace_commands.email_notification_catalogue()) c
                  where c->>'id' = e.event_id),
        'details', coalesce(e.details, case when w.id is not null then jsonb_strip_nulls(jsonb_build_object(
          'actor', coalesce(nullif(actor.full_name, ''), nullif(w.actor_name, ''), nullif(actor.name, '')),
          'exchangeDate', w.metadata->>'exchangeDate', 'completionDate', w.metadata->>'completionDate',
          'purchaser', w.metadata->>'purchaser', 'fileName', w.metadata->>'fileName',
          'versionNumber', w.metadata->>'versionNumber', 'documentType', w.metadata->>'documentType',
          'reason', case when e.event_id in ('reservation_queried', 'completion_document_queried', 'exchange_authority_revoked')
                         then w.metadata->>'reason' end
        )) end),
        'current', case when (a.redacted_at is null or (e.event_id = 'sale_fallen_through' and a.workflow_status = 'fallen_through'))
                             and (e.comment_id is null or c.id is not null)
                        then workspace_commands.email_notification_context(a.id, e.comment_id) end,
        'comment', case when c.id is not null then jsonb_build_object(
          'body', c.body, 'author', c.author_name, 'version', c.version, 'createdAt', c.created_at
        ) end
      ) order by e.sequence), '[]'::jsonb)
      from workspace_commands.notification_batch_items i
      join workspace_commands.notification_events e on e.id = i.event_id
      left join public.sale_comments c on c.id = e.comment_id and c.sale_attempt_id = a.id
      left join public.unit_sale_workflow_events w on w.sale_attempt_id = a.id and e.source_key = 'workflow:' || w.id::text
      left join public.profiles actor on actor.id = w.created_by_user_id
      where i.batch_id = b.id
    )
  ) into data
  from public.unit_sale_attempts a
  join public.units u on u.id = a.unit_id
  join public.buildings building on building.id = a.building_id
  join public.profiles p on p.id = b.recipient_id
  where a.id = b.sale_id;
  return data || jsonb_build_object('revision', md5(data::text));
end $$;

create or replace function public.workspace_notification_worker_v2(
  p_worker uuid, p_action text, p_payload jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  state workspace_commands.notification_dispatch_state%rowtype;
  e workspace_commands.notification_events%rowtype;
  b workspace_commands.notification_batches%rowtype;
  person record;
  chosen uuid;
  context jsonb;
  eligible jsonb;
  ready_at timestamptz;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_worker is null then
    raise exception 'Server dispatcher required.' using errcode = '42501';
  end if;
  select * into strict state from workspace_commands.notification_dispatch_state where singleton for update;
  if not state.enabled then return jsonb_build_object('enabled', false); end if;
  if p_action = 'claim' then
    if state.worker is not null and state.lease_until > clock_timestamp() then
      return jsonb_build_object('claimed', false);
    end if;
    update workspace_commands.notification_dispatch_state
    set worker = p_worker, lease_until = clock_timestamp() + interval '60 seconds' where singleton;
    insert into workspace_commands.notification_worker_runs(id) values(p_worker);
    return jsonb_build_object('claimed', true);
  end if;
  if state.worker is distinct from p_worker or state.lease_until <= clock_timestamp() then
    raise exception 'Dispatcher lease expired.' using errcode = '40001';
  end if;
  update workspace_commands.notification_dispatch_state set lease_until = clock_timestamp() + interval '60 seconds' where singleton;
  if p_action = 'release' then
    update workspace_commands.notification_worker_runs set finished_at = clock_timestamp(), result = p_payload where id = p_worker;
    update workspace_commands.notification_dispatch_state set worker = null, lease_until = null where singleton;
    return jsonb_build_object('released', true);
  elsif p_action = 'next_event' then
    return (select to_jsonb(t) from workspace_commands.notification_events t where fanout_at is null order by sequence limit 1);
  elsif p_action = 'fanout' then
    select * into strict e from workspace_commands.notification_events where id = (p_payload->>'eventId')::uuid for update;
    if e.fanout_at is not null then return jsonb_build_object('done', true); end if;
    for person in
      select distinct (c->>'userId')::uuid id from jsonb_array_elements(e.audience->'candidates') c
      where cardinality(workspace_commands.notification_reasons(e.audience, e.event_id, (c->>'userId')::uuid)) > 0
    loop
      if not coalesce(p_payload->'recipientIds' ? person.id::text, false) then
        raise exception 'Resolver omitted an eligible recipient';
      end if;
      -- The old opened_at uniqueness remains for historical rows.
      select greatest(e.occurred_at, max(opened_at) + interval '1 microsecond') into ready_at
      from workspace_commands.notification_batches where recipient_id = person.id and sale_id = e.sale_id;
      insert into workspace_commands.notification_batches(recipient_id, sale_id, opened_at, due_at, transaction_event_id)
      values(person.id, e.sale_id, ready_at, ready_at + interval '5 minutes', e.id)
      returning id into chosen;
      insert into workspace_commands.notification_batch_items(event_id, recipient_id, batch_id)
      values(e.id, person.id, chosen);
    end loop;
    update workspace_commands.notification_events set fanout_at = clock_timestamp() where id = e.id;
    return jsonb_build_object('done', true);
  elsif p_action = 'next_batch' then
    select t.id into chosen from workspace_commands.notification_batches t
    where t.status = 'pending' and t.dispatch_at <= clock_timestamp()
    order by t.dispatch_at, t.id limit 1;
    if chosen is null then return null; end if;
    return workspace_commands.notification_batch_context(chosen);
  elsif p_action = 'capture' then
    select * into strict b from workspace_commands.notification_batches where id = (p_payload->>'batchId')::uuid for update;
    if b.status <> 'pending' then
      return jsonb_build_object('status', b.status, 'batchId', b.id, 'replayed', true);
    end if;
    if b.dispatch_at > clock_timestamp() then raise exception 'Notification is not due'; end if;
    perform pg_advisory_xact_lock(hashtextextended('notification-sale:' || b.sale_id::text, 0));
    context := workspace_commands.notification_batch_context(b.id);
    if context->>'revision' is distinct from p_payload->>'revision' then
      raise exception 'Notification access, settings or content changed. Recheck before capture.' using errcode = '40001';
    end if;
    eligible := workspace_commands.current_notification_items(context, b.recipient_id);
    if eligible is distinct from p_payload->'items' then
      raise exception 'Recheck recipient eligibility before capture.' using errcode = '40001';
    end if;
    if jsonb_array_length(eligible) = 0 then
      update workspace_commands.notification_batches set status = 'suppressed', finished_at = clock_timestamp() where id = b.id;
      return jsonb_build_object('status', 'suppressed', 'batchId', b.id);
    end if;
    if nullif(p_payload#>>'{mail,subject}', '') is null or nullif(p_payload#>>'{mail,html}', '') is null
      or nullif(p_payload#>>'{mail,text}', '') is null then
      raise exception 'Rendered email required';
    end if;
    insert into workspace_commands.notification_captures(batch_id, recipient_id, recipient_email, subject, html_body, text_body, items)
    values(b.id, b.recipient_id, context->>'email', p_payload#>>'{mail,subject}', p_payload#>>'{mail,html}',
      p_payload#>>'{mail,text}', eligible)
    on conflict(batch_id) do nothing;
    update workspace_commands.notification_batches set status = 'captured', finished_at = clock_timestamp() where id = b.id;
    return jsonb_build_object('status', 'captured', 'batchId', b.id, 'externalDelivery', false);
  end if;
  raise exception 'Unknown dispatcher action';
end $$;

revoke all on function public.workspace_notification_worker_v2(uuid,text,jsonb) from public, anon, authenticated, service_role;
