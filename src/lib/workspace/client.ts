import type {reader,Config,Session,Catalog,Completion} from "@/lib/experiments/building-integration/reader";
import {stagingOrigin,stagingProject} from "./staging";
import type {Scope} from "@/lib/experiments/building-contracts/contracts";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import type {SaleActivity} from "@/lib/sales/discussion";
export const stagingSessionKey="bunnywell-staging-workspace-auth";
export async function stagingRead<T>(session:Session,kind:string,values:Record<string,string>={},signal?:AbortSignal):Promise<T>{
 const r=await fetch("/workspace/read?"+new URLSearchParams({kind,...values}),{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store",signal,redirect:"error"});
 const data=await r.json();if(!r.ok)throw Error(data.error||"Read unavailable.");return data;
}
export async function stagingConfig():Promise<Config>{
 const r=await fetch("/workspace/read?kind=config",{cache:"no-store"});if(!r.ok)throw Error("Staging review is unavailable.");const c=await r.json();
 if(c.projectId!==stagingProject||c.apiOrigin!==stagingOrigin||c.readOnly!==true)throw Error("Unexpected project.");return c;
}
export async function stagingAuth(c:Config,path:"token?grant_type=password"|"user"|"logout",token?:string,body?:{email:string;password:string}){
 if(c.apiOrigin!==stagingOrigin)throw Error("Unexpected project.");
 const r=await fetch(stagingOrigin+"/auth/v1/"+path,{method:path==="user"?"GET":"POST",headers:{apikey:c.anonKey,Authorization:"Bearer "+(token||c.anonKey),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,redirect:"error",cache:"no-store"});
 if(!r.ok)throw Error("Sign-in or session unavailable. Use your existing staging account.");return r.status===204?null:r.json();
}
export function stagingReader(c:Config,session:Session):ReturnType<typeof reader>{
 const scopeValues=(s:RecordScope)=>({building:s.buildingId,unit:s.unitId,sale:s.saleId});
 const disabled=async():Promise<never>=>{throw Error("Business actions are disabled in this staging review.");};
 return{
  read:disabled,catalog:(signal)=>stagingRead<Catalog>(session,"catalog",{},signal),
  load:(scope:Scope,signal:AbortSignal)=>stagingRead(session,"workspace",{building:scope.buildingId},signal),
  completion:(scope,unit,sale,signal)=>stagingRead<Completion>(session,"completion",{building:scope.buildingId,unit,sale},signal),
  workflow:{action:disabled,upload:disabled,
   comments:(s,before,signal,after,target)=>stagingRead(session,"comments",{...scopeValues(s),...(before==null?{}:{before:String(before)}),...(after==null?{}:{after:String(after)}),...(target?{target}:{})},signal),
   activity:(s,before?:SaleActivity,signal?:AbortSignal)=>stagingRead(session,"activity",{...scopeValues(s),...(before?{beforeId:before.id,beforeTime:before.created_at}:{})},signal),
   document:disabled
  }
 };
}
