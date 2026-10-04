import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const { legalRefreshScope, loadLegalSaleChanges, replaceSaleRows, replaceRowsById, runAndRefresh, settleRefreshes } = loadTypescriptModule('src/lib/sales/action-refresh.ts');

function client(fail) {
  const calls=[];
  return { calls, from(table) {
    const call={table};calls.push(call);
    return {select(value){call.select=value;return this;},eq(key,value){call.filter=[key,value];return this;},single(){call.single=true;return this;},then(resolve){
      const data=table==='unit_sale_attempts'?{id:call.filter[1],unit_id:'unit',workflow_status:'completed'}:table==='unit_sale_documents'?[{id:'doc',sale_attempt_id:call.filter[1],unit_sale_document_versions:[{id:'v2',document_id:'doc',is_current:true}]}]:[];
      return Promise.resolve({data,error:table===fail?new Error('Read unavailable'):null}).then(resolve);
    }};
  },rpc(name,args){calls.push({table:name,args});return Promise.resolve({data:[{id:'actor',display_name:'Current actor'}],error:null});} };
}
for(const [action,documents,unit] of [
  ['request_authority',false,false],['send',false,false],['confirm_exchange',false,true],
  ['finalize_completion_upload',true,false],['approve_completion_package',true,false],['confirm_completion',false,true],
  ['query_completion_package',true,false],['confirm_notice',true,false],['retry_email',false,false],
]) test(`${action} refreshes the affected sale and only changed data`,async()=>{
  assert.deepEqual(legalRefreshScope(action),{documents,unit,deposit:false});
  const c=client(),fresh=await loadLegalSaleChanges(c,'sale-A',action);
  assert.equal(fresh.attempt.id,'sale-A');
  assert.deepEqual(c.calls.map(x=>x.table),['unit_sale_attempts','sale_actor_names',...(documents?['unit_sale_documents']:[])]);
  for(const call of c.calls) assert.deepEqual(call.filter??call.args,call.table==='sale_actor_names'?{p_sales:['sale-A']}:['id'===call.filter[0]?'id':'sale_attempt_id','sale-A']);
  if(documents)assert.equal(fresh.documents[0].unit_sale_document_versions[0].id,'v2');
});
test('switching sales retains the other sale, terms and commercial figures; deleted scoped rows are removed',()=>{
  const original=[{id:'a',sale_attempt_id:'A',price:250000},{id:'b',sale_attempt_id:'B',price:310000}];
  const updated=replaceSaleRows(original,'A',[{id:'a2',sale_attempt_id:'A',price:260000}]);
  assert.deepEqual(updated.find(row=>row.sale_attempt_id==='B'),original[1]);
  assert.equal(updated.find(row=>row.sale_attempt_id==='A').price,260000);
  assert.deepEqual(replaceSaleRows(updated,'A',[]),[original[1]]);
  assert.deepEqual(replaceRowsById([{id:'A',status:'reserved'},{id:'B',status:'reserved'}],[{id:'A',status:'completed'}]),[{id:'B',status:'reserved'},{id:'A',status:'completed'}]);
});
test('document read failure publishes no incomplete refresh',async()=>{
  await assert.rejects(loadLegalSaleChanges(client('unit_sale_documents'),'A','finalize_completion_upload'),/Read unavailable/);
});
for(const phase of ['prepare','transfer','finalisation','email delivery','receipt save']) test(`${phase} failure reconciles saved state and preserves the error`,async()=>{
  const problem=new Error(`${phase} failed`);let refreshed=false;
  await assert.rejects(runAndRefresh(async()=>{throw problem;},async()=>{refreshed=true;}),error=>error===problem);
  assert.equal(refreshed,true);
});
test('saved action with refresh failure does not report success',async()=>{
  await assert.rejects(runAndRefresh(async()=>{},async()=>{throw new Error('offline');}),/saved.*Refresh/);
  await assert.rejects(runAndRefresh(async()=>{throw new Error('delivery uncertain');},async()=>{throw new Error('offline');}),/delivery uncertain.*refresh/);
});
test('a partial refresh waits for every independent panel, including one that succeeds after another fails',async()=>{
  let published=false;let finish;
  const pending=new Promise(resolve=>{finish=()=>{published=true;resolve();};});
  const all=settleRefreshes([Promise.reject(new Error('context offline')),pending]);
  finish();await assert.rejects(all,/context offline/);assert.equal(published,true);
});
