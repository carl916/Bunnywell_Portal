import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, sale, building } from './helpers/dashboard-fixture.mjs';
const { deriveDashboard, destinationUrl } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deadlineState } = loadTypescriptModule('src/lib/dashboard/dates.ts');
const { financialSubview } = loadTypescriptModule('src/lib/sales/financial-navigation.ts');
const fact = { id:'source',sale_attempt_id:sale.id,required:true,expected_amount:15000,percent:5,received_amount:10000,
  timing:{basis:'fixed',date:'2027-04-01',time:'17:00'},months_after_exchange:null,exchanged_at:sale.exchanged_at,pc_date:'2027-10-01',deadline:null,terms_version:1 };
const setup = () => fixture({ furtherDeposits:[{...fact}], viewer:{id:'solicitor',role:'conveyancer',organisation_id:'legal-org'},now:Date.parse('2027-04-01T15:59:59Z') });
const actions = f => deriveDashboard(f).items.filter(i=>i.kind==='further_deposit_receipt');

test('one canonical deposit action carries partial payment, exact deadline, organisation ownership and Financials deep link',()=>{
  const f=setup();const [item]=actions(f);
  assert.equal(actions(f).length,1);assert.equal(item.ours,true);
  assert.match(item.action,/Part received.*Due today.*£5,000.00.*17:00/);
  assert.equal(deadlineState(item.deadline,f.now),'today');
  const link=destinationUrl(item.destination);
  assert.match(link,/section=financials/);assert.match(link,/financialView=deposits/);assert.match(link,/#further-deposit$/);
  f.now=Date.parse('2027-04-01T16:00:00Z');assert.equal(deadlineState(actions(f)[0].deadline,f.now),'overdue');
  assert.match(actions(f)[0].action,/Part received.*Overdue/);
  f.viewer.id='another-solicitor';assert.equal(actions(f)[0].ours,true);
  f.furtherDeposits[0].received_amount=15000;assert.equal(actions(f).length,0);
  f.furtherDeposits[0].received_amount=14000;assert.match(actions(f)[0].action,/£1,000.00/);
  f.furtherDeposits[0].received_amount=15000.01;assert.match(actions(f)[0].action,/£0.01 excess/);
  f.buildings=[{...building,conveyancer_organisation_id:null}];assert.equal(actions(f)[0].responsibility.allocation,'unallocated');
});
test('30 days upcoming, forecasts, completed reconciliation and eligibility share the same facts',()=>{
  const f=setup();f.now=Date.parse('2027-03-02T12:00:00Z');assert.equal(deadlineState(actions(f)[0].deadline,f.now),'soon');
  f.now=Date.parse('2027-03-01T12:00:00Z');assert.equal(deadlineState(actions(f)[0].deadline,f.now),'future');
  f.furtherDeposits[0].timing={basis:'before_pc',months:6};assert.equal(actions(f)[0].deadline,null);assert.match(actions(f)[0].action,/deadline needs confirmation.*PC forecast/);
  f.furtherDeposits[0].timing=fact.timing;
  f.sales[0].workflow_status='completed';f.sales[0].completed_at='2026-10-01';
  assert.match(actions(f)[0].action,/Reconcile.*receipt not fully recorded/);assert.doesNotMatch(actions(f)[0].action,/chase|Overdue/);assert.equal(actions(f)[0].deadline,null);
  for (const status of ['withdrawn','failed','fallen_through','superseded']) {f.sales[0].workflow_status=status;assert.equal(actions(f).length,0);}
  f.sales[0]={...sale,is_active:false};assert.equal(actions(f).length,0);
  f.sales[0]={...sale,workflow_status:'approved',exchanged_at:null};f.units[0].sale_status='reserved';assert.equal(actions(f).length,0);
  f.sales=[];f.units[0].sale_status='for_sale';assert.equal(actions(f).length,0);
});
test('legacy fee and deposit bookmarks resolve to accessible subviews',()=>{
  assert.equal(financialSubview(new URLSearchParams('section=progression'),'#exchange-deposit-task'),'deposits');
  assert.equal(financialSubview(new URLSearchParams('section=financials'),''),'agent_fees');
  assert.equal(financialSubview(new URLSearchParams('financialView=deposits'),'#agent-fees'),'agent_fees');
});
