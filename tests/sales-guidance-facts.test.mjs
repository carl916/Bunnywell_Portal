import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const {loadSalesGuidanceFacts}=loadTypescriptModule('src/lib/sales/guidance-facts.ts');
const {loadBuildingSalesData}=loadTypescriptModule('src/lib/sales/action-refresh.ts');

function fixture({count, failure, changing=false}={}) {
  const calls=[];
  return {calls,from(table){const call={table};calls.push(call);return {
    select(columns,options){call.columns=columns;call.options=options;return this;},in(key,ids){call.ids=ids;call.key=key;return this;},order(){return this;},
    range(from,to){call.range=[from,to];return this;},then(resolve){
      const length=count??call.ids.length, from=call.range?.[0]??0;
      const data=Array.from({length:Math.min(250,Math.max(0,length-from))},(_,i)=>({id:`${table}-${from+i}`,sale_attempt_id:call.ids[i%call.ids.length]}));
      return Promise.resolve({data,count:changing&&from?length+1:length,error:table===failure?{code:'42501',message:'Synthetic denied'}:null}).then(resolve);
    }
  };}};
}
test('compact guidance uses three bounded batches, not one request per sale', async()=>{
  const client=fixture();const result=await loadSalesGuidanceFacts(client,Array.from({length:18},(_,i)=>`sale-${i}`));
  assert.equal(client.calls.length,3);assert.equal(result.authorities.length,18);
  for(const call of client.calls){assert.equal(call.options.count,'exact');assert.equal(call.key,'sale_attempt_id');assert.equal(call.ids.length,18);assert.ok(!call.columns.includes('*'));}
  assert.ok(Number.isFinite(Date.parse(result.asOf)));
});
test('long result sets paginate and input IDs are bounded',async()=>{
  const client=fixture({count:301});await loadSalesGuidanceFacts(client,['sale']);
  assert.equal(client.calls.length,6);assert.deepEqual(client.calls.at(-1).range,[250,499]);
  const many=fixture();await loadSalesGuidanceFacts(many,Array.from({length:301},(_,i)=>String(i)));
  assert.equal(many.calls.length,9);assert.ok(many.calls.every(c=>c.ids.length<=150));
});
test('guidance preserves access denial and rejects changing or excessive populations',async()=>{
  await assert.rejects(loadSalesGuidanceFacts(fixture({failure:'sale_legal_emails'}),['sale']),e=>e.code==='42501');
  await assert.rejects(loadSalesGuidanceFacts(fixture({count:301,changing:true}),['sale']),/incomplete/);
  await assert.rejects(loadSalesGuidanceFacts(fixture({count:20001}),['sale']),/incomplete/);
  const empty=fixture();assert.deepEqual((await loadSalesGuidanceFacts(empty,[])).authorities,[]);assert.equal(empty.calls.length,0);
});
test('internal complete-count guard refuses truncated core sales without deriving an empty workload',async()=>{
  const client={from(table){return {select(){return this;},in(){return this;},order(){return this;},eq(){return this;},then(resolve){return Promise.resolve({data:[],error:null,count:table==='unit_sale_attempts'?100:0}).then(resolve);}};}};
  await assert.rejects(loadBuildingSalesData(client,['unit'],'building',true),/incomplete/);
});
