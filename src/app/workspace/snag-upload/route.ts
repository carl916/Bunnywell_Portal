import {snagUpload} from "@/lib/workspace/snag-upload";
import {ReadError} from "@/lib/workspace/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 const headers={"Cache-Control":"private, no-store","Vary":"Authorization"};
 try{return Response.json(await snagUpload(request),{headers})}
 catch(e){return Response.json({error:e instanceof Error?e.message:"Evidence upload failed."},{status:e instanceof ReadError?e.status:400,headers})}
}
