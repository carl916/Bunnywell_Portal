import { rows } from './reads';
import { moduleAllowed } from './staging';
import { ReadError, type Viewer } from './server';
import { deriveDashboard } from '@/lib/dashboard/model';
import { matchesWorkTeam,isUnallocatedWork } from '@/lib/dashboard/work-classification';
import { projectWorkspace,scopeFor,summarise } from '@/lib/experiments/building-contracts/projection';
import { contractVersion,validId } from '@/lib/experiments/building-contracts/contracts';
import type { DashboardInput,WorkSale } from '@/lib/dashboard/types';
import type { Building,Unit,BuildingFloor } from '@/lib/data/production';
import type { PortalSnapshot } from './types';
import { sortUnitsByBuildingFloorOrder } from '@/lib/units/commercial-allocation';
import { saleProgression } from './sale-progression';

export async function projected(v:Viewer,id:string,mode:'summary'|'worklist'|'record',p:URLSearchParams):Promise<PortalSnapshot>{
 if(!validId(id)||!moduleAllowed(v.profile.role,mode==='summary'?'dashboard':'sales'))throw new ReadError('Building or module unavailable.');
 const unit=mode==='record'?p.get('unit'):null,sale=mode==='record'?(p.get('sale')||null):null;
 if(mode==='record'&&(!unit||!validId(unit)||Boolean(sale&&!validId(sale))))throw new ReadError('Exact sale identifiers required.',400);
 const [[b],response]=await Promise.all([
 rows<Building>(v.client,'buildings','id,name,address_line_1,town',q=>q.eq('id',id)),
 v.client.rpc('workspace_building_facts',{p_building:id,p_unit:unit,p_sale:sale,p_include_snags:mode==='summary'})
 ]);
 if(!b||response.error)throw new ReadError(response.error?.code==='42501'?'Building or exact sale unavailable.':'Building facts could not be loaded completely.',response.error?.code==='42501'?403:503);
 const access={identity:v.profile.id,role:v.profile.role,organisationId:v.profile.organisation_id,active:true,buildingIds:[id],accessRevision:v.revision};
 const building={id:b.id,name:b.name,address:[b.address_line_1,b.town].filter(Boolean).join(', ')};
 const now=Date.now(),sales=moduleAllowed(v.profile.role,'sales'),snags=moduleAllowed(v.profile.role,'snags')&&mode==='summary',fees=['admin','developer','sales_agent'].includes(v.profile.role);
 const input:DashboardInput={...response.data,viewer:v.profile,now,buildingId:id,saleEvents:[],handovers:[],tenancies:[],arrears:[],rentalImports:[],accessRequests:[],sources:[['sales','Sales progression',sales],['legal','Authorities and completion documents',sales],['fees','Agent invoice position',fees],['snags','Snags and resident defects',snags]].map(([key,label,allowed])=>({key:String(key),label:String(label),state:allowed?'ready':'not_permitted',asOf:allowed?new Date(now).toISOString():null}))};
 const overview=deriveDashboard(input);
 let result:PortalSnapshot={contract:contractVersion,scope:scopeFor(access,id,true),building,asOf:new Date(now).toISOString(),fixtureOnly:false,population:'Authorised building records',sources:[],counts:{units:0,stages:{},complete:true,ours:{actions:0,sales:0},others:{actions:0,sales:0},unallocated:{actions:0,sales:0},distinctSales:0},rows:[]};
 if(sales){const buyers=Object.fromEntries((input.sales as (WorkSale&{buyer_person_name?:string;buyer_company_name?:string})[]).map(s=>[s.id,s.buyer_person_name||s.buyer_company_name||'Buyer not recorded']));result=projectWorkspace(access,building,{...input,snags:[]},buyers,false,true);}
 result.rows=result.rows.map(row=>{const sale=input.sales.find(a=>a.id===row.saleId);return sale?{...row,progression:saleProgression(sale,input.documents.filter(d=>d.sale_attempt_id===sale.id),input.authorities.filter(a=>a.sale_attempt_id===sale.id),now)}:row;});
 if(mode==='record'){
  let row=result.rows.find(r=>r.unitId===unit&&r.saleId===(sale||null));
  // Historical attempts without outstanding fees must remain directly readable.
  // The reviewed RPC has already checked the exact building/unit/attempt and RLS.
  if(!row){
   const a=input.sales.find(a=>a.id===sale&&a.unit_id===unit&&!a.is_active&&!a.redacted_at),u=input.units.find(u=>u.id===unit);
   if(a&&u){const buyer=a as WorkSale&{buyer_person_name?:string;buyer_company_name?:string};row={unitId:u.id,unitNumber:u.unit_number,buildingId:id,buildingName:b.name,floor:u.floor||"",saleId:a.id,buyerLabel:buyer.buyer_person_name||buyer.buyer_company_name||"Buyer not recorded",stage:a.workflow_status,historical:true,actions:[],primaryActionId:null,warning:"Historical sale attempt",preview:{heading:"Historical sale",state:a.workflow_status,responsibleTeam:"Recorded history",mode:"read-only",onBehalf:null}};}
  }
  if(!row)throw new ReadError('This exact building, unit and sale are unavailable.');
  if(!row.progression){const a=input.sales.find(a=>a.id===row!.saleId);if(a)row={...row,progression:saleProgression(a,input.documents.filter(d=>d.sale_attempt_id===a.id),input.authorities.filter(e=>e.sale_attempt_id===a.id),now)};}
  return {...result,rows:[row]};
 }
 if(mode==='worklist'){
  const search=(p.get('q')||'').toLowerCase(),stage=p.get('stage')||'',queue=p.get('queue')||'';
  if(queue&&!['ours','others','unallocated'].includes(queue))throw new ReadError('Invalid responsibility filter.',400);
  const filtered=result.rows.filter(r=>(!stage||r.stage===stage)&&(!queue||r.actions.some(a=>a.queue===queue))&&(r.unitNumber+' '+r.buyerLabel).toLowerCase().includes(search));
  const pages=Math.max(1,Math.ceil(filtered.length/20)),page=Math.min(pages,Math.max(1,Math.trunc(Number(p.get('page'))||1)));
  const filteredCounts=summarise(filtered,result.counts.complete);const currentCounts=summarise(filtered.filter(r=>!r.historical),true);filteredCounts.units=currentCounts.units;filteredCounts.stages=currentCounts.stages;
  return {...result,...(result.rows.length<=200?{filterRows:result.rows}:{}),filteredCounts,rows:filtered.slice((page-1)*20,page*20),page:{number:page,pages,total:filtered.length,size:20}};
 }
 const items=overview.items.filter(i=>i.module==='snags');
 const queues=Object.fromEntries((['ours','others','unallocated'] as const).map(q=>{const chosen=items.filter(i=>q==='unallocated'?isUnallocatedWork(i):matchesWorkTeam(i,q));return[q,{actions:chosen.length,records:new Set(chosen.map(i=>i.recordKey)).size}];}));
 return {...result,rows:result.rows.filter(r=>r.actions.some(a=>a.queue==='ours')).slice(0,2),overview:{items:items.filter(i=>matchesWorkTeam(i,'ours')).slice(0,2),sources:overview.sources.filter(s=>s.key==='snags'),summaries:overview.summaries.filter(s=>['developer_snags','resident_defects'].includes(s.key)),queues}};
}

export async function unitOptions(v:Viewer,id:string){
 if(!validId(id)||!moduleAllowed(v.profile.role,'sales'))throw new ReadError('Unit selector unavailable.');
 const [units,floors]=await Promise.all([
 rows<Unit&{unit_sale_attempts:{id:string;is_active:boolean;redacted_at:string|null}[]}>(v.client,'units','id,building_id,unit_number,floor,unit_sale_attempts!unit_sale_attempts_unit_id_fkey(id,is_active,redacted_at)',q=>q.eq('building_id',id).eq('unit_sale_attempts.is_active',true).is('unit_sale_attempts.redacted_at',null)),
 rows<BuildingFloor>(v.client,'building_floors','id,building_id,name,sort_order',q=>q.eq('building_id',id))
 ]);
 return sortUnitsByBuildingFloorOrder(units,floors,[]).flatMap(u=>u.unit_sale_attempts.length?u.unit_sale_attempts.map(a=>({unitId:u.id,saleId:a.id as string|null,unitNumber:u.unit_number})):[{unitId:u.id,saleId:null,unitNumber:u.unit_number}]);
}
