/*
  Bunnywell Portal - production clean-down preserving one admin

  PURPOSE
  -------
  Removes production application data and all non-admin Supabase Auth users,
  then recreates the preserved admin user's public profile.

  PRESERVED
  ---------
  - The Supabase Auth user whose email matches admin_email below.
  - Storage buckets and files.
  - Database schema, functions, triggers, policies and migrations.

  DELETED
  -------
  - All other Supabase Auth users.
  - All public application data other than the recreated admin profile.

  IMPORTANT
  ---------
  1. Take a production backup before using this script.
  2. Run it only in the Supabase SQL Editor for the production project.
  3. Change BOTH safety values below immediately before execution.
  4. Do not save real confirmation values into source control.
  5. Run the production template importer promptly afterwards.
*/

do $clean_down$
declare
  target_environment constant text := 'CHANGE_ME';
  confirmation constant text := 'CHANGE_ME';
  admin_email constant text := 'carl.gilbert@gmail.com';
  expected_confirmation text;
  admin_user_id uuid;
  table_list text;
  table_count integer;
  deleted_auth_users integer;
begin
  if lower(target_environment) <> 'production' then
    raise exception
      'Clean-down blocked: target_environment must be production.';
  end if;

  expected_confirmation :=
    'DELETE ALL BUNNYWELL PRODUCTION DATA EXCEPT ' || lower(admin_email);

  if confirmation <> expected_confirmation then
    raise exception
      'Clean-down blocked: confirmation must exactly equal "%".',
      expected_confirmation;
  end if;

  select id
  into admin_user_id
  from auth.users
  where lower(email) = lower(admin_email)
  order by created_at asc
  limit 1;

  if admin_user_id is null then
    raise exception
      'Clean-down blocked: admin Auth user "%" was not found.',
      admin_email;
  end if;

  select
    string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename),
    count(*)
  into table_list, table_count
  from pg_tables
  where schemaname = 'public'
    and tablename not in ('profiles', 'spatial_ref_sys');

  if table_list is null or table_count = 0 then
    raise exception 'Clean-down blocked: no public application tables were found.';
  end if;

  raise notice
    'Resetting % public application tables before deleting non-admin Auth users.',
    table_count;

  execute 'truncate table ' || table_list || ' restart identity cascade';

  delete from auth.users
  where lower(coalesce(email, '')) <> lower(admin_email);
  get diagnostics deleted_auth_users = row_count;

  delete from public.profiles
  where id <> admin_user_id;

  insert into public.profiles (id, email, full_name, name, role, active)
  values (admin_user_id, lower(admin_email), 'Carl Gilbert', 'Carl Gilbert', 'admin', true)
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    name = excluded.name,
    role = excluded.role,
    active = true,
    organisation_id = null,
    resident_type = null,
    updated_at = now();

  raise notice
    'Production clean-down complete. Deleted % non-admin Auth users. Preserved admin user: % (%).',
    deleted_auth_users,
    admin_email,
    admin_user_id;
end
$clean_down$;
