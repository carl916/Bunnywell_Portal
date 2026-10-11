// Isolated request-count comparison. No credentials or live network requests.
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';
const temporary = 'src/lib/dashboard/.stage2b-baseline-read.ts';
writeFileSync(temporary, execFileSync('git',['show','6a4475b:src/lib/dashboard/read.ts']));
try {
  const before=loadTypescriptModule(temporary), after=loadTypescriptModule('src/lib/dashboard/read.ts');
  const results=[];
  for(const population of [62,130,301]) {
    for(const [version,reader] of [['before',before],['after',after]]) {
      const calls=[];
      const building={id:'building',name:'Synthetic House',sales_agent_organisation_id:'agent',conveyancer_organisation_id:'legal'};
      const sales=Array.from({length:population},(_,i)=>({id:`sale-${i}`,unit_id:`unit-${i}`,building_id:building.id,is_active:true,redacted_at:null,workflow_status:'exchanged'}));
      const tables={buildings:[building],units:sales.map(s=>({id:s.unit_id,building_id:building.id,sale_status:'exchanged'})),building_floors:[],organisations:[{id:'agent',name:'Agency'}],building_organisations:[],unit_sale_attempts:sales,
        unit_sale_terms:sales.map(s=>({id:`terms-${s.id}`,sale_attempt_id:s.id,contract_price:100000,exchange_agent_fee_percent:1,completion_agent_fee_percent:1,vat_rate:20})),
        unit_sale_invoices:sales.map(s=>({id:`invoice-${s.id}`,sale_attempt_id:s.id,invoice_type:'sales_agent',fee_milestone:'exchange',status:'approved',gross_amount:1200,expected_payable_amount:1200,created_at:'2026-10-01'})),unit_sale_invoice_payments:[]};
      const client={from(table){calls.push(table);let rows=tables[table]??[],start=0,end=Infinity;
        const q={select(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},limit(){return q;},not(){return q;},is(){return q;},eq(key,value){rows=rows.filter(row=>row[key]===value);return q;},in(key,values){if(!key.includes('.'))rows=rows.filter(row=>values.includes(row[key]));return q;},
          then(resolve){return Promise.resolve({data:rows.slice(start,end+1),count:rows.length,error:null}).then(resolve);}};return q;
      },rpc:async name=>{calls.push(name);const data=name==='get_agent_fee_portfolio'?sales.map(s=>({sale_attempt_id:s.id,building_id:building.id,building_name:building.name,unit_id:s.unit_id,unit_number:s.unit_id,unit_sale_status:'exchanged',workflow_status:'exchanged',contract_price:100000,exchange_fee_percent:1,completion_fee_percent:1,vat_rate:20,exchange_invoice:null,completion_invoice:null,exchange_active_payments:[],completion_active_payments:[]})):[];return{data,count:data.length,error:null};}};
      await reader.loadDashboardInput(client,{id:'viewer',role:'developer',organisation_id:null},building.id);
      const categories=Object.fromEntries([...new Set(calls)].map(name=>[name,calls.filter(c=>c===name).length]));
      results.push({version,population,sourceRequests:calls.length,feeRequests:calls.filter(c=>['unit_sale_terms','unit_sale_invoices','unit_sale_invoice_payments','get_agent_fee_portfolio'].includes(c)).length,categories});
    }
  }
  mkdirSync('docs/dashboard-stage2b',{recursive:true});
  writeFileSync('docs/dashboard-stage2b/request-counts.json',JSON.stringify({method:'Executed source loaders against identical isolated fixtures; excludes unchanged caller authentication/profile and before/after access checks. Counts are transport calls, not query time or user loading time. The RPC returns the full authorised portfolio before the selected-building filter.',results},null,2)+'\n');
  console.log(results.map(({version,population,sourceRequests,feeRequests})=>({version,population,sourceRequests,feeRequests})));
} finally { unlinkSync(temporary); }
