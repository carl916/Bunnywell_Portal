import { ContractError, resolveSale, scopeKey, type Scope, type Workspace } from "./contracts";
export type Filters={search:string;stage:string;queue:string;page:number;scroll:number};
export const emptyFilters:Filters={search:"",stage:"",queue:"",page:1,scroll:0};
export function filtersFrom(p:URLSearchParams):Filters {
  return {search:(p.get("q")??"").slice(0,200),stage:p.get("stage")??"",queue:["ours","others","unallocated"].includes(p.get("queue")??"")?p.get("queue")!:"",
    page:Math.max(1,Math.min(10000,Number(p.get("page"))||1)),scroll:0};
}
export const returnKey=(scope:Scope)=>"building-contracts-return-v1:"+scopeKey(scope);
export function readReturn(storage:Pick<Storage,"getItem">,scope:Scope):Filters {
  try{const v=JSON.parse(storage.getItem(returnKey(scope))??"null");if(!v)return {...emptyFilters};
    return {...filtersFrom(new URLSearchParams({q:String(v.search??""),stage:String(v.stage??""),queue:String(v.queue??""),page:String(v.page??1)})),scroll:Math.max(0,Number(v.scroll)||0)};
  }catch{return {...emptyFilters};}
}
export type ApprovedEnvironment={approved:true;projectId:string;appOrigin:string;syntheticOnly:true;exactAttemptHandlingVerified:boolean};
export function existingSaleUrl(workspace:Workspace,unitId:string,saleId:string,approval:ApprovedEnvironment|null,runtime:{projectId:string;appOrigin:string}) {
  if(!approval||!approval.exactAttemptHandlingVerified||!approval.syntheticOnly||!approval.approved||approval.projectId!==runtime.projectId||approval.appOrigin!==runtime.appOrigin)return null;
  const origin=new URL(approval.appOrigin);
  if(origin.origin!==approval.appOrigin||origin.protocol!=="http:"||!["127.0.0.1","localhost"].includes(origin.hostname))throw new ContractError("Only the proposed approved local synthetic origin is allowed.");
  const row=resolveSale(workspace,unitId,saleId);
  const p=new URLSearchParams({screen:"sales",building:workspace.scope.buildingId,salesUnitId:row.unitId,workSale:row.saleId!,section:"progression"});
  return origin.origin+"/?"+p;
}
