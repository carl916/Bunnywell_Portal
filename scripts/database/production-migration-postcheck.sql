-- Read-only verification after the catch-up and rental privilege correction.
-- Checks effective privileges, including PUBLIC and inherited role grants.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';

with rental_tables(table_name) as (
  values ('public.unit_tenancies'), ('public.rental_arrears_episodes'),
    ('public.rental_arrears_events'), ('public.rental_import_runs')
), client_privilege_failures as (
  select t.table_name, r.role_name, p.privilege_name
  from rental_tables t
  cross join (values ('anon'), ('authenticated')) r(role_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
    ('REFERENCES'), ('TRIGGER')) p(privilege_name)
  where has_table_privilege(r.role_name, t.table_name, p.privilege_name)
), access_failures as (
  select t.table_name
  from rental_tables t
  where has_table_privilege('anon', t.table_name, 'SELECT')
    or not has_table_privilege('authenticated', t.table_name, 'SELECT')
    or not has_table_privilege('service_role', t.table_name, 'SELECT')
    or not has_table_privilege('service_role', t.table_name, 'INSERT')
    or not has_table_privilege('service_role', t.table_name, 'UPDATE')
    or not has_table_privilege('service_role', t.table_name, 'DELETE')
    or not (select relrowsecurity from pg_class where oid = t.table_name::regclass)
)
select jsonb_pretty(jsonb_build_object(
  'captured_at', current_timestamp,
  'unexpected_client_privileges', coalesce((select jsonb_agg(to_jsonb(f)) from client_privilege_failures f), '[]'::jsonb),
  'rental_access_failures', coalesce((select jsonb_agg(to_jsonb(f)) from access_failures f), '[]'::jsonb),
  'btree_gist_installed', exists(select 1 from pg_extension where extname = 'btree_gist'),
  'unit_count', (select count(*) from public.units),
  'units_outside_rental_portfolio', (select count(*) from public.units where rental_portfolio_status = 'not_in_portfolio'),
  'uncategorised_audit_events', (select count(*) from public.audit_events where category is null),
  'missing_last_active_with_known_sign_in', (
    select count(*) from public.profiles p join auth.users u on u.id = p.id
    where p.last_active_at is null and u.last_sign_in_at is not null
  )
)) as migration_postcheck;

commit;
