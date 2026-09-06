-- Add optional, queryable audit context without changing or discarding historic events.
alter table public.audit_events
  add column if not exists category text,
  add column if not exists actor_organisation_id uuid references public.organisations(id) on delete set null,
  add column if not exists building_id uuid references public.buildings(id) on delete set null,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists affected_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists field_name text,
  add column if not exists previous_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists action_id uuid,
  add column if not exists source text;

create index if not exists audit_events_category_created_at_idx
  on public.audit_events (category, created_at desc);
create index if not exists audit_events_building_created_at_idx
  on public.audit_events (building_id, created_at desc)
  where building_id is not null;
create index if not exists audit_events_unit_created_at_idx
  on public.audit_events (unit_id, created_at desc)
  where unit_id is not null;
create index if not exists audit_events_affected_user_created_at_idx
  on public.audit_events (affected_user_id, created_at desc)
  where affected_user_id is not null;
create index if not exists audit_events_action_id_idx
  on public.audit_events (action_id)
  where action_id is not null;

update public.audit_events
set category = case
  when lower(event_type || ' ' || entity_type) ~ '(password|login|security|auth)' then 'security'
  when lower(event_type || ' ' || entity_type) ~ '(report|digest)' then 'reports'
  when lower(event_type || ' ' || entity_type) ~ '(tenan|rental|rent_)' then 'rentals'
  when lower(event_type || ' ' || entity_type) ~ '(sale|reservation|exchange|completion|deal)' then 'sales'
  when lower(event_type || ' ' || entity_type) ~ '(user|profile|access_request)' then 'users'
  when lower(event_type || ' ' || entity_type) ~ '(building|organisation|handover|trade|unit)' then 'setup'
  else 'system'
end
where category is null;

update public.audit_events
set source = metadata ->> 'source'
where source is null and nullif(metadata ->> 'source', '') is not null;

update public.audit_events
set building_id = coalesce(nullif(metadata ->> 'building_id', ''), nullif(metadata ->> 'buildingId', ''))::uuid
where building_id is null
  and coalesce(nullif(metadata ->> 'building_id', ''), nullif(metadata ->> 'buildingId', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.buildings
    where id = coalesce(nullif(audit_events.metadata ->> 'building_id', ''), nullif(audit_events.metadata ->> 'buildingId', ''))::uuid
  );

update public.audit_events
set unit_id = coalesce(nullif(metadata ->> 'unit_id', ''), nullif(metadata ->> 'unitId', ''))::uuid
where unit_id is null
  and coalesce(nullif(metadata ->> 'unit_id', ''), nullif(metadata ->> 'unitId', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.units
    where id = coalesce(nullif(audit_events.metadata ->> 'unit_id', ''), nullif(audit_events.metadata ->> 'unitId', ''))::uuid
  );

update public.audit_events
set affected_user_id = entity_id
where affected_user_id is null
  and entity_type in ('user', 'profile')
  and exists (select 1 from public.profiles where id = audit_events.entity_id);

update public.audit_events
set action_id = coalesce(nullif(metadata ->> 'action_id', ''), nullif(metadata ->> 'actionId', ''), nullif(metadata ->> 'batch_identifier', ''))::uuid
where action_id is null
  and coalesce(nullif(metadata ->> 'action_id', ''), nullif(metadata ->> 'actionId', ''), nullif(metadata ->> 'batch_identifier', ''))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

create or replace function public.populate_audit_event_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate text;
begin
  if new.category is null then
    new.category := case
      when lower(new.event_type || ' ' || new.entity_type) ~ '(password|login|security|auth)' then 'security'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(report|digest)' then 'reports'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(tenan|rental|rent_)' then 'rentals'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(sale|reservation|exchange|completion|deal)' then 'sales'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(user|profile|access_request)' then 'users'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(building|organisation|handover|trade|unit)' then 'setup'
      else 'system'
    end;
  end if;

  if new.actor_organisation_id is null and new.created_by_user_id is not null then
    select organisation_id into new.actor_organisation_id
    from public.profiles
    where id = new.created_by_user_id;
  end if;

  new.source := coalesce(new.source, nullif(new.metadata ->> 'source', ''));

  if new.building_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'building_id', ''), nullif(new.metadata ->> 'buildingId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.buildings where id = candidate::uuid) then
      new.building_id := candidate::uuid;
    elsif new.entity_type = 'building' and exists (select 1 from public.buildings where id = new.entity_id) then
      new.building_id := new.entity_id;
    end if;
  end if;

  if new.unit_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'unit_id', ''), nullif(new.metadata ->> 'unitId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.units where id = candidate::uuid) then
      new.unit_id := candidate::uuid;
    elsif new.entity_type = 'unit' and exists (select 1 from public.units where id = new.entity_id) then
      new.unit_id := new.entity_id;
    end if;
  end if;

  if new.affected_user_id is null and new.entity_type in ('user', 'profile')
    and exists (select 1 from public.profiles where id = new.entity_id) then
    new.affected_user_id := new.entity_id;
  end if;

  if new.action_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'action_id', ''), nullif(new.metadata ->> 'actionId', ''), nullif(new.metadata ->> 'batch_identifier', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      new.action_id := candidate::uuid;
    end if;
  end if;

  if new.field_name is null and new.metadata ? 'old_sale_status' and new.metadata ? 'new_sale_status' then
    new.field_name := 'sale_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_sale_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_sale_status');
  elsif new.field_name is null and new.metadata ? 'old_rental_portfolio_status' and new.metadata ? 'new_rental_portfolio_status' then
    new.field_name := 'rental_portfolio_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_rental_portfolio_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_rental_portfolio_status');
  end if;

  return new;
end;
$$;

drop trigger if exists audit_events_populate_context on public.audit_events;
create trigger audit_events_populate_context
before insert on public.audit_events
for each row execute function public.populate_audit_event_context();
