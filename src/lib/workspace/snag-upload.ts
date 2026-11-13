import {createHash} from "node:crypto";
import {createSupabaseServiceRoleClient} from "@/lib/supabase/admin";
import {validId} from "@/lib/experiments/building-contracts/contracts";
import {viewer,check,ReadError} from "./server";
import {operationsEnabled,snagScope,snagClient,snagActions} from "./operations";
import {operationsFetch} from "./operations-fetch";
export const snagMediaLimit=4*1024*1024;
export function validSnagMedia(bytes:Uint8Array,mime:string){
 const b=Buffer.from(bytes);
 if(mime==="image/png")return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==="image/jpeg")return b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==="image/webp")return b.subarray(0,4).toString()==="RIFF"&&b.subarray(8,12).toString()==="WEBP";
 if(mime==="video/mp4")return b.subarray(4,8).toString()==="ftyp";
 if(mime==="video/webm")return b.subarray(0,4).equals(Buffer.from([26,69,223,163]));
 return false;
}
export async function snagUpload(request:Request){
 if(!operationsEnabled())throw new ReadError("Snag uploads unavailable.",404);
 if(request.headers.get("origin")!==new URL(request.url).origin)throw new ReadError("Use this workspace to upload evidence.");
 if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))throw new ReadError("Choose an evidence file.",415);
 const limit=snagMediaLimit+20000;if(Number(request.headers.get("content-length"))>limit)throw new ReadError("Choose evidence up to 4 MiB.",413);
 const reader=request.body?.getReader();if(!reader)throw new ReadError("Choose evidence.",400);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new ReadError("Choose evidence up to 4 MiB.",413);chunks.push(part.value)}}finally{await reader.cancel()}
 const form=await new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type")!}}).formData(),metadata=form.get("metadata"),file=form.get("file");
 if(typeof metadata!=="string"||metadata.length>12000)throw new ReadError("Invalid evidence metadata.",400);
 const p=JSON.parse(metadata),scope=snagScope(p);
 if(!snagActions.has(p.action)||!validId(p.requestId)||!p.payload||typeof p.payload!=="object"||Array.isArray(p.payload)||!(file instanceof File)||file.size<8||file.size>snagMediaLimit||file.name.length>200||/[\x00-\x1f/\\]/.test(file.name))throw new ReadError("Choose supported evidence up to 4 MiB.",400);
 const bytes=Buffer.from(await file.arrayBuffer());if(!validSnagMedia(bytes,file.type))throw new ReadError("The evidence file does not match its image or video type.",400);
 const v=await viewer(request);await check(v);const client=snagClient(v,scope.buildingId,scope.snagId);
 const args={p_building:scope.buildingId,p_snag:scope.snagId,p_request:p.requestId,p_action:p.action};
 const intent=await client.rpc("workspace_snag_media",{...args,p_name:file.name,p_mime:file.type,p_size:file.size});
 if(intent.error)throw new ReadError(intent.error.message,400);
 const path=String(intent.data.path);
 if(!path.startsWith(scope.buildingId+"/"+p.requestId+"/evidence."))throw new ReadError("Evidence path unavailable.",400);
 const storage=createSupabaseServiceRoleClient(operationsFetch(v.profile.id,{mediaPath:path},true),v.profile.id).storage.from("workspace-snag-media");
 const saved=await storage.upload(path,bytes,{contentType:file.type,upsert:false});
 if(saved.error){
  if(!/already exists|duplicate/i.test(saved.error.message))throw new ReadError(saved.error.message,400);
  const previous=await storage.download(path);if(previous.error)throw previous.error;
  const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
  if(hash(new Uint8Array(await previous.data.arrayBuffer()))!==hash(bytes))throw new ReadError("Evidence submission reference conflicts with this file.",409);
 }
 await check(v);
 const r=await client.rpc("workspace_snag_operation",{...args,p_payload:{...p.payload,withMedia:true}});
 if(r.error)throw new ReadError(r.error.message,400);return r.data;
}
