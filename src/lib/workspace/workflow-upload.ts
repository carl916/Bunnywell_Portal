import {noticeValidation,noticeFilenameWarnings} from '@/lib/sales/notice-contract';
import {rows,readBuildingNoticeTerms} from "./reads";
import {invoiceInputs,saleService} from "./extended-sales";
import {createHash} from "node:crypto";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {recordScope} from "@/lib/experiments/building-integration/completion-boundary";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import {canPerformSalesAction} from "@/lib/sales/permissions";
import {viewer,completion,check,ReadError} from "./server";
import {coreSalesEnabled} from "./staging";
import {coreCommandFetch} from "./core-fetch";
import {submitReservationPdf} from './reservation-submission';
export const workflowPdfLimit=2*1024*1024;
export async function workflowUpload(request:Request){
 if(!coreSalesEnabled())throw new ReadError("Core Sales uploads are unavailable.",404);
 if(request.headers.get("origin")!==new URL(request.url).origin)throw new ReadError("Use this workspace to upload.");
 if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))throw new ReadError("Choose a PDF.",415);
 const limit=workflowPdfLimit+16000;
 if(Number(request.headers.get("content-length"))>limit)throw new ReadError("Choose a PDF up to 2 MiB.",413);
 const reader=request.body?.getReader();if(!reader)throw new ReadError("Choose a PDF.",400);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>limit)throw new ReadError("Choose a PDF up to 2 MiB.",413);chunks.push(chunk.value);}}finally{await reader.cancel();}
 const body=Buffer.concat(chunks),form=await new Response(body,{headers:{"Content-Type":request.headers.get("content-type")!}}).formData();
 const metadata=form.get("metadata");if(typeof metadata!=="string"||metadata.length>8000)throw new ReadError("Invalid file metadata.",400);
 const p=JSON.parse(metadata),scope=recordScope(p.scope),file=form.get("file");
 if(!scope||!validId(p.requestId)||!["reservation_form","completion_correspondence","agent_invoice"].includes(p.type)||(p.expectedVersionId!==null&&!validId(p.expectedVersionId)))throw new ReadError("Invalid upload scope.",400);
 if(!(file instanceof File)||file.type!=="application/pdf"||file.size<5||file.size>workflowPdfLimit||file.name.length>200||!file.name.toLowerCase().endsWith(".pdf")||/[\x00-\x1f/\\]/.test(file.name))throw new ReadError("Choose a PDF up to 2 MiB.",400);
 const bytes=Buffer.from(await file.arrayBuffer());if(bytes.subarray(0,5).toString()!=="%PDF-")throw new ReadError("The selected file is not a PDF.",400);
 const v=await viewer(request);await completion(v,scope);
 const reservation=p.type==="reservation_form",invoice=p.type==="agent_invoice";

 if(!canPerformSalesAction(v.profile.role,reservation||invoice?"submit_reservation":"confirm_completion_arrangements"))throw new ReadError("This role cannot upload this document.");
 await check(v);
 const client=createSupabaseServiceRoleClient(coreCommandFetch(scope,v.profile.id),v.profile.id);
 if(reservation){
  if(p.action!=='submit_reservation')throw new ReadError('Submit the reservation details and PDF together.',400);
  return submitReservationPdf(client,scope,v.profile.id,p,file,bytes);
 }
 if(!invoice){
  const defaults=await readBuildingNoticeTerms(v.client,scope.buildingId);
  const [unit]=await rows<{unit_number:string}>(v.client,'units','unit_number',q=>q.eq('id',scope.unitId).eq('building_id',scope.buildingId));
  if(noticeFilenameWarnings(file.name,unit?.unit_number||'').length&&p.filenameMismatchConfirmed!==true)throw new ReadError('Review and confirm the filename mismatch.',400);
  if(!p.expectedVersionId){
   if(!['on_notice','fixed_date'].includes(p.basis)||typeof p.reason!=='string'||p.reason.length>2000)throw new ReadError('Check completion arrangements.',400);
   const error=noticeValidation({...p,serviceConfirmed:p.serviceConfirmed===true},{workingDays:defaults?.notice_working_days??10,serviceProvision:defaults?.notice_service_provision||''});if(error)throw new ReadError(error,400);
  }
 }
 const path=scope.buildingId+"/"+scope.saleId+"/"+(invoice?"invoice":"notice")+"-"+p.requestId+"/"+(invoice?"agent_invoice":"notice")+".pdf";
 const uploaded=await client.storage.from("sale-documents").upload(path,bytes,{contentType:"application/pdf",upsert:false});
 if(uploaded.error){
  if(!/already exists|duplicate/i.test(uploaded.error.message))throw uploaded.error;
  const saved=await client.storage.from("sale-documents").download(path);if(saved.error)throw saved.error;
  const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
  if(hash(new Uint8Array(await saved.data.arrayBuffer()))!==hash(bytes))throw new ReadError("Submission reference conflicts with the selected PDF.",409);
 }
 const details={path,name:file.name,size:file.size,mime:file.type,...(!invoice?{noticeTerms:{serviceDate:p.serviceDate,basis:p.basis,reason:p.reason,serviceConfirmed:p.serviceConfirmed,filenameMismatchConfirmed:p.filenameMismatchConfirmed}}:{})};
 const invoicePayload={milestone:p.milestone,reference:typeof p.reference==="string"?p.reference.trim():"",date:p.date,gross:Number(p.gross),termsId:p.termsId,termsRevision:p.termsRevision,expectedVersionId:p.expectedVersionId,file:details};
 if(invoice){
  const receipt=await saleService(v,scope).rpc("workspace_sale_receipt",{p_building:scope.buildingId,p_unit:scope.unitId,p_request:p.requestId,p_action:"register_agent_invoice",p_payload:invoicePayload});
  if(receipt)return receipt.result;
 }
 const invoiceData=invoice?await invoiceInputs(v,scope,p):null;
 const r=invoice?await client.rpc("workspace_sale_operation",{p_building:scope.buildingId,p_unit:scope.unitId,p_sale:scope.saleId,p_actor:v.profile.id,p_request:p.requestId,p_action:"register_agent_invoice",p_payload:{...invoicePayload,...invoiceData}}):
 await client.rpc("sales_legal_submit_notice",{p_sale:scope.saleId,p_actor:v.profile.id,p_request:p.requestId,p_expected:p.expectedVersionId,p_file:details,p_notice:p.noticeDate||null,p_due:p.dueDate||null,p_replace:p.expectedVersionId!==null});
 if(r.error)throw new ReadError(r.error.message,400);
 return r.data;
}
