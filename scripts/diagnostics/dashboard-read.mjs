// Read-only application validation on dedicated staging fixtures. No workflow mutations.
import fs from 'node:fs';
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env, origin=env.DASHBOARD_TEST_ORIGIN;
if(env.DASHBOARD_TEST_STAGING!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Verified staging opt-in required.');
if(!origin||!/^http:\/\/localhost:\d+$|^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin))throw Error('Use the local application or verified branch preview.');
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=await client.auth.signInWithPassword({email:env.PLAYWRIGHT_ADMIN_EMAIL,password:env.PLAYWRIGHT_ADMIN_PASSWORD});
if(auth.error)throw Error('Dedicated reviewer sign-in failed.');
try {
  const building=await client.from('buildings').select('id').eq('name','E2E Completion Upload 2026-09-22').single();
  if(building.error)throw Error('Dedicated synthetic fixture building unavailable.');
  const samples=[];
  for(let i=0;i<3;i++){
    const start=performance.now(),response=await fetch(`${origin}/api/dashboard?building=${building.data.id}`,{headers:{Authorization:`Bearer ${auth.data.session.access_token}`}});
    const body=await response.text();let payload;try{payload=JSON.parse(body);}catch{throw Error(`Dashboard did not return JSON (${response.status}).`);}
    samples.push({status:response.status,durationMs:Math.round(performance.now()-start),bytes:Buffer.byteLength(body),sources:payload.sources,records:payload.items ? new Set(payload.items.map(item=>item.recordKey)).size : null,tasks:payload.items?.length,error:payload.error,cacheControl:response.headers.get('cache-control')});
  }
  fs.mkdirSync('test-results/organisation-dashboard',{recursive:true});fs.writeFileSync('test-results/organisation-dashboard/staging-read.json',JSON.stringify({origin,project:'vxkpvdtrldwwqiddoyof',fixture:'E2E Completion Upload 2026-09-22',samples},null,2));
  console.log(JSON.stringify(samples,null,2));
}finally{await client.auth.signOut();}
