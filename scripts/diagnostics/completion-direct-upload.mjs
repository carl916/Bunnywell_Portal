// Explicit staging fixtures only. No tokens, request bodies, signed URLs or real
// sales data are retained. Run against the reviewed local build or staging preview.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env,origin=env.UPLOAD_TEST_ORIGIN||'http://localhost:3100';
if(env.UPLOAD_TEST_STAGING!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Explicit staging opt-in required.');
if(!/^http:\/\/localhost:\d+$/.test(origin)&&origin!=='https://staging.bunnywell.co.uk'&&!/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin))throw Error('Use an explicitly scoped test origin.');
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const building=await admin.from('buildings').select('id').eq('name','E2E Completion Upload 2026-09-22').single();if(building.error)throw Error('Dedicated upload fixtures missing.');
const {data:units,error}=await admin.from('units').select('id,unit_number').eq('building_id',building.data.id).order('unit_number');if(error||units.length!==3)throw Error('Expected three new upload fixtures.');
const out='artifacts/completion-direct-upload';fs.mkdirSync(out,{recursive:true});fs.mkdirSync('test-results/upload-files',{recursive:true});
const samples=[];const save=()=>fs.writeFileSync(`${out}/live-samples.json`,JSON.stringify({originKind:origin.startsWith('http://localhost')?'local-production-build/staging-storage':'staging-preview',samples},null,2));
function pdf(size,name){const doc=new jsPDF();doc.text('SYNTHETIC UPLOAD TEST - NOT A LEGAL DOCUMENT',12,20);const source=Buffer.from(doc.output('arraybuffer'));const path=`test-results/upload-files/${name}`;fs.writeFileSync(path,Buffer.concat([source,Buffer.alloc(size-source.length,32)]));return path;}
const browser=await chromium.launch({headless:true});
try {
 for(const [i,profile] of ['desktop','mobile-throttled'].entries()){
  if(env.UPLOAD_TEST_PROFILE&&profile!==env.UPLOAD_TEST_PROFILE)continue;
  const context=await browser.newContext({viewport:i?{width:390,height:844}:{width:1280,height:900}}),page=await context.newPage();
  await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill('carl@accoladeproperties.co.uk');await page.getByLabel('Password',{exact:true}).fill(env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).or(page.getByRole('button',{name:'Open menu',exact:true})).waitFor();
  await page.goto(`${origin}/?screen=sales&building=${building.data.id}&salesUnitId=${units[i].id}`);await page.getByRole('button',{name:/^Completion\b/}).click();const docs=page.locator('#completion-documents-step');await docs.getByLabel('Choose completion documents',{exact:true}).waitFor();
  if(i){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
  for(const [count,size,label] of [[1,1048576,'one-1MiB'],[2,1048576,'two-1MiB'],[2,5242880,'two-5MiB'],[2,10485760,'two-exact-10MiB']]){
    if(env.UPLOAD_TEST_CASE&&env.UPLOAD_TEST_CASE!==label)continue;
    const files=Array.from({length:count},(_,n)=>pdf(size,n?'synthetic-account.pdf':'synthetic-completion.pdf'));
    await docs.getByLabel('Choose completion documents',{exact:true}).setInputFiles(files);
    const requests=[],pending=[],starts=new Map();let requestId;let finalStatus;
    const begin=r=>{const path=new URL(r.url()).pathname;if(path==='/api/sales/legal'||path.includes('/storage/v1/upload/resumable'))starts.set(r,Date.now());};
    const end=r=>{if(!starts.has(r))return;pending.push((async()=>{const response=await r.response(),sizes=await r.sizes().catch(()=>null);if(response?.status()>=400&&new URL(r.url()).pathname.includes('/storage/')){const err=await response.json().catch(()=>({}));console.log(JSON.stringify({storageStatus:response.status(),message:String(err.message||err.error||'').replace(/eyJ[a-zA-Z0-9._-]+/g,'[redacted]')}));}const category=new URL(r.url()).pathname==='/api/sales/legal'?'legal':'storage';requests.push({category,method:r.method(),status:response?.status(),durationMs:Date.now()-starts.get(r),requestBytes:category==='legal'?sizes?.requestBodySize??null:null});if(category==='legal'&&r.method()==='POST'){const body=r.postDataJSON();requestId=body.requestId;if(body.action==='finalize_completion_upload')finalStatus=response.status();}})());};
    page.on('request',begin);page.on('requestfinished',end);const started=Date.now();
    await docs.getByRole('button',{name:'Upload completion documents',exact:true}).click();
    const outcome=await Promise.race([docs.locator('[role="group"][aria-label^="Selected "]').first().waitFor({state:'detached',timeout:360000}).then(()=>true),page.getByRole('alert').filter({hasText:/Could not|failed|not confirmed|interrupted|wrong|missing/}).first().waitFor({timeout:360000}).then(()=>false)]);
    const totalMs=Date.now()-started;page.off('request',begin);page.off('requestfinished',end);await Promise.all(pending);
    const sample={profile,label,count,size,totalMs,outcome,finalStatus,requests};samples.push(sample);save();console.log(JSON.stringify({profile,label,totalMs,outcome,finalStatus}));
    if(!outcome){const text=await page.getByRole('alert').allTextContents();console.log(JSON.stringify({errors:text.map(t=>t.slice(0,250))}));throw Error('Upload did not complete.');}
    const {data:session}=await admin.from('sale_completion_uploads').select('state,result').eq('id',requestId).single();if(session?.state!=='finalized'||session.result.length!==count)throw Error('Stored outcome mismatch.');
  }
  await context.close();
 }
}finally{save();await browser.close();}
