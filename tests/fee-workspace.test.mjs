import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgentFeePortfolioRow } from "../src/lib/sales/agent-fees-portfolio.ts";
import { feeWorkCategory, salesWorkCategory } from "../src/lib/dashboard/work-classification.ts";
import { FEE_CATEGORIES, INITIAL_FEE_FILTERS, feeActions, matchingFeeActions, selectFeeRows, selectFeeCategory, feeScopeRows, summariseFeeCategories, readFeeFilters, writeFeeFilters, feeCategoryDestination, feeRecordUrl } from "../src/lib/sales/fee-workspace.ts";
const approved=(id,amount=3000)=>({id,status:"approved",approved_at:"2026-10-01",expected_payable_amount:amount});
const input=(overrides={})=>({saleAttemptId:"sale-1",buildingId:"b1",buildingName:"House",unitId:"u1",unitNumber:"101",unitSaleStatus:"exchanged",workflowStatus:"exchanged",agentOrganisationId:"a1",agentName:"Agency",salePrice:250000,exchangeFeePercent:1,completionFeePercent:1,vatRate:20,...overrides});
const row=overrides=>deriveAgentFeePortfolioRow(input(overrides));
test("many missing invoices cannot bury four approved positive balances in Our actions",()=>{
  const rows=Array.from({length:30},(_,i)=>row({saleAttemptId:`sale-${i}`,unitId:`u${i}`,exchangeInvoice:i<4?approved(`i${i}`):null}));
  assert.equal(selectFeeRows(rows,INITIAL_FEE_FILTERS,new Map()).length,4);
  assert.equal(selectFeeRows(rows,selectFeeCategory(INITIAL_FEE_FILTERS,"payment-position"),new Map()).length,4);
  assert.equal(summariseFeeCategories(rows).categories["payment-position"].sales,4);
});
test("overlapping categories count invoices and unique sales separately",()=>{
  const r=row({exchangeInvoice:approved("i"),completionInvoice:{id:"c",status:"uploaded",expected_payable_amount:9999}});
  const summary=summariseFeeCategories([r]).categories;
  assert.deepEqual(summary["invoice-review"],{sales:1,tasks:1,amount:0,unallocated:0});
  assert.deepEqual(summary["payment-position"],{sales:1,tasks:1,amount:3000,unallocated:0});
  assert.equal(matchingFeeActions(r,INITIAL_FEE_FILTERS).length,2);
});
test("submitted unapproved money never enters approved unpaid totals",()=>{
  const r=row({exchangeInvoice:{id:"i",status:"uploaded",expected_payable_amount:20000}});
  assert.equal(summariseFeeCategories([r]).categories["payment-position"].amount,0);
  assert.equal(summariseFeeCategories([r]).categories["invoice-review"].tasks,1);
});
test("part payments, voided payments, deductions, full settlement and zero balances retain existing calculations",()=>{
  const r=row({exchangeInvoice:{...approved("i",2000),gross_amount:3000,reservation_fee_deduction:500,agent_contribution_deduction:500},
    exchangePayments:[{amount:700,payer_type:"developer"},{amount:1300,payer_type:"solicitor",voided_at:"2026-10-02"}]});
  assert.equal(summariseFeeCategories([r]).categories["payment-position"].amount,1300);
  assert.equal(summariseFeeCategories([row({exchangeInvoice:approved("i",0)})]).categories["payment-position"].tasks,0);
  assert.equal(summariseFeeCategories([row({exchangeInvoice:approved("i"),exchangePayments:[{amount:3000,payer_type:"developer"}]})]).categories["payment-position"].tasks,0);
});
test("queried invoices require correction even with historical approval; replacement is a review",()=>{
  const queried=row({exchangeInvoice:{...approved("i"),status:"query_raised"}});
  assert.equal(feeActions(queried)[0].category,"invoice-submission");
  assert.equal(summariseFeeCategories([queried]).categories["payment-position"].amount,0);
  const replacement=row({exchangeInvoice:{id:"new",status:"uploaded",expected_payable_amount:3000}});
  assert.equal(feeActions(replacement)[0].category,"invoice-review");
});
test("unallocated submissions appear in All records and submission category, not another team's tasks",()=>{
  const r=row({agentOrganisationId:null,agentName:null});
  assert.equal(matchingFeeActions(r,{...INITIAL_FEE_FILTERS,work:"others"}).length,0);
  const selected=selectFeeCategory(INITIAL_FEE_FILTERS,"invoice-submission");
  assert.equal(selected.work,"all");
  assert.equal(matchingFeeActions(r,selected).length,2);
  assert.equal(summariseFeeCategories([r]).categories["invoice-submission"].unallocated,2);
});
test("category totals are independent of selected category, page, search and milestone",()=>{
  const rows=[row({exchangeInvoice:approved("i"),completionInvoice:approved("c")}),row({saleAttemptId:"sale2",unitId:"u2",buildingId:"b2",agentOrganisationId:"a2"})];
  const scope=feeScopeRows(rows,"b1","a1");
  const total=summariseFeeCategories(scope);
  selectFeeRows(scope,{...INITIAL_FEE_FILTERS,milestone:"completion",search:"absent",page:3},new Map());
  assert.equal(total.categories["payment-position"].amount,6000);
  assert.equal(total.categories["payment-position"].sales,1);
  assert.equal(total.categories["payment-position"].tasks,2);
});
test("priority uses reviews then payment positions and canonical floor order before pagination",()=>{
  const rows=[row({saleAttemptId:"paid-position",unitId:"u2",exchangeInvoice:approved("i")}),row({saleAttemptId:"review",unitId:"u3",exchangeInvoice:{id:"r",status:"uploaded"}}),row({saleAttemptId:"position-ground",unitId:"u1",exchangeInvoice:approved("g")})];
  const order=new Map([["u1",0],["u2",1],["u3",2]]);
  assert.deepEqual(selectFeeRows(rows,INITIAL_FEE_FILTERS,order).map(r=>r.saleAttemptId),["review","position-ground","paid-position"]);
  assert.deepEqual(selectFeeRows(rows,{...INITIAL_FEE_FILTERS,sort:"unit"},order).map(r=>r.unitId),["u1","u2","u3"]);
});
test("validated category links reset incompatible restrictions and share Phase 1 category identities",()=>{
  for(const category of Object.keys(FEE_CATEGORIES)){
    const url=new URL(feeCategoryDestination("b1",category),"https://fixture.test");
    const f=readFeeFilters(url.search);
    assert.equal(f.category,category); assert.equal(f.agent,"");assert.equal(f.milestone,"all");assert.equal(f.page,1);assert.equal(f.search,"");
  }
  assert.equal(readFeeFilters("?feeWork=ours&feeCategory=invoice-submission").work,"all");
  assert.equal(readFeeFilters("?feeWork=others&feeCategory=payment-position").work,"ours");
  assert.deepEqual(readFeeFilters("?feeWork=bad&feeCategory=bad&feePage=-1&feeSort=bad"),INITIAL_FEE_FILTERS);
  assert.equal(feeWorkCategory("part_paid"),salesWorkCategory({kind:"fee_completion_part_paid",responsibility:{kind:"developer"}}));
});
test("URL round trip preserves filters and fee record opens the matching completion section",()=>{
  const f={...INITIAL_FEE_FILTERS,category:"invoice-review",milestone:"completion",agent:"a1",page:2,search:"101",sort:"unit"};
  const params=new URLSearchParams();writeFeeFilters(params,f);assert.deepEqual(readFeeFilters(params.toString()),f);
  const r=row({exchangeInvoice:approved("i"),completionInvoice:{id:"c",status:"uploaded"}});
  assert.match(feeRecordUrl(r,f,params.toString()),/section=financials#completion-fee$/);
  assert.match(feeRecordUrl(r,f,params.toString()),/workReturn=fees/);
  assert.match(feeRecordUrl(r,INITIAL_FEE_FILTERS,""),/#agent-fees$/);
});
test("future completion fees remain net secondary information and missing invoices add no approved money",()=>{
  const summary=summariseFeeCategories([row({})]);assert.equal(summary.futureNet,2500);assert.equal(summary.categories["payment-position"].amount,0);
});
