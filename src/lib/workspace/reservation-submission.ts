import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {RecordScope} from '@/lib/experiments/building-integration/completion-boundary';
import {reservationErrors} from '@/lib/sales/reservation-validation';
import {reservationCommercial} from './core-commands';
import {ReadError} from './server';

export async function submitReservationPdf(client:SupabaseClient,scope:RecordScope,actor:string,p:Record<string,unknown>,file:File,bytes:Buffer){
 const payload=p.payload as Record<string,unknown>;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||typeof p.expected!=='string'||!Number.isFinite(Date.parse(p.expected)))throw new ReadError('Reload the reservation before submitting.',400);
 const clean:Record<string,unknown>={};
 for(const key of ['buyerPersonName','buyerCompanyName','buyerEmail','buyerPhone','buyerSolicitorName','reservationDate']){
  if(typeof payload[key]!=='string'||String(payload[key]).length>5000)throw new ReadError('Invalid reservation details.',400);
  clean[key]=String(payload[key]).trim();
 }
 clean.reservationTermsChecked=payload.reservationTermsChecked===true;
 const errors=reservationErrors(clean,clean.reservationTermsChecked===true,true);if(errors.length)throw new ReadError(errors.join(' '),400);
 const input={expected:p.expected,expectedVersionId:p.expectedVersionId,payload:clean,file:{name:file.name,size:file.size,mime:file.type},sha256:createHash('sha256').update(bytes).digest('hex')};
 const args={p_building:scope.buildingId,p_unit:scope.unitId,p_sale:scope.saleId,p_actor:actor,p_request:p.requestId,p_input:input};
 const cleanup=await client.rpc('workspace_reservation_upload',{...args,p_action:'cleanup',p_input:null});
 if(!cleanup.error)for(const path of cleanup.data.paths as string[]){await client.storage.from('sale-documents').remove([path]);}
 const prepared=await client.rpc('workspace_reservation_upload',{...args,p_action:'prepare'});
 if(prepared.error)throw new ReadError(prepared.error.message,400);
 if(prepared.data.state==='committed')return prepared.data.result;
 if(prepared.data.state==='aborted')throw new ReadError('The previous attempt was cancelled. Please retry.',400);
 const path=prepared.data.path as string;
 try{
  const uploaded=await client.storage.from('sale-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false});
  if(uploaded.error){
   if(!/already exists|duplicate/i.test(uploaded.error.message))throw uploaded.error;
   const existing=await client.storage.from('sale-documents').download(path);if(existing.error)throw existing.error;
   if(createHash('sha256').update(new Uint8Array(await existing.data.arrayBuffer())).digest('hex')!==input.sha256)throw Error('Submission reference conflicts with the selected PDF.');
  }
  const commercial=await reservationCommercial(async(name,args)=>{const r=await client.rpc(name,{p_sale:scope.saleId,p_actor:actor,...args});if(r.error)throw r.error;return r.data},scope);
  const submitted=await client.rpc('workspace_reservation_submit',{...args,...commercial});
  if(submitted.error)throw submitted.error;
  return submitted.data;
 }catch(error){
  // The database lock resolves commit-vs-abort before any deletion. A lost success
  // response must never cause removal of a submitted or approved PDF.
  const outcome=await client.rpc('workspace_reservation_upload',{...args,p_action:'abort'});
  if(outcome.error)throw new ReadError('Submission could not be confirmed. Your details and file are retained; retry to check the same submission.',503);
  if(outcome.data.state==='committed')return outcome.data.result;
  const removed=await client.storage.from('sale-documents').remove([path]);
  if(removed.error)throw new ReadError('Submission failed. The pending upload is tracked for cleanup. Your details and file are retained; retry.',400);
  throw new ReadError(error instanceof Error?error.message:(error as {message?:string}).message||'Submission failed. Please retry.',400);
 }
}
