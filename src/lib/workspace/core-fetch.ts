import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {stagingProject} from "./staging";
const origin="https://"+stagingProject+".supabase.co";
const legalActions=["request_authority","confirm_exchange","request_notice_authority","confirm_completion"];
export function allowedCoreRequest(target:string,method:string,body:unknown,scope:RecordScope,actor:string){
 const u=new URL(target);if(u.origin!==origin||u.username||u.password||u.hash)return false;
 const p=body as Record<string,unknown>|undefined, rpc=u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
 if(rpc){
  if(method!=="POST"||p?.p_sale!==scope.saleId||p?.p_actor!==actor)return false;
  if(rpc[1]==="workspace_reservation_command")return p.p_building===scope.buildingId&&p.p_unit===scope.unitId&&["save_reservation_draft","save_reservation","approve_reservation","query_reservation","reject_reservation"].includes(String(p.p_action));
  if(["workspace_sale_test_context","workspace_sale_operation","workspace_sale_receipt"].includes(rpc[1]))return p.p_building===scope.buildingId&&p.p_unit===scope.unitId;
  if(rpc[1]==="sales_deposit_context")return true;
  if(rpc[1]==="workspace_reservation_inputs")return p.p_building===scope.buildingId&&p.p_unit===scope.unitId;
  if(["workspace_reservation_upload","workspace_reservation_submit"].includes(rpc[1]))return p.p_building===scope.buildingId&&p.p_unit===scope.unitId;
  if(rpc[1]==="sales_legal_action")return legalActions.includes(String(p.p_action));
  return ["sales_legal_snapshot","workspace_capture_legal_email","workspace_legal_test_delivery","workspace_reservation_file","sales_legal_submit_notice"].includes(rpc[1]);
 }
 const path=new RegExp("^/storage/v1/object/(?:authenticated/)?sale-documents/"+scope.buildingId+"/"+scope.saleId+"/(?:reservation|notice|invoice)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/(?:reservation_form|notice|agent_invoice)\\.pdf$","i");
 if(method==='DELETE'&&u.pathname==='/storage/v1/object/sale-documents')return Array.isArray(p?.prefixes)&&p.prefixes.length===1&&path.test('/storage/v1/object/sale-documents/'+p.prefixes[0]);
 return path.test(u.pathname)&&["GET","POST"].includes(method);
}
export function coreCommandFetch(scope:RecordScope,actor:string):typeof fetch{return async(input,options)=>{
 const target=typeof input==="string"?input:input instanceof URL?input.href:input.url,method=(options?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
 let body:unknown; if(new URL(target).pathname.startsWith("/rest/")||method==='DELETE'){const raw=options?.body??(input instanceof Request?await input.clone().text():undefined);if(typeof raw!=="string")throw Error("Core command body rejected");body=JSON.parse(raw);}
 if(!allowedCoreRequest(target,method,body,scope,actor))throw Error("Core command boundary rejected request");
 return fetch(input,{...options,redirect:"error"});
}};
