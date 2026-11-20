import {createSupabaseServiceRoleClient} from '@/lib/supabase/admin';
import {rows} from './reads';
import {ReadError,buildingDetail,type Viewer} from './server';
import {moduleAllowed} from './staging';
import {operationsFetch} from './operations-fetch';
import {sortUnitsByBuildingFloorOrder} from '@/lib/units/commercial-allocation';
import type {SetupContext,SetupPeople,SetupAllocation,Profile} from './setup-types';
import type {Building,BuildingFloor,Unit} from '@/lib/data/production';
function admin(v:Viewer){if(!moduleAllowed(v.profile.role,'setup'))throw new ReadError('Setup unavailable for this role.');}
export async function setupContext(v:Viewer):Promise<SetupContext>{
 admin(v);const client=createSupabaseServiceRoleClient(operationsFetch(v.profile.id,{},true),v.profile.id);
 const r=await client.rpc('workspace_setup_context',{p_actor:v.profile.id});if(r.error)throw new ReadError('Setup reference data unavailable.',503);return r.data;
}
export async function setupPeople(v:Viewer):Promise<SetupPeople>{
 admin(v);
 const [people,links,access,units,floors,buildings,requests]=await Promise.all([
  rows<Profile&{updated_at:string}>(v.client,'profiles','*'),
  rows<{user_id:string;building_id:string}>(v.client,'user_building_access','*'),
  rows<{user_id:string;unit_id:string;access_type:string}>(v.client,'user_unit_access','*'),
  rows<Unit>(v.client,'units','*'),rows<BuildingFloor>(v.client,'building_floors','*'),rows<Building>(v.client,'buildings','id,name'),
  rows<Record<string,unknown>>(v.client,'resident_access_requests','*')
 ]);
 return {people:people.map(p=>({...p,buildingIds:links.filter(l=>l.user_id===p.id).map(l=>l.building_id),unitAccess:access.filter(l=>l.user_id===p.id).map(l=>({unitId:l.unit_id,accessType:l.access_type}))})),units:sortUnitsByBuildingFloorOrder(units,floors,buildings.sort((a,b)=>a.name.localeCompare(b.name))),floors,requests};
}
export async function setupAllocation(v:Viewer,id:string):Promise<SetupAllocation>{
 admin(v);const data=await buildingDetail(v,id);
 const client=createSupabaseServiceRoleClient(operationsFetch(v.profile.id,{},true),v.profile.id);
 const r=await client.rpc('get_unit_allocation_sale_workflows',{p_actor_user_id:v.profile.id});if(r.error)throw new ReadError('Allocation workflow information unavailable.',503);
 const ids=new Set(data.units.map(u=>u.id));return{units:data.units,workflows:(r.data??[]).filter((w:{unit_id:string})=>ids.has(w.unit_id))};
}
export async function setupAudit(v:Viewer,p:URLSearchParams){
 admin(v);const filters:Record<string,unknown>={};
 for(const key of ['building','unit','sale','snag','category','event','actor','from','to','stream','search'])if(p.get(key))filters[key]=p.get(key);
 const r=await v.client.rpc('portal_audit_page',{p_filters:filters,p_before_time:p.get('beforeTime')||null,p_before_id:p.get('beforeId')||null,p_before_source:p.get('beforeSource')||null});
 if(r.error)throw new ReadError('Audit history unavailable.',503);return r.data;
}
