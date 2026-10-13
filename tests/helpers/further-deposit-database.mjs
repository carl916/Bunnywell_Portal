import { readFileSync } from 'node:fs';
import { legalDatabase } from './legal-database.mjs';
export const migration='supabase/migrations/20261013141431_further_deposit_configuration_and_receipts.sql';
export async function furtherDepositDatabase({ beforeMigration, initialiseTerms = true } = {}) {
  const f=await legalDatabase(); await f.owner();
  await f.db.exec(`
    alter table buildings add column pc_date text,add column practical_completion_date date;
    alter table unit_sale_attempts add column reservation_approved_at timestamptz,add column reservation_submitted_at timestamptz,
      add column reservation_date date,add column buyer_email text,add column buyer_phone text,add column buyer_solicitor_name text;
    alter table unit_sale_terms add column second_deposit_enabled boolean default false,add column second_deposit_percent numeric,
      add column second_deposit_months_after_exchange integer,add column completion_balance_percent numeric,add column updated_at timestamptz;
    create table building_sale_defaults(building_id uuid primary key references buildings(id),exchange_deposit_percent numeric,
      second_deposit_enabled boolean default false,second_deposit_percent numeric,second_deposit_months_after_exchange integer);
    grant select on unit_sale_terms,building_sale_defaults to authenticated,service_role;
    grant select on buildings to authenticated,service_role;
    create policy building_read on buildings for select to authenticated using(can_access_sales_building(id));
  `);
  await beforeMigration?.(f);
  await f.owner();
  await f.db.exec(readFileSync(migration,'utf8'));
  await f.db.query('update profiles set organisation_id=$1 where id=$2',[f.solicitorOrg,f.ids.solicitor]);
  if (initialiseTerms) await f.db.query("update unit_sale_terms set contract_price=300000,second_deposit_enabled=true,second_deposit_percent=5,completion_balance_percent=85,further_deposit_timing=$2 where sale_attempt_id=$1",[f.ids.sale,{basis:'fixed',date:'2027-04-01',time:'17:00'}]);
  async function exchange() { const email=await f.sent(await f.prepare()); await f.action('solicitor','confirm_exchange',{date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date())});return email; }
  async function context(user='solicitor',sale=f.ids.sale) { await f.service(user);return f.rpc('sales_deposit_context',{p_sale:sale,p_actor:f.ids[user]}); }
  async function action(action,payload,user='solicitor',sale=f.ids.sale) {await f.service(user);return f.rpc('sales_further_deposit_action',{p_sale:sale,p_actor:f.ids[user],p_action:action,p_payload:payload});}
  async function payload(extra={}) { const c=await context();return {sourceId:c.further.id,expectedReceivedAmount:c.further.received_amount,requestId:crypto.randomUUID(),amount:'10000',date:'2026-09-01',time:null,note:'Synthetic fixture',...extra}; }
  return {...f,exchange,context,depositAction:action,payload};
}
