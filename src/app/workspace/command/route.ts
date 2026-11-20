import {completionCommand} from "@/lib/workspace/commands";
import {ReadError} from "@/lib/workspace/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 try{return Response.json(await completionCommand(request),{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})}
 catch(e){return Response.json({error:e instanceof ReadError?e.message:e instanceof Error?e.message:"Completion operation failed."},{status:e instanceof ReadError?e.status:400,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})}
}
