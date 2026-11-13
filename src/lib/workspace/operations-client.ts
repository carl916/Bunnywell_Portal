import type {Session} from "@/lib/experiments/building-integration/reader";
export async function operation<T=Record<string,unknown>>(session:Session,value:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
 const r=await fetch("/workspace/operations",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify(value),signal,cache:"no-store",redirect:"error"});
 const result=await r.json();if(!r.ok)throw Error(result.error||"Operation failed.");return result;
}
export async function snagEvidence(session:Session,value:Record<string,unknown>,file:File,signal:AbortSignal){
 const form=new FormData();form.set("metadata",JSON.stringify(value));form.set("file",file);
 const r=await fetch("/workspace/snag-upload",{method:"POST",headers:{Authorization:"Bearer "+session.access_token},body:form,signal,cache:"no-store",redirect:"error"});
 const result=await r.json();if(!r.ok)throw Error(result.error||"Evidence upload failed.");return result as {id:string};
}
