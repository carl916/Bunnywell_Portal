-- Apply to Bunnywell Portal Staging only. Configuration starts empty and no cron job is installed.
begin;

create role sheets_backup_runner nologin noinherit;
alter role sheets_backup_runner set statement_timeout = '10s';
alter role sheets_backup_runner set lock_timeout = '2s';

create schema sheets_backup;
revoke all on schema sheets_backup from public, anon, authenticated, service_role;
grant usage on schema sheets_backup to sheets_backup_runner;

-- No foreign key to a business table. These records cannot block a portal deletion.
create table sheets_backup.buildings (
  building_id uuid primary key,
  enabled boolean not null default false,
  shared_drive_id text not null check (shared_drive_id ~ '^[A-Za-z0-9_-]{10,120}$'),
  drive_folder_id text unique check (drive_folder_id ~ '^[A-Za-z0-9_-]{10,120}$'),
  lease_token uuid,
  lease_until timestamptz,
  check ((lease_token is null) = (lease_until is null))
);

create table sheets_backup.exports (
  building_id uuid not null references sheets_backup.buildings(building_id) on delete cascade,
  kind text not null check (kind in ('sales', 'defects')),
  spreadsheet_id text unique check (spreadsheet_id ~ '^[A-Za-z0-9_-]{10,120}$'),
  creation_requested_at timestamptz,
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  error text,
  row_count integer,
  primary key (building_id, kind)
);

alter table sheets_backup.buildings enable row level security;
alter table sheets_backup.exports enable row level security;
create policy runner_enabled_buildings on sheets_backup.buildings to sheets_backup_runner using (enabled) with check (enabled);
create policy runner_enabled_exports on sheets_backup.exports to sheets_backup_runner
  using (exists (select 1 from sheets_backup.buildings b where b.building_id = exports.building_id and b.enabled))
  with check (exists (select 1 from sheets_backup.buildings b where b.building_id = exports.building_id and b.enabled));

revoke all on all tables in schema sheets_backup from public, anon, authenticated, service_role;
grant select on sheets_backup.buildings, sheets_backup.exports to sheets_backup_runner;
grant update (drive_folder_id, lease_token, lease_until) on sheets_backup.buildings to sheets_backup_runner;
grant insert (building_id, kind, last_attempt_at, status),
  update (spreadsheet_id, creation_requested_at, last_attempt_at, last_success_at, status, error, row_count)
  on sheets_backup.exports to sheets_backup_runner;

-- The dedicated login has no business-table grants. This function projects only
-- the fields below, for a single enabled building and the current lease holder.
create function sheets_backup.snapshot(p_building uuid, p_kind text, p_lease uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  building jsonb;
  floors jsonb;
  data jsonb;
begin
  if session_user <> 'sheets_backup_runner' or p_kind is null or p_kind not in ('sales', 'defects') or not exists (
    select 1 from sheets_backup.buildings c
    where c.building_id = p_building and c.enabled and c.lease_token = p_lease and c.lease_until > statement_timestamp()
  ) then
    raise exception 'No active export lease for this building' using errcode = '42501';
  end if;

  select jsonb_build_object('id', b.id, 'name', b.name) into building from public.buildings b where b.id = p_building;
  if building is null then raise exception 'Configured building is unavailable' using errcode = 'P0002'; end if;

  if p_kind = 'sales' then
    select coalesce(jsonb_agg(jsonb_build_object('building_id', f.building_id, 'name', f.name, 'sort_order', f.sort_order)), '[]')
    into floors from public.building_floors f where f.building_id = p_building;

    select coalesce(jsonb_agg(to_jsonb(projected) order by projected.id), '[]') into data from (
      select u.id, u.building_id, u.unit_number, u.floor, coalesce(ut.name, u.unit_type) as unit_type, u.sale_status,
        case when a.is_system_baseline and a.workflow_status = 'draft'
          and coalesce(nullif(btrim(a.buyer_person_name), ''), nullif(btrim(a.buyer_name), ''), nullif(btrim(a.buyer_company_name), ''),
            nullif(btrim(a.buyer_email), ''), nullif(btrim(a.buyer_phone), ''), nullif(btrim(a.buyer_solicitor_name), '')) is null
          and a.reservation_date is null then null else a.id end as record_id,
        a.workflow_status, t.list_price_at_offer as list_price, t.contract_price,
        t.developer_contribution, t.agent_contribution, t.other_concessions,
        u.parking_bays, t.parking_location_details as parking_location,
        coalesce(nullif(btrim(a.buyer_person_name), ''), nullif(btrim(a.buyer_name), '')) as buyer,
        a.buyer_company_name as company, a.buyer_email as email, a.buyer_phone as phone, a.buyer_solicitor_name as solicitor,
        coalesce(a.reservation_date, case when u.sale_status in ('reserved', 'exchanged', 'completed', 'handed_over') then u.reservation_date end) as reservation_date,
        t.reservation_fee,
        case when ds.id is not null then ds.expected_amount when t.id is not null then public.sales_exchange_deposit_amount(
          jsonb_build_object('terms', jsonb_build_object('contract_price', t.contract_price, 'exchange_deposit_percent', t.exchange_deposit_percent),
            'schedule', coalesce((select jsonb_agg(jsonb_build_object('payment_stage', ps.payment_stage, 'due_event', ps.due_event,
              'due_offset_days', ps.due_offset_days, 'expected_amount', ps.expected_amount, 'fixed_amount', ps.fixed_amount,
              'percent_of_contract_price', ps.percent_of_contract_price)) from public.unit_sale_payment_schedule ps
              where ps.sale_attempt_id = a.id and (ps.sale_terms_id = t.id or ps.sale_terms_id is null)), '[]'))
        ) end as exchange_due,
        receipt.received_date as exchange_received_date, a.exchanged_at as exchange_date,
        a.completion_notice_issued_at as notice_date, a.contractual_completion_date as completion_deadline,
        coalesce((a.legal_completed_at at time zone 'Europe/London')::date, a.completed_at,
          case when u.sale_status in ('completed', 'handed_over') then u.completion_date end) as completion_date,
        coalesce((select jsonb_agg(jsonb_build_object('at', c.created_at, 'author', nullif(c.author_name, ''), 'body', c.body)
          order by c.created_at desc, c.sequence desc) from public.sale_comments c where c.sale_attempt_id = a.id), '[]') as comments
      from public.units u
      left join public.unit_types ut on ut.id = u.unit_type_id
      left join public.unit_sale_attempts a on a.unit_id = u.id and a.building_id = u.building_id
        and a.is_active is true and a.redacted_at is null and a.workflow_status not in ('fallen_through', 'superseded', 'cancelled')
      left join public.unit_sale_terms t on t.sale_attempt_id = a.id and t.is_current is true
      left join public.sale_exchange_deposit_sources ds on ds.sale_attempt_id = a.id
      left join lateral (select r.received_date from public.sale_exchange_deposit_receipts r
        where r.sale_attempt_id = a.id order by r.revision desc limit 1) receipt on true
      where u.building_id = p_building
    ) projected;
  else
    with defects as materialized (
      select d.id, d.building_id, d.unit_id, d.flat_id, d.area_id, d.title, d.description,
        d.status, d.created_at, d.assigned_to_organisation_id, d.trade_id, d.image_path
      from public.snags d where d.building_id = p_building and d.source_type = 'developer_snag'
    ), comment_rows as (
      select e.snag_id, e.id, e.created_at, coalesce(nullif(e.actor_name, ''), nullif(p.full_name, ''), nullif(p.name, '')) as author, e.comment as body
      from defects d join public.snag_events e on e.snag_id = d.id
      left join public.profiles p on p.id = e.created_by_user_id
      where e.event_type in ('note', 'comment', 'status_change', 'triage') and nullif(btrim(e.comment), '') is not null
      union all
      select c.snag_id, c.id, c.created_at, coalesce(nullif(p.full_name, ''), nullif(p.name, '')), c.body
      from defects d join public.snag_comments c on c.snag_id = d.id
      left join public.profiles p on p.id = c.user_id
      where nullif(btrim(c.body), '') is not null
    ), comment_lists as (
      select snag_id, jsonb_agg(jsonb_build_object('at', created_at, 'author', author, 'body', body)
        order by created_at desc, id desc) as comments from comment_rows group by snag_id
    ), with_photos as (
      select distinct p.snag_id from defects d join public.snag_photos p on p.snag_id = d.id where p.media_type is distinct from 'video'
    )
    select coalesce(jsonb_agg(to_jsonb(projected) order by projected.raised_on, projected.id), '[]') into data from (
      select d.id, d.building_id,
        coalesce(u.unit_number, f.flat_reference, case when d.unit_id is null then coalesce(area.name, 'Communal') end) as flat_or_area,
        case when u.id is not null or f.id is not null then area.name end as location,
        d.title, nullif(d.description, d.title) as description, (d.created_at at time zone 'Europe/London')::date as raised_on, d.status,
        o.name as contractor, t.name as trade,
        (ph.snag_id is not null or nullif(btrim(d.image_path), '') is not null) as has_photos,
        coalesce(c.comments, '[]') as comments
      from defects d
      left join public.units u on u.id = d.unit_id and u.building_id = d.building_id
      left join public.flats f on f.id = d.flat_id and f.building_name = (building->>'name') and d.unit_id is null
      left join public.areas area on area.id = d.area_id and area.building_id = d.building_id and area.unit_id is not distinct from d.unit_id
      left join public.organisations o on o.id = d.assigned_to_organisation_id
      left join public.trades t on t.id = d.trade_id
      left join with_photos ph on ph.snag_id = d.id
      left join comment_lists c on c.snag_id = d.id
    ) projected;
  end if;
  return jsonb_build_object('building', building, 'floors', coalesce(floors, '[]'), 'rows', data);
end;
$$;

revoke all on function sheets_backup.snapshot(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function sheets_backup.snapshot(uuid, text, uuid) to sheets_backup_runner;

commit;
