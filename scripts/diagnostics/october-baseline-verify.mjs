import fs from 'node:fs';
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
import {out} from './baseline-recorder.mjs';
dotenv.config({path:'.env.local',quiet:true});
const project='vxkpvdtrldwwqiddoyof.supabase.co';
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!==project)throw Error('Wrong local project.');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:building,error}=await admin.from('buildings').select('id').eq('name','Forum House').single();if(error)throw Error('Authorised building missing.');
const {data:units,error:unitError}=await admin.from('units').select('id,unit_number').eq('building_id',building.id).in('unit_number',['107','108','109','110']).order('unit_number');if(unitError||units.length!==4)throw Error('Scope mismatch.');
const {data:sales,error:salesError}=await admin.from('unit_sale_attempts').select('unit_id,workflow_status,buyer_person_name').in('unit_id',units.map(u=>u.id)).eq('is_active',true);
if(salesError||sales.length!==4||sales.some(s=>s.workflow_status!=='draft'||s.buyer_person_name))throw Error('Fresh empty drafts required.');
const browser=await chromium.launch({headless:true});let matched=false;
try{const page=await browser.newPage();page.on('request',r=>{if(new URL(r.url()).hostname===project)matched=true;});await page.goto('https://staging.bunnywell.co.uk');await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({timeout:60000});if(!matched)throw Error('Live staging project mismatch.');
fs.mkdirSync('.next/performance',{recursive:true});fs.writeFileSync('.next/performance/staging-test-sales.json',JSON.stringify({buildingId:building.id,units}));fs.writeFileSync('.next/performance/staging-access.json',JSON.stringify({matched}));
fs.writeFileSync(`${out}/deployment.json`,JSON.stringify({commit:'b883040b9bfc7b66084d1c4af73c13a179af578b',deploymentId:'dpl_5hFWn1r6y1FW7VjbwVgcixBFt9GR',deploymentUrl:'https://bunnywell-portal-i0gxaiq18-carl-gilbert-s-projects.vercel.app',alias:'https://staging.bunnywell.co.uk',region:'iad1',stagingProjectMatched:matched,verifiedAt:new Date().toISOString(),browserVersion:browser.version(),nodeVersion:process.version,freshAuthorisedUnits:[107,108,109,110],originalCompletedUnitsExcluded:[102,103,104,105,106]},null,2));console.log(JSON.stringify({matched,freshDrafts:sales.length,browserVersion:browser.version()}));
}finally{await browser.close();}
