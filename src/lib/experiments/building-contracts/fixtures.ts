import type { DashboardInput } from "../../dashboard/types";
import { contractVersion, ContractError, roles, type Catalog, type Building } from "./contracts";
import { scopeFor, projectWorkspace, type Access } from "./projection";
export const id=(n:number)=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
export const buildings:Building[]=[
  {id:id(1),name:"Willow Court",address:"Garden Lane, St Albans"},
  {id:id(2),name:"Orchard House",address:"Orchard Road, Harpenden"},
  {id:id(3),name:"Cedar Place",address:"Cedar Avenue, Welwyn"},
];
export const accounts:Record<string,Access>={
  developer:{identity:id(901),role:"developer",organisationId:id(501),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  "developer-single":{identity:id(902),role:"developer",organisationId:id(501),accessRevision:"offline-v1",active:true,buildingIds:[id(1)]},
  admin:{identity:id(903),role:"admin",organisationId:id(501),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  agent:{identity:id(904),role:"sales_agent",organisationId:id(502),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  "agent-colleague":{identity:id(905),role:"sales_agent",organisationId:id(502),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  "agent-other":{identity:id(906),role:"sales_agent",organisationId:id(503),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  conveyancer:{identity:id(907),role:"conveyancer",organisationId:id(504),accessRevision:"offline-v1",active:true,buildingIds:[id(1),id(2)]},
  inactive:{identity:id(908),role:"developer",organisationId:id(501),accessRevision:"offline-v1",active:false,buildingIds:[id(1)]},
  restricted:{identity:id(909),role:"contractor",organisationId:id(505),accessRevision:"offline-v1",active:true,buildingIds:[id(1)]},
};
export function account(alias:string) {
  const found=accounts[alias];
  if(!found||!found.active||!(roles as readonly string[]).includes(found.role))throw new ContractError("Account unavailable for Sales.");
  return structuredClone(found);
}
export function catalog(alias:string):Catalog {
  const a=account(alias);
  return {contract:contractVersion,scope:{identity:a.identity,role:a.role as Catalog["scope"]["role"],organisationId:a.organisationId,accessRevision:a.accessRevision},
    buildings:buildings.filter(b=>a.buildingIds.includes(b.id)).map(b=>({...b})),fixtureOnly:true};
}
export const snapshotTime=Date.parse("2026-11-03T12:00:00Z");
// Instantiated only for the requested building on the local server. No other-building
// sale/document records are materialised or sent to the client on normal entry.
export function facts(alias:string,buildingId:string) {
  const a=account(alias);scopeFor(a,buildingId);
  const b=buildings.find(b=>b.id===buildingId)!;const offset=b.id===id(1)?100:200;
  const specs=b.id===id(1)?[
    ["G11","Ground","exchanged","Taylor Reed"],["LG11","Lower Ground","awaiting_approval","Jordan Finch"],
    ["301","Third","draft","Avery Moss"],["G2","Ground","ready_for_exchange","Jamie Brooks"]
  ]:[
    ["G11","Ground","ready_for_exchange","Harper Stone"],["LG11","Lower Ground","completed","Morgan West"],
    ["301","Third","draft","Riley Lake"],["G2","Ground","awaiting_approval","Casey Green"]
  ];
  const buyers:Record<string,string>={};
  const units=specs.map(([label,floor,status],i)=>({id:id(offset+i),building_id:b.id,unit_number:label,floor,sale_status:status==="exchanged"?"exchanged":status==="completed"?"completed":status==="ready_for_exchange"?"reserved":"for_sale",rental_portfolio_status:"not_in_portfolio"}));
  const sales=specs.map(([, ,status,buyer],i)=>{
    const saleId=id(offset+1000+i);buyers[saleId]=buyer;
    return {id:saleId,building_id:b.id,unit_id:units[i].id,is_active:true,redacted_at:null,workflow_status:status,
      sales_agent_organisation_id:null,conveyancer_organisation_id:null,
      reservation_approved_at:["exchanged","ready_for_exchange","completed"].includes(status)?"2026-10-07T12:00:00Z":null,
      reservation_submitted_at:status==="awaiting_approval"?"2026-10-06T12:00:00Z":null,
      commercial_approved_at:["exchanged","ready_for_exchange","completed"].includes(status)?"2026-10-08T12:00:00Z":null,
      exchanged_at:["exchanged","completed"].includes(status)?"2026-10-20":null,
      legal_completed_at:status==="completed"?"2026-11-02T10:30:00Z":null,
      completion_arrangements_confirmed_at:status==="exchanged"?"2026-10-25T12:00:00Z":null,
      completion_authority_given_at:status==="exchanged"?"2026-10-24T12:00:00Z":null,
      completion_notice_issued_at:status==="exchanged"?"2026-10-25":null,
      contractual_completion_date:status==="exchanged"?"2026-11-03":null,created_at:"2026-10-01T12:00:00Z"};
  });
  const documents=sales.filter(s=>s.workflow_status==="exchanged").flatMap(s=>["completion_statement","draft_statement_of_account","completion_correspondence"].map((type,i)=>({
    id:id(offset+2000+i),sale_attempt_id:s.id,document_type:type,status:i===0?"query_raised":"uploaded",
    approved_version_id:null,approved_at:null,updated_at:"2026-11-02T10:00:00Z",updated_by_user_id:id(9999),
    query_note:i===0?"Correct the service-charge apportionment.":null,
    unit_sale_document_versions:[{id:id(offset+3000+i),is_current:true,redacted_at:null,uploaded_at:"2026-11-01T12:00:00Z"}]
  })));
  const input={viewer:{id:a.identity,role:a.role,organisation_id:a.organisationId},now:snapshotTime,buildingId:b.id,
    buildings:[{...b,status:"active",sales_agent_organisation_id:b.id===id(1)?id(502):id(503),conveyancer_organisation_id:id(504)}],
    units,sales,documents,floors:["Lower Ground","Ground","First","Second","Third"].map((name,sort_order)=>({building_id:b.id,name,sort_order})),
    organisations:[{id:id(502),name:"Willow Sales Team"},{id:id(503),name:"Orchard Sales Team"},{id:id(504),name:"Brook Legal Team"}],
    buildingOrganisations:[],authorities:[],saleEvents:[],deposits:sales.filter(s=>s.workflow_status==="exchanged").map(s=>({sale_attempt_id:s.id,source_id:id(offset+4000),expected_amount:42500,received_amount:42500})),depositSources:sales.filter(s=>s.workflow_status==="exchanged").map(s=>({id:id(offset+4000),sale_attempt_id:s.id,source_kind:"cash",expected_amount:42500})),furtherDeposits:[],invoices:[],payments:[],
    terms:sales.map(s=>({sale_attempt_id:s.id,is_current:true,version_number:1,contract_price:425000,exchange_agent_fee_percent:1.5,completion_agent_fee_percent:0,vat_rate:20})),
    snags:[],handovers:[],tenancies:[],arrears:[],rentalImports:[],accessRequests:[],
    sources:["sales","legal","fees"].map(key=>({key,label:key,state:"ready",asOf:new Date(snapshotTime).toISOString()}))
  } as unknown as DashboardInput;
  return {access:a,building:{...b},input,buyers};
}
export function workspace(alias:string,buildingId:string,mode="ready") {
  const f=facts(alias,buildingId);
  if(mode==="error")throw new Error("Sample data could not be loaded.");
  if(mode==="unavailable")throw new ContractError("Building unavailable in this sample.");
  if(mode==="empty"){f.input.units=[];f.input.sales=[];f.input.documents=[];f.input.terms=[];f.input.deposits=[];f.input.depositSources=[];}
  if(mode==="incomplete")f.input.sources.find(s=>s.key==="fees")!.state="unavailable";
  return projectWorkspace(f.access,f.building,f.input,f.buyers);
}
