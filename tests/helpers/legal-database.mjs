import { readFileSync } from 'node:fs';
import { discussionDatabase } from './discussion-database.mjs';

export async function legalDatabase() {
  const f = await discussionDatabase();
  await f.owner();
  await f.db.exec(`
    create or replace function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
    alter table organisations add column type text;
    alter table organisations enable row level security;
    grant select on organisations,buildings to authenticated;
    alter table units add column updated_at timestamptz,add column rental_portfolio_status text default 'not_in_portfolio';
    alter table unit_sale_attempts add column exchanged_at date,add column completed_at date,add column redacted_at timestamptz,
      add column commercial_approved_at timestamptz,add column updated_at timestamptz,add column stage_entered_at timestamptz;
    alter table unit_sale_documents add column superseded_at timestamptz,add column required boolean,add column approved_at timestamptz,add column updated_at timestamptz;
    alter table unit_sale_documents add constraint unit_sale_documents_type_check check(true);
    alter table unit_sale_document_versions add column storage_bucket text,add column storage_path text,add column mime_type text,add column file_size_bytes bigint,add column uploaded_at timestamptz default now();
    create table unit_sale_terms(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid references unit_sale_attempts,version_number int default 1,is_current boolean default true,
      contract_price numeric,reservation_fee numeric,reservation_fee_holder text,exchange_deposit_percent numeric,deposit_summary text,
      developer_contribution numeric default 0,agent_contribution numeric default 0,other_concessions numeric default 0,parking_value numeric default 0,
      parking_contribution_value numeric default 0,parking_location_details text,additional_special_conditions text[] default '{}',commercial_summary text);
    create table unit_sale_payment_schedule(id uuid primary key default gen_random_uuid(),sale_attempt_id uuid,sale_terms_id uuid,sequence_no int,payment_stage text,label text,due_event text,
      due_offset_days int,percent_of_contract_price numeric,fixed_amount numeric,expected_amount numeric,includes_reservation_fee boolean,notes text);
    grant all on all tables in schema public to service_role;
    grant select,insert,update,delete on unit_sale_attempts,unit_sale_terms,unit_sale_documents,unit_sale_document_versions to authenticated;
    create policy sales_write on unit_sale_attempts for all to authenticated using(can_access_sales_building(building_id));
  `);
  const allocation = readFileSync('supabase/migrations/20260828_commercial_unit_allocation.sql','utf8');
  for (const name of ['assert_commercial_unit_actor','sales_workflow_mark_unit_exchanged','sales_workflow_mark_unit_completed']) {
    const start = allocation.indexOf(`create or replace function public.${name}(`);
    await f.db.exec(allocation.slice(start,allocation.indexOf('$$;',start)+3));
  }
  await f.db.query("update unit_sale_attempts set workflow_status='approved',buyer_person_name='Buyer One' where id=$1",[f.ids.sale]);
  await f.db.query("update units set sale_status='reserved' where id=$1",[f.ids.unit]);
  await f.db.query("insert into unit_sale_terms(sale_attempt_id,contract_price,reservation_fee,reservation_fee_holder,exchange_deposit_percent) values($1,250000,2000,'sales_agent',10)",[f.ids.sale]);
  // Existing completed sale is deliberately untouched by migration.
  await f.db.query("update unit_sale_attempts set workflow_status='completed',completed_at='2026-08-01',exchanged_at='2026-07-01' where id=$1",[f.ids.replacement]);
  await f.db.exec(readFileSync('supabase/migrations/20260922_sales_legal_workflow.sql','utf8'));
  const solicitorOrg=crypto.randomUUID(),agentOrg=crypto.randomUUID();
  await f.db.query("insert into organisations(id,name,type,shared_system_email) values($1,'Legal Team','conveyancer','legal@example.test'),($2,'Agent Team','sales_agent','sales@example.test')",[solicitorOrg,agentOrg]);
  await f.db.query("update buildings set conveyancer_organisation_id=$1,sales_agent_organisation_id=$2,seller_name='Seller SPV Ltd' where id=$3",[solicitorOrg,agentOrg,f.ids.building]);
  async function as(user) { await f.as(user); await f.db.query("select set_config('request.jwt.claim.role','authenticated',false)"); }
  async function service(user='developer') {
    await f.owner(); await f.db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','service_role',false)",[f.ids[user] ?? user]);
    await f.db.exec('set role service_role');
  }
  async function snapshot(user='developer') { await service(user); return f.rpc('sales_legal_snapshot',{p_sale:f.ids.sale,p_actor:f.ids[user] ?? user}); }
  async function prepare({kind='authority',date=new Date(Date.now()+172800000).toISOString(),snap,id=crypto.randomUUID()}={}) {
    snap ??= await snapshot(); await service();
    return f.rpc('sales_legal_prepare_email',{p_sale:f.ids.sale,p_actor:f.ids.developer,p_id:id,p_kind:kind,p_snapshot:snap,p_email:{subject:'Saved subject',body:'Saved exact body',from:'Portal <portal@example.test>'},p_date:date});
  }
  async function sent(email) { await service(); await f.rpc('sales_legal_dispatch',{p_id:email.id,p_actor:f.ids.developer,p_status:'sending'}); return f.rpc('sales_legal_dispatch',{p_id:email.id,p_actor:f.ids.developer,p_status:'sent',p_message_id:`resend-${email.id}`}); }
  async function action(user,action,payload={}) { await service(user); return f.rpc('sales_legal_action',{p_sale:f.ids.sale,p_actor:f.ids[user],p_action:action,p_payload:payload}); }
  async function upload(type='completion_statement') { await service('solicitor'); return f.rpc('sales_legal_register_document',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_type:type,p_file:{path:`test/${crypto.randomUUID()}.pdf`,name:'statement.pdf',size:100}}); }
  return {...f,as,service,snapshot,prepare,sent,action,upload,solicitorOrg,agentOrg};
}
