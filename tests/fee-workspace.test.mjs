import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgentFeePortfolioRow } from "../src/lib/sales/agent-fees-portfolio.ts";
import { feeWorkCategory, salesWorkCategory } from "../src/lib/dashboard/work-classification.ts";
import { FEE_CATEGORIES, FEE_VIEWS, INITIAL_FEE_FILTERS, feeActions, matchingFeeActions, selectFeeRows, selectFeeView, selectFeeCategory, feeScopeRows, summariseFeeCategories, readFeeFilters, writeFeeFilters, feeCategoryDestination, feeViewDestination, feeRecordUrl } from "../src/lib/sales/fee-workspace.ts";
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
  assert.equal(matchingFeeActions(r,readFeeFilters("?feeWork=others")).length,0);
  const selected=selectFeeCategory(INITIAL_FEE_FILTERS,"invoice-submission");
  assert.equal(selected.view,"invoice-submission");
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
    assert.equal(f.view,category); assert.equal(f.agent,"");assert.equal(f.milestone,"all");assert.equal(f.page,1);assert.equal(f.search,"");
  }
  assert.equal(readFeeFilters("?feeWork=ours&feeCategory=invoice-submission").view,"invoice-submission");
  assert.equal(readFeeFilters("?feeWork=others&feeCategory=payment-position").view,"payment-position");
  assert.deepEqual(readFeeFilters("?feeWork=bad&feeCategory=bad&feePage=-1&feeSort=bad"),INITIAL_FEE_FILTERS);
  assert.equal(feeWorkCategory("part_paid"),salesWorkCategory({kind:"fee_completion_part_paid",responsibility:{kind:"developer"}}));
});
test("URL round trip preserves filters and fee record opens the matching completion section",()=>{
  const f={...INITIAL_FEE_FILTERS,view:"invoice-review",milestone:"completion",agent:"a1",page:2,search:"101",sort:"unit"};
  const params=new URLSearchParams();writeFeeFilters(params,f);assert.deepEqual(readFeeFilters(params.toString()),f);
  const r=row({exchangeInvoice:approved("i"),completionInvoice:{id:"c",status:"uploaded"}});
  assert.match(feeRecordUrl(r,f,params.toString()),/section=financials#completion-fee$/);
  assert.match(feeRecordUrl(r,f,params.toString()),/workReturn=fees/);
  assert.match(feeRecordUrl(r,INITIAL_FEE_FILTERS,""),/#agent-fees$/);
});
test("future completion fees remain net secondary information and missing invoices add no approved money",()=>{
  const summary=summariseFeeCategories([row({})]);assert.equal(summary.futureNet,2500);assert.equal(summary.categories["payment-position"].amount,0);
});

test("one canonical selection survives refinements and serialisation; reselecting is a no-op",()=>{
  for(const view of Object.keys(FEE_VIEWS)) {
    const f=selectFeeView({...INITIAL_FEE_FILTERS,agent:"unassigned",milestone:"completion",search:"101",sort:"unit",page:7},view);
    assert.equal(f.view,view);
    assert.equal(f.page,view==="ours"?7:1);
    assert.equal(f.agent,"unassigned");assert.equal(f.milestone,"completion");assert.equal(f.search,"101");assert.equal(f.sort,"unit");
    assert.equal(selectFeeView(f,view),f);
    const p=new URLSearchParams("feeWork=others&feeCategory=invoice-submission");writeFeeFilters(p,f);
    assert.equal(p.has("feeWork"),false);assert.equal(p.has("feeCategory"),false);
    assert.deepEqual(readFeeFilters(p.toString()),f);
  }
});

test("every legacy responsibility/category combination preserves its effective membership",()=>{
  const rows=[row({saleAttemptId:"assigned",exchangeInvoice:approved("a"),completionInvoice:{id:"c",status:"uploaded"}}),row({saleAttemptId:"missing"}),row({saleAttemptId:"unassigned",agentOrganisationId:null}),row({saleAttemptId:"unassigned-review",agentOrganisationId:null,exchangeInvoice:{id:"u",status:"uploaded"}})];
  for(const work of ["ours","others","all"])for(const category of ["",...Object.keys(FEE_CATEGORIES)]) {
    const f=readFeeFilters(`?feeWork=${work}&feeCategory=${category}`);
    const legacyWork=category==="invoice-submission"&&work==="ours"?"all":category&&category!=="invoice-submission"&&work==="others"?"ours":work;
    const expected=rows.filter(r=>legacyWork==="all"&&!category||feeActions(r).some(a=>(!category||a.category===category)&&(legacyWork==="all"||legacyWork==="ours"&&a.owner==="developer"||legacyWork==="others"&&a.owner==="agent")));
    const scope=feeScopeRows(rows,"","",f.assignedOnly);
    assert.deepEqual(selectFeeRows(scope,f,new Map()).map(r=>r.saleAttemptId).sort(),expected.map(r=>r.saleAttemptId).sort(),`${work}/${category}`);
    const link=new URL(feeCategoryDestination("b1",category,work),"https://fixture.test");
    assert.deepEqual(readFeeFilters(link.search),f);
  }
  const unassigned=new URL(feeCategoryDestination("b1","invoice-submission","all","unassigned"),"https://fixture.test");
  assert.equal(readFeeFilters(unassigned.search).agent,"unassigned");
  assert.equal(feeScopeRows(rows,"","unassigned",true).length,0);
  const canonical=readFeeFilters("?feeView=all&feeWork=others&feeCategory=invoice-review");
  assert.equal(canonical.view,"all");assert.equal(canonical.assignedOnly,false);
});

test("assigned-only scope remains explicit through view changes and summary totals",()=>{
  const f=selectFeeView(readFeeFilters("?feeWork=others"),"all");
  assert.equal(f.assignedOnly,true);
  const rows=[row({}),row({saleAttemptId:"unallocated",agentOrganisationId:null})];
  const scope=feeScopeRows(rows,"","",f.assignedOnly);
  assert.equal(summariseFeeCategories(scope).categories["invoice-submission"].tasks,2);
  assert.equal(selectFeeRows(rows,f,new Map()).length,1);
  assert.equal(readFeeFilters(new URL(feeViewDestination("b1",f.view,f),"https://fixture.test").search).assignedOnly,true);
});

test("purpose-built empty, approval-only, balance-only, missing-only and settled populations",()=>{
  const review={id:"review",status:"uploaded"};
  const cases=[
    {rows:[],ours:0,all:0,reviews:0,unpaid:0,submissions:0},
    {rows:[row({exchangeInvoice:review,completionInvoice:review})],ours:1,all:1,reviews:2,unpaid:0,submissions:0},
    {rows:[row({exchangeInvoice:approved("a"),completionInvoice:approved("b")})],ours:1,all:1,reviews:0,unpaid:2,submissions:0},
    {rows:Array.from({length:37},(_,i)=>row({saleAttemptId:`missing-${i}`,agentOrganisationId:i%2?null:"agent"})),ours:0,all:37,reviews:0,unpaid:0,submissions:74},
    {rows:[row({exchangeInvoice:approved("a",0),completionInvoice:approved("b",0)})],ours:0,all:1,reviews:0,unpaid:0,submissions:0},
    {rows:[row({exchangeInvoice:approved("a"),completionInvoice:review})],ours:1,all:1,reviews:1,unpaid:1,submissions:0},
  ];
  for(const c of cases){
    const s=summariseFeeCategories(c.rows);
    assert.equal(s.ourSales,c.ours);assert.equal(s.allSales,c.all);
    assert.equal(selectFeeRows(c.rows,INITIAL_FEE_FILTERS,new Map()).length,c.ours);
    assert.equal(s.categories["invoice-review"].tasks,c.reviews);
    assert.equal(s.categories["payment-position"].tasks,c.unpaid);
    assert.equal(s.categories["invoice-submission"].tasks,c.submissions);
  }
});
