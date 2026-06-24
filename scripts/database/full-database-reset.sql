/*
  Bunnywell Portal - full application-data reset

  PURPOSE
  -------
  Deletes all rows from every ordinary table in the public schema so that the
  cleanup-template importer can repopulate the environment.

  PRESERVED
  ---------
  - Supabase Auth users (auth.users)
  - Storage buckets and files (storage schema)
  - Database schema, functions, triggers, policies and migrations

  DELETED
  -------
  All application data in public tables, including profiles, access records,
  buildings, floors, units, areas, organisations, snags, snag history,
  handovers, reports, imports and audit records.

  IMPORTANT
  ---------
  1. Take a backup before using this script.
  2. Run it in the Supabase SQL Editor for the intended project.
  3. Change BOTH safety values below immediately before execution.
  4. Do not save real confirmation values into source control.
  5. Run the importer promptly afterwards. Auth users remain, but the app will
     not recognise them until their public profiles are recreated.

  This script deliberately does not delete Storage files. Removing rows from
  storage.objects directly can orphan the underlying files. Use the Supabase
  Storage API separately if stored photographs must also be removed.
*/

do $reset$
declare
  target_environment constant text := 'CHANGE_ME';
  confirmation constant text := 'CHANGE_ME';
  expected_confirmation text;
  table_list text;
  table_count integer;
begin
  if lower(target_environment) not in ('staging', 'production') then
    raise exception
      'Reset blocked: target_environment must be either staging or production.';
  end if;

  expected_confirmation :=
    'DELETE ALL BUNNYWELL DATA FROM ' || upper(target_environment);

  if confirmation <> expected_confirmation then
    raise exception
      'Reset blocked: confirmation must exactly equal "%".',
      expected_confirmation;
  end if;

  select
    string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename),
    count(*)
  into table_list, table_count
  from pg_tables
  where schemaname = 'public'
    -- PostGIS may place this extension-owned reference table in public.
    and tablename <> 'spatial_ref_sys';

  if table_list is null or table_count = 0 then
    raise exception 'Reset blocked: no public application tables were found.';
  end if;

  raise notice
    'Resetting % public tables in the % environment.',
    table_count,
    target_environment;

  execute 'truncate table ' || table_list || ' restart identity cascade';

  raise notice
    'Bunnywell public application data reset complete for %.',
    target_environment;
end
$reset$;
