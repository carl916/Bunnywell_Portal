-- Run in PRODUCTION Supabase SQL Editor and return the single result.
-- Read-only: inventories only Trinity Point units 69-86 and transfer dependencies.
-- Does not export tenant names, arrears narratives, passwords or credentials.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';

with buildings as (
  select id, name, address_line_1, postcode
  from public.buildings where lower(trim(name)) = 'trinity point'
), expected_units as (
  select generate_series(69, 86)::text as unit_number
), units as (
  select u.id, u.building_id, u.unit_number, u.sale_status,
    u.rental_portfolio_status, u.reservation_date, u.completion_date, u.handover_date
  from public.units u join buildings b on b.id = u.building_id
  join expected_units e on e.unit_number = trim(u.unit_number)
), tenancies as (
  select t.id, t.unit_id, t.building_id, t.source_reference,
    t.tenancy_start_date, t.tenancy_end_date
  from public.unit_tenancies t join units u on u.id = t.unit_id
), episodes as (
  select e.id, e.tenancy_id, e.source_import_key
  from public.rental_arrears_episodes e join tenancies t on t.id = e.tenancy_id
), sale_attempts as (
  select a.id, a.unit_id, a.workflow_status, a.is_active, a.is_system_baseline,
    public.sale_attempt_blocks_unit_allocation(a.id) as blocks_allocation
  from public.unit_sale_attempts a join units u on u.id = a.unit_id
)
select jsonb_pretty(jsonb_build_object(
  'captured_at', current_timestamp,
  'building_matches', coalesce((select jsonb_agg(to_jsonb(b)) from buildings b), '[]'::jsonb),
  'expected_unit_count', 18,
  'matched_unit_count', (select count(*) from units),
  'units', coalesce((select jsonb_agg(to_jsonb(u) order by u.unit_number::integer) from units u), '[]'::jsonb),
  'missing_unit_numbers', coalesce((select jsonb_agg(e.unit_number order by e.unit_number::integer) from expected_units e where not exists(select 1 from units u where trim(u.unit_number) = e.unit_number)), '[]'::jsonb),
  'duplicate_unit_numbers', coalesce((select jsonb_agg(to_jsonb(d)) from (select trim(unit_number) as unit_number, count(*) as matches from units group by trim(unit_number) having count(*) > 1) d), '[]'::jsonb),
  'existing_tenancies', coalesce((select jsonb_agg(to_jsonb(t)) from tenancies t), '[]'::jsonb),
  'existing_arrears_episode_count', (select count(*) from episodes),
  'existing_arrears_event_count', (select count(*) from public.rental_arrears_events e join episodes p on p.id = e.episode_id),
  'existing_import_runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'source_reference', r.source_reference, 'status', r.status)) from public.rental_import_runs r join buildings b on b.id = r.building_id), '[]'::jsonb),
  'existing_sale_attempts', coalesce((select jsonb_agg(to_jsonb(a)) from sale_attempts a), '[]'::jsonb),
  'letting_agent_matches', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type)) from public.organisations o where lower(trim(o.name)) = 'rmj'), '[]'::jsonb),
  'actor_matches', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'active', p.active)) from public.profiles p where lower(trim(p.email)) = 'carl.gilbert@gmail.com'), '[]'::jsonb)
)) as trinity_point_transfer_preflight;

commit;
