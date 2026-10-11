import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {discussionDatabase} from "./helpers/discussion-database.mjs";

test("unchanged portfolio RPC rejects sales agents, conveyancers, forged requester and inactive internal users",async t=>{
  const f=await discussionDatabase();t.after(()=>f.db.close());await f.owner();
  await f.db.exec(`
    alter table unit_sale_attempts add column sales_agent_organisation_id uuid;
    create table unit_sale_terms(sale_attempt_id uuid,version_number int,is_current boolean,contract_price numeric,exchange_agent_fee_percent numeric,completion_agent_fee_percent numeric,vat_rate numeric);
    alter table unit_sale_invoices add column invoice_type text,add column fee_milestone text,add column status text,add column created_at timestamptz,
      add column approved_at timestamptz,add column gross_amount numeric,add column expected_payable_amount numeric,add column reservation_fee_deduction numeric,add column agent_contribution_deduction numeric;
    alter table unit_sale_invoice_payments add column invoice_id uuid,add column payment_source text,add column payer_type text,add column amount numeric,add column voided_at timestamptz,add column paid_at timestamptz,add column created_at timestamptz;
  `);
  await f.db.exec(readFileSync("supabase/migrations/20260825c_agent_fee_portfolio.sql","utf8"));
  for(const role of ["agent","solicitor","outsider"]){
    await f.as(role);
    await assert.rejects(f.db.query("select * from get_agent_fee_portfolio($1)",[f.ids[role]]),/Only developers or admins/);
    await assert.rejects(f.db.query("select * from get_agent_fee_portfolio($1)",[f.ids.developer]),/cannot view/);
  }
  await f.as("developer");
  const result=await f.db.query("select * from get_agent_fee_portfolio($1)",[f.ids.developer]);assert.equal(result.rows.length,2);
  await f.owner();await f.db.query("update profiles set active=false where id=$1",[f.ids.developer]);await f.as("developer");
  await assert.rejects(f.db.query("select * from get_agent_fee_portfolio($1)",[f.ids.developer]),/Only developers or admins/);
});
