-- Independent snagging activity and digests, dispatched by the staging worker.
create table workspace_commands.snag_notification_settings (
  singleton boolean primary key default true check (singleton),
  frequency text not null default 'daily' check (frequency in ('immediate_only', 'daily', 'twice_daily', 'disabled')),
  overrides jsonb not null default '{}',
  version integer not null default 0,
  updated_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null
);
insert into workspace_commands.snag_notification_settings(singleton) values (true);

create table workspace_commands.snag_notification_events (
  id uuid primary key,
  snag_id uuid not null,
  building_id uuid not null,
  event_key text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  assignee_user_id uuid,
  assignee_organisation_id uuid,
  mentioned_user_ids uuid[] not null default '{}',
  fanout_at timestamptz,
  eligible_count integer
);
create index snag_notification_events_pending
  on workspace_commands.snag_notification_events(occurred_at, id) where fanout_at is null;
create index snag_notification_events_building_pending
  on workspace_commands.snag_notification_events(building_id, occurred_at) where fanout_at is null;

create table workspace_commands.snag_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null,
  recipient_id uuid not null,
  mode text not null check (mode in ('immediate', 'digest')),
  immediate_event_id uuid references workspace_commands.snag_notification_events(id),
  period_start timestamptz,
  cutoff_at timestamptz,
  check ((mode = 'immediate' and immediate_event_id is not null and period_start is null and cutoff_at is null)
      or (mode = 'digest' and immediate_event_id is null and period_start is not null and cutoff_at is not null and cutoff_at > period_start)),
  unique (immediate_event_id, recipient_id),
  unique (building_id, recipient_id, cutoff_at),
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'retry_pending', 'failed', 'accepted', 'delivered',
    'bounced', 'complained', 'suppressed', 'reconciliation_required'
  )),
  next_attempt_at timestamptz not null default clock_timestamp(),
  worker uuid,
  lease_until timestamptz,
  captured_at timestamptz,
  intended jsonb,
  original_mail jsonb,
  provider_payload jsonb,
  rendered_revision text,
  first_attempt_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  provider_id text,
  attempts integer not null default 0,
  consecutive_failures integer not null default 0,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index snag_notification_deliveries_due
  on workspace_commands.snag_notification_deliveries(next_attempt_at)
  where status in ('pending', 'processing', 'retry_pending', 'accepted');

create table workspace_commands.snag_notification_items (
  event_id uuid references workspace_commands.snag_notification_events(id) not null,
  recipient_id uuid not null,
  building_id uuid not null,
  delivery_id uuid references workspace_commands.snag_notification_deliveries(id),
  period_start timestamptz,
  cutoff_at timestamptz,
  primary key (event_id, recipient_id),
  check (delivery_id is not null or (period_start is not null and cutoff_at is not null and cutoff_at > period_start))
);
create index snag_notification_items_ready
  on workspace_commands.snag_notification_items(cutoff_at, building_id, recipient_id) where delivery_id is null;
create index snag_notification_items_delivery
  on workspace_commands.snag_notification_items(delivery_id) where delivery_id is not null;

alter table workspace_commands.snag_notification_settings enable row level security;
alter table workspace_commands.snag_notification_events enable row level security;
alter table workspace_commands.snag_notification_items enable row level security;
alter table workspace_commands.snag_notification_deliveries enable row level security;
revoke all on workspace_commands.snag_notification_settings, workspace_commands.snag_notification_events,
  workspace_commands.snag_notification_items, workspace_commands.snag_notification_deliveries
from public, anon, authenticated, service_role;

create function workspace_commands.snag_notification_catalogue()
returns table (key text, label text, mode text, roles text[], required boolean, digest_allowed boolean, roles_locked boolean)
language sql immutable set search_path = '' as $$
  values
    ('assigned', 'Assigned to a person or organisation', 'immediate', '{responsible}'::text[], false, false, false),
    ('needs_information', 'Information requested', 'immediate', '{responsible}', true, false, true),
    ('mentioned', 'Mentioned in a comment', 'immediate', '{mentioned}', true, false, true),
    ('urgent', 'Priority raised to P1', 'immediate', '{responsible,developer}', true, false, false),
    ('ready_for_review', 'Resolution needs developer review', 'immediate', '{responsible}', true, false, true),
    ('returned', 'Returned to the contractor', 'immediate', '{responsible}', false, false, false),
    ('created', 'New snag', 'digest', '{developer,responsible}', false, true, false),
    ('updated', 'Snag details updated', 'digest', '{developer,responsible}', false, true, false),
    ('closed', 'Snag closed', 'digest', '{developer,responsible}', false, true, false),
    ('status_changed', 'Other status changes', 'digest', '{developer,responsible}', false, true, false),
    ('comment', 'Routine comment', 'digest', '{developer,responsible}', false, true, false)
$$;

create function workspace_commands.snag_notification_configuration() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('version', s.version, 'frequency', s.frequency, 'updatedAt', s.updated_at, 'events', (
    select jsonb_agg(jsonb_build_object(
      'id', c.key, 'label', c.label, 'mode', coalesce(s.overrides->c.key->>'mode', c.mode),
      'roles', coalesce(s.overrides->c.key->'roles', to_jsonb(c.roles)), 'required', c.required,
      'digestAllowed', c.digest_allowed, 'rolesLocked', c.roles_locked
    ) order by c.ordinality)
    from workspace_commands.snag_notification_catalogue() with ordinality c
  ))
  from workspace_commands.snag_notification_settings s where s.singleton
$$;

create function public.workspace_snag_notification_settings(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform workspace_commands.setup_actor(p_actor);
  return workspace_commands.snag_notification_configuration();
end $$;

create function public.workspace_save_snag_notifications(p_actor uuid, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry record;
  rule record;
  prior workspace_commands.operation_receipts%rowtype;
  settings_id constant uuid := '00000000-0000-0000-0000-000000000002';
  frequency text := p_payload->>'frequency';
  chosen_mode text;
  previous jsonb;
  saved jsonb;
begin
  perform workspace_commands.setup_actor(p_actor);
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'events') is distinct from 'object'
    or coalesce(p_payload->>'expectedVersion', '') !~ '^[0-9]+$'
    or coalesce(frequency, '') not in ('immediate_only', 'daily', 'twice_daily', 'disabled')
    or p_payload - array['frequency', 'events', 'expectedVersion'] <> '{}' then
    raise exception 'Choose valid snagging notification settings.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select * into prior from workspace_commands.operation_receipts where id = p_request;
  if found then
    if prior.actor_id <> p_actor or prior.action <> 'save_snag_notifications'
      or prior.target_id <> settings_id or prior.input is distinct from p_payload then
      raise exception 'This submission conflicts with an existing operation.' using errcode = '22023';
    end if;
    return prior.result;
  end if;
  for entry in select * from jsonb_each(p_payload->'events') loop
    select * into rule from workspace_commands.snag_notification_catalogue() where key = entry.key;
    chosen_mode := entry.value->>'mode';
    if not found or jsonb_typeof(entry.value) is distinct from 'object'
      or entry.value - array['mode', 'roles'] <> '{}'
      or jsonb_typeof(entry.value->'roles') is distinct from 'array'
      or coalesce(chosen_mode, '') not in ('immediate', 'digest', 'off')
      or (rule.required and chosen_mode <> 'immediate') or (chosen_mode = 'digest' and not rule.digest_allowed) then
      raise exception 'Choose a permitted delivery mode for each snagging event.' using errcode = '22023';
    end if;
    if (rule.roles_locked and entry.value->'roles' is distinct from to_jsonb(rule.roles))
      or (chosen_mode <> 'off' and jsonb_array_length(entry.value->'roles') = 0)
      or jsonb_array_length(entry.value->'roles') <>
         (select count(distinct role) from jsonb_array_elements_text(entry.value->'roles') role)
      or exists (select 1 from jsonb_array_elements_text(entry.value->'roles') role
                 where role not in ('developer', 'developer_representative', 'responsible', 'contractor', 'mentioned')
                   or (role = 'mentioned' and entry.key <> 'mentioned')) then
      raise exception 'Choose valid and distinct snagging recipients.' using errcode = '22023';
    end if;
  end loop;
  perform 1 from workspace_commands.snag_notification_settings s where singleton
    and s.version::text = p_payload->>'expectedVersion' for update;
  if not found then
    raise exception 'Snagging notification settings changed. Reload before saving.' using errcode = '40001';
  end if;
  previous := workspace_commands.snag_notification_configuration();
  update workspace_commands.snag_notification_settings s
  set frequency = p_payload->>'frequency', overrides = s.overrides || (p_payload->'events'),
      version = s.version + 1, updated_at = clock_timestamp(), updated_by = p_actor
  where s.singleton;
  saved := workspace_commands.snag_notification_configuration();
  insert into public.audit_events(event_type, entity_type, entity_id, summary, category, created_by_user_id,
    metadata, action_id, source, outcome)
  values('snag_notifications_updated', 'system_settings', settings_id, 'Snagging notification settings saved.', 'setup',
    p_actor, jsonb_build_object('before', previous, 'after', saved), p_request, 'workspace_setup', 'success');
  insert into workspace_commands.operation_receipts(id, actor_id, action, target_id, input, result)
  values(p_request, p_actor, 'save_snag_notifications', settings_id, p_payload, saved);
  return saved;
end $$;

-- Apply the workspace's building and exact-snag checks to an explicit recipient.
-- Workers have no interactive JWT for that recipient. This private predicate
-- is limited to the four account roles that can open the Snags workspace.
create function workspace_commands.snag_notification_access(p_user uuid, p_building uuid, p_snag uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.snags s
    join public.profiles p on p.id = p_user and p.active
    where s.id = p_snag and s.building_id = p_building
      and p.role in ('admin', 'developer', 'developer_representative', 'contractor')
      and (
        p.role in ('admin', 'developer')
        or exists (select 1 from public.user_building_access a where a.user_id = p.id and a.building_id = s.building_id)
        or exists (select 1 from public.user_unit_access a join public.units u on u.id = a.unit_id
                   where a.user_id = p.id and u.building_id = s.building_id)
        or exists (select 1 from public.building_organisations a where a.building_id = s.building_id
                   and a.organisation_id = p.organisation_id and coalesce(a.active, true))
      )
      and (
        p.role in ('admin', 'developer', 'developer_representative') or s.created_by_user_id = p.id
        or (p.role = 'contractor' and (s.assigned_to_organisation_id is null or s.assigned_to_organisation_id = p.organisation_id)
            and exists (select 1 from public.building_organisations a where a.building_id = s.building_id
                        and a.organisation_id = p.organisation_id and coalesce(a.active, true)
                        and a.role_on_project = 'main_contractor'))
      )
  )
$$;

create function public.workspace_snag_mention_candidates(p_building uuid, p_snag uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_snag is null or not exists (
    select 1 from public.snags where id = p_snag and building_id = p_building
  ) then raise exception 'Exact snag unavailable.' using errcode = '42501'; end if;
  perform workspace_commands.snag_actor(p_building, p_snag, 'snag_comment');
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.name),
      'role', p.role::text) order by coalesce(nullif(p.full_name, ''), p.name), p.id), '[]')
    from public.profiles p
    where p.active and p.role in ('admin', 'developer', 'developer_representative', 'contractor')
      and coalesce(nullif(p.full_name, ''), nullif(p.name, '')) is not null and nullif(btrim(p.email), '') is not null
      and workspace_commands.snag_notification_access(p.id, p_building, p_snag)
  );
end $$;

alter table public.snag_events add column mention_ids uuid[] not null default '{}';

create function workspace_commands.validate_snag_mentions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare building uuid;
begin
  if cardinality(new.mention_ids) = 0 then return new; end if;
  select building_id into building from public.snags where id = new.snag_id;
  if new.event_type <> 'note' or cardinality(new.mention_ids) > 10 or building is null
    or cardinality(new.mention_ids) <> (select count(distinct mentioned.user_id) from unnest(new.mention_ids) as mentioned(user_id)) then
    raise exception 'Choose up to 10 distinct people to mention.' using errcode = '22023';
  end if;
  perform workspace_commands.snag_actor(building, new.snag_id, 'snag_comment');
  if exists (
    select 1 from unnest(new.mention_ids) as mentioned(user_id)
    where not exists (select 1 from public.profiles p where p.id = mentioned.user_id and p.active
      and p.role in ('admin', 'developer', 'developer_representative', 'contractor')
      and workspace_commands.snag_notification_access(p.id, building, new.snag_id))
  ) then raise exception 'Everyone mentioned must have access to this snag.' using errcode = '42501'; end if;
  return new;
end $$;

create trigger validate_snag_notification_mentions before insert on public.snag_events
for each row when (cardinality(new.mention_ids) > 0) execute function workspace_commands.validate_snag_mentions();

-- The existing operation receipt also covers the selected mention IDs. Keep
-- existing media, status and audit behaviour in the snag operation.
do $migration$
declare
  definition text;
  note_insert constant text := 'insert into snag_events(snag_id,event_type,comment,created_by_user_id) values(target,''note'',note,actor.id);';
begin
  definition := pg_get_functiondef('public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  if position(note_insert in definition) = 0 then raise exception 'Review the current snag comment operation.'; end if;
  execute replace(definition, note_insert,
    'insert into snag_events(snag_id,event_type,comment,created_by_user_id,mention_ids)
     values(target,''note'',note,actor.id,array(
       select value::uuid from jsonb_array_elements_text(coalesce(p_payload->''mentions'',''[]''))
     ));');
end $migration$;

create function workspace_commands.enqueue_snag_notification(
  p_id uuid, p_snag public.snags, p_kind text, p_mentions uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_snag.building_id is null or not exists (
    select 1 from workspace_commands.notification_dispatch_state where enabled and stage3_active
  ) then return; end if;
  -- A cutoff cannot be sealed while an earlier event is awaiting commit.
  perform pg_advisory_xact_lock_shared(hashtextextended('snag-notification-cutoff', 0));
  insert into workspace_commands.snag_notification_events(
    id, snag_id, building_id, event_key, assignee_user_id, assignee_organisation_id, mentioned_user_ids
  )
  values(p_id, p_snag.id, p_snag.building_id, p_kind, p_snag.assigned_to_user_id,
    p_snag.assigned_to_organisation_id, p_mentions)
  on conflict(id) do nothing;
end $$;

create function workspace_commands.snag_record_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event_key text; event_id uuid;
begin
  if tg_op = 'INSERT' then
    perform workspace_commands.enqueue_snag_notification(new.id, new, 'created');
    event_id := gen_random_uuid();
    event_key := case when new.priority_code = 'P1' then 'urgent'
                      when coalesce(new.assigned_to_user_id, new.assigned_to_organisation_id) is not null then 'assigned' end;
  else
    event_id := gen_random_uuid();
    if new.status is distinct from old.status then
      event_key := case
        when new.status = 'closed' then 'closed'
        when new.status = 'needs_more_info' then 'needs_information'
        when new.status = 'resolved_by_contractor' then 'ready_for_review'
        when new.status = 'rejected_back_to_contractor'
           or (new.status = 'open' and old.status = 'needs_more_info') then 'returned'
        else 'status_changed' end;
    end if;
    if new.status <> 'closed' and new.priority_code = 'P1' and old.priority_code is distinct from 'P1' then
      event_key := 'urgent';
    elsif event_key is null and new.status <> 'closed'
      and (new.assigned_to_user_id, new.assigned_to_organisation_id) is distinct from (old.assigned_to_user_id, old.assigned_to_organisation_id)
      and coalesce(new.assigned_to_user_id, new.assigned_to_organisation_id) is not null then
      event_key := 'assigned';
    end if;
    if event_key is null and (new.title, new.description, new.priority_code, new.trade_id, new.sla_due_date,
      new.assigned_to_user_id, new.assigned_to_organisation_id, new.unit_id, new.area_id)
      is distinct from (old.title, old.description, old.priority_code, old.trade_id, old.sla_due_date,
      old.assigned_to_user_id, old.assigned_to_organisation_id, old.unit_id, old.area_id) then
      event_key := 'updated';
    end if;
  end if;
  if event_key is not null then
    perform workspace_commands.enqueue_snag_notification(event_id, new, event_key);
  end if;
  return new;
end $$;

create trigger snag_record_notification after insert or update on public.snags
for each row execute function workspace_commands.snag_record_notification();

create function workspace_commands.snag_comment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare snag public.snags%rowtype; mentions uuid[] := '{}';
begin
  if tg_table_name = 'snag_events' then mentions := new.mention_ids; end if;
  select * into snag from public.snags where id = new.snag_id;
  if found then
    perform workspace_commands.enqueue_snag_notification(new.id, snag,
      case when cardinality(mentions) > 0 then 'mentioned' else 'comment' end, mentions);
  end if;
  return new;
end $$;

create trigger snag_note_notification after insert on public.snag_events
for each row when (new.event_type = 'note') execute function workspace_commands.snag_comment_notification();
create trigger snag_comment_notification after insert on public.snag_comments
for each row execute function workspace_commands.snag_comment_notification();

create function workspace_commands.snag_notification_mode(p_rule jsonb, p_frequency text) returns text
language sql immutable set search_path = '' as $$
  select case
    when (p_rule->>'required')::boolean then 'immediate'
    when p_frequency = 'disabled' then null
    when p_rule->>'mode' = 'immediate' then 'immediate'
    when p_rule->>'mode' = 'digest' and p_frequency in ('daily', 'twice_daily') then 'digest'
  end
$$;

create function workspace_commands.snag_digest_period(p_occurred_at timestamptz, p_frequency text)
returns table (period_start timestamptz, cutoff_at timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  local_time timestamp := p_occurred_at at time zone 'Europe/London';
  day date := local_time::date;
  start_local timestamp;
  end_local timestamp;
begin
  if p_frequency not in ('daily', 'twice_daily') then return; end if;
  if p_frequency = 'twice_daily' and local_time::time < time '12:00' then
    start_local := (day - 1) + time '16:00';
    end_local := day + time '12:00';
  elsif local_time::time < time '16:00' then
    start_local := case when p_frequency = 'twice_daily' then day + time '12:00'
                        else (day - 1) + time '16:00' end;
    end_local := day + time '16:00';
  else
    start_local := day + time '16:00';
    end_local := (day + 1) + case when p_frequency = 'twice_daily' then time '12:00' else time '16:00' end;
  end if;
  return query select start_local at time zone 'Europe/London', end_local at time zone 'Europe/London';
end $$;

create function workspace_commands.snag_notification_recipient(
  p_event workspace_commands.snag_notification_events, p_user public.profiles, p_rule jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  snag public.snags%rowtype;
  role_name text := case when p_user.role::text = 'admin' then 'developer' else p_user.role::text end;
  roles jsonb := p_rule->'roles';
  responsible boolean := false;
  developer_owner uuid;
begin
  if p_user.active is distinct from true or nullif(btrim(p_user.email), '') is null
    or role_name not in ('developer', 'developer_representative', 'contractor') or roles is null then
    return false;
  end if;
  if not (roles ? role_name or roles ? 'responsible' or roles ? 'mentioned') then return false; end if;
  select * into snag from public.snags where id = p_event.snag_id and building_id = p_event.building_id;
  if not found then return false; end if;
  -- A change of assignee or status invalidates a stale request for action.
  if p_event.event_key = 'assigned' and (
    snag.status = 'closed' or (snag.assigned_to_user_id, snag.assigned_to_organisation_id) is distinct from
      (p_event.assignee_user_id, p_event.assignee_organisation_id)
  ) then return false; end if;
  if (p_event.event_key = 'needs_information' and snag.status <> 'needs_more_info')
    or (p_event.event_key = 'ready_for_review' and snag.status <> 'resolved_by_contractor')
    or (p_event.event_key = 'urgent' and (snag.status = 'closed' or snag.priority_code is distinct from 'P1'))
    or (p_event.event_key = 'returned' and snag.status not in ('open', 'rejected_back_to_contractor')) then
    return false;
  end if;
  if p_event.event_key = 'mentioned' and (
    not (p_user.id = any(p_event.mentioned_user_ids)) or not exists (
      select 1 from public.snag_events note
      where note.id = p_event.id and note.snag_id = snag.id and p_user.id = any(note.mention_ids)
    )
  ) then return false; end if;

  if roles ? 'responsible' then
    if p_event.event_key in ('needs_information', 'ready_for_review') then
      -- This workflow returns the question or review to the developer side.
      -- Use the reporter when they can act, otherwise the assigned project team.
      select p.id into developer_owner from public.profiles p
      where p.id = snag.created_by_user_id and p.active and nullif(btrim(p.email), '') is not null
        and p.role in ('admin', 'developer', 'developer_representative')
        and workspace_commands.snag_notification_access(p.id, snag.building_id, snag.id);
      responsible := case when developer_owner is not null then developer_owner = p_user.id
        else role_name in ('developer', 'developer_representative') and (
          exists (select 1 from public.user_building_access a where a.user_id = p_user.id and a.building_id = snag.building_id)
          or exists (select 1 from public.building_organisations a where a.active and
            a.building_id = snag.building_id and a.organisation_id = p_user.organisation_id
            and a.role_on_project = 'developer_representative')
        ) end;
    elsif snag.assigned_to_user_id is not null then
      responsible := p_user.id = snag.assigned_to_user_id;
    elsif snag.assigned_to_organisation_id is not null then
      responsible := p_user.organisation_id is not distinct from snag.assigned_to_organisation_id;
    elsif role_name = 'contractor' then
      responsible := exists (select 1 from public.building_organisations a where a.active and
        a.building_id = snag.building_id and a.organisation_id = p_user.organisation_id
        and a.role_on_project = 'main_contractor');
    end if;
  end if;
  return (roles ? role_name or responsible or (roles ? 'mentioned' and p_user.id = any(p_event.mentioned_user_ids)))
    and workspace_commands.snag_notification_access(p_user.id, snag.building_id, snag.id);
end $$;

create function workspace_commands.prepare_snag_notifications(p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  config jsonb;
  event workspace_commands.snag_notification_events%rowtype;
  rule jsonb;
  frequency text;
  mode text;
  person uuid;
  delivery uuid;
  period record;
  digest record;
  events integer := 0;
  recipients integer;
  digests integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('snag-notification-fanout', 0)) then
    return jsonb_build_object('events', 0, 'digests', 0);
  end if;
  config := workspace_commands.snag_notification_configuration();
  frequency := config->>'frequency';
  for event in select * from workspace_commands.snag_notification_events
    where fanout_at is null order by occurred_at, id limit 200 for update skip locked
  loop
    recipients := 0;
    select e into rule from jsonb_array_elements(config->'events') e where e->>'id' = event.event_key;
    mode := workspace_commands.snag_notification_mode(rule, frequency);
    if mode is not null then
      for person in select p.id from public.profiles p where p.active and workspace_commands.snag_notification_recipient(event, p, rule)
      loop
        if mode = 'immediate' then
          insert into workspace_commands.snag_notification_deliveries(building_id, recipient_id, mode, immediate_event_id)
          values(event.building_id, person, mode, event.id)
          on conflict (immediate_event_id, recipient_id) do nothing returning id into delivery;
          if delivery is null then
            select id into delivery from workspace_commands.snag_notification_deliveries
            where immediate_event_id = event.id and recipient_id = person;
          end if;
          insert into workspace_commands.snag_notification_items(event_id, recipient_id, building_id, delivery_id)
          values(event.id, person, event.building_id, delivery)
          on conflict (event_id, recipient_id) do nothing;
        else
          select * into period from workspace_commands.snag_digest_period(event.occurred_at, frequency);
          insert into workspace_commands.snag_notification_items(event_id, recipient_id, building_id, period_start, cutoff_at)
          values(event.id, person, event.building_id, period.period_start, period.cutoff_at)
          on conflict (event_id, recipient_id) do nothing;
        end if;
        recipients := recipients + 1;
      end loop;
    end if;
    update workspace_commands.snag_notification_events
    set fanout_at = clock_timestamp(), eligible_count = recipients where id = event.id;
    events := events + 1;
  end loop;
  if pg_try_advisory_xact_lock(hashtextextended('snag-notification-cutoff', 0)) then
    -- Each recipient/building/cutoff is sealed once. Delayed or retried
    -- deliveries keep these bounds, and later activity has its own cutoff.
    for digest in
      select i.building_id, i.recipient_id, i.cutoff_at, min(i.period_start) as period_start
      from workspace_commands.snag_notification_items i
      where i.delivery_id is null and i.cutoff_at <= p_now
        and not exists (select 1 from workspace_commands.snag_notification_events pending
          where pending.building_id = i.building_id and pending.fanout_at is null and pending.occurred_at < i.cutoff_at)
      group by i.building_id, i.recipient_id, i.cutoff_at
      order by i.cutoff_at, i.building_id, i.recipient_id limit 200
    loop
      insert into workspace_commands.snag_notification_deliveries(building_id, recipient_id, mode, period_start, cutoff_at)
      values(digest.building_id, digest.recipient_id, 'digest', digest.period_start, digest.cutoff_at)
      on conflict (building_id, recipient_id, cutoff_at) do nothing returning id into delivery;
      if delivery is not null then
        update workspace_commands.snag_notification_items
        set delivery_id = delivery
        where delivery_id is null and building_id = digest.building_id
          and recipient_id = digest.recipient_id and cutoff_at = digest.cutoff_at;
        digests := digests + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('events', events, 'digests', digests);
end $$;

create function workspace_commands.snag_delivery_context(p_delivery uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d workspace_commands.snag_notification_deliveries%rowtype;
  person public.profiles%rowtype;
  config jsonb := workspace_commands.snag_notification_configuration();
  activity jsonb;
  recipient jsonb;
  building_name text;
begin
  select * into strict d from workspace_commands.snag_notification_deliveries where id = p_delivery;
  select * into person from public.profiles where id = d.recipient_id and active;
  if not found then return null; end if;
  select name into building_name from public.buildings where id = d.building_id;
  if not found then return null; end if;
  with eligible as materialized (
    select e.id, e.event_key, e.snag_id, e.occurred_at, s.title, s.status::text
    from workspace_commands.snag_notification_items i
    join workspace_commands.snag_notification_events e on e.id = i.event_id
    join public.snags s on s.id = e.snag_id and s.building_id = e.building_id
    join lateral (select rule from jsonb_array_elements(config->'events') rule where rule->>'id' = e.event_key) rules on true
    where i.delivery_id = d.id and i.building_id = d.building_id and i.recipient_id = d.recipient_id
      and workspace_commands.snag_notification_mode(rules.rule, config->>'frequency') = d.mode
      and workspace_commands.snag_notification_recipient(e, person, rules.rule)
  )
  select jsonb_build_object(
    'eventCount', count(*),
    'created', count(distinct snag_id) filter (where event_key = 'created'),
    'awaitingInformation', count(distinct snag_id) filter (where status = 'needs_more_info'),
    'closed', count(distinct snag_id) filter (where event_key = 'closed'),
    'statusChanges', count(*) filter (where event_key = 'status_changed'),
    'updates', count(*) filter (where event_key = 'updated'),
    'comments', count(*) filter (where event_key = 'comment'),
    'fingerprint', md5(string_agg(id::text, ',' order by id)),
    'details', case when count(*) <= 6 then jsonb_agg(jsonb_build_object(
      'id', snag_id, 'title', title, 'event', event_key
    ) order by occurred_at, id) else '[]'::jsonb end
  ) into activity from eligible;
  if (activity->>'eventCount')::integer = 0 then return null; end if;
  recipient := jsonb_build_object('email', person.email, 'name', coalesce(nullif(person.full_name, ''), person.name),
    'role', person.role::text);
  activity := activity || jsonb_build_object('mode', d.mode, 'buildingId', d.building_id, 'building', building_name,
    'periodStart', d.period_start, 'cutoffAt', d.cutoff_at, 'recipient', recipient);
  return activity || jsonb_build_object('revision', md5(activity::text));
end $$;

create function public.workspace_snag_notification_worker(
  p_worker uuid, p_action text, p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d workspace_commands.snag_notification_deliveries%rowtype;
  moment timestamptz := clock_timestamp();
  target_id uuid := nullif(p_payload->>'id', '')::uuid;
  context jsonb;
  mail jsonb;
  payload jsonb;
  outcome text;
  returned_provider_id text := nullif(p_payload->>'providerId', '');
  failures integer;
  next_attempt timestamptz;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_worker is null then
    raise exception 'Server dispatcher required.' using errcode = '42501';
  end if;
  if not exists (select 1 from workspace_commands.notification_dispatch_state where enabled and stage3_active) then
    return null;
  end if;
  if p_action = 'prepare' then
    return workspace_commands.prepare_snag_notifications(moment);
  end if;
  if p_action = 'claim' then
    update workspace_commands.snag_notification_deliveries
    set status = case when first_attempt_at is null then 'failed' else 'reconciliation_required' end,
        worker = null, lease_until = null, updated_at = moment,
        last_error = 'Delivery worker interrupted or provider idempotency window ended.'
    where status in ('pending', 'processing', 'retry_pending')
      and (worker is null or lease_until <= moment)
      and (first_attempt_at <= moment - interval '23 hours'
        or (worker is not null and consecutive_failures >= 5));
    select * into d from workspace_commands.snag_notification_deliveries q
    where (target_id is null or q.id = target_id)
      and q.status in ('pending', 'processing', 'retry_pending', 'accepted')
      and (q.status <> 'accepted' or coalesce(p_payload->>'poll', 'true') = 'true')
      and q.next_attempt_at <= moment and (q.worker is null or q.lease_until <= moment)
    order by (q.status = 'accepted'), (q.mode = 'digest'), q.next_attempt_at, q.created_at
    for update skip locked limit 1;
    if not found then return null; end if;
    update workspace_commands.snag_notification_deliveries q
    set consecutive_failures = q.consecutive_failures + (q.worker is not null and q.provider_id is null)::integer,
        worker = p_worker, lease_until = moment + interval '60 seconds',
        status = case when q.provider_id is null then 'processing' else q.status end,
        updated_at = moment
    where q.id = d.id returning * into d;
    if d.provider_id is null then context := workspace_commands.snag_delivery_context(d.id); end if;
    return jsonb_build_object('id', d.id, 'providerId', d.provider_id, 'providerPayload', d.provider_payload,
      'context', context);
  end if;
  if p_action = 'retry' then
    update workspace_commands.snag_notification_deliveries q
    set status = 'retry_pending', consecutive_failures = 0, next_attempt_at = moment, updated_at = moment
    where q.id = target_id and q.status = 'failed' and q.provider_id is null
      and (q.first_attempt_at is null or q.first_attempt_at > moment - interval '23 hours');
    return jsonb_build_object('scheduled', found);
  end if;
  select * into strict d from workspace_commands.snag_notification_deliveries where id = target_id for update;
  if d.worker is distinct from p_worker or d.lease_until <= moment then
    raise exception 'Delivery lease expired.' using errcode = '40001';
  end if;
  if p_action = 'release_for_send' then
    if d.provider_id is not null then return jsonb_build_object('send', false); end if;
    context := workspace_commands.snag_delivery_context(d.id);
    if context is null or (d.first_attempt_at is not null and d.rendered_revision is distinct from context->>'revision')
        or d.first_attempt_at <= moment - interval '23 hours' then
      outcome := case when d.first_attempt_at is null then 'suppressed' else 'reconciliation_required' end;
      update workspace_commands.snag_notification_deliveries
      set status = outcome, worker = null, lease_until = null, updated_at = moment,
          last_error = 'Eligibility, snag content or the provider retry window changed before release.'
      where id = d.id;
      return jsonb_build_object('send', false, 'status', outcome);
    end if;
    if d.first_attempt_at is null then
      mail := p_payload->'mail';
      if context->>'revision' is distinct from p_payload->>'revision' then
        raise exception 'Recheck snagging notification eligibility.' using errcode = '40001';
      end if;
      if nullif(mail->>'subject', '') is null or nullif(mail->>'html', '') is null or nullif(mail->>'text', '') is null then
        raise exception 'Rendered snagging email required.';
      end if;
      update workspace_commands.snag_notification_deliveries
      set original_mail = mail, intended = context->'recipient', captured_at = coalesce(captured_at, moment),
          rendered_revision = context->>'revision', updated_at = moment
      where id = d.id;
    end if;
    if p_payload->'providerPayload' is null then return jsonb_build_object('send', false, 'captured', true); end if;
    payload := coalesce(d.provider_payload, p_payload->'providerPayload');
    if payload->'to' is distinct from '["carl@accoladeproperties.co.uk"]'::jsonb
      or payload->'cc' is distinct from '[]'::jsonb or payload->'bcc' is distinct from '[]'::jsonb
      or payload->>'reply_to' is distinct from 'carl@accoladeproperties.co.uk'
      or not coalesce(payload->>'subject' like '[STAGING] %', false) then
      raise exception 'Unsafe staging provider payload.';
    end if;
    update workspace_commands.snag_notification_deliveries
    set provider_payload = payload, first_attempt_at = coalesce(first_attempt_at, moment),
        attempts = attempts + 1, updated_at = moment
    where id = d.id;
    return jsonb_build_object('send', true, 'payload', payload,
      'idempotencyKey', 'staging-snags/' || d.mode || '/' || d.id::text);
  end if;
  if p_action = 'result' then
    outcome := p_payload->>'status';
    if outcome is null or outcome not in ('unknown', 'failed', 'accepted', 'delivered', 'bounced', 'complained') then
      raise exception 'Unsupported delivery result.';
    end if;
    if outcome in ('accepted', 'delivered') and coalesce(d.provider_id, returned_provider_id) is null then
      raise exception 'Provider ID required.';
    end if;
    failures := d.consecutive_failures;
    next_attempt := moment + case when outcome = 'accepted' and nullif(p_payload->>'error', '') is not null
                                 then interval '1 hour' else interval '1 minute' end;
    if outcome in ('unknown', 'failed') and d.provider_id is null then
      failures := failures + 1;
      next_attempt := moment + make_interval(mins => (array[1, 2, 5, 15, 30, 60])[least(failures, 6)]);
      outcome := case when failures < 6 then 'retry_pending'
                      when outcome = 'unknown' and d.first_attempt_at is not null then 'reconciliation_required'
                      else 'failed' end;
    elsif outcome in ('accepted', 'delivered') then
      failures := 0;
    end if;
    update workspace_commands.snag_notification_deliveries q
    set status = outcome, provider_id = coalesce(q.provider_id, returned_provider_id),
        accepted_at = case when outcome in ('accepted', 'delivered') then coalesce(q.accepted_at, moment) else q.accepted_at end,
        delivered_at = case when outcome = 'delivered' then coalesce(q.delivered_at, moment) else q.delivered_at end,
        consecutive_failures = failures, last_error = left(p_payload->>'error', 200),
        next_attempt_at = next_attempt, worker = null, lease_until = null, updated_at = moment
    where q.id = d.id;
    return jsonb_build_object('id', d.id, 'status', outcome);
  end if;
  raise exception 'Unknown snagging delivery action.';
end $$;

revoke all on function public.workspace_snag_notification_settings(uuid),
  public.workspace_save_snag_notifications(uuid, uuid, jsonb), public.workspace_snag_mention_candidates(uuid, uuid),
  public.workspace_snag_notification_worker(uuid, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.workspace_snag_notification_settings(uuid),
  public.workspace_save_snag_notifications(uuid, uuid, jsonb),
  public.workspace_snag_notification_worker(uuid, text, jsonb) to service_role;
grant execute on function public.workspace_snag_mention_candidates(uuid, uuid) to authenticated;

revoke all on function workspace_commands.snag_notification_catalogue(), workspace_commands.snag_notification_configuration(),
  workspace_commands.snag_notification_access(uuid, uuid, uuid), workspace_commands.validate_snag_mentions(),
  workspace_commands.enqueue_snag_notification(uuid, public.snags, text, uuid[]),
  workspace_commands.snag_record_notification(), workspace_commands.snag_comment_notification(),
  workspace_commands.snag_notification_mode(jsonb, text), workspace_commands.snag_digest_period(timestamptz, text),
  workspace_commands.snag_notification_recipient(workspace_commands.snag_notification_events, public.profiles, jsonb),
  workspace_commands.prepare_snag_notifications(timestamptz), workspace_commands.snag_delivery_context(uuid)
from public, anon, authenticated, service_role;
