import { NextResponse } from "next/server";
import { account, catalog, workspace } from "@/lib/experiments/building-contracts/fixtures";
import { ContractError } from "@/lib/experiments/building-contracts/contracts";

export const dynamic="force-dynamic";
export async function GET(request:Request) {
  if(process.env.NODE_ENV!=="development"||process.env.BUILDING_CONTRACTS_OFFLINE!=="1"||process.env.STAGING_WEB_VITALS==="1")return new Response(null,{status:404});
  const p=new URL(request.url).searchParams;
  if([...p.keys()].some(k=>!["kind","viewer","building","mode"].includes(k)))return NextResponse.json({error:"Invalid fixture parameters"},{status:400});
  try {
    const alias=p.get("viewer")??"developer";account(alias);
    const kind=p.get("kind");const mode=p.get("mode")??"ready";
    if(!["ready","loading","empty","error","unavailable","incomplete"].includes(mode))return NextResponse.json({error:"Invalid fixture mode"},{status:400});
    if(kind==="catalog")return NextResponse.json(catalog(alias),{headers:{"Cache-Control":"no-store","X-Fixture-Only":"1"}});
    if(kind!=="workspace")return NextResponse.json({error:"Unknown fixture resource"},{status:400});
    const result=workspace(alias,p.get("building")??"",mode);
    if(mode==="loading")await new Promise(resolve=>setTimeout(resolve,1500));
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store","X-Fixture-Only":"1"}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unavailable"},{status:e instanceof ContractError?403:503,headers:{"Cache-Control":"no-store"}});}
}
