import {scopeKey,type Scope} from "@/lib/experiments/building-contracts/contracts";
export const returnViews=["dashboard","worklist","snags"] as const;
export function returnView(p:URLSearchParams){const v=p.get("return");return returnViews.includes(v as typeof returnViews[number])?v!:(p.get("view")==="snag"?"snags":"worklist");}
export const navigationKey=(scope:Scope,view:string)=>"workspace-return:"+scopeKey(scope)+":"+view;
export function savedNavigation(scope:Scope,view:string):Record<string,string>{
 try {const raw=JSON.parse(sessionStorage.getItem(navigationKey(scope,view))||"{}");const values:Record<string,string>={};for(const key of ["q","stage","queue","page","status","source"])if(typeof raw.parameters?.[key]==="string")values[key]=raw.parameters[key];return{...values,building:scope.buildingId,view};}catch{return{building:scope.buildingId,view};}
}
export function originValues(values:Record<string,string>,current:URLSearchParams):Record<string,string>{
 if(!["sale","snag"].includes(values.view))return values;
 const sameBuilding=values.building===current.get("building");
 const origin=sameBuilding?(returnViews.includes(current.get("view") as typeof returnViews[number])?current.get("view"):current.get("return")):null;
 return{...values,...(origin&&returnViews.includes(origin as typeof returnViews[number])?{return:origin}:{})};
}
