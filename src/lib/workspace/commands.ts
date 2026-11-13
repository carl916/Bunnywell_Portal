import {extendedSalesActions,extendedSalesCommand,saleService} from "./extended-sales";
import {coreActions,coreCommand} from "./core-commands";
import {createClient} from "@supabase/supabase-js";
import {completionUploadAction} from "@/lib/sales/completion-upload-server";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {canPerformSalesAction} from "@/lib/sales/permissions";
import {recordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import {completionWritesEnabled,stagingOrigin} from "./staging";
import {viewer,completion,check,ReadError} from "./server";
import {completionCommandFetch} from "./command-fetch";

export const completionActions=new Set(["prepare_completion_upload","finalize_completion_upload","approve_completion_document","query_completion_document","comment","comment_context"]);

export async function completionCommand(request:Request) {
 if(!completionWritesEnabled())throw new ReadError("Completion writes are unavailable.",404);
 if(request.headers.get("origin")!==new URL(request.url).origin)throw new ReadError("Use this workspace to save changes.");
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new ReadError("JSON metadata required.",415);
 if(Number(request.headers.get("content-length"))>24000)throw new ReadError("Request too large.",413);
 const raw=await request.text();if(raw.length>24000)throw new ReadError("Request too large.",413);
 let p:Record<string,unknown>;try{p=JSON.parse(raw)}catch{throw new ReadError("Invalid request.",400)}
 if(!p||typeof p!=="object"||typeof p.action!=="string"||(!completionActions.has(p.action)&&!coreActions.has(p.action)&&!extendedSalesActions.has(p.action)))throw new ReadError("This operation is not enabled.");
 const scope=recordScope(p.scope);if(!scope)throw new ReadError("Select an exact building, unit and sale.",400);
 const v=await viewer(request);
 if(extendedSalesActions.has(p.action))return extendedSalesCommand(v,p,scope);
 if(coreActions.has(p.action))return coreCommand(v,p,scope);
 const current=await completion(v,scope);
 if(p.action==="comment"||p.action==="comment_context"){
  await check(v);
  const eligibility=await saleService(v,scope).rpc("workspace_sale_test_context",{p_building:scope.buildingId,p_unit:scope.unitId});
  if(p.action==="comment_context")return {writable:eligibility.enrolled===true};
  if(!eligibility.enrolled)throw new ReadError("Imported reference histories remain read-only. Use a designated fictional test journey.");
 }
 if(p.action!=="comment"&&(!current.sale.is_active||!current.sale.exchanged_at||current.sale.legal_completed_at||current.sale.workflow_status==="completed"))throw new ReadError("An active exchanged sale awaiting completion is required.");
 if(p.action!=="comment"&&!current.sale.completion_arrangements_confirmed_at&&current.sale.completion_legacy_stage!=="arrangements")throw new ReadError("Confirm completion arrangements first.");
 const upload=p.action==="prepare_completion_upload"||p.action==="finalize_completion_upload";
 if(p.action!=="comment"&&!canPerformSalesAction(v.profile.role,upload?"submit_completion_documents":"approve_completion_documents"))throw new ReadError("This account cannot perform this operation.");
 await check(v);
 const guarded=completionCommandFetch(scope,v.profile.id);
 if(p.action==="comment"){
  if(typeof p.body!=="string"||!p.body.trim()||p.body.length>5000||typeof p.clientId!=="string"||!validId(p.clientId))throw new ReadError("Enter a comment of 1–5,000 characters with a submission reference.",400);
  const client=createClient(stagingOrigin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guarded,headers:{Authorization:"Bearer "+v.token}}});
  const result=await client.rpc("sale_comment_write",{p_sale:scope.saleId,p_body:p.body,p_client:p.clientId,p_mentions:[]});
  if(result.error)throw new ReadError(result.error.message,400);
  return{id:result.data};
 }
 const client=createSupabaseServiceRoleClient(guarded,v.profile.id);
 if(upload)return completionUploadAction(client,v.profile.id,{action:p.action,sale:scope.saleId,requestId:p.requestId,files:p.files}, undefined, guarded);
 if(!["completion_statement","draft_statement_of_account"].includes(String(p.documentType))||typeof p.versionId!=="string"||!validId(p.versionId))throw new ReadError("Select a current completion document.",400);
 if(p.action==="query_completion_document"&&(typeof p.reason!=="string"||!p.reason.trim()||p.reason.length>5000))throw new ReadError("Enter a query of 1–5,000 characters.",400);
 const result=await client.rpc("sales_legal_action",{p_sale:scope.saleId,p_actor:v.profile.id,p_action:p.action,p_payload:{documentType:p.documentType,versionId:p.versionId,reason:p.reason}});
 if(result.error)throw new ReadError(result.error.message,400);
 return result.data;
}