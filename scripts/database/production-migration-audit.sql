-- Run in the PRODUCTION Supabase SQL Editor and export the result as CSV.
-- This is a schema inventory, NOT a migration or proof of migration execution.
-- It reads database definitions, not customer records, and makes no changes.
-- Run the same query in staging if you want a live environment comparison.
-- Keep the exported definitions private: function bodies may contain literals.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';

with
relations as (
  select n.nspname as schema_name, c.relname as name, c.relkind as kind,
    c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
    c.relacl::text as grants,
    case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) end as view_definition
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
),
columns as (
  select c.relname as table_name, a.attname as column_name,
    a.attnum as ordinal_position, format_type(a.atttypid, a.atttypmod) as data_type,
    a.attnotnull as not_null, a.attidentity as identity_kind,
    a.attgenerated as generated_kind, pg_get_expr(d.adbin, d.adrelid) as default_expression
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and a.attnum > 0 and not a.attisdropped
),
constraints as (
  select c.conrelid::regclass::text as table_name, c.conname as name,
    c.contype as kind, c.convalidated as validated,
    pg_get_constraintdef(c.oid, true) as definition
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
),
indexes as (
  select t.relname as table_name, c.relname as name,
    i.indisvalid as valid, i.indisready as ready,
    pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
  join pg_class t on t.oid = i.indrelid
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
),
functions as (
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer, p.proconfig as settings,
    p.proacl::text as grants, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
),
triggers as (
  select c.relname as table_name, t.tgname as name,
    t.tgenabled as enabled, pg_get_triggerdef(t.oid, true) as definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),
policies as (
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname in ('public', 'storage')
),
enums as (
  select t.typname as name, e.enumlabel as label, e.enumsortorder as sort_order
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
)
select jsonb_pretty(jsonb_build_object(
  'captured_at', current_timestamp,
  'database_name', current_database(),
  'migration_history_table_exists', to_regclass('supabase_migrations.schema_migrations') is not null,
  'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from relations r), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(to_jsonb(r) order by r.table_name, r.ordinal_position) from columns r), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(to_jsonb(r) order by r.table_name, r.name) from constraints r), '[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(to_jsonb(r) order by r.table_name, r.name) from indexes r), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(r) order by r.name, r.arguments) from functions r), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(r) order by r.table_name, r.name) from triggers r), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(to_jsonb(r) order by r.schemaname, r.tablename, r.policyname) from policies r), '[]'::jsonb),
  'enums', coalesce((select jsonb_agg(to_jsonb(r) order by r.name, r.sort_order) from enums r), '[]'::jsonb)
)) as schema_audit;

commit;

-- Optional separate query, ONLY if migration_history_table_exists is true:
-- select version, name from supabase_migrations.schema_migrations order by version;
-- An absent/empty history does not mean manually pasted migrations never ran.
