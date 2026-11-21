import { globSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function sqlFunction(path, marker) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(marker);
  return source.slice(start, source.indexOf('$$;', start) + 3);
}

export async function snagNotificationDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema workspace_commands; create schema storage;
    grant usage on schema auth to authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select jsonb_build_object('role', current_setting('request.jwt.claim.role', true))$$;
    create type public.user_role as enum ('admin', 'developer', 'developer_representative', 'contractor', 'resident', 'sales_agent');
    create type public.snag_status as enum ('open', 'closed', 'resolved_by_contractor', 'needs_more_info', 'rejected_back_to_contractor', 'in_progress');
    create table public.profiles(id uuid primary key, name text, full_name text, role public.user_role,
      email text, active boolean default true, organisation_id uuid);
    create table public.buildings(id uuid primary key, name text);
    create table public.building_organisations(building_id uuid, organisation_id uuid, role_on_project text, active boolean default true);
    create table public.user_building_access(user_id uuid, building_id uuid);
    create table public.user_unit_access(user_id uuid, unit_id uuid);
    create table public.units(id uuid, building_id uuid);
    create table public.areas(id uuid, unit_id uuid, building_id uuid);
    create table public.trades(id uuid, active boolean);
    create table public.snags(id uuid primary key default gen_random_uuid(), building_id uuid, unit_id uuid,
      area_id uuid, source_type text default 'developer_snag', created_by_user_id uuid, created_by uuid,
      title text, description text, status public.snag_status not null default 'open', priority_code text,
      priority int, trade_id uuid, sla_due_date timestamptz, assigned_to_user_id uuid,
      assigned_to_organisation_id uuid, updated_at timestamptz default statement_timestamp(), closed_at timestamptz);
    create table public.snag_events(id uuid primary key default gen_random_uuid(), snag_id uuid, event_type text,
      comment text, created_by_user_id uuid);
    create table public.snag_comments(id uuid primary key default gen_random_uuid(), snag_id uuid, body text);
    create table public.audit_events(event_type text, entity_type text, entity_id uuid, summary text, category text,
      created_by_user_id uuid, metadata jsonb, action_id uuid, source text, outcome text);
    create table workspace_commands.notification_dispatch_state(enabled boolean, stage3_active boolean);
    insert into workspace_commands.notification_dispatch_state values(true,true);
    create table workspace_commands.operation_receipts(id uuid primary key, actor_id uuid, action text, target_id uuid,
      input jsonb, result jsonb);
    create table workspace_commands.snag_media_intents(id uuid, actor_id uuid, building_id uuid, snag_id uuid,
      action text, path text, mime text, size bigint);
    create function public.current_app_role() returns text language sql stable security definer as
      $$select role::text from public.profiles where id=auth.uid() and active$$;
    create function public.current_organisation_id() returns uuid language sql stable security definer as
      $$select organisation_id from public.profiles where id=auth.uid() and active$$;
    create function public.is_setup_admin() returns boolean language sql stable security definer as
      $$select coalesce(public.current_app_role() in ('admin','developer'),false)$$;
    create function public.can_access_unit(uuid) returns boolean language sql stable as $$select false$$;
    create function public.can_access_building(target uuid) returns boolean language sql stable security definer as $$
      select public.is_setup_admin() or exists (select 1 from public.user_building_access a where a.building_id=target and a.user_id=auth.uid())
        or exists (select 1 from public.user_unit_access a join public.units u on u.id=a.unit_id where a.user_id=auth.uid() and u.building_id=target)
        or (public.current_app_role() in ('developer_representative','contractor') and exists
          (select 1 from public.building_organisations bo where bo.building_id=target and bo.active and bo.organisation_id=public.current_organisation_id()))
    $$;
    create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql as $$
      begin
        if auth.jwt()->>'role' is distinct from 'service_role' or p_actor is distinct from auth.uid() or not public.is_setup_admin()
        then raise exception 'Setup denied.' using errcode='42501'; end if;
      end $$;
  `);
  const accessMigration = 'supabase/migrations/20260703_building_responsible_organisations.sql';
  await db.exec(sqlFunction(accessMigration, 'create or replace function public.contractor_can_access_developer_snag('));
  await db.exec(sqlFunction(accessMigration, 'create or replace function public.can_access_snag_row('));
  await db.exec(`
    create function public.can_access_snag(p_snag uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.snags s where s.id=p_snag
        and public.can_access_snag_row(s.source_type,s.building_id,s.unit_id,s.assigned_to_organisation_id,s.created_by_user_id))
    $$;
  `);
  const operations = 'supabase/migrations/20261118143432_staging_workspace.sql';
  await db.exec(`
    create table workspace_commands.test_entities (kind text, entity_id uuid);
  `);
  await db.exec(sqlFunction(operations, 'create function workspace_commands.snag_actor('));
  await db.exec(sqlFunction(operations, 'create function public.workspace_snag_operation('));
  await db.exec('grant execute on function public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb) to authenticated;');
  await db.exec(readFileSync(globSync('supabase/migrations/*_snag_notification_digest.sql')[0], 'utf8'));

  const names = ['developer', 'otherDeveloper', 'representative', 'contractor', 'otherContractor', 'resident', 'building', 'otherBuilding', 'org', 'otherOrg'];
  const ids = Object.fromEntries(names.map(name => [name, crypto.randomUUID()]));
  await db.query('insert into public.buildings values($1,$2),($3,$4)', [ids.building, 'Synthetic Snags', ids.otherBuilding, 'Separate Building']);
  await db.query("insert into workspace_commands.test_entities values ('building',$1),('building',$2)", [ids.building, ids.otherBuilding]);
  await db.query("insert into public.building_organisations values($1,$2,'main_contractor',true),($1,$3,'supporting_trade',true)",
    [ids.building, ids.org, ids.otherOrg]);
  const roles = { developer: 'developer', otherDeveloper: 'developer', representative: 'developer_representative',
    contractor: 'contractor', otherContractor: 'contractor', resident: 'resident' };
  for (const [name, role] of Object.entries(roles)) {
    const org = name === 'contractor' ? ids.org : name === 'otherContractor' ? ids.otherOrg : null;
    await db.query('insert into public.profiles(id,full_name,email,role,organisation_id) values($1,$2,$3,$4,$5)',
      [ids[name], name, name.toLowerCase() + '@example.test', role, org]);
  }
  await db.query('insert into public.user_building_access values($1,$2)', [ids.representative, ids.building]);

  async function as(role, user = 'developer') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)",
      [role, ids[user] ?? user]);
    await db.exec('set role ' + role);
  }
  async function rows(query, parameters = []) {
    await db.exec('reset role');
    return (await db.query(query, parameters)).rows;
  }
  async function worker(action, payload = {}, workerId = crypto.randomUUID()) {
    await as('service_role');
    const result = await db.query('select public.workspace_snag_notification_worker($1,$2,$3) as value', [workerId, action, payload]);
    return result.rows[0].value;
  }
  async function addSnag({ building = ids.building, org = null, title = 'Synthetic snag', creator = ids.developer, priority = null } = {}) {
    const [snag] = await rows(`insert into public.snags(building_id, assigned_to_organisation_id,title,created_by_user_id,priority_code)
      values($1,$2,$3,$4,$5) returning id`, [building, org, title, creator, priority]);
    return snag.id;
  }
  async function comment(snag, mentions, request = crypto.randomUUID(), user = 'developer') {
    await as('authenticated', user);
    return (await db.query("select public.workspace_snag_operation($1,$2,$3,'snag_comment',$4) as value",
      [ids.building, snag, request, { comment: 'Synthetic comment', mentions }])).rows[0].value;
  }
  return { db, rows, as, worker, addSnag, comment, ids };
}
