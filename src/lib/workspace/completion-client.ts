import {WorkspaceRequestError} from "./record-read";
import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import type {CompletionUploadFile} from "@/lib/sales/completion-upload";
import {uploadCompletionFiles,type UploadProgress} from "@/lib/sales/completion-upload-client";
import type {Upload} from "tus-js-client";
import {stagingProject} from "./staging";
export function hostedCompletionClient(credential:string|(()=>string),anonKey:string){
 const token=()=>typeof credential==="string"?credential:credential();
 const request=(scope:RecordScope,value:Record<string,unknown>,signal?:AbortSignal)=>fetch("/workspace/command",{method:"POST",signal,redirect:"error",cache:"no-store",headers:{Authorization:"Bearer "+token(),"Content-Type":"application/json"},body:JSON.stringify({...value,scope})});
 async function action(scope:RecordScope,value:Record<string,unknown>,signal?:AbortSignal){
  const response=await request(scope,value,signal);const data=await response.json();if(!response.ok)throw new WorkspaceRequestError(data.error||"Completion operation failed.",response.status);return data;
 }
 return{action,async upload(scope:RecordScope,requestId:string,file:File,metadata:CompletionUploadFile & {action?:string;expected?:string;payload?:Record<string,unknown>;noticeDate?:string;dueDate?:string;milestone?:string;reference?:string;date?:string;gross?:number;termsId?:string},progress:(value:UploadProgress)=>void,signal:AbortSignal,attempts:Map<string,Upload>){
  if(["reservation_form","completion_correspondence","agent_invoice"].includes(metadata.type)){
   progress({loaded:0,total:file.size,phase:"uploading"});const form=new FormData();form.set("file",file);form.set("metadata",JSON.stringify({...metadata,scope,requestId}));
   const response=await fetch("/workspace/upload",{method:"POST",headers:{Authorization:"Bearer "+token()},body:form,signal,redirect:"error",cache:"no-store"});const result=await response.json();if(!response.ok)throw new WorkspaceRequestError(result.error||"Upload failed.",response.status);progress({loaded:file.size,total:file.size,phase:"verifying"});return result;
  }
  await uploadCompletionFiles(scope.saleId,requestId,[file],[metadata],progress,signal,attempts,{prepare:payload=>request(scope,payload,signal),anonKey,allowedStorageOrigin:"https://"+stagingProject+".storage.supabase.co"});
  return action(scope,{action:"finalize_completion_upload",requestId},signal);
 }};
}
