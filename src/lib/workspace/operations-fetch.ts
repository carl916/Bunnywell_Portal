import {integrationProject} from "./staging";
const origin="https://"+integrationProject+".supabase.co";
const setupRpc=new Set(["workspace_setup_context","workspace_setup_operation","workspace_setup_receipt"]);
const snagRpc=new Set(["workspace_snag_context","workspace_snag_operation","workspace_snag_media"]);
export function operationsFetch(actor:string,scope:{buildingId?:string;snagId?:string|null;accountId?:string;requestId?:string;email?:string;mediaPath?:string}={},service=false):typeof fetch{
 return async(input,options)=>{
  const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),method=(options?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
  if(u.origin!==origin||u.username||u.password||u.hash)throw Error("Operations origin rejected");
  let allowed=false;
  const rpc=u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  if(rpc&&method==="POST"){
   const raw=options?.body??(input instanceof Request?await input.clone().text():null);
   const p=typeof raw==="string"?JSON.parse(raw):{};
   allowed=service?setupRpc.has(rpc[1])&&p.p_actor===actor:snagRpc.has(rpc[1])&&p.p_building===scope.buildingId&&(p.p_snag??null)===(scope.snagId??null);
  }
  if(service&&scope.accountId){
   if(u.pathname==="/auth/v1/admin/users/"+scope.accountId)allowed=method==="GET";
   if(u.pathname==="/auth/v1/admin/users"&&method==="POST"){
    const raw=options?.body??(input instanceof Request?await input.clone().text():null),p=typeof raw==="string"?JSON.parse(raw):{};
    allowed=p.id===scope.accountId&&p.email===scope.email&&p.email_confirm===true&&p.app_metadata?.workspace_test_request===scope.requestId&&p.role===undefined;
   }
  }
  if(service&&scope.mediaPath){
   allowed=["GET","POST"].includes(method)&&[ "/storage/v1/object/workspace-snag-media/"+scope.mediaPath,"/storage/v1/object/authenticated/workspace-snag-media/"+scope.mediaPath].includes(u.pathname);
  }
  if(!allowed)throw Error("Operations egress rejected request");
  return fetch(input,{...options,redirect:"error"});
 };
}
