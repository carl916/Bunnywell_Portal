import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

/** @type {Record<string,string>} */
export const ids = Object.fromEntries(['developer','agent','solicitor','outsider','revoked','building','unit','sale','replacement','otherUnit'].map((key, i) => [key, `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
// Minimal existing schema / auth adapter. The feature migrations below are
// executed unchanged by PostgreSQL, including their RLS and PL/pgSQL bodies.
const defaultIds = ids;
export async function discussionDatabase(overrides = {}, { includeBuildingAgentsMigration = true } = {}) {
  /** @type {Record<string,string>} */
  const ids = { ...defaultIds, ...overrides };
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table organisations(id uuid primary key,name text);
    create type public.user_role as enum ('admin','developer','sales_agent','conveyancer','user');
    create table profiles(id uuid primary key,name text,full_name text,email text,role public.user_role,active boolean default true,organisation_id uuid references organisations);
    create table buildings(id uuid primary key,name text);
    create table units(id uuid primary key,building_id uuid references buildings,unit_number text,sale_status text);
    create table user_building_access(user_id uuid,building_id uuid);
    create table building_organisations(building_id uuid,organisation_id uuid,role_on_project text,active boolean);
    create table unit_sale_attempts(id uuid primary key default gen_random_uuid(),building_id uuid references buildings,unit_id uuid references units,attempt_number integer default 1,
      is_active boolean default true,workflow_status text default 'draft',created_by_user_id uuid,updated_by_user_id uuid,reservation_submitted_by_user_id uuid,
      reservation_approved_by_user_id uuid,reservation_rejected_by_user_id uuid,commercial_approved_by_user_id uuid,redacted_by_user_id uuid,
      buyer_name text,buyer_person_name text,buyer_company_name text,is_system_baseline boolean default false,created_at timestamptz default now());
    create unique index active_sale on unit_sale_attempts(unit_id) where is_active;
    create table unit_sale_documents(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,document_type text,title text,status text,
      visibility text default 'shared_sale_file',fee_milestone text,query_note text,redacted_at timestamptz,updated_by_user_id uuid,
      created_by_user_id uuid,approved_by_user_id uuid,redacted_by_user_id uuid);
    create table unit_sale_document_versions(id uuid primary key default gen_random_uuid(),document_id uuid references unit_sale_documents,version_number integer,is_current boolean default true,
      file_name text,redacted_at timestamptz,uploaded_by_user_id uuid,redacted_by_user_id uuid);
    create table unit_sale_invoices(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,
      created_by_user_id uuid,updated_by_user_id uuid,approved_by_user_id uuid);
    create table unit_sale_invoice_payments(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,
      recorded_by_user_id uuid,voided_by_user_id uuid);
    create table unit_sale_notes(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,
      visibility text default 'shared_sale_file',created_by_user_id uuid,redacted_by_user_id uuid);
    create table unit_sale_workflow_events(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,building_id uuid,unit_id uuid,
      event_type text,from_status text,to_status text,summary text,metadata jsonb default '{}',created_by_user_id uuid,created_at timestamptz default now());
    grant select on unit_sale_workflow_events to authenticated;
    create table audit_events(id uuid primary key default gen_random_uuid(),event_type text,entity_type text,entity_id uuid,summary text,metadata jsonb,created_by_user_id uuid);
    create function current_app_role() returns text language sql stable security definer as $$select role::text from profiles where id=auth.uid() and active$$;
    create function is_sales_internal_user() returns boolean language sql stable security definer as $$select coalesce(current_app_role() in ('admin','developer'),false)$$;
    create function can_access_sales_building(target_building_id uuid) returns boolean language sql stable security definer as $$select is_sales_internal_user() or exists(select 1 from user_building_access where user_id=auth.uid() and building_id=target_building_id)$$;
    create function can_access_sale_attempt(target_sale_attempt_id uuid) returns boolean language sql stable security definer as $$select exists(select 1 from unit_sale_attempts where id=target_sale_attempt_id and can_access_sales_building(building_id))$$;
    alter table unit_sale_attempts enable row level security;
    create policy sales_read on unit_sale_attempts for select to authenticated using(can_access_sales_building(building_id));
    grant select on unit_sale_attempts to authenticated;
    alter table profiles enable row level security;
    create policy profile_self on profiles for select to authenticated using(id=auth.uid());
    grant select on profiles to authenticated;
    create function sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid) returns boolean language sql stable security definer as $$select false$$;
  `);
  await db.query('insert into buildings values($1,$2)', [ids.building, 'Synthetic House']);
  for (const unit of [ids.unit, ids.otherUnit]) await db.query('insert into units values($1,$2,$3,$4)', [unit, ids.building, unit === ids.unit ? '101' : '102', 'for_sale']);
  for (const name of ['developer','agent','solicitor','outsider','revoked']) {
    await db.query('insert into profiles(id,full_name,role) values($1,$2,$3)', [ids[name], `Test ${name}`, name === 'developer' ? 'developer' : name === 'solicitor' ? 'conveyancer' : 'sales_agent']);
    await db.query('insert into user_building_access values($1,$2)', [ids[name], ids.building]);
  }
  await db.query('insert into unit_sale_attempts(id,building_id,unit_id,created_by_user_id,buyer_name) values($1,$2,$3,$4,$5)', [ids.sale, ids.building, ids.unit, ids.agent, 'Original Buyer']);
  await db.query('insert into unit_sale_attempts(id,building_id,unit_id,created_by_user_id) values($1,$2,$3,$4)', [ids.replacement, ids.building, ids.otherUnit, ids.outsider]);
  for (const name of ['20260907_sale_discussions.sql','20260907b_sale_activity_projection.sql',
    ...(includeBuildingAgentsMigration ? ['20260908_sale_discussion_building_agents.sql'] : []),
    '20260908b_sale_actor_names.sql']) await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  async function as(user) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[user] ?? user]);
    await db.exec('set role authenticated');
  }
  async function owner() { await db.exec('reset role'); }
  async function rpc(name, args = {}) {
    const entries = Object.entries(args);
    const sql = `select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as result`;
    return (await db.query(sql, entries.map(([,value]) => value))).rows[0].result;
  }
  async function write(body, extra = {}) { return rpc('sale_comment_write', { p_sale: ids.sale, p_body: body, p_client: crypto.randomUUID(), ...extra }); }
  await as('developer');
  return { db, as, owner, rpc, write, ids };
}
