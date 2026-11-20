import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import {buildDepositStructure,buildPaymentScheduleRows} from "@/lib/sales/deal-structure";
import {buildBuildingSaleDefaultsPayload} from "@/lib/sales/building-defaults";
import {validateAgentFeeStructure} from "@/lib/sales/agent-fees";
import {parsePercentInput} from "@/lib/sales/percentages";
import {parseGbpInput} from "@/lib/sales/currency";
import {timingError,type FurtherDepositTiming} from "@/lib/sales/further-deposit";
import {viewer,check,ReadError,type Viewer} from "./server";
import {operationsWritesEnabled,stagingOrigin} from "./staging";
import {operationsFetch} from "./operations-fetch";
export const setupActions=new Set(["create_building","save_building","create_organisation","save_organisation","create_trade","save_trade","create_type","save_type","save_person","set_person_status","save_floor","delete_floor","reorder_floors","save_unit","save_area","delete_area","save_team","remove_team","save_defaults","save_lifecycle","save_contacts","review_access_request","set_sales_availability","set_rental_portfolio"]);
export const snagActions=new Set(["create_snag","resolve_snag","request_snag_info","close_snag","reject_snag","answer_snag_info","assign_snag","snag_comment","add_snag_media"]);
type Fields=Record<string,unknown>;
export const operationsEnabled=operationsWritesEnabled;
export const revision=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fields(value:unknown):Fields{if(!value||typeof value!=="object"||Array.isArray(value))throw new ReadError("Invalid operation fields.",400);return value as Fields;}
export function snagClient(v:Viewer,buildingId:string,snagId:string|null){
 return createClient(stagingOrigin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+v.token},fetch:operationsFetch(v.profile.id,{buildingId,snagId})}});
}
export function snagScope(p:Fields){
 const scope=fields(p.scope),buildingId=String(scope.buildingId),snagId=scope.snagId?String(scope.snagId):null;
 if(!validId(buildingId)||(snagId&&!validId(snagId)))throw new ReadError("Choose an exact building and snag.",400);
 return {buildingId,snagId};
}
export async function operationsBody(request:Request){
 if(!operationsEnabled())throw new ReadError("Operational writes are unavailable.",404);
 if(request.headers.get("origin")!==new URL(request.url).origin)throw new ReadError("Use this workspace to save changes.");
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new ReadError("JSON fields required.",415);
 if(Number(request.headers.get("content-length"))>48000)throw new ReadError("Request too large.",413);
 const raw=await request.text();if(raw.length>48000)throw new ReadError("Request too large.",413);
 const p=fields(JSON.parse(raw)),action=String(p.action),v=await viewer(request);await check(v);
 if(action==="snag_context"||snagActions.has(action)){
  const {buildingId,snagId}=snagScope(p),client=snagClient(v,buildingId,snagId);
  const args:Fields={p_building:buildingId,p_snag:snagId};
  if(action!=="snag_context"){if(!validId(String(p.requestId)))throw new ReadError("Submission reference required.",400);Object.assign(args,{p_action:action,p_request:p.requestId,p_payload:fields(p.payload??{})});}
  const r=await client.rpc(action==="snag_context"?"workspace_snag_context":"workspace_snag_operation",args);
  if(r.error)throw new ReadError(r.error.message,400);return r.data;
 }
 if(!["admin","developer"].includes(v.profile.role))throw new ReadError("Setup administration is unavailable for this role.");
 const client=createSupabaseServiceRoleClient(operationsFetch(v.profile.id,{},true),v.profile.id);
 const rpc=async(name:string,args:Fields={})=>{const r=await client.rpc(name,{p_actor:v.profile.id,...args});if(r.error){
  if(action==="save_team"||action==="remove_team"){
   console.error("Delivery team operation failed",{action,requestId:p.requestId,error:r.error});
   throw new ReadError("The delivery team change could not be saved. Reload the current team and try again.",400);
  }
  throw new ReadError(r.error.message,400);
 }return r.data;};
 if(action==="setup_context")return rpc("workspace_setup_context");
 if(action==="save_email_notifications"){
  if(!validId(String(p.requestId)))throw new ReadError("Submission reference required.",400);
  const payload=fields(p.payload);
  return rpc("workspace_save_email_notifications",{p_request:p.requestId,p_payload:payload});
 }
 if(!setupActions.has(action)||!validId(String(p.requestId))||!validId(String(p.targetId)))throw new ReadError("Setup operation, record and submission reference required.",400);
 const payload=fields(p.payload??{}),requestId=String(p.requestId),targetId=String(p.targetId);
 const args={p_request:requestId,p_action:action,p_target:targetId,p_payload:payload};
 const saved=await rpc("workspace_setup_receipt",args);if(saved)return saved.result;
 if(action==="save_defaults"){
  const building=String(payload.buildingId);if(!validId(building)||building!==targetId)throw new ReadError("Choose the building defaults.",400);
  const defaultsRead=await v.client.from("building_sale_defaults").select("*").eq("building_id",building).maybeSingle();
  if(defaultsRead.error)throw new ReadError(defaultsRead.error.message,400);
  const current=defaultsRead.data;
  if(revision(current??null)!==payload.revision)throw new ReadError("Building defaults changed. Reload before saving.",409);
  const f=fields(payload.form),fee=validateAgentFeeStructure({totalFeePercent:parsePercentInput(f.agentFeePercent as string),exchangeFeePercent:parsePercentInput(f.exchangeAgentFeePercent as string),completionFeePercent:parsePercentInput(f.completionAgentFeePercent as string)});
  if(!fee.isValid)throw new ReadError(fee.error||"Check the fee percentages.",400);
  const deposit=buildDepositStructure({exchangeDepositPercent:parsePercentInput(f.exchangeDepositPercent as string),secondDepositEnabled:f.secondDepositEnabled===true,secondDepositPercent:parsePercentInput(f.secondDepositPercent as string),secondDepositMonthsAfterExchange:f.months===""?null:Number(f.months),furtherDepositTiming:f.timing as FurtherDepositTiming});
  if(deposit.secondDepositEnabled&&timingError(deposit.furtherDepositTiming,deposit.secondDepositMonthsAfterExchange,true))throw new ReadError(timingError(deposit.furtherDepositTiming,deposit.secondDepositMonthsAfterExchange,true)!,400);
  if(!deposit.isValid)throw new ReadError(deposit.error||"Check the deposit terms.",400);
  if(parseGbpInput(String(f.buildCost))===null||parseGbpInput(String(f.reservationFee))===null)throw new ReadError("Enter valid build cost and reservation fee amounts.",400);
  const defaults=buildBuildingSaleDefaultsPayload({buildingId:building,buildCost:String(f.buildCost),agentFeePercent:parsePercentInput(f.agentFeePercent as string),exchangeAgentFeePercent:parsePercentInput(f.exchangeAgentFeePercent as string),completionAgentFeePercent:parsePercentInput(f.completionAgentFeePercent as string),reservationFee:String(f.reservationFee),reservationFeeHolder:String(f.reservationFeeHolder),depositStructure:deposit});
  const noticeDays=Number(f.noticeWorkingDays??current?.notice_working_days??10);
  if(!Number.isInteger(noticeDays)||noticeDays<1||noticeDays>90)throw new ReadError('Notice period must be 1–90 working days.',400);
  Object.assign(defaults,{notice_working_days:noticeDays,notice_service_provision:String(f.noticeServiceProvision??current?.notice_service_provision??'').slice(0,2000)});
  Object.assign(payload,{defaults,schedule:buildPaymentScheduleRows(deposit),expectedDefaults:current??null});
 }
 const result=await rpc("workspace_setup_operation",args);
 if((action==="save_team"||action==="remove_team")&&result?.ok===false)throw new ReadError(result.message,409);
 return result;
}
