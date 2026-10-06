import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});
const mode=process.argv[2];
const origin=process.env.AUDIT_PREVIEW_URL || 'https://staging.bunnywell.co.uk';
if(!['baseline','increment'].includes(mode)) throw Error('Choose baseline or increment');
if(new URL(origin).hostname!=='staging.bunnywell.co.uk' && !new URL(origin).hostname.endsWith('.vercel.app')) throw Error('Staging preview only');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(new URL(url).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co') throw Error('Staging database required');
const auth=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const {data,error}=await auth.auth.signInWithPassword({email:process.env.PLAYWRIGHT_ADMIN_EMAIL,password:process.env.PLAYWRIGHT_ADMIN_PASSWORD});
if(error) throw Error('Test authentication failed');
const {data:verified}=await auth.auth.getUser(data.session.access_token);
if(!verified.user) throw Error('Actor verification failed');
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{headers:{'x-bunnywell-audit-actor':verified.user.id}}});
const scope=JSON.parse(fs.readFileSync('.next/performance/staging-test-sales.json','utf8'));
const {data:type,error:typeError}=await admin.from('unit_types').select('id,name').limit(1).single();
if(typeError) throw Error('Fixture type missing');
const id=crypto.randomUUID(),number=`[E2E AUDIT ${id.slice(0,8)}]`;
const {error:created}=await admin.from('units').insert({id,building_id:scope.buildingId,unit_number:number,floor:'Ground',size_sqm:50,parking_bays:[],unit_type_id:type.id,unit_type:type.name});
if(created) throw Error('Synthetic fixture creation failed');
const samples=[];
try {
  const payload={unit_number:number,floor:'Ground',size_sqm:50,parking_bays:[],unit_type_id:type.id};
  const patch=body=>fetch(`${origin}/api/buildings/units/${id}`,{method:'PATCH',headers:{authorization:`Bearer ${data.session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  for(let i=0;i<20;i++) {
    payload.floor=i%2?'Ground':'First';
    const start=performance.now();const response=await patch(payload);await response.arrayBuffer();
    if(!response.ok) throw Error(`Synthetic mutation returned ${response.status}`);
    samples.push(performance.now()-start);
  }
  // The same payload is a no-op; malformed mutation must not create history.
  const {count:before}=await admin.from('audit_events').select('id',{count:'exact',head:true}).eq('entity_id',id);
  if(!(await patch(payload)).ok) throw Error('Retry failed');
  if((await patch({...payload,sale_status:'completed'})).status!==400) throw Error('Protected mutation unexpectedly accepted');
  const {count:after}=await admin.from('audit_events').select('id',{count:'exact',head:true}).eq('entity_id',id);
  if(before!==after) throw Error('Retry/failed action added success history');
  if(mode==='increment') {
    const {data:events,error:eventsError}=await admin.from('audit_events').select('created_by_user_id,outcome').eq('entity_id',id);
    if(eventsError || events.length!==21 || events.some(e=>e.created_by_user_id!==verified.user.id || e.outcome!=='succeeded')) throw Error('Trusted mutation history missing');
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  const result={mode,sampleSize:20,p50Ms:sorted[9],p95Ms:sorted[18],browserRequestsPerMutation:1,retryAndFailureNoExtraHistory:true,samples};
  fs.mkdirSync('artifacts/audit',{recursive:true});fs.writeFileSync(`artifacts/audit/${mode}-mutation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,samples:undefined}));
} finally {
  // Only this newly created synthetic unit is eligible for cleanup.
  const {error:cleanup}=await admin.from('units').delete().eq('id',id).eq('unit_number',number);
  if(cleanup) throw Error('Synthetic fixture cleanup failed');
  await auth.auth.signOut();
}
