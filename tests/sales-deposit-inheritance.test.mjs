import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { furtherDepositDatabase } from "./helpers/further-deposit-database.mjs";

const migration = readFileSync("supabase/migrations/20261020145955_repair_inherited_sale_deposits.sql", "utf8");
const fixed = { basis: "fixed", date: "2027-04-01", time: "17:00" };

async function fixture(t) {
  const f = await furtherDepositDatabase();
  t.after(() => f.db.close());
  await f.owner();
  await f.db.exec("alter table unit_sale_terms add column status text default 'draft'; alter table unit_sale_payment_schedule add column status text default 'pending'");
  await f.db.query("insert into building_sale_defaults(building_id,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,further_deposit_timing) values($1,10,true,5,$2)", [f.ids.building, fixed]);
  async function baseline({ system = true, exchange = null, completion = null } = {}) {
    const id = crypto.randomUUID();
    await f.db.query("insert into units(id,building_id,unit_number,sale_status) values($1,$2,$3,'for_sale')", [id, f.ids.building, id.slice(0, 8)]);
    await f.db.query("insert into unit_sale_attempts(id,unit_id,building_id,workflow_status,is_system_baseline) values($1,$1,$2,'draft',$3)", [id, f.ids.building, system]);
    await f.db.query("insert into unit_sale_terms(sale_attempt_id,contract_price,exchange_deposit_percent,completion_balance_percent) values($1,201000,$2,$3)", [id, exchange, completion]);
    return id;
  }
  async function terms(id) { return (await f.db.query("select * from unit_sale_terms where sale_attempt_id=$1", [id])).rows[0]; }
  async function repair() { await f.db.exec(migration); }
  return { ...f, baseline, terms, repair };
}

test("repairs Priors Gate-shaped empty baselines and all server deposit previews without changing prices", async t => {
  const f = await fixture(t);
  const sale = await f.baseline();
  const before = await f.terms(sale);
  await f.repair();
  const after = await f.terms(sale);
  assert.equal(after.exchange_deposit_percent, "10");
  assert.equal(after.second_deposit_enabled, true);
  assert.equal(after.second_deposit_percent, "5");
  assert.equal(after.completion_balance_percent, "85");
  assert.equal(after.further_deposit_timing.instant, "2027-04-01T16:00:00+00:00");
  for (const field of ["id", "contract_price", "reservation_fee", "developer_contribution", "agent_contribution", "version_number"]) {
    assert.equal(after[field], before[field], field);
  }
  const context = await f.context("developer", sale);
  assert.equal(context.exchanged, false);
  assert.equal(context.exchange.percent, 10);
  assert.equal(context.exchange.preview_amount, 20100);
  assert.equal(context.further.required, true);
  assert.equal(context.further.expected_amount, 10050);
  assert.equal(context.further.timing.date, "2027-04-01");
  assert.equal(context.receipts.length, 0);
});

test("repair preserves explicit terms, real drafts, approved records, custom schedules and retained exchange snapshots", async t => {
  const f = await fixture(t);
  await f.exchange();
  await f.owner();
  const protectedSales = [f.ids.sale];
  protectedSales.push(await f.baseline({ system: false }));
  protectedSales.push(await f.baseline({ exchange: 15, completion: 85 }));
  protectedSales.push(await f.baseline({ exchange: 10, completion: 90 })); // Explicit no further deposit.
  await f.db.exec("select set_config('app.sales_legal_write','on',false)");
  for (const column of ["reservation_date", "reservation_submitted_at", "reservation_approved_at", "commercial_approved_at", "exchanged_at", "completed_at"]) {
    const id = await f.baseline();
    await f.db.query(`update unit_sale_attempts set ${column}='2026-10-01' where id=$1`, [id]);
    protectedSales.push(id);
  }
  const buyer = await f.baseline();
  await f.db.query("update unit_sale_attempts set buyer_name='Synthetic buyer' where id=$1", [buyer]);
  protectedSales.push(buyer);
  const approved = await f.baseline();
  await f.db.query("update unit_sale_terms set status='approved' where sale_attempt_id=$1", [approved]);
  protectedSales.push(approved);
  const document = await f.baseline();
  await f.db.query("insert into unit_sale_documents(sale_attempt_id,document_type,status) values($1,'reservation_form','uploaded')", [document]);
  protectedSales.push(document);
  for (const schedule of [
    { stage: "other", percent: 5, fixed: null, status: "pending" },
    { stage: "exchange", percent: 10, fixed: 20100, status: "pending" },
    { stage: "exchange", percent: 10, fixed: null, status: "paid" },
  ]) {
    const id = await f.baseline();
    await f.db.query("insert into unit_sale_payment_schedule(sale_attempt_id,payment_stage,percent_of_contract_price,fixed_amount,status) values($1,$2,$3,$4,$5)",
      [id, schedule.stage, schedule.percent, schedule.fixed, schedule.status]);
    protectedSales.push(id);
  }
  const snapshots = await Promise.all(protectedSales.map(id => f.terms(id)));
  const schedules = (await f.db.query("select * from unit_sale_payment_schedule order by id")).rows;
  const sources = (await f.db.query("select * from sale_exchange_deposit_sources order by id")).rows;
  await f.repair();
  assert.deepEqual(await Promise.all(protectedSales.map(id => f.terms(id))), snapshots);
  assert.deepEqual((await f.db.query("select * from unit_sale_payment_schedule order by id")).rows, schedules);
  assert.deepEqual((await f.db.query("select * from sale_exchange_deposit_sources order by id")).rows, sources);
});

test("future saves initialise empty baselines and retain inheritance through on/off changes and disabled zero values", async t => {
  const f = await fixture(t);
  await f.repair();
  const sale = await f.baseline();
  await f.db.query("update building_sale_defaults set exchange_deposit_percent=exchange_deposit_percent where building_id=$1", [f.ids.building]);
  assert.equal((await f.terms(sale)).second_deposit_percent, "5", "resaving the same defaults also repairs an empty baseline");
  await f.db.query("update building_sale_defaults set second_deposit_percent=6 where building_id=$1", [f.ids.building]);
  assert.equal((await f.terms(sale)).second_deposit_percent, "6");
  await f.db.query("update building_sale_defaults set second_deposit_enabled=false,second_deposit_percent=0 where building_id=$1", [f.ids.building]);
  assert.equal((await f.terms(sale)).second_deposit_percent, null);
  const override = await f.baseline({ exchange: 20, completion: 80 });
  await f.db.query("update building_sale_defaults set second_deposit_enabled=true,second_deposit_percent=5,further_deposit_timing=$2 where building_id=$1", [f.ids.building, fixed]);
  assert.equal((await f.terms(sale)).second_deposit_percent, "5");
  assert.equal((await f.terms(sale)).completion_balance_percent, "85");
  assert.equal((await f.terms(override)).exchange_deposit_percent, "20");
  const beforeNoop = await f.terms(sale);
  await f.db.query("update building_sale_defaults set exchange_deposit_percent=exchange_deposit_percent where building_id=$1", [f.ids.building]);
  assert.deepEqual(await f.terms(sale), beforeNoop);
  await f.as("developer");
  await assert.rejects(f.db.query("select public.sales_apply_inherited_deposits(d) from public.building_sale_defaults d"), /permission denied/);
});

test("first building defaults initialise existing empty baselines without creating sale attempts", async t => {
  const f = await fixture(t);
  await f.repair();
  await f.db.query("delete from building_sale_defaults where building_id=$1", [f.ids.building]);
  const sale = await f.baseline();
  const beforeCount = (await f.db.query("select count(*)::int as n from unit_sale_attempts")).rows[0].n;
  await f.db.query("insert into building_sale_defaults(building_id,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,further_deposit_timing) values($1,10,true,5,$2)", [f.ids.building, fixed]);
  assert.equal((await f.terms(sale)).completion_balance_percent, "85");
  assert.equal((await f.db.query("select count(*)::int as n from unit_sale_attempts")).rows[0].n, beforeCount);
});
