import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDatabase } from './helpers/audit-database.mjs';
import { markUnitOpenIntent,consumeUnitOpenIntent } from '../src/lib/audit/unit-open.ts';
test('database attribution, atomicity, access, pagination, retries and retention',async()=>{
  const {db,as,owner,page,ids}=await auditDatabase();
  try {
    await as('admin');
    await db.query('update units set floor=$1 where id=$2',['First',ids.unit]);
    let rows=await page({unit:ids.unit});
    assert.equal(rows[0].created_by_user_id,ids.admin,'client header cannot impersonate developer');
    assert.equal(rows[0].outcome,'succeeded');
    assert.deepEqual(rows[0].metadata.changed_fields,['floor']);
    await db.query('update units set floor=$1 where id=$2',['First',ids.unit]);
    assert.equal((await page({unit:ids.unit})).length,1,'unchanged retry has no new history');
    await assert.rejects(db.query('update units set unit_number=null where id=$1',[ids.unit]));
    assert.equal((await page({unit:ids.unit})).length,1,'failed mutation creates no success event');
    await db.query('update profiles set phone=$1,last_active_at=now() where id=$2',['PRIVATE',ids.resident]);
    rows=await page();assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.ok(rows[0].metadata.changed_fields.includes('phone'));
    const count=rows.length;
    await db.query('update profiles set last_active_at=now() where id=$1',[ids.admin]);
    assert.equal((await page()).length,count,'heartbeat has no business/login event');
    await db.query('select change_snag($1,$2,$3)',[ids.snag,{status:'accepted'},'Test reason']);
    await db.query('select change_snag($1,$2,$3)',[ids.snag,{status:'accepted'},'Test reason']);
    await owner();
    let events=(await db.query('select * from snag_events')).rows;
    assert.equal(events.length,1);assert.equal(events[0].created_by_user_id,ids.admin);assert.equal(events[0].comment,'Test reason');
    // Force an essential writer error; the business update must roll back.
    await db.exec(`create function public.test_audit_fail() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$;
      create trigger test_audit_fail before insert on audit_events for each row execute function test_audit_fail();`);
    await as('admin');
    await assert.rejects(db.query('update units set floor=$1 where id=$2',['Second',ids.unit]),/audit unavailable/);
    assert.equal((await db.query('select floor from units where id=$1',[ids.unit])).rows[0].floor,'First');
    await owner();await db.exec('drop trigger test_audit_fail on audit_events');
    for(const role of ['resident','contractor','agent','conveyancer','rep','inactive']) {
      await as(role);await assert.rejects(page(),/Audit access denied/);
      assert.equal((await db.query('select * from audit_events')).rows.length,0);
      await assert.rejects(db.query('select record_unit_open($1)',[ids.unit]),/Unit access denied/);
      await assert.rejects(db.query('select change_snag($1,$2)',[ids.snag,{status:'closed'}]));
    }
    await as('developer');assert.ok((await page()).length>0);
    await as('admin');
    for(const table of ['audit_events','snag_events','unit_sale_workflow_events']) {
      assert.equal((await db.query("select has_table_privilege('authenticated',$1,'TRUNCATE') as allowed",[table])).rows[0].allowed,false);
      assert.equal((await db.query("select has_table_privilege('anon',$1,'TRUNCATE') as allowed",[table])).rows[0].allowed,false);
    }
    assert.equal((await db.query('select record_unit_open($1) as added',[ids.unit])).rows[0].added,true);
    assert.equal((await db.query('select record_unit_open($1) as added',[ids.unit])).rows[0].added,false);
    assert.equal((await page({stream:'views'})).length,1);
    assert.ok((await page()).every(e=>e.event_type!=='unit_opened'));
    await owner();await db.exec("update unit_open_events set created_at=now()-interval '31 days'");
    await as('admin');assert.equal((await page({stream:'views'})).length,0);
    await owner();await db.exec('select portal_audit.purge_unit_opens()');assert.equal((await db.query('select * from unit_open_events')).rows.length,0);
    await db.query('insert into auth.audit_log_entries(payload) values($1),($2),($3)',[{actor_id:ids.admin,action:'login'},{actor_id:ids.admin,action:'token_refreshed'},{actor_id:ids.admin,action:'logout'}]);
    await as('admin');assert.deepEqual((await page({stream:'authentication'})).map(e=>e.event_type).sort(),['auth_login','auth_logout']);
    for(let i=0;i<110;i++) await db.query('update units set floor=$1 where id=$2',[`Test ${i}`,ids.unit]);
    const first=await page({unit:ids.unit});assert.equal(first.length,51);
    const second=await page({unit:ids.unit},first[49]);assert.equal(second.length,51);
    assert.ok(first.slice(0,50).every(e=>!second.some(next=>next.id===e.id)));
    assert.equal((await page({event:'no_such_event'})).length,0);
    assert.equal((await page({from:'2099-01-01'})).length,0);
    // Verified service actor and access diff preserve unchanged access on retry.
    await as('admin',true);
    await db.query('select save_portal_user_access($1,$2,$3,$4)',[ids.resident,{email:'synthetic@example.invalid',role:'resident'},[ids.building],[{unitId:ids.unit,accessType:'tenant'}]]);
    await owner();const previous=(await db.query('select count(*)::int n from audit_events')).rows[0].n;
    await as('admin',true);await db.query('select save_portal_user_access($1,$2,$3,$4)',[ids.resident,{email:'synthetic@example.invalid',role:'resident'},[ids.building],[{unitId:ids.unit,accessType:'tenant'}]]);
    await owner();assert.equal((await db.query('select count(*)::int n from audit_events')).rows[0].n,previous);
    await as('admin');await assert.rejects(db.query('select save_portal_user_access($1,$2,$3,$4)',[ids.resident,{},[],[]]),/permission denied/);
  } finally { await db.close(); }
});
test('background loads and repeated renders do not arm unit opens',()=>{
  const unit=crypto.randomUUID();assert.equal(consumeUnitOpenIntent(unit),false);
  markUnitOpenIntent(unit,1000);assert.equal(consumeUnitOpenIntent(unit,1000),true);
  assert.equal(consumeUnitOpenIntent(unit,1001),false);
  markUnitOpenIntent(unit,2000);assert.equal(consumeUnitOpenIntent(unit,2000),false);
  markUnitOpenIntent(unit,301001);assert.equal(consumeUnitOpenIntent(unit,301001),true);
  const stale=crypto.randomUUID();markUnitOpenIntent(stale,1000);assert.equal(consumeUnitOpenIntent(stale,62000),false);
});

test('sale and payment inserts include essential history and rollback together',async()=>{
  const {db,as,owner,page,ids}=await auditDatabase();
  try {
    await as('admin');
    await db.query('update unit_sale_attempts set workflow_status=$1,buyer_email=$2 where id=$3',['reserved','CONTACT MUST NOT BE COPIED',ids.sale]);
    const saleRows=await page({sale:ids.sale});
    assert.equal(saleRows.length,1);assert.equal(saleRows[0].created_by_user_id,ids.admin);
    assert.ok(!JSON.stringify(saleRows).includes('CONTACT MUST NOT BE COPIED'));
    await db.query("insert into unit_sale_invoices(id,sale_attempt_id,invoice_type,expected_payable_amount) values($1,$2,'sales_agent',100)",[ids.invoice,ids.sale]);
    await db.query("insert into unit_sale_invoice_payments(id,sale_attempt_id,invoice_id,amount,payment_source) values($1,$2,$3,100,'direct')",[ids.payment,ids.sale,ids.invoice]);
    await db.query("insert into unit_sale_invoice_payments(id,sale_attempt_id,invoice_id,amount,payment_source) values($1,$2,$3,100,'direct') on conflict(id) do nothing",[ids.payment,ids.sale,ids.invoice]);
    const rows=await page({sale:ids.sale});
    assert.equal(rows.filter(e=>e.event_type==='agent_fee_payment_recorded').length,1);
    assert.equal(rows.filter(e=>e.event_type==='agent_fee_invoice_paid').length,1);
    await owner();await db.exec(`create function public.test_sale_audit_fail() returns trigger language plpgsql as $$begin raise exception 'history unavailable'; end$$;
      create trigger test_sale_audit_fail before insert on unit_sale_workflow_events for each row execute function test_sale_audit_fail();`);
    await as('admin');
    await assert.rejects(db.query("insert into unit_sale_invoice_payments(id,sale_attempt_id,invoice_id,amount,payment_source) values(gen_random_uuid(),$1,$2,50,'direct')",[ids.sale,ids.invoice]),/history unavailable/);
    assert.equal((await db.query('select count(*)::int n from unit_sale_invoice_payments')).rows[0].n,1);
    assert.equal((await db.query('select audit_unit_open_setting(false) as enabled')).rows[0].enabled,false);
    assert.equal((await db.query('select record_unit_open($1) as added',[ids.unit])).rows[0].added,false);
    await as('contractor');await assert.rejects(db.query('select audit_unit_open_setting(true)'),/Audit access denied/);
  } finally {await db.close();}
});
