import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {integrationProject} from "./staging";
const origin="https://"+integrationProject+".supabase.co";
const uuid="[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
/** This boundary grants no access. SQL independently authorises the verified actor. */
export function allowedCompletionRequest(target:string,method:string,body:unknown,scope:RecordScope,actor:string){
 const u=new URL(target);if(u.origin!==origin||u.username||u.password||u.hash)return false;
 const p=body as Record<string,unknown>|undefined;
 const rpc=u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
 if(rpc){
  if(method!=="POST"||p?.p_sale!==scope.saleId)return false;
  if(rpc[1]==="sale_comment_write")return Array.isArray(p.p_mentions)&&p.p_mentions.length===0&&!p.p_comment&&!p.p_parent;
  if(p.p_actor!==actor)return false;
  if(rpc[1]==="sales_legal_action")return ["approve_completion_document","query_completion_document"].includes(String(p.p_action));
  return rpc[1]==="sales_completion_upload_session"&&["begin","get","finalize"].includes(String(p.p_action));
 }
 const path=new RegExp("^"+scope.buildingId+"/"+scope.saleId+"/completion-"+uuid+"/(?:completion_statement|draft_statement_of_account)\\.pdf$","i");
 const storage=u.pathname.match(/^\/storage\/v1\/object\/(info|authenticated|upload\/sign)\/(completion-uploads|sale-documents)\/(.+)$/);
 if(storage&&path.test(storage[3]))return storage[1]==="upload/sign"?method==="POST"&&storage[2]==="completion-uploads":method==="GET";
 return u.pathname==="/storage/v1/object/copy"&&method==="POST"&&p?.bucketId==="completion-uploads"&&p.destinationBucket==="sale-documents"&&typeof p.sourceKey==="string"&&p.sourceKey===p.destinationKey&&path.test(p.sourceKey);
}
export function completionCommandFetch(scope:RecordScope,actor:string):typeof fetch{
 return async(input,options)=>{
  const target=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const method=(options?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
  let body:unknown;const raw=options?.body??(input instanceof Request?await input.clone().text():undefined);
  if(raw){if(typeof raw!=="string")throw Error("Command boundary rejected body");try{body=JSON.parse(raw)}catch{throw Error("Command boundary rejected body")}}
  if(!allowedCompletionRequest(target,method,body,scope,actor))throw Error("Command boundary rejected request");
  return fetch(input,{...options,redirect:"error"});
 };
}
