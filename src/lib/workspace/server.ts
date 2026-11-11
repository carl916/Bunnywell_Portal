import { createClient } from "@supabase/supabase-js";
import { stagingOrigin, moduleAllowed } from "./staging";
import { rows, related } from "./reads";
import { loadDashboardInput, dashboardAccessKey } from "@/lib/dashboard/read";
import { deriveDashboard } from "@/lib/dashboard/model";
import { projectWorkspace, scopeFor, type Access } from "@/lib/experiments/building-contracts/projection";
import { validId, contractVersion } from "@/lib/experiments/building-contracts/contracts";
import { sortUnitsByBuildingFloorOrder } from "@/lib/units/commercial-allocation";
import type { Catalog, Completion, Document } from "@/lib/experiments/building-integration/reader";
import type { WorkViewer, WorkSale, DashboardInput } from "@/lib/dashboard/types";
import type { Building, Unit, Area, BuildingFloor, BuildingOrganisation, Organisation, ProductionSnag, SnagEvent, SnagPhoto } from "@/lib/data/production";
import type { PortalSnapshot, SnagList, SnagDetail, BuildingDetail, SetupData } from "./types";
export class ReadError extends Error { constructor(message:string,public status=403){super(message);} }
export async function viewer(request:Request) {
 const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
 if(!token)throw new ReadError("Sign in to the staging workspace.",401);
 const client=createClient(stagingOrigin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
 const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)throw new ReadError("Session expired. Sign in again.",401);
 const p=await client.from("profiles").select("id,role,organisation_id,active").eq("id",auth.data.user.id).single();
 if(p.error||!p.data?.active||!moduleAllowed(p.data.role,"dashboard"))throw new ReadError("This account cannot open the workspace.");
 const profile=p.data as WorkViewer & {active:boolean};
 const revision=await dashboardAccessKey(client,profile);
 return{client,profile,revision,token};
}
export type Viewer = Awaited<ReturnType<typeof viewer>>;
export async function check(v:Viewer){const p=await v.client.from("profiles").select("id,role,organisation_id,active").eq("id",v.profile.id).single();if(p.error||JSON.stringify(p.data)!==JSON.stringify(v.profile)||await dashboardAccessKey(v.client,v.profile)!==v.revision)throw new ReadError("Access changed. Sign in again.");}
export async function catalog(v:Viewer):Promise<Catalog>{
 const buildings=await rows<Building>(v.client,"buildings","id,name,address_line_1,town");
 const access:Access={identity:v.profile.id,role:v.profile.role,organisationId:v.profile.organisation_id,active:true,buildingIds:buildings.map(b=>b.id),accessRevision:v.revision};
 return{access,buildings:buildings.map(b=>({id:b.id,name:b.name,address:[b.address_line_1,b.town].filter(Boolean).join(", ")}))};
}
async function building(v:Viewer,id:string,module:string){
 if(!validId(id)||!moduleAllowed(v.profile.role,module))throw new ReadError("Building or module unavailable.");
 const c=await catalog(v);const b=c.buildings.find(b=>b.id===id);if(!b)throw new ReadError("Building unavailable for this account.");
 return{c,b,scope:scopeFor(c.access,id,true)};
}
export async function workspace(v:Viewer,id:string):Promise<PortalSnapshot>{
 const {c,b,scope}=await building(v,id,"dashboard");
 const input=await loadDashboardInput(v.client,v.profile,id,Date.now(),"workspace");
 const overview=deriveDashboard(input);
 let result:PortalSnapshot={contract:contractVersion,scope,building:b,asOf:new Date().toISOString(),fixtureOnly:false,population:"Authorised building records",sources:overview.sources,counts:{units:0,stages:{},complete:true,ours:{actions:0,sales:0},others:{actions:0,sales:0},unallocated:{actions:0,sales:0},distinctSales:0},rows:[]};
 if(moduleAllowed(v.profile.role,"sales")){
  const buyers=await rows<{id:string;buyer_person_name:string|null;buyer_company_name:string|null}>(v.client,"unit_sale_attempts","id,buyer_person_name,buyer_company_name",q=>q.eq("building_id",id).is("redacted_at",null));
  const salesInput={...input,feePortfolio:undefined,snags:[],handovers:[],tenancies:[],arrears:[],rentalImports:[],accessRequests:[]};
  // Fees have already been read once by the shared loader; preserve their scoped
  // historical facts for the existing pure projection.
  result=projectWorkspace(c.access,b,salesInput,Object.fromEntries(buyers.map(s=>[s.id,s.buyer_person_name||s.buyer_company_name||"Buyer not recorded"])),false,true);
 }
 return{...result,overview:{items:overview.items.filter(i=>i.module==="snags"),sources:overview.sources.filter(s=>s.key==="snags"),summaries:overview.summaries.filter(s=>["developer_snags","resident_defects"].includes(s.key))}};
}
export async function completion(v:Viewer,scope:{buildingId:string;unitId:string;saleId:string}):Promise<Completion>{
 await building(v,scope.buildingId,"sales");
 if(!validId(scope.unitId)||!validId(scope.saleId))throw new ReadError("Invalid record.");
 const sales=await rows<WorkSale>(v.client,"unit_sale_attempts","id,building_id,unit_id,is_active,workflow_status,exchanged_at,legal_completed_at,completion_authority_given_at,completion_arrangements_confirmed_at,completion_legacy_stage,completion_notice_issued_at,contractual_completion_date",q=>q.eq("id",scope.saleId).eq("unit_id",scope.unitId).eq("building_id",scope.buildingId).is("redacted_at",null));
 if(sales.length!==1)throw new ReadError("This exact building, unit and sale are unavailable.");
 const documents=await rows<Document>(v.client,"unit_sale_documents","id,document_type,title,status,query_note,approved_version_id,approved_at,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,version_number,file_name,is_current,uploaded_at,redacted_at)",q=>q.eq("sale_attempt_id",scope.saleId).is("redacted_at",null).is("superseded_at",null).in("document_type",["completion_statement","draft_statement_of_account","completion_correspondence"]));
 return{sale:sales[0],documents};
}
export async function discussion(v:Viewer,p:URLSearchParams){
 const scope={buildingId:p.get("building")||"",unitId:p.get("unit")||"",saleId:p.get("sale")||""};await completion(v,scope);
 const kind=p.get("kind");const args:Record<string,unknown>={p_sale:scope.saleId};
 if(kind==="comments"){args.p_unit=scope.unitId;for(const [q,key]of [["before","p_before"],["after","p_after"]])if(p.has(q)){const n=Number(p.get(q));if(!Number.isSafeInteger(n)||n<0)throw new ReadError("Invalid cursor.",400);args[key]=n;}if(p.has("target")){if(!validId(p.get("target")!))throw new ReadError("Invalid comment.",400);args.p_target=p.get("target");}}
 else if(kind==="activity"){if(p.has("beforeId")){if(!validId(p.get("beforeId")!)||!Number.isFinite(Date.parse(p.get("beforeTime")||"")))throw new ReadError("Invalid cursor.",400);args.p_before_id=p.get("beforeId");args.p_before_time=p.get("beforeTime");}}
 else throw new ReadError("Document file viewing is not yet enabled in this read-only staging integration.",400);
 const result=await v.client.rpc(kind==="comments"?"sale_comment_page":"sale_activity_page",args);if(result.error)throw new ReadError("Discussion unavailable for this record.");return result.data;
}
export async function snags(v:Viewer,id:string):Promise<SnagList>{
 await building(v,id,"snags");
 const input=await loadDashboardInput(v.client,v.profile,id,Date.now(),"workspace-snags");
 const items=deriveDashboard(input).items;
 const all=await rows<ProductionSnag>(v.client,"snags","id,building_id,unit_id,area_id,source_type,title,status,trade_id,assigned_to_organisation_id,assigned_to_user_id,priority_code,sla_due_date,created_at,closed_at",q=>q.eq("building_id",id));
 const areas=await rows<Area>(v.client,"areas","id,name,building_id,unit_id",q=>q.eq("building_id",id));
 const unitOrder=new Map(sortUnitsByBuildingFloorOrder(input.units,input.floors,input.buildings).map((u,i)=>[u.id,i]));all.sort((a,b)=>(unitOrder.get(a.unit_id||"")??Infinity)-(unitOrder.get(b.unit_id||"")??Infinity)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 return{buildingId:id,complete:input.sources.find(s=>s.key==="snags")?.state==="ready",rows:all.map(s=>({...s,unitLabel:input.units.find(u=>u.id===s.unit_id)?.unit_number||(s.unit_id?"Unit unavailable":"Communal"),areaLabel:areas.find(a=>a.id===s.area_id)?.name||"Location not recorded",actions:items.filter(a=>a.recordKey==="snag:"+s.id)}))};
}
export async function snagDetail(v:Viewer,id:string,snagId:string,before?:string):Promise<SnagDetail>{
 const selected=await building(v,id,"snags");if(!validId(snagId))throw new ReadError("Invalid snag.");
 const [s]=await rows<ProductionSnag>(v.client,"snags","*",q=>q.eq("building_id",id).eq("id",snagId));if(!s)throw new ReadError("Snag unavailable in this building.");
 const [units,areas,photos,teams,transition]=await Promise.all([
 s.unit_id?rows<Unit>(v.client,"units","id,building_id,unit_number,floor",q=>q.eq("id",s.unit_id).eq("building_id",id)):[],
 s.area_id?rows<Area>(v.client,"areas","id,name",q=>q.eq("id",s.area_id).eq("building_id",id)):[],
 rows<SnagPhoto>(v.client,"snag_photos","id,snag_id,file_url,photo_type,caption,media_type,thumbnail_url,created_at",q=>q.eq("snag_id",snagId)),
 rows<BuildingOrganisation>(v.client,"building_organisations","id,building_id,organisation_id,role_on_project,active",q=>q.eq("building_id",id)),
 v.client.from("snag_events").select("id,snag_id,event_type,old_value,new_value,created_at,created_by_user_id,comment").eq("snag_id",snagId).in("event_type",["status_change","triage"]).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(1)
 ]);
 if(transition.error)throw new ReadError("Snag responsibility unavailable.",503);
 const organisations=await related<Organisation>(v.client,"organisations","id,name","id",[...new Set([...teams.map(t=>t.organisation_id),s.assigned_to_organisation_id].filter((v):v is string=>Boolean(v)))]);
 const facts:DashboardInput={viewer:v.profile,now:Date.now(),buildingId:id,buildings:[{id:selected.b.id,name:selected.b.name} as Building],units,floors:[],organisations,buildingOrganisations:teams,snags:[{...s,snag_events:transition.data as SnagEvent[]}],sales:[],documents:[],authorities:[],saleEvents:[],deposits:[],depositSources:[],invoices:[],terms:[],payments:[],handovers:[],tenancies:[],arrears:[],rentalImports:[],accessRequests:[],sources:[{key:"snags",label:"Snags",state:"ready",asOf:new Date().toISOString()}]};
 const actions=deriveDashboard(facts).items.filter(i=>i.recordKey==="snag:"+snagId);
 // Timestamp + ID cursor gives stable pages even for events written together.
 let q=v.client.from("snag_events").select("id,snag_id,event_type,old_value,new_value,comment,created_by_user_id,actor_name,actor_role,created_at").eq("snag_id",snagId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(101);
 if(before){const [at,key]=before.split("|");if(!validId(key)||!Number.isFinite(Date.parse(at)))throw new ReadError("Invalid history cursor.",400);q=q.or("created_at.lt."+at+",and(created_at.eq."+at+",id.lt."+key+")");}
 const events=await q;if(events.error)throw new ReadError("Snag history unavailable.",503);
 return{buildingId:id,snag:{...s,unitLabel:units[0]?.unit_number||(s.unit_id?"Unit unavailable":"Communal"),areaLabel:areas[0]?.name||"Location not recorded",actions},unit:units[0]||null,photos,events:events.data.slice(0,100) as SnagEvent[],moreEvents:events.data.length>100};
}
export async function buildingDetail(v:Viewer,id:string):Promise<BuildingDetail>{
 await building(v,id,"buildings");
 const [[b],units,floors,areas,teams]=await Promise.all([
 rows<Building>(v.client,"buildings","*",q=>q.eq("id",id)),
 rows<Unit>(v.client,"units","*",q=>q.eq("building_id",id)),
 rows<BuildingFloor>(v.client,"building_floors","*",q=>q.eq("building_id",id)),
 rows<Area>(v.client,"areas","*",q=>q.eq("building_id",id)),
 rows<BuildingOrganisation>(v.client,"building_organisations","*",q=>q.eq("building_id",id))
 ]);
 const organisations=await related<Organisation>(v.client,"organisations","id,name,type,email,phone","id",[...new Set(teams.map(t=>t.organisation_id))]);
 const defaults=await v.client.from("building_sale_defaults").select("*").eq("building_id",id).maybeSingle();if(defaults.error)throw new ReadError("Building defaults unavailable.",503);
 return{building:b,units:sortUnitsByBuildingFloorOrder(units,floors,[b]),floors,areas,teams,organisations,defaults:defaults.data||null};
}
export async function setup(v:Viewer,tab:string,page:number):Promise<SetupData>{
 if(!moduleAllowed(v.profile.role,"setup"))throw new ReadError("Setup unavailable.");
 const definitions:Record<string,[string,string,string]>={people:["profiles","id,email,name,full_name,role,organisation_id,active","email"],organisations:["organisations","id,name,type,main_contact_name,email,phone","name"],trades:["trades","id,name,sort_order","sort_order"],types:["unit_types","id,name,description","name"],audit:["audit_events","id,created_at,event_type,entity_type,summary,actor_name","created_at"]};
 if(!definitions[tab])throw new ReadError("Setup view unavailable.",400);
 const [table,columns,order]=definitions[tab];const from=(page-1)*30;
 const r=await v.client.from(table).select(columns).order(order,{ascending:tab!=="audit"}).order("id").range(from,from+30);if(r.error)throw new ReadError("This Setup source is unavailable.",503);
 return{tab,rows:r.data.slice(0,30) as unknown as Record<string,unknown>[],more:r.data.length>30};
}
