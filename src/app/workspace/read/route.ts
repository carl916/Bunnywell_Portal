import {saleDetails} from "@/lib/workspace/sale-details";
import { stagingEnabled, stagingOrigin, stagingProject, optimizedReads } from "@/lib/workspace/staging";
import {projected,unitOptions} from "@/lib/workspace/projections";
import * as read from "@/lib/workspace/server";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}});
export async function GET(request:Request){
 if(!stagingEnabled())return json({error:"Unavailable"},404);
 try{
 const p=new URL(request.url).searchParams,kind=p.get("kind");
 if(kind==="config")return json({projectId:stagingProject,apiOrigin:stagingOrigin,appOrigin:new URL(request.url).origin,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,readOnly:true});
 const v=await read.viewer(request);const id=p.get("building")||"";
 let result:unknown;
 if(kind==="catalog")result=await read.catalog(v);
 else if(optimizedReads&&["summary","worklist","record"].includes(kind||""))result=await projected(v,id,kind as "summary"|"worklist"|"record",p);
 else if(optimizedReads&&kind==="unit-options")result=await unitOptions(v,id);
 else if(kind==="workspace")result=await read.workspace(v,id);
 else if(kind==="sale-details")result=await saleDetails(v,p);
 else if(kind==="completion")result=await read.completion(v,{buildingId:id,unitId:p.get("unit")||"",saleId:p.get("sale")||""});
 else if(["comments","activity","document"].includes(kind||""))result=await read.discussion(v,p);
 else if(kind==="snags")result=await read.snags(v,id);
 else if(kind==="snag")result=await read.snagDetail(v,id,p.get("snag")||"",p.get("before")||undefined);
 else if(kind==="building")result=await read.buildingDetail(v,id);
 else if(kind==="setup")result=await read.setup(v,p.get("tab")||"people",Math.min(1000,Math.max(1,Number(p.get("page"))||1)));
 else return json({error:"Read unavailable"},400);
 await read.check(v);return json(result);
 }catch(e){return json({error:e instanceof read.ReadError?e.message:"Workspace data could not be loaded completely."},e instanceof read.ReadError?e.status:503);}
}
export async function POST(){if(!stagingEnabled())return json({error:"Unavailable"},404);return json({error:"Business writes are disabled in this staging review."},403);}
export const PATCH=POST,PUT=POST,DELETE=POST;
