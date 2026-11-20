import {stagingProject} from "./staging";
const origin="https://"+stagingProject+".supabase.co";
const setupRpc=new Set(["workspace_setup_context","workspace_setup_operation","workspace_setup_receipt","get_unit_allocation_sale_workflows","workspace_email_notification_settings","workspace_save_email_notifications"]);
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
   allowed=service?setupRpc.has(rpc[1])&&(p.p_actor??p.p_actor_user_id)===actor:snagRpc.has(rpc[1])&&p.p_building===scope.buildingId&&(p.p_snag??null)===(scope.snagId??null);
  }
  if(service&&scope.mediaPath){
   allowed=["GET","POST"].includes(method)&&[ "/storage/v1/object/workspace-snag-media/"+scope.mediaPath,"/storage/v1/object/authenticated/workspace-snag-media/"+scope.mediaPath].includes(u.pathname);
  }
  if(!allowed)throw Error("Operations egress rejected request");
  return fetch(input,{...options,redirect:"error"});
 };
}
