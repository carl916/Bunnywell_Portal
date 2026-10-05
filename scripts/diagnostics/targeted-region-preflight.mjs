// Read-only execution-region gate. No authorised sale is mutated here.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});
const out='artifacts/performance/2026-10-05-targeted-region';
fs.mkdirSync(out,{recursive:true});
const origins={A:'https://bunnywell-portal-mwvgb5vko-carl-gilbert-s-projects.vercel.app',B:'https://bunnywell-portal-11i4lffpk-carl-gilbert-s-projects.vercel.app'};
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Staging required');
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await client.auth.signInWithPassword({email:process.env.PLAYWRIGHT_ADMIN_EMAIL,password:process.env.PLAYWRIGHT_ADMIN_PASSWORD});
if(login.error)throw Error('Diagnostic login failed');
const token=login.data.session.access_token;
const rows=[];
const otherRoutes=process.argv.includes('--other-routes');
const paths=otherRoutes?['/api/rentals/tenancies','/api/rentals/rent-risk']:['/api/sales/legal','/api/admin/users','/api/rentals/tenancies','/api/buildings/units/00000000-0000-0000-0000-000000000000'];
for(let round=1;round<=3;round++)for(const variant of round%2?['A','B']:['B','A'])for(const path of paths){
  // Legal GET without a sale exits before expiry RPC or other sale work.
  const start=performance.now();
  const r=await fetch(origins[variant]+path,{headers:{Authorization:`Bearer ${token}`}});
  await r.arrayBuffer();
  const id=r.headers.get('x-vercel-id');
  const regions=id?.split('::').filter(p=>/^[a-z]{3}\d$/.test(p))??[];
  const row={round,variant,path,status:r.status,durationMs:performance.now()-start,vercelId:id,edgeRegion:regions[0]??null,executionRegion:regions.length>1?regions.at(-1):null,cache:r.headers.get('x-vercel-cache'),serverTiming:r.headers.get('server-timing')};
  rows.push(row);console.log(JSON.stringify(row));
}
await client.auth.signOut();
const isolationPassed=rows.every(r=>r.executionRegion===(r.variant==='B'&&r.path==='/api/sales/legal'?'fra1':'iad1'));
const successfulHandlers=otherRoutes?rows.every(r=>r.status===200):null;
fs.writeFileSync(`${out}/${otherRoutes?'other-function-verification':'preflight'}.json`,JSON.stringify({verifiedAt:new Date().toISOString(),origins,rows,isolationPassed,successfulHandlers,salesMutations:0},null,2));
if(!isolationPassed||otherRoutes&&!successfulHandlers)process.exitCode=2;
