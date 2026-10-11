import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discussionDatabase } from './helpers/discussion-database.mjs';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { deriveFeePortfolio, feePortfolioFromSales } = loadTypescriptModule('src/lib/sales/fee-portfolio-data.ts');
const { feeActions } = loadTypescriptModule('src/lib/sales/fee-workspace.ts');

test('Sales adapter matches the deployed portfolio SQL on historic eligibility, invoice exclusions, terms fallback and cash sources', async t => {
  const f = await discussionDatabase(); t.after(() => f.db.close()); await f.owner();
  await f.db.exec(`
    alter table buildings add column sales_agent_organisation_id uuid;
    alter table unit_sale_attempts add column sales_agent_organisation_id uuid;
    create table unit_sale_terms(sale_attempt_id uuid,version_number int,is_current boolean,contract_price numeric,exchange_agent_fee_percent numeric,completion_agent_fee_percent numeric,vat_rate numeric);
    alter table unit_sale_invoices add column invoice_type text,add column fee_milestone text,add column status text,add column created_at timestamptz,
      add column approved_at timestamptz,add column gross_amount numeric,add column expected_payable_amount numeric,add column reservation_fee_deduction numeric,add column agent_contribution_deduction numeric;
    alter table unit_sale_invoice_payments add column invoice_id uuid,add column payment_source text,add column payer_type text,add column amount numeric,add column voided_at timestamptz,add column paid_at timestamptz,add column created_at timestamptz;
  `);
  const sql = readFileSync('supabase/migrations/20260828_commercial_unit_allocation.sql', 'utf8');
  const start = sql.indexOf('create or replace function public.get_agent_fee_portfolio(');
  await f.db.exec(sql.slice(start, sql.indexOf('$$;', start) + 3));
  const org = crypto.randomUUID();
  await f.db.query('insert into organisations values($1,$2)', [org, 'Appointed agency']);
  await f.db.query('update buildings set sales_agent_organisation_id=$1', [org]);
  const history = crypto.randomUUID(), excluded = crypto.randomUUID();
  for (const id of [history, excluded]) await f.db.query("insert into unit_sale_attempts(id,building_id,unit_id,is_active,workflow_status) values($1,$2,$3,false,'fallen_through')", [id,f.ids.building,f.ids.unit]);
  for (const id of [f.ids.sale, f.ids.replacement, history, excluded]) {
    await f.db.query('insert into unit_sale_terms values($1,1,false,100000,1,2,20),($1,2,false,200000,1,2,20)', [id]);
  }
  // Current takes precedence over a later noncurrent version.
  await f.db.query('insert into unit_sale_terms values($1,0,true,150000,1,2,20)', [f.ids.sale]);
  const outstanding = crypto.randomUUID();
  const addInvoice = async (id,sale,status,created,amount=1200,type='sales_agent') => f.db.query(
    "insert into unit_sale_invoices(id,sale_attempt_id,invoice_type,fee_milestone,status,created_at,approved_at,gross_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction) values($1,$2,$3,'exchange',$4,$5,'2026-10-01',1200,$6,0,0)", [id,sale,type,status,created,amount]);
  await addInvoice(outstanding,history,'approved','2026-10-01');
  await addInvoice(crypto.randomUUID(),history,'redacted','2026-10-03');
  await addInvoice(crypto.randomUUID(),history,'superseded','2026-10-04');
  await addInvoice(crypto.randomUUID(),history,'approved','2026-10-05',999,'other');
  await addInvoice(crypto.randomUUID(),excluded,'redacted','2026-10-01');
  for (const [source,amount,voided] of [['bank_transfer',200,null],['reservation_fee',900,null],['bank_transfer',600,'2026-10-02'],[null,700,null]]) {
    await f.db.query("insert into unit_sale_invoice_payments(sale_attempt_id,invoice_id,payment_source,payer_type,amount,voided_at) values($1,$2,$3,'developer',$4,$5)",[history,outstanding,source,amount,voided]);
  }
  const rows = async table => JSON.parse(JSON.stringify((await f.db.query(`select * from ${table}`)).rows));
  const input = { sales:await rows('unit_sale_attempts'), units:await rows('units'), buildings:await rows('buildings'), organisations:await rows('organisations'), terms:await rows('unit_sale_terms'), invoices:await rows('unit_sale_invoices'), payments:await rows('unit_sale_invoice_payments') };
  await f.as('developer');
  const raw = (await f.db.query('select * from get_agent_fee_portfolio($1)',[f.ids.developer])).rows;
  const fromRpc = deriveFeePortfolio(raw,input.buildings,input.organisations), fromSales = feePortfolioFromSales(input);
  const positions = rows => rows.map(row => ({ id:row.saleAttemptId, owner:row.agentOrganisationId, price:row.salePrice, exchange:row.exchange.kind, remaining:row.exchange.outstandingBalance, actions:feeActions(row).map(action=>({category:action.category,milestone:action.milestone,kind:action.state.kind,balance:action.state.outstandingBalance})) })).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(positions(fromSales),positions(fromRpc));
  assert.equal(fromRpc.length,3); assert.ok(!fromRpc.some(row=>row.saleAttemptId===excluded));
  assert.equal(Number(raw.find(row=>row.sale_attempt_id===history).contract_price),200000);
  assert.equal(Number(raw.find(row=>row.sale_attempt_id===f.ids.sale).contract_price),150000);
  assert.equal(raw.find(row=>row.sale_attempt_id===history).exchange_active_payments.length,1);
  assert.ok(feeActions(fromRpc.find(row=>row.saleAttemptId===history)).some(action=>action.category==='payment-position'));
});

test('appointed conveyancer colleagues replace documents with individual attribution; unrelated and inactive users are denied', async t => {
  const f = await legalDatabase(); t.after(()=>f.db.close()); await f.owner();
  f.ids.colleague = crypto.randomUUID();
  await f.db.query("insert into profiles(id,role,active,full_name,organisation_id) values($1,'conveyancer',true,'Colleague',$2)",[f.ids.colleague,f.solicitorOrg]);
  await f.db.query('update profiles set organisation_id=$1 where id=$2',[f.solicitorOrg,f.ids.solicitor]);
  await f.db.query('delete from user_building_access where user_id in ($1,$2,$3)',[f.ids.solicitor,f.ids.colleague,f.ids.outsider]);
  await f.db.query("insert into building_organisations values($1,$2,'conveyancer',true)",[f.ids.building,f.solicitorOrg]);
  await f.sent(await f.prepare()); await f.action('solicitor','confirm_exchange',{date:new Date().toISOString().slice(0,10)});
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));
  await f.notice({noticeDate:new Date().toISOString().slice(0,10),dueDate:new Date().toISOString().slice(0,10)});
  await f.uploadFiles();
  const before = await f.packageVersions();
  await f.action('developer','query_completion_document',{documentType:'completion_statement',versionId:before.statementVersionId,reason:'Isolated query'});
  const result = await f.uploadFiles(['completion_statement'],{p_actor:f.ids.colleague});
  await f.service();
  const versions = (await f.db.query('select id,uploaded_by_user_id,is_current from unit_sale_document_versions where id in ($1,$2)',[before.statementVersionId,result[0].versionId])).rows;
  assert.equal(versions.find(v=>v.id===before.statementVersionId).uploaded_by_user_id,f.ids.solicitor);
  assert.equal(versions.find(v=>v.id===result[0].versionId).uploaded_by_user_id,f.ids.colleague);
  assert.equal(versions.find(v=>v.id===before.statementVersionId).is_current,false);
  await f.as('outsider'); assert.equal((await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows.length,0);
  await assert.rejects(f.action('outsider','request_authority'),/access/i);
  await assert.rejects(f.action('colleague','approve_completion_document',{documentType:'completion_statement',versionId:result[0].versionId}),/access denied/i);
  await f.owner(); await f.db.query('update profiles set active=false where id=$1',[f.ids.colleague]);
  await assert.rejects(f.uploadFiles(['completion_statement'],{p_actor:f.ids.colleague}),/active|access/i);
});

test('existing explicitly granted building access is broader than current appointments: documented database boundary', async t => {
  const f = await legalDatabase(); t.after(()=>f.db.close());
  // The fixture outsider has an existing direct building grant. Appointments and
  // creator identity do not revoke that grant in the unchanged deployed function.
  await f.as('outsider');
  assert.equal((await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows.length,1);
  await f.action('outsider','request_authority');
});

test('reservation and invoice upload helper permits an authorised agency colleague and records their individual actor', async () => {
  const { uploadSaleDocument } = loadTypescriptModule('src/app/api/sales/reservations/route.ts', { exports:['uploadSaleDocument'] });
  for (const invoice of [false,true]) {
    const writes=[];
    const client={ storage:{ listBuckets:async()=>({data:[{name:'sale-documents'}]}), from:()=>({upload:async()=>({error:null})}) }, from(table) {
      const filters={}; let mutation=null, singular=false;
      const q={ select(){return q;}, eq(key,value){filters[key]=value;return q;}, neq(){return q;}, is(){return q;}, order(){return q;}, limit(){return q;},
        update(value){mutation={table,kind:'update',value};return q;}, insert(value){mutation={table,kind:'insert',value};return q;}, maybeSingle(){singular=true;return q;}, single(){singular=true;return q;},
        then(resolve){
          if(mutation)writes.push(mutation);
          const rows=table==='unit_sale_attempts'?[{id:'sale',building_id:'building',unit_id:'unit',workflow_status:'draft',created_by_user_id:'amy',sales_agent_organisation_id:'legacy-conflict'}]
            :table==='building_organisations'&&filters.organisation_id==='appointed-agency'&&filters.role_on_project==='sales_agent'?[{building_id:'building'}]
            :table==='unit_sale_documents'?[{id:'document',created_by_user_id:'amy'}]
            :table==='unit_sale_document_versions'?[{id:'old-version',version_number:1,uploaded_by_user_id:'amy'}]
            :table==='units'?[{id:'unit',unit_number:'101',sale_status:'for_sale'}]:[];
          return Promise.resolve({data:singular?rows[0]??null:rows,error:null}).then(resolve);
        }};return q;
    }};
    const form=new FormData();form.set('saleAttemptId','sale');form.set('file',new File(['isolated PDF bytes'],'reservation.pdf',{type:'application/pdf'}));
    const config=invoice?{documentType:'agent_invoice',requiredAction:'submit_agent_invoice',feeMilestone:'exchange'}:undefined;
    await uploadSaleDocument(client,{id:'colleague',role:'sales_agent',organisation_id:'appointed-agency'},form,config);
    assert.equal(writes.find(w=>w.table==='unit_sale_documents').value.updated_by_user_id,'colleague');
    const version=writes.find(w=>w.table==='unit_sale_document_versions'&&w.kind==='insert').value;
    assert.equal(version.uploaded_by_user_id,'colleague');assert.equal(version.version_number,2);
    assert.ok(!writes.some(w=>w.value.created_by_user_id),'historical creator is preserved');
    const count=writes.length;
    await assert.rejects(uploadSaleDocument(client,{id:'unrelated',role:'sales_agent',organisation_id:'legacy-conflict'},form,config),/access/);
    await assert.rejects(uploadSaleDocument(client,{id:'conveyancer',role:'conveyancer',organisation_id:'appointed-agency'},form,config),/cannot upload/);
    assert.equal(writes.length,count);
  }
});
