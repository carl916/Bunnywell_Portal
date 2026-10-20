import test from "node:test";
import assert from "node:assert/strict";
import { agentFeeInheritanceDatabase } from "./helpers/agent-fee-inheritance-database.mjs";

const feeFields = ["agent_fee_percent", "exchange_agent_fee_percent", "completion_agent_fee_percent"];
const fees = terms => feeFields.map(key => terms[key]);
const otherFields = terms => Object.fromEntries(Object.entries(terms).filter(([key]) => ![...feeFields, "updated_at"].includes(key)));
async function fixture(t) {
  const f = await agentFeeInheritanceDatabase();
  t.after(() => f.db.close());
  return f;
}

test("repairs all 64 Priors Gate-shaped baselines without changing other commercial terms", async t => {
  const f = await fixture(t);
  const before = new Map();
  for (let i = 0; i < 64; i++) {
    const id = await f.baseline();
    before.set(id, await f.terms(id));
    assert.deepEqual(fees(before.get(id)), [null, "0", "0"]);
  }
  await f.repair();
  for (const [id, original] of before) {
    const repaired = await f.terms(id);
    assert.deepEqual(fees(repaired), ["10", "9.5", "0.5"]);
    assert.deepEqual(otherFields(repaired), otherFields(original));
  }
  const after = await f.terms([...before.keys()][0]);
  await f.repair();
  assert.deepEqual(await f.terms([...before.keys()][0]), after, "repeat repair is a no-op");
});

test("new baseline terms use the current building fee split, including explicit zero fees", async t => {
  const f = await fixture(t);
  await f.repair();
  for (const unitStatus of ["for_sale", "not_released", "not_for_sale"]) {
    assert.deepEqual(fees(await f.terms(await f.baseline({ unitStatus }))), ["10", "9.5", "0.5"]);
  }
  assert.deepEqual(fees(await f.terms(await f.baseline({ total: 0, exchange: 0, completion: 0 }))), ["0", "0", "0"]);
  assert.deepEqual(fees(await f.terms(await f.baseline({ total: 8, exchange: 7, completion: 1 }))), ["8", "7", "1"]);
  await f.db.query("update building_sale_defaults set default_agent_fee_percent=12,default_exchange_agent_fee_percent=11,default_completion_agent_fee_percent=1 where building_id=$1", [f.ids.building]);
  assert.deepEqual(fees(await f.terms(await f.baseline())), ["12", "11", "1"]);
});

test("repair preserves real drafts, progressed sales, explicit fees and retained financial records", async t => {
  const f = await fixture(t);
  const protectedSales = [
    await f.baseline({ system: false }),
    await f.baseline({ total: 0, exchange: 0, completion: 0 }),
    await f.baseline({ total: 10, exchange: 10, completion: 0 }),
    await f.baseline({ total: 8, exchange: 7, completion: 1 }),
  ];
  for (const status of ["reserved", "exchanged"]) protectedSales.push(await f.baseline({ unitStatus: status }));
  await f.db.exec("select set_config('app.sales_legal_write','on',false)");
  for (const status of ["completed", "handed_over"]) {
    const id = await f.baseline();
    await f.db.query("update unit_sale_attempts set legal_completed_at=now() where id=$1", [id]);
    await f.db.query("update units set sale_status=$2 where id=$1", [id, status]);
    protectedSales.push(id);
  }
  for (const column of ["buyer_name", "buyer_person_name", "buyer_company_name", "buyer_email", "buyer_phone", "buyer_solicitor_name"]) {
    const id = await f.baseline();
    await f.db.query(`update unit_sale_attempts set ${column}='Synthetic draft' where id=$1`, [id]);
    protectedSales.push(id);
  }
  for (const column of ["reservation_date", "reservation_submitted_at", "reservation_approved_at", "commercial_approved_at", "exchanged_at", "completed_at", "legal_completed_at"]) {
    const id = await f.baseline();
    await f.db.query(`update unit_sale_attempts set ${column}='2026-10-01' where id=$1`, [id]);
    protectedSales.push(id);
  }
  for (const change of ["status='approved'", "approved_at=now()", "is_current=false"]) {
    const id = await f.baseline();
    await f.db.query(`update unit_sale_terms set ${change} where sale_attempt_id=$1`, [id]);
    protectedSales.push(id);
  }
  const document = await f.baseline();
  await f.db.query("insert into unit_sale_documents(sale_attempt_id,document_type,status) values($1,'reservation_form','uploaded')", [document]);
  protectedSales.push(document);
  const invoice = await f.baseline();
  await f.db.query("insert into unit_sale_invoices(sale_attempt_id) values($1)", [invoice]);
  protectedSales.push(invoice);
  const authority = await f.baseline();
  await f.db.query(`insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,
    sending_address,to_recipients,approved_by,expires_at)
    values(gen_random_uuid(),$1,'authority',1,'{}','Saved authority','Saved body',
    'portal@example.test',array['legal@example.test'],$2,now()+interval '1 day')`, [authority, f.ids.developer]);
  protectedSales.push(authority);
  const before = await Promise.all(protectedSales.map(id => f.terms(id)));
  await f.repair();
  assert.deepEqual(await Promise.all(protectedSales.map(id => f.terms(id))), before);
});

test("legacy commercial saves keep a valid split and explicit splits are retained", async t => {
  const f = await fixture(t);
  await f.repair();
  const id = await f.baseline();
  await f.db.query("update unit_sale_terms set agent_fee_percent=12 where sale_attempt_id=$1", [id]);
  assert.deepEqual(fees(await f.terms(id)), ["12", "12", "0"]);
  await f.db.query("update unit_sale_terms set exchange_agent_fee_percent=11,completion_agent_fee_percent=1 where sale_attempt_id=$1", [id]);
  assert.deepEqual(fees(await f.terms(id)), ["12", "11", "1"]);
  await f.db.query("update unit_sale_terms set contract_price=225000 where sale_attempt_id=$1", [id]);
  assert.deepEqual(fees(await f.terms(id)), ["12", "11", "1"]);
});
