import {setupContext,setupPeople,setupAllocation,setupAudit} from "@/lib/workspace/setup-read";
import {emailNotificationSettings} from "@/lib/workspace/email-notifications-server";
import {operationsEnabled} from "@/lib/workspace/operations";
import {saleDetails} from "@/lib/workspace/sale-details";
import {saleContext} from '@/lib/workspace/sale-context';
import { stagingEnabled, stagingOrigin, stagingProject, optimizedReads, completionWritesEnabled, coreSalesEnabled } from "@/lib/workspace/staging";
import {projected,unitOptions} from "@/lib/workspace/projections";
import * as read from "@/lib/workspace/server";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}});
export async function GET(request:Request){
 if(!stagingEnabled())return json({error:"Unavailable"},404);
 try{
 const p=new URL(request.url).searchParams,kind=p.get("kind");
 if(kind==="config")return json({projectId:stagingProject,apiOrigin:stagingOrigin,appOrigin:new URL(request.url).origin,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,readOnly:!completionWritesEnabled(),completionReview:completionWritesEnabled(),coreSales:coreSalesEnabled(),operations:operationsEnabled()});
 const v=await read.viewer(request);const id=p.get("building")||"";
 let result:unknown;
 if(kind==="setup-context")result=await setupContext(v);
 else if(kind==="email-notifications")result=await emailNotificationSettings(v);
 else if(kind==="setup-people")result=await setupPeople(v);
 else if(kind==="setup-allocation")result=await setupAllocation(v,id);
 else if(kind==="setup-audit")result=await setupAudit(v,p);
 else if(kind==="catalog")result=await read.catalog(v);
 else if(optimizedReads&&["summary","worklist","record"].includes(kind||""))result=await projected(v,id,kind as "summary"|"worklist"|"record",p);
 else if(optimizedReads&&kind==="unit-options")result=await unitOptions(v,id);
 else if(kind==="workspace")result=await read.workspace(v,id);
 else if(kind==="sale-details")result=await saleDetails(v,p);
 else if(kind==='sale-context')result=await saleContext(v,p);
 else if(kind==="completion")result=await read.completion(v,{buildingId:id,unitId:p.get("unit")||"",saleId:p.get("sale")||""});
 else if(["comments","activity","document"].includes(kind||""))result=await read.discussion(v,p);
 else if(kind==="snags")result=await read.snags(v,id);
 else if(kind==="snag-thumbnail")result=await read.snagThumbnail(v,id,p.get("snag")||"",p.get("photo")||"");
 else if(kind==="snag")result=await read.snagDetail(v,id,p.get("snag")||"",p.get("before")||undefined);
 else if(kind==="building")result=await read.buildingDetail(v,id);
 else return json({error:"Read unavailable"},400);
 await read.check(v);return json(result);
 }catch(e){return json({error:e instanceof read.ReadError?e.message:"Workspace data could not be loaded completely."},e instanceof read.ReadError?e.status:503);}
}
export async function POST(){if(!stagingEnabled())return json({error:"Unavailable"},404);return json({error:"Business writes are disabled in this staging review."},403);}
export const PATCH=POST,PUT=POST,DELETE=POST;
