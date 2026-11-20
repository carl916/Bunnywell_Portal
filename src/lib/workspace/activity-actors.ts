import type {SupabaseClient} from '@supabase/supabase-js';
import {rows} from './reads';

export function personLabel(saved:unknown,profile?:{full_name?:string|null;name?:string|null}){
 const name=typeof saved==='string'?saved.trim():'';
 const generic=/^(unknown user|user|account|conveyancer|developer|administrator|admin|sales agent)$/i;
 if(name&&!generic.test(name))return name;
 return [profile?.full_name,profile?.name].find(value=>value?.trim()&&!generic.test(value.trim()))?.trim()||name||null;
}
export async function activityActors<T extends {created_by_user_id?:string|null;actor_name?:unknown}>(client:SupabaseClient,events:T[]):Promise<T[]>{
 const ids=[...new Set(events.map(e=>e.created_by_user_id).filter((id):id is string=>Boolean(id)))];
 if(!ids.length)return events;
 // Caller-JWT/RLS read: never use a service credential to disclose profiles.
 const profiles=await rows<{id:string;full_name:string|null;name:string|null}>(client,'profiles','id,full_name,name',q=>q.in('id',ids));
 return events.map(event=>({...event,actor_name:personLabel(event.actor_name,profiles.find(p=>p.id===event.created_by_user_id))}));
}
