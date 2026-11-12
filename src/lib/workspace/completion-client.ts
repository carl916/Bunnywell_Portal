import type {RecordScope} from "@/lib/experiments/building-integration/completion-boundary";
import type {CompletionUploadFile} from "@/lib/sales/completion-upload";
import {uploadCompletionFiles,type UploadProgress} from "@/lib/sales/completion-upload-client";
import type {Upload} from "tus-js-client";
import {integrationProject} from "./staging";
export function hostedCompletionClient(token:string,anonKey:string){
 const request=(scope:RecordScope,value:Record<string,unknown>,signal?:AbortSignal)=>fetch("/workspace/command",{method:"POST",signal,redirect:"error",cache:"no-store",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({...value,scope})});
 async function action(scope:RecordScope,value:Record<string,unknown>,signal?:AbortSignal){
  const response=await request(scope,value,signal);const data=await response.json();if(!response.ok)throw Error(data.error||"Completion operation failed.");return data;
 }
 return{action,async upload(scope:RecordScope,requestId:string,file:File,metadata:CompletionUploadFile,progress:(value:UploadProgress)=>void,signal:AbortSignal,attempts:Map<string,Upload>){
  await uploadCompletionFiles(scope.saleId,requestId,[file],[metadata],progress,signal,attempts,{prepare:payload=>request(scope,payload,signal),anonKey,allowedStorageOrigin:"https://"+integrationProject+".storage.supabase.co"});
  return action(scope,{action:"finalize_completion_upload",requestId},signal);
 }};
}
