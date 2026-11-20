import {WorkspaceRequestError} from "./record-read";
import {hostedCompletionClient} from "./completion-client";
import type {SaleDetails,SaleDetailsReader} from "./sale-details-types";
import type {SaleContext} from './sale-context-projection';
import {createSupabaseBrowserClient} from "@/lib/supabase/client";
import type {reader,Config,Session,Catalog,Completion} from "@/lib/experiments/building-integration/reader";
import {stagingOrigin,stagingProject,hostedWorkspace} from "./staging";
import type {Scope} from "@/lib/experiments/building-contracts/contracts";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import type {SaleActivity} from "@/lib/sales/discussion";
export const stagingSessionKey="bunnywell-staging-workspace-auth";
export async function stagingRead<T>(session:Session,kind:string,values:Record<string,string>={},signal?:AbortSignal):Promise<T>{
 const r=await fetch("/workspace/read?"+new URLSearchParams({kind,...values}),{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store",signal,redirect:"error"});
 const data=await r.json();if(!r.ok)throw new WorkspaceRequestError(data.error||"Read unavailable.",r.status);return data;
}
export async function stagingConfig():Promise<Config>{
 const r=await fetch("/workspace/read?kind=config",{cache:"no-store"});if(!r.ok)throw Error("Staging review is unavailable.");const c=await r.json();
 if(c.projectId!==stagingProject||c.apiOrigin!==stagingOrigin||!(c.readOnly===true||(hostedWorkspace&&c.readOnly===false&&c.completionReview===true)))throw Error("Unexpected project.");return c;
}
export async function stagingAuth(c:Config,path:"token?grant_type=password"|"user"|"logout",token?:string,body?:{email:string;password:string}){
 if(c.apiOrigin!==stagingOrigin)throw Error("Unexpected project.");
 const client=createSupabaseBrowserClient();
 if(path==="token?grant_type=password"){const r=await client.auth.signInWithPassword(body!);if(r.error||!r.data.session)throw Error("Sign-in failed. Check your account details.");return r.data.session;}
 if(path==="user"){const r=await client.auth.getUser();if(r.error)throw r.error;return r.data.user;}
 const r=await client.auth.signOut();if(r.error){await client.auth.signOut({scope:"local"});throw r.error;}return null;
}
export function stagingReader(c:Config,session:Session):ReturnType<typeof reader>&SaleDetailsReader{
 const scopeValues=(s:RecordScope)=>({building:s.buildingId,unit:s.unitId,sale:s.saleId});
 const disabled=async():Promise<never>=>{throw Error("Business actions are disabled in this staging review.");};
 return{
  read:disabled,catalog:(signal)=>stagingRead<Catalog>(session,"catalog",{},signal),
  load:(scope:Scope,signal:AbortSignal)=>stagingRead(session,"workspace",{building:scope.buildingId},signal),
  completion:(scope,unit,sale,signal)=>stagingRead<Completion>(session,"completion",{building:scope.buildingId,unit,sale},signal),
  details:(scope,unit,sale,section,signal)=>stagingRead<SaleDetails>(session,"sale-details",{building:scope.buildingId,unit,sale,section},signal),
  context:(scope,unit,sale,signal)=>stagingRead<SaleContext>(session,'sale-context',{building:scope.buildingId,unit,sale:sale||''},signal),
  workflow:{...(hostedWorkspace&&c.completionReview?hostedCompletionClient(()=>session.access_token,c.anonKey):{action:disabled,upload:disabled}),
   comments:(s,before,signal,after,target)=>stagingRead(session,"comments",{...scopeValues(s),...(before==null?{}:{before:String(before)}),...(after==null?{}:{after:String(after)}),...(target?{target}:{})},signal),
   activity:(s,before?:SaleActivity,signal?:AbortSignal)=>stagingRead(session,"activity",{...scopeValues(s),...(before?{beforeId:before.id,beforeTime:before.created_at}:{})},signal),
   document:(scope,version,signal)=>hostedWorkspace?stagingRead<{url:string;fileName:string}>(session,"document",{...scopeValues(scope),version},signal):disabled()
  }
 };
}
