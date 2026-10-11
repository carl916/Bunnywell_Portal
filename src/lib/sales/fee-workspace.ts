import { feeWorkCategory } from "../dashboard/work-classification.ts";
import type { AgentFeePortfolioRow, AgentFeePortfolioInvoiceState } from "./agent-fees-portfolio.ts";

export const FEE_CATEGORIES = {
  "invoice-review": "Awaiting approval",
  "payment-position": "Approved unpaid balances",
  "invoice-submission": "Invoices awaiting submission/correction",
} as const;
export type FeeCategory = keyof typeof FEE_CATEGORIES;
export const FEE_VIEWS = {
  ours: "Our actions",
  "invoice-review": "Awaiting approval",
  "payment-position": "Approved unpaid",
  "invoice-submission": "Invoices to submit/correct",
  all: "All records",
} as const;
export type FeeView = keyof typeof FEE_VIEWS;
export type FeeFilters = {
  view: FeeView; assignedOnly: boolean; agent: string;
  milestone: "all" | "exchange" | "completion"; sort: "work" | "unit"; search: string; page: number;
};
export const INITIAL_FEE_FILTERS: FeeFilters = {view:"ours",assignedOnly:false,agent:"",milestone:"all",sort:"work",search:"",page:1};
export function readFeeFilters(search:string):FeeFilters {
  const p=new URLSearchParams(search), category=p.get("feeCategory"), work=p.get("feeWork"), milestone=p.get("feeMilestone"), page=Number(p.get("feePage")??1);
  const validCategory=category && Object.hasOwn(FEE_CATEGORIES,category) ? category as FeeCategory : "";
  const requestedView=p.get("feeView");
  const canonical=Boolean(requestedView && Object.hasOwn(FEE_VIEWS,requestedView));
  // Preserve the effective legacy category normalisation, including the narrower
  // assigned-agent population of others + submissions (or no category).
  const view:FeeView=canonical ? requestedView as FeeView : validCategory || (work==="others"?"invoice-submission":work==="all"?"all":"ours");
  const assignedOnly=canonical ? p.get("feeAssigned")==="only" : work==="others" && (!validCategory||validCategory==="invoice-submission");
  return {view,assignedOnly,agent:(p.get("feeAgent")??"").slice(0,100),milestone:milestone==="exchange"||milestone==="completion"?milestone:"all",
    sort:p.get("feeSort")==="unit"?"unit":"work",search:(p.get("feeSearch")??"").slice(0,200),
    page:Number.isSafeInteger(page)&&page>0?Math.min(page,10000):1};
}
export function writeFeeFilters(p:URLSearchParams,f:FeeFilters) {
  p.delete("feeWork");p.delete("feeCategory");
  for(const [key,value] of Object.entries({feeView:f.view,feeAssigned:f.assignedOnly?"only":"",feeAgent:f.agent,feeMilestone:f.milestone,feeSort:f.sort,feeSearch:f.search,feePage:String(f.page)})) {
    if(value) p.set(key,value); else p.delete(key);
  }
}
export function feeViewDestination(buildingId:string,view:FeeView,scope:Pick<FeeFilters,"agent"|"assignedOnly">={agent:"",assignedOnly:false}) {
  const p=new URLSearchParams({screen:"sales",building:buildingId||"all",salesView:"agent_fees"});
  writeFeeFilters(p,{...INITIAL_FEE_FILTERS,...scope,view});
  return `/?${p}#fee-results`;
}
export function feeCategoryDestination(buildingId:string,category:FeeCategory|"",work:"ours"|"others"|"all"="ours",agent="") {
  const filters=readFeeFilters(new URLSearchParams({feeCategory:category,feeWork:work,feeAgent:agent}).toString());
  return feeViewDestination(buildingId,filters.view,filters);
}
export function selectFeeView(filters:FeeFilters,view:FeeView):FeeFilters {
  return view===filters.view ? filters : {...filters,view,page:1};
}
export function selectFeeCategory(filters:FeeFilters,category:FeeCategory|""):FeeFilters {
  return selectFeeView(filters,category||"ours");
}
export function feeActions(row:AgentFeePortfolioRow) {
  return [row.exchange,row.completion].filter(s=>s.needsAction && (feeWorkCategory(s.kind)!=="payment-position"||s.outstandingBalance>0)).map(state=>{
    const category=feeWorkCategory(state.kind), owner=category==="invoice-submission" ? row.agentOrganisationId ? "agent" : "unallocated" : "developer";
    return {state,category,owner,label:feeActionLabel(state)};
  }).sort((a,b)=>feeCategoryRank(a.category)-feeCategoryRank(b.category));
}
const feeCategoryRank=(category:FeeCategory)=>category==="invoice-review"?0:category==="payment-position"?1:2;
export function feeActionLabel(state:AgentFeePortfolioInvoiceState) {
  return state.kind==="awaiting_approval"?`Review ${state.milestone} agent invoice`:
    state.kind==="rejected"?`Correct ${state.milestone} agent invoice`:
    feeWorkCategory(state.kind)==="payment-position"?`Review payment position for ${state.milestone}`:`Submit ${state.milestone} agent invoice`;
}
export function matchingFeeActions(row:AgentFeePortfolioRow,f:FeeFilters) {
  if(f.assignedOnly&&!row.agentOrganisationId)return [];
  return feeActions(row).filter(a=>(f.view==="all"||f.view==="ours"&&a.owner==="developer"||f.view===a.category)&&
    (f.milestone==="all"||a.state.milestone===f.milestone));
}
export function feeScopeRows(rows:AgentFeePortfolioRow[],building:string,agent:string,assignedOnly=false) {
  return rows.filter(r=>(!building||r.buildingId===building)&&(!agent||(r.agentOrganisationId??"unassigned")===agent)&&(!assignedOnly||Boolean(r.agentOrganisationId)));
}
export function selectFeeRows(rows:AgentFeePortfolioRow[],f:FeeFilters,unitOrder:Map<string,number>) {
  const search=f.search.trim().toLocaleLowerCase("en-GB");
  return rows.filter(row=>(!f.assignedOnly||Boolean(row.agentOrganisationId))&&(!search||`${row.unitNumber} ${row.buildingName} ${row.agentName}`.toLocaleLowerCase("en-GB").includes(search))&&
    (f.view==="all" ? f.milestone==="all"||row[f.milestone].isRelevant : matchingFeeActions(row,f).length>0))
    .sort((a,b)=>{
      // The compact RPC records no due date or urgent flag. Approval age is not
      // a deadline. Reviews precede payment positions, then submissions; ties
      // use configured building/floor/unit order and immutable sale identity.
      const rank=(r:AgentFeePortfolioRow)=>Math.min(...matchingFeeActions(r,f).map(a=>a.category==="invoice-review"?0:a.category==="payment-position"?1:2),3);
      return (f.sort==="work"?rank(a)-rank(b):0)||(unitOrder.get(a.unitId)??Infinity)-(unitOrder.get(b.unitId)??Infinity)||a.saleAttemptId.localeCompare(b.saleAttemptId);
    });
}
export function summariseFeeCategories(rows:AgentFeePortfolioRow[]) {
  const summary=Object.fromEntries(Object.keys(FEE_CATEGORIES).map(key=>[key,{sales:0,tasks:0,amount:0,unallocated:0}])) as Record<FeeCategory,{sales:number;tasks:number;amount:number;unallocated:number}>;
  let futureNet=0,ourSales=0;
  for(const row of rows) {
    futureNet+=Math.round(row.futureCompletionFeeNet*100);
    const actions=feeActions(row);
    if(actions.some(a=>a.owner==="developer"))ourSales++;
    for(const category of Object.keys(FEE_CATEGORIES) as FeeCategory[]) {
      const matches=actions.filter(a=>a.category===category),s=summary[category];
      if(matches.length) s.sales++;
      s.tasks+=matches.length;
      s.unallocated+=matches.filter(a=>a.owner==="unallocated").length;
      if(category==="payment-position") s.amount+=matches.reduce((n,a)=>n+Math.round(a.state.outstandingBalance*100),0);
    }
  }
  summary["payment-position"].amount/=100;
  return {categories:summary,futureNet:futureNet/100,ourSales,allSales:rows.length};
}
export function feeRecordUrl(row:AgentFeePortfolioRow,f:FeeFilters,search:string) {
  const p=new URLSearchParams(search);
  writeFeeFilters(p,f);
  p.set("screen","sales");p.set("salesUnitId",row.unitId);p.set("workSale",row.saleAttemptId);p.set("workReturn","fees");p.set("section","financials");
  for(const key of ["salesView","workVersion","conversation","comment"])p.delete(key);
  const actions=matchingFeeActions(row,f);
  const milestone=actions[0]?.state.milestone??(f.milestone==="completion"?"completion":"exchange");
  // Both milestones share the existing financials workspace. A multi-action
  // label opens its heading, not one arbitrarily chosen invoice halfway down.
  return `/?${p}#${actions.length>1?"agent-fees":`${milestone}-fee`}`;
}
