import {createSupabaseServiceRoleClient} from '@/lib/supabase/admin';
import {viewer,check,ReadError} from './server';
import {operationsWritesEnabled,stagingOrigin} from './staging';
import {validId} from '@/lib/experiments/building-contracts/contracts';
import type {SupabaseClient} from '@supabase/supabase-js';

const roles=['admin','developer','developer_representative','contractor','sales_agent','conveyancer','resident'];
const scoped=['developer_representative','contractor','sales_agent','conveyancer'];
const residents=['leaseholder','tenant','letting_agent','managing_agent'];
export async function setupAccountActor(request:Request){
 if(!operationsWritesEnabled())throw new ReadError('Account administration unavailable.',404);
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new ReadError('Use this workspace to manage accounts.');
 const v=await viewer(request);await check(v);if(!['admin','developer'].includes(v.profile.role))throw new ReadError('Account administration unavailable for this role.');
 // Ordinary accounts have a dedicated, bounded server path; no test-account metadata.
 const bounded:typeof fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.origin!==stagingOrigin||!/^\/(auth\/v1\/(admin\/users(?:\/[0-9a-f-]+)?|invite|recover|otp)|rest\/v1\/(profiles|units|buildings|organisations|resident_access_requests|rpc\/(save_portal_user_access|workspace_setup_operation)))$/.test(u.pathname))throw new Error('Account service request rejected.');return fetch(input,{...init,redirect:'error'})};
 return{v,client:createSupabaseServiceRoleClient(bounded,v.profile.id)};
}
export type AccountFields={email:string;password?:string;name:string;phone?:string;role:string;residentType?:string;organisationId?:string;buildingIds:string[];unitAccess:{unitId:string;accessType:string}[];sendInviteEmail?:boolean};
export async function validateAccount(c:SupabaseClient,p:AccountFields){
 if(!p.name?.trim()||!roles.includes(p.role))throw new ReadError('Enter a name and valid role.',400);
 if(!Array.isArray(p.buildingIds)||!Array.isArray(p.unitAccess))throw new ReadError('Choose valid access assignments.',400);
 if(scoped.includes(p.role)){
  if(!validId(p.organisationId||'')||!p.buildingIds.length)throw new ReadError('Choose an organisation and at least one building.',400);
  const o=await c.from('organisations').select('type').eq('id',p.organisationId!).single();
  if(o.error||!(o.data.type===p.role||p.role==='contractor'&&o.data.type==='supporting_trade'))throw new ReadError('Organisation does not match this role.',400);
 }
 if(p.role==='resident'){
  if(!residents.includes(p.residentType||'')||!p.unitAccess.length||p.unitAccess.some(a=>!validId(a.unitId)||![...residents,'representative'].includes(a.accessType)))throw new ReadError('Choose a resident type and valid flat access.',400);
  const ids=[...new Set(p.unitAccess.map(a=>a.unitId))],u=await c.from('units').select('id,building_id').in('id',ids);
  if(u.error||u.data.length!==ids.length)throw new ReadError('One or more flats are unavailable.',400);
  p.buildingIds=[...new Set(u.data.map(u=>u.building_id))];
 }else p.unitAccess=[];
 if(p.buildingIds.some(id=>!validId(id)))throw new ReadError('Choose valid buildings.',400);
 if(p.buildingIds.length){const b=await c.from('buildings').select('id').in('id',[...new Set(p.buildingIds)]);if(b.error||b.data.length!==new Set(p.buildingIds).size)throw new ReadError('One or more buildings are unavailable.',400);}
}
export async function createAccount(c:SupabaseClient,p:AccountFields,request:Request){
 await validateAccount(c,p);
 const email=p.email?.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ReadError('Enter a valid email address.',400);
 if(!p.sendInviteEmail&&(!p.password||p.password.length<12))throw new ReadError('Use a temporary password of at least 12 characters.',400);
 const redirectTo=new URL('/workspace?view=password-setup',request.url).toString();
 const r=p.sendInviteEmail?await c.auth.admin.inviteUserByEmail(email,{data:{full_name:p.name},redirectTo}):await c.auth.admin.createUser({email,password:p.password,email_confirm:true,user_metadata:{full_name:p.name}});
 if(r.error||!r.data.user)throw new ReadError(r.error?.message||'Account could not be created.',400);
 const id=r.data.user.id;
 const access=await c.rpc('save_portal_user_access',{p_user:id,p_profile:{email,name:p.name,full_name:p.name,phone:p.phone||null,role:p.role,resident_type:p.role==='resident'?p.residentType:null,organisation_id:scoped.includes(p.role)?p.organisationId:null,active:true},p_buildings:p.buildingIds,p_units:p.unitAccess});
 if(access.error){await c.from('profiles').update({active:false}).eq('id',id);throw new ReadError('Account created but access could not be assigned. It has been disabled; reload Users and edit its access before reactivating.',409);}
 return{id,invited:Boolean(p.sendInviteEmail)};
}
