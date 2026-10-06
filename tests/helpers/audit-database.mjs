import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
export const ids = Object.fromEntries(['admin','developer','resident','contractor','agent','conveyancer','rep','inactive','building','unit','snag','sale','invoice','payment'].map((k,i)=>[k,`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
export async function auditDatabase() {
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create type public.user_role as enum ('admin','developer','resident','contractor','sales_agent','conveyancer','developer_representative');
    create type public.snag_status as enum ('open','accepted','closed','resolved_by_contractor');
    create table organisations(id uuid primary key,name text);
    create table profiles(id uuid primary key,email text,full_name text,name text,phone text,role user_role,resident_type text,organisation_id uuid,active boolean default true,last_active_at timestamptz);
    create table buildings(id uuid primary key,name text);
    create table units(id uuid primary key default gen_random_uuid(),building_id uuid references buildings,unit_number text not null,floor text,size_sqm numeric,parking_bays jsonb,unit_type text,unit_type_id uuid);
    create table user_building_access(id uuid primary key default gen_random_uuid(),user_id uuid,building_id uuid references buildings,role_on_building text,unique(user_id,building_id));
    create table user_unit_access(id uuid primary key default gen_random_uuid(),user_id uuid,unit_id uuid references units,access_type text,unique(user_id,unit_id,access_type));
    create table resident_access_requests(id uuid primary key,status text,admin_notes text,reviewed_by_user_id uuid);
    create table areas(id uuid primary key,building_id uuid,unit_id uuid,name text,area_type text,sort_order integer);
    create table audit_events(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),created_by_user_id uuid,event_type text,entity_type text,entity_id uuid,summary text,metadata jsonb default '{}',category text,building_id uuid,unit_id uuid,affected_user_id uuid,source text,actor_organisation_id uuid,field_name text,previous_value jsonb,new_value jsonb);
    create table unit_sale_attempts(id uuid primary key,building_id uuid,unit_id uuid,workflow_status text,buyer_email text);
    create table unit_sale_terms(id uuid primary key,sale_attempt_id uuid,contract_price numeric);
    create table unit_sale_invoices(id uuid primary key,sale_attempt_id uuid,status text,invoice_type text,expected_payable_amount numeric,expected_gross_amount numeric,reservation_fee_deduction numeric,agent_contribution_deduction numeric,gross_amount numeric);
    create table unit_sale_invoice_payments(id uuid primary key,sale_attempt_id uuid,invoice_id uuid,amount numeric,paid_at date,payment_source text,voided_at timestamptz);
    create table unit_sale_workflow_events(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),created_by_user_id uuid,sale_attempt_id uuid,building_id uuid,unit_id uuid,event_type text,summary text,metadata jsonb default '{}',from_status text,to_status text);
    create table snags(id uuid primary key,building_id uuid,unit_id uuid,status snag_status,priority_code text,trade_id uuid,assigned_to_organisation_id uuid,assigned_to_user_id uuid,sla_due_date timestamptz,closed_at timestamptz);
    create table snag_events(id uuid primary key default gen_random_uuid(),snag_id uuid,created_by_user_id uuid,created_at timestamptz default now(),event_type text,old_value text,new_value text,comment text);
    create table auth.audit_log_entries(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),payload jsonb);
    create function public.is_setup_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','developer'))$$;
    create function public.can_access_unit(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_setup_admin() or exists(select 1 from public.user_unit_access where user_id=auth.uid() and unit_id=p_unit)$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant all on all tables in schema public to anon,authenticated,service_role;
    alter table audit_events enable row level security;
    create policy audit_read on audit_events for select to authenticated using(is_setup_admin());
    create policy audit_insert on audit_events for insert to authenticated with check(is_setup_admin() and created_by_user_id=auth.uid());
    alter table snags enable row level security;
    create policy snag_read on snags for select to authenticated using(is_setup_admin());
    create policy snag_write on snags for update to authenticated using(is_setup_admin()) with check(is_setup_admin());
  `);
  for(const [name,role] of Object.entries({admin:'admin',developer:'developer',resident:'resident',contractor:'contractor',agent:'sales_agent',conveyancer:'conveyancer',rep:'developer_representative',inactive:'admin'})) await db.query('insert into profiles(id,role,active) values($1,$2,$3)',[ids[name],role,name!=='inactive']);
  await db.query('insert into buildings values($1,$2)',[ids.building,'Synthetic House']);
  await db.query('insert into units(id,building_id,unit_number) values($1,$2,$3)',[ids.unit,ids.building,'E2E']);
  await db.query('insert into unit_sale_attempts(id,building_id,unit_id,workflow_status) values($1,$2,$3,$4)',[ids.sale,ids.building,ids.unit,'draft']);
  await db.query('insert into snags(id,building_id,unit_id,status) values($1,$2,$3,$4)',[ids.snag,ids.building,ids.unit,'open']);
  let migration=readFileSync('supabase/migrations/20261006134823_reliable_audit_increment.sql','utf8');
  // PGlite has no cron scheduler; only that managed extension setup is omitted.
  // The complete unmodified migration and cron job are also verified in staging.
  migration=migration.replace(/create extension if not exists pg_cron[\s\S]*?-- Query through/, '-- Query through');
  await db.exec(migration);
  await db.exec('alter table unit_sale_workflow_events add column actor_name text, add column actor_role text');
  async function as(name,service=false) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.headers',$2,false)",[
      JSON.stringify({role:service?'service_role':'authenticated',sub:ids[name]??name}),
      JSON.stringify({'x-bunnywell-audit-actor':service?ids[name]:ids.developer})]);
    await db.exec(`set role ${service?'service_role':'authenticated'}`);
  }
  async function owner(){await db.exec('reset role');}
  async function page(filters={},cursor=null){return (await db.query('select public.portal_audit_page($1,$2,$3,$4) as data',[filters,cursor?.created_at??null,cursor?.id??null,cursor?.source??null])).rows[0].data;}
  return {db,as,owner,page,ids};
}
