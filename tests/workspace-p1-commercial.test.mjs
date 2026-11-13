import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {commercialSummary}=loadTypescriptModule('src/lib/workspace/commercial-summary.ts');
const terms={id:'terms',version_number:2,is_current:true,status:'draft',contract_price:425000,parking_value:10000,developer_contribution:5000,solicitor_fee:1000,agent_fee_percent:2,exchange_agent_fee_percent:1.5,completion_agent_fee_percent:0.5,vat_rate:20,agent_contribution:500,reservation_fee:2000,reservation_fee_holder:'sales_agent',exchange_deposit_percent:10,second_deposit_enabled:true,second_deposit_percent:5,second_deposit_months_after_exchange:1};
const fields=(summary,id)=>Object.fromEntries(summary.groups.find(g=>g.id===id).fields);
test('commercial model preserves established proceeds, VAT, fee deductions and buyer schedule calculations',()=>{
 const summary=commercialSummary(terms,'developer'),dev=fields(summary,'developer'),agent=fields(summary,'agent'),buyer=fields(summary,'buyer');
 assert.equal(dev['Net developer proceeds before other costs'],'£420,500.00');
 assert.equal(agent['Exchange fee excluding VAT'],'£6,375.00');assert.equal(agent['Exchange VAT'],'£1,275.00');assert.equal(agent['Exchange expected cash payable'],'£5,150.00');
 assert.equal(agent['Completion expected cash payable'],'£2,550.00');assert.equal(buyer['10% exchange deposit'],'£42,500.00');assert.equal(buyer['5% further deposit'],'£21,250.00');assert.equal(buyer['85% balance on completion'],'£361,250.00');
 assert.match(summary.notes.join(' '),/does not approve/);assert.match(summary.notes.join(' '),/reservation fee is included/);
});
test('conveyancer receives only buyer fields even if private source fields are supplied; agent has no developer proceeds',()=>{
 const summary=commercialSummary(terms,'conveyancer');assert.deepEqual(summary.groups.map(g=>g.id),['buyer']);assert.equal(fields(summary,'buyer')['Contract price'],'£425,000.00');
 assert.doesNotMatch(JSON.stringify(summary),/developer|agent-funded|solicitor fee|\bVAT\b|6,375|420,500/i);
 assert.deepEqual(commercialSummary(terms,'sales_agent').groups.map(g=>g.id),['agent','buyer']);
});
test('missing amounts remain unknown, invalid schedules are identified and penny rounding is explicit',()=>{
 const missing=commercialSummary({version_number:1,status:'draft'},'developer');assert.equal(fields(missing,'developer')['Net developer proceeds before other costs'],'Not recorded');assert.equal(fields(missing,'buyer')['Contract price'],'Not recorded');
 const invalid=commercialSummary({...terms,exchange_deposit_percent:98},'developer');assert.match(fields(invalid,'buyer')['Payment schedule'],/exceed 100/);
 assert(commercialSummary({...terms,contract_price:425000.11,exchange_deposit_percent:15},'developer').notes.some(n=>n.includes('rounding')));
 const noFurther=fields(commercialSummary({...terms,second_deposit_enabled:false,reservation_fee_holder:'developer'},'conveyancer'),'buyer');assert.equal(noFurther['90% balance on completion'],'£382,500.00');
});
const ids=['b1700000-0000-4000-8000-000000000001','b1700000-0000-4000-8000-000000000002','b1700000-0000-4000-8000-000000000003'];
function adapter({role='conveyancer',available=true,recorded=true}={}){
 const calls=[];
 const {saleDetails}=loadTypescriptModule('src/lib/workspace/sale-details.ts',{overrides:{'./server':{ReadError:class extends Error{}},'./reads':{rows:async(_client,table,columns,filter)=>{
  const constraints=[],query={eq:(...v)=>{constraints.push(v);return query},is:()=>query,in:()=>query};filter?.(query);calls.push({table,columns,constraints});
  if(!available)return [];
  if(table==='buildings')return [{id:ids[0]}];if(table==='unit_sale_attempts')return [{id:ids[2],is_active:true,attempt_number:1,workflow_status:'draft'}];
  if(table==='unit_sale_terms')return recorded?[terms]:[];return [];
 }}}});
 return {calls,run:()=>saleDetails({profile:{role}},new URLSearchParams({building:ids[0],unit:ids[1],sale:ids[2],section:'commercial'}))};
}
test('for-sale conveyancer read retains exact record bounds, omits private columns and does not hide draft buyer terms',async()=>{
 const a=adapter(),result=await a.run();assert(result.commercial);const call=a.calls.find(c=>c.table==='unit_sale_terms');
 assert.deepEqual(call.constraints,[['sale_attempt_id',ids[2]]]);assert.doesNotMatch(call.columns,/agent_fee|developer_contribution|agent_contribution|solicitor_fee|commercial_summary|vat_rate/);
 assert.deepEqual(a.calls.find(c=>c.table==='unit_sale_attempts').constraints,[['id',ids[2]],['unit_id',ids[1]],['building_id',ids[0]]]);
 assert.deepEqual(result.commercial.groups.map(g=>g.id),['buyer']);
});
test('missing terms and denied record access are distinct responses',async()=>{
 const empty=await adapter({recorded:false}).run();assert.match(empty.notices.join(' '),/No commercial terms have been recorded/);assert.equal(empty.commercial,undefined);
 await assert.rejects(adapter({available:false}).run(),/exact building, unit and sale are unavailable/);
});
