import {workflowUpload} from "@/lib/workspace/workflow-upload";
import {ReadError} from "@/lib/workspace/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 try{return Response.json(await workflowUpload(request),{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})}
 catch(e){return Response.json({error:e instanceof Error?e.message:"Upload could not be saved."},{status:e instanceof ReadError?e.status:400,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})}
}
