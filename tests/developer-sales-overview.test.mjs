import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, document, NOW, sale, unit, building, snag } from './helpers/dashboard-fixture.mjs';
const { deriveDeveloperSalesRows, selectDeveloperSalesRows, visibleSalesWork, INITIAL_SALES_OVERVIEW: defaults, readSalesOverviewFilters, salesOverviewDestination, saleRecordUrl } = loadTypescriptModule('src/lib/sales/developer-overview.ts');
const { deriveDashboard, filterWork } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { hasWorkOwner, salesWorkCategory } = loadTypescriptModule('src/lib/dashboard/work-classification.ts');

test('All sales follows building/floor/natural unit order; action views sort before pagination', () => {
  const units = Array.from({length:16}, (_,i) => ({...unit,id:`unit-${i}`,unit_number:String(i+1),floor:i===0?'First':'Ground'}));
  const sales = units.map((u,i) => ({...sale,id:`sale-${i}`,unit_id:u.id,contractual_completion_date:i===15?'2026-10-06':i===14?'2026-10-09':'2026-12-01'}));
  const documents = sales.map(s => ({...document('completion_statement'),id:`doc-${s.id}`,sale_attempt_id:s.id}));
  const rows=deriveDeveloperSalesRows(fixture({units,sales,documents,floors:[{building_id:building.id,name:'Ground',sort_order:0},{building_id:building.id,name:'First',sort_order:1}]}));
  assert.deepEqual(selectDeveloperSalesRows(rows,defaults,NOW).map(r=>r.unitNumber),[...Array.from({length:15},(_,i)=>String(i+2)),'1']);
  const work=selectDeveloperSalesRows(rows,{...defaults,work:'ours'},NOW);
  assert.equal(work[0].unitNumber,'16');assert.equal(work[1].unitNumber,'15');
  assert.equal(work.slice(0,12).length,12);assert.equal(work.slice(12).length,4);
  for(const row of rows) if(row.keyDate)row.keyDate.label='Formatting does not control sorting';
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,work:'ours'},NOW)[0].unitNumber,'16');
});

test('shared queues count two current reviews, not the saved date; both teams and destinations remain available', () => {
  const f=fixture({documents:[document('completion_statement'),document('draft_statement_of_account','query_raised')]});
  const rows=deriveDeveloperSalesRows(f), row=rows[0];
  assert.equal(row.observations.length,1);
  assert.equal(visibleSalesWork(row,{...defaults,work:'ours'}).length,1);
  const review=visibleSalesWork(row,{...defaults,work:'ours'})[0];
  assert.equal(review.destination.anchor,'completion-documents-step');assert.equal(review.destination.versionId,'completion_statement-v1');
  const snapshot=deriveDashboard(f);
  assert.equal(filterWork(snapshot,'ours','sales').tasks,1);
  assert.ok(!filterWork(snapshot,'others','sales').items.some(i=>i.kind==='completion_date'));
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,work:'ours'},NOW).length,1);
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,work:'others'},NOW).length,1);
});

test('unallocated work is explicit and never assigned to another team; non-Sales destinations survive', () => {
  const f=fixture({buildings:[{...building,conveyancer_organisation_id:null}],snags:[snag()]});
  const snapshot=deriveDashboard(f), rows=deriveDeveloperSalesRows(f);
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,work:'others'},NOW).length,0);
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,category:'unallocated'},NOW).length,1);
  assert.ok(rows[0].work.every(i=>!hasWorkOwner(i)));
  assert.equal(filterWork(snapshot,'others','snags').items[0].destination.screen,'snags');
});

test('available and legacy completed units never fabricate reservation tasks; missing and duplicate records are checks', () => {
  for(const status of ['for_sale','completed','handed_over']) {
    const row=deriveDeveloperSalesRows(fixture({sales:[],units:[{...unit,sale_status:status}]}))[0];
    assert.equal(row.work.length,0);assert.ok(!row.neutral.includes('Submit reservation'));
    if(status==='for_sale')assert.equal(row.neutral,'Available for reservation');
  }
  const missing=deriveDeveloperSalesRows(fixture({sales:[]}))[0];
  assert.equal(missing.work[0].kind,'sale_record_check');assert.equal(missing.work[0].ours,true);
  const duplicate=deriveDeveloperSalesRows(fixture({sales:[sale,{...sale,id:'duplicate'}]}))[0];
  assert.equal(duplicate.work.length,1);assert.match(duplicate.work[0].action,/multiple/);
});

test('payment position is positive approved balance with no assumed deadline and an existing financials destination', () => {
  const f=fixture({invoices:[{id:'invoice',sale_attempt_id:sale.id,status:'approved',fee_milestone:'exchange',expected_payable_amount:100,created_at:'2026-09-01',approved_at:'2026-09-02'}]});
  const item=deriveDeveloperSalesRows(f)[0].work.find(i=>salesWorkCategory(i)==='payment-position');
  assert.match(item.action,/Review payment position/);assert.equal(item.deadline,null);
  assert.equal(item.destination.section,'financials');assert.equal(item.destination.anchor,'exchange-fee');
  f.payments=[{invoice_id:'invoice',amount:100,voided_at:null}];
  assert.ok(!deriveDeveloperSalesRows(f)[0].work.some(i=>salesWorkCategory(i)==='payment-position'));
});

test('category destinations start clean and validate unknown filters; record URLs preserve context', () => {
  const destination=salesOverviewDestination(building.id,'documents','ours');
  assert.equal(destination,`/?screen=sales&building=${building.id}&salesWork=ours&salesCategory=documents#sales-results`);
  assert.deepEqual(readSalesOverviewFilters('?salesWork=evil&salesCategory=__proto__&salesFilter=evil&salesPage=-5'),defaults);
  const parsed=readSalesOverviewFilters('?salesWork=others&salesCategory=notice&salesSearch=101&salesPage=2&salesFilter=exchanged');
  assert.equal(parsed.page,2);assert.equal(parsed.stage,'exchanged');
  const url=saleRecordUrl({screen:'sales',buildingId:building.id,unitId:unit.id,section:'financials',anchor:'completion-fee'},'?screen=sales&salesWork=ours&salesPage=2&salesSearch=10');
  assert.match(url,/salesPage=2/);assert.match(url,/salesWork=ours/);assert.match(url,/#completion-fee$/);
});

test('filtered counts share row predicates; unavailable sources cannot become action rows', () => {
  const f=fixture({documents:[document('completion_statement')]});
  const rows=deriveDeveloperSalesRows(f);
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,category:'documents',work:'ours',search:'Synthetic',stage:'exchanged'},NOW).length,1);
  assert.equal(selectDeveloperSalesRows(rows,{...defaults,category:'documents',work:'ours',search:'missing'},NOW).length,0);
  f.sources=f.sources.map(s=>({...s,state:'unavailable'}));
  assert.equal(deriveDeveloperSalesRows(f)[0].work.length,0);
});
