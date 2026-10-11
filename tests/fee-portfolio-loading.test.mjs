import test from "node:test";
import assert from "node:assert/strict";
import {loadTypescriptModule} from "./helpers/load-typescript-module.mjs";
const row={sale_attempt_id:"s",building_id:"b",building_name:"Synthetic",unit_id:"u",unit_number:"1",unit_sale_status:"exchanged",workflow_status:"exchanged",
  contract_price:250000,exchange_fee_percent:1,completion_fee_percent:1,vat_rate:20,exchange_invoice:null,completion_invoice:null,exchange_active_payments:[],completion_active_payments:[]};
function loader(response){
  const calls=[];
  const mod=loadTypescriptModule("src/components/portal/sales/useAgentFeePortfolio.ts",{overrides:{"@/lib/supabase/client":{createSupabaseBrowserClient:()=>({rpc:async(...args)=>{calls.push(args);return response;}})}}});
  return {...mod,calls};
}
test("one compact authorised RPC checks exact completeness and accepts genuine empty data",async()=>{
  const f=loader({data:[],count:0,error:null});assert.deepEqual(await f.queryAgentFeePortfolio("developer"),[]);
  assert.deepEqual(f.calls,[["get_agent_fee_portfolio",{p_requester_id:"developer"},{count:"exact"}]]);
});
test("truncated, unknown count, duplicate and missing input responses cannot produce zero work",async()=>{
  for(const response of [
    {data:[row],count:2},{data:[row],count:null},{data:null,count:0},{data:[row,row],count:2},
    {data:[{...row,contract_price:null}],count:1},{data:[{...row,exchange_active_payments:null}],count:1},
    {data:[{...row,completion_invoice:undefined}],count:1},
  ])await assert.rejects(loader(response).queryAgentFeePortfolio("developer"),/incomplete/);
});
test("authorisation errors propagate without manufacturing successful empty data",async()=>{
  const error={code:"P0001",message:"Only developers or admins can view the Agent Fees portfolio."};
  await assert.rejects(loader({error,data:null}).queryAgentFeePortfolio("agent"),e=>e===error);
});
