import type {SnagRow} from "./types";
import {matchesWorkTeam,isUnallocatedWork} from "@/lib/dashboard/work-classification";
const keys=["q","status","source","queue","page","sort","unit"] as const;
export function snagListValues(p:URLSearchParams,building:string):Record<string,string>{
 const values:Record<string,string>={view:"snags",building};
 for(const key of keys)if(p.has(key))values[key]=p.get(key)!;
 return values;
}
// Store query state, never a page of IDs or an untrusted return URL.
export function snagListContext(p:URLSearchParams,building:string){
 const raw=p.get("snagList");if(!raw||raw.length>12000)return null;
 const list=new URLSearchParams(raw);
 if(list.get("view")!=="snags"||list.get("building")!==building)return null;
 return snagListValues(list,building);
}
export function selectSnags(rows:SnagRow[],p:URLSearchParams){
 const q=(p.get("q")||"").toLowerCase(),status=p.get("status"),source=p.get("source"),queue=p.get("queue"),unit=p.get("unit");
 const result=rows.filter(r=>(!q||(r.title+" "+(r.description||"")+" "+r.unitLabel+" "+r.areaLabel).toLowerCase().includes(q))&&(!status||r.status===status)&&(!source||r.source_type===source)&&(!unit||r.unit_id===unit)&&(!queue||r.actions.some(a=>queue==="unallocated"?isUnallocatedWork(a):matchesWorkTeam(a,queue as "ours"|"others"))));
 // The API's default order follows configured floors and natural unit order.
 const sort=p.get("sort");
 if(sort==="raised-asc"||sort==="raised-desc")result.sort((a,b)=>(sort==="raised-desc"?-1:1)*a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 return result;
}
export function snagNeighbours(rows:SnagRow[],p:URLSearchParams,id:string){
 const selected=selectSnags(rows,p),index=selected.findIndex(r=>r.id===id);
 return {previous:index>0?selected[index-1].id:null,next:index>=0&&index<selected.length-1?selected[index+1].id:null,matched:index>=0};
}
