import { readFileSync } from "node:fs";
import { furtherDepositDatabase } from "./further-deposit-database.mjs";

export const agentFeeMigration = "supabase/migrations/20261020160052_initialise_baseline_agent_fee_split.sql";

export async function agentFeeInheritanceDatabase() {
  const f = await furtherDepositDatabase();
  await f.owner();
  await f.db.exec(`
    alter table unit_sale_terms add column status text default 'draft',
      add column approved_at timestamptz, add column approved_by_user_id uuid,
      add column agent_fee_percent numeric, add column exchange_agent_fee_percent numeric,
      add column completion_agent_fee_percent numeric;
    alter table building_sale_defaults add column default_agent_fee_percent numeric,
      add column default_exchange_agent_fee_percent numeric,
      add column default_completion_agent_fee_percent numeric;
    alter table unit_sale_terms add constraint unit_sale_terms_agent_fee_structure_check check (
      (agent_fee_percent is null and exchange_agent_fee_percent=0 and completion_agent_fee_percent=0)
      or (agent_fee_percent between 0 and 100 and exchange_agent_fee_percent between 0 and 100
        and completion_agent_fee_percent between 0 and 100
        and round(exchange_agent_fee_percent+completion_agent_fee_percent,4)=round(agent_fee_percent,4))
    );
  `);
  // Reproduce the existing normaliser before applying the new migration.
  const source = readFileSync("supabase/migrations/20260825_agent_fees_workspace.sql", "utf8");
  const start = source.indexOf("create or replace function public.normalise_unit_sale_agent_fee_structure()");
  const end = source.indexOf("alter table public.unit_sale_documents", start);
  await f.db.exec(source.slice(start, end));
  await f.db.query(`insert into building_sale_defaults(building_id,default_agent_fee_percent,
    default_exchange_agent_fee_percent,default_completion_agent_fee_percent) values($1,10,9.5,0.5)`, [f.ids.building]);

  async function baseline({ total = null, exchange = null, completion = null, system = true, unitStatus = "for_sale" } = {}) {
    await f.owner();
    const id = crypto.randomUUID();
    await f.db.query("insert into units(id,building_id,unit_number,sale_status) values($1,$2,$3,$4)", [id, f.ids.building, id.slice(0, 8), unitStatus]);
    await f.db.query("insert into unit_sale_attempts(id,unit_id,building_id,workflow_status,is_system_baseline) values($1,$1,$2,'draft',$3)", [id, f.ids.building, system]);
    await f.db.query(`insert into unit_sale_terms(sale_attempt_id,contract_price,agent_fee_percent,
      exchange_agent_fee_percent,completion_agent_fee_percent) values($1,211000,$2,$3,$4)`, [id, total, exchange, completion]);
    return id;
  }
  async function terms(id) { return (await f.db.query("select * from unit_sale_terms where sale_attempt_id=$1", [id])).rows[0]; }
  async function repair() { await f.owner(); await f.db.exec(readFileSync(agentFeeMigration, "utf8")); }
  return { ...f, baseline, terms, repair };
}
