// One fresh authority issue per region. Never retry a mutation to enlarge n.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { jsPDF } from 'jspdf';
dotenv.config({path:'.env.local',quiet:true});
const out='artifacts/performance/2026-10-05-targeted-region';
if(process.env.SALES_PERF_ALLOW_STAGING_MUTATIONS!=='1')throw Error('Authorised staging opt-in required');
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw Error('Staging required');
const verification=JSON.parse(fs.readFileSync(`${out}/verification.json`));
if(!verification.completed||!verification.unchanged||verification.guardViolations)throw Error('Read-only batch must finish cleanly first');
if(fs.existsSync(`${out}/mutation-results.json`))throw Error('Mutation report exists; inspect consumed units before further work');
const deployments=JSON.parse(fs.readFileSync(`${out}/deployments.json`));
const report={startedAt:new Date().toISOString(),consumedUnits:[],fixtures:[],fixtureSetupRequests:[],samples:[],failures:[],profile:'desktop',mutation:'authority.issue',safeRecipientAllowlist:['carl@accoladeproperties.co.uk'],readiness:'success notice, Active authority status, visible reissue review control, two animation frames',plannedMutationSamplesPerRegion:1};
const save=()=>fs.writeFileSync(`${out}/mutation-results.json`,JSON.stringify(report,null,2));
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const clients={},tokens={};
const read=async q=>{const r=await q;if(r.error)throw Error('Staging inspection failed');return r.data;};
const building=(await read(admin.from('buildings').select('id').eq('name','Forum House').single())).id;
const numbers=[...Array.from({length:14},(_,i)=>String(102+i)),...Array.from({length:9},(_,i)=>String(201+i)),'301'];
const protectedUnits=await read(admin.from('units').select('id').eq('building_id',building).in('unit_number',numbers));
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function fingerprints(){
 const attempts=await read(admin.from('unit_sale_attempts').select('*').in('unit_id',protectedUnits.map(u=>u.id)));
 const ids=attempts.map(s=>s.id), result={units:await read(admin.from('units').select('*').in('id',protectedUnits.map(u=>u.id))),attempts};
 for(const table of ['sale_legal_emails','unit_sale_workflow_events','sale_comments','sale_mention_notifications'])result[table]=await read(admin.from(table).select('*').in('sale_attempt_id',ids));
 result.documents=await read(admin.from('unit_sale_documents').select('*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)').in('sale_attempt_id',ids));
 return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{count:v.length,sha256:hash(v)}]));
}
report.protectedBefore=await fingerprints();save();
let browser;
try{
 for(const [role,email] of Object.entries({admin:process.env.PLAYWRIGHT_ADMIN_EMAIL,agent:'carl@bunnywell.co.uk'})){
  clients[role]=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const r=await clients[role].auth.signInWithPassword({email,password:process.env.PLAYWRIGHT_ADMIN_PASSWORD});if(r.error)throw Error('Configured test login failed');tokens[role]=r.data.session.access_token;
 }
 async function post(role,origin,path,body){
  const started=performance.now();
  const r=await fetch(origin+path,{method:'POST',headers:{Authorization:`Bearer ${tokens[role]}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});
  const id=r.headers.get('x-vercel-id'),parts=id?.split('::').filter(v=>/^[a-z]{3}\d$/.test(v))??[];
  const row={regionVariant:origin===deployments.iad1.origin?'iad1':'fra1',endpoint:path,action:body instanceof FormData?'reservation_form_upload':body.action,status:r.status,vercelId:id,executionRegion:parts.length>1?parts.at(-1):null,durationMs:performance.now()-started,excludedFromMeasuredLegalAction:true};
  report.fixtureSetupRequests.push(row);save();
  if(!r.ok)throw Error(`Fixture setup rejected HTTP ${r.status}`);
  if(row.executionRegion!=='iad1')throw Error('Reservation setup route did not remain in iad1');return r.json();
 }
 // Match ordinary reservation preparation; no status edits or resetting.
 for(const [region,number] of [['iad1','210'],['fra1','211']]){
  const unit=await read(admin.from('units').select('id,unit_number').eq('building_id',building).eq('unit_number',number).single());
  const sale=await read(admin.from('unit_sale_attempts').select('*').eq('unit_id',unit.id).eq('is_active',true).single());
  const docs=await read(admin.from('unit_sale_documents').select('id').eq('sale_attempt_id',sale.id));
  const emails=await read(admin.from('sale_legal_emails').select('id').eq('sale_attempt_id',sale.id));
  if(sale.workflow_status!=='draft'||sale.redacted_at||sale.buyer_name||sale.buyer_person_name||sale.buyer_company_name||sale.authority_requested_at||sale.exchanged_at||sale.completed_at||docs.length||emails.length)throw Error('Fresh empty draft required');
  const origin=deployments[region].origin;
  report.consumedUnits.push(Number(number));save();
  await post('admin',origin,'/api/sales/reservations',{action:'save_commercial_model',unitId:unit.id,saleAttemptId:sale.id,contractPrice:250000});
  const pdf=new jsPDF();pdf.text('STAGING REGION TEST - NOT A LEGAL DOCUMENT',12,20);
  const form=new FormData();form.set('saleAttemptId',sale.id);form.set('file',new Blob([pdf.output('arraybuffer')],{type:'application/pdf'}),'synthetic-region-reservation.pdf');
  await post('agent',origin,'/api/sales/reservations',form);
  const today=new Date().toISOString().slice(0,10);
  await post('agent',origin,'/api/sales/reservations',{action:'save_reservation',unitId:unit.id,buyerPersonName:'Performance test targeted region buyer',buyerEmail:'performance-test@example.invalid',buyerPhone:'00000000000',buyerSolicitorName:'Performance test solicitor',reservationDate:today,reservationTermsChecked:true});
  await post('admin',origin,'/api/sales/reservations',{action:'approve_reservation',saleAttemptId:sale.id,reservationDate:today});
  const snapshot=await read(admin.rpc('sales_legal_snapshot',{p_sale:sale.id,p_actor:(await clients.admin.auth.getUser()).data.user.id}));
  const recipients=[snapshot.conveyancer?.shared_system_email,snapshot.sales_agent?.shared_system_email].filter(Boolean);
  if(!recipients.length||recipients.some(e=>!report.safeRecipientAllowlist.includes(e)))throw Error('Non-test recipient detected');
  const normalised={...snapshot,sale_id:undefined,unit_id:undefined,plot:undefined,terms:{...snapshot.terms,id:undefined}};
  const state=await read(admin.from('unit_sale_attempts').select('workflow_status,authority_requested_at,exchanged_at,completed_at').eq('id',sale.id).single());
  if(state.authority_requested_at||state.exchanged_at||state.completed_at)throw Error('Unexpected prepared legal state');
  report.fixtures.push({region,unit:Number(number),preparedState:state,normalisedSnapshotSha256:hash(normalised),safeRecipientsVerified:true,reservationStorageWork:'setup only; excluded from measured authority issue'});save();
  unit.sale=sale.id;deployments[region].fixture=unit;
  console.log(JSON.stringify({prepared:true,region,unit:Number(number),state:state.workflow_status}));
 }
 report.matchedLegalSnapshots=report.fixtures[0].normalisedSnapshotSha256===report.fixtures[1].normalisedSnapshotSha256;
 if(!report.matchedLegalSnapshots)throw Error('Prepared fixture snapshots differ');save();
 browser=await chromium.launch({headless:true});
 const expiry=new Date(Date.now()+48*3600000);expiry.setUTCSeconds(0,0);report.commonExpiry=expiry.toISOString();
 // Warm both previews with read/preview work before either measured mutation.
 const sessions={};
 for(const region of ['iad1','fra1']){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',()=>{report.failures.push({region,type:'pageerror'});save();});
  const origin=deployments[region].origin,unit=deployments[region].fixture;
  await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  await page.goto(`${origin}/?screen=sales&building=${building}&salesUnitId=${unit.id}`);await page.getByRole('button',{name:/^Exchange\b/}).click();await page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor();
  const local=await page.evaluate(iso=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);},expiry.toISOString());
  await page.getByLabel('Authority expiry date and time (your local time)').fill(local);
  await page.getByRole('button',{name:'Review authority and email',exact:true}).click();await page.getByRole('region',{name:'Final confirmation and email preview'}).waitFor();await page.waitForLoadState('networkidle');
  await page.getByRole('region',{name:'Final confirmation and email preview'}).getByRole('checkbox').check();sessions[region]={context,page};
 }
 for(const region of ['fra1','iad1']){
  const {page}=sessions[region],rows=[],tracked=new Map(),pending=[],start=performance.now();let status='ok';
  const begin=r=>{const u=new URL(r.url()),category=u.pathname==='/api/sales/legal'?'legal':u.hostname.endsWith('.supabase.co')?(u.pathname.includes('/storage/')?'storage':u.pathname.includes('/auth/')?'auth':'direct-supabase'):'other';const endpoint=category==='legal'?'/api/sales/legal':category==='direct-supabase'?u.pathname.split('/').at(-1).replace(/[^a-z_]/g,''):category;const row={category,endpoint,method:r.method(),offsetMs:performance.now()-start,status:null,finished:false,failed:false};rows.push(row);tracked.set(r,row);};
  const response=r=>{const row=tracked.get(r.request());if(!row)return;const h=r.headers(),id=h['x-vercel-id'],parts=id?.split('::').filter(v=>/^[a-z]{3}\d$/.test(v))??[];Object.assign(row,{status:r.status(),vercelId:id??null,executionRegion:parts.length>1?parts.at(-1):null,serverTiming:h['server-timing']??null});};
  const end=r=>{const row=tracked.get(r);if(!row)return;row.finished=true;row.endMs=performance.now()-start;row.durationMs=row.endMs-row.offsetMs;row.browserTiming=r.timing();pending.push(r.sizes().then(s=>{row.responseBytes=s.responseBodySize;}).catch(()=>{}));};
  const fail=r=>{const row=tracked.get(r);if(row){row.failed=true;row.endMs=performance.now()-start;}};
  page.on('request',begin);page.on('response',response);page.on('requestfinished',end);page.on('requestfailed',fail);
  try{
   await page.getByRole('button',{name:'Issue authority to exchange',exact:true}).click();
   await page.getByText('Authority to exchange issued.',{exact:true}).waitFor();
   await page.locator('[aria-label="Authority status"]').getByText('Active',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Review reissued authority and email',exact:true}).waitFor();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  }catch{status='failed';}
  const readyMs=performance.now()-start,readyRequests=rows.length;
  await page.waitForLoadState('networkidle');await page.waitForTimeout(1500);
  page.off('request',begin);page.off('response',response);page.off('requestfinished',end);page.off('requestfailed',fail);await Promise.all(pending);
  const state=await read(admin.from('sale_legal_emails').select('delivery_status,sent_at,resend_message_id,version,kind').eq('sale_attempt_id',deployments[region].fixture.sale));
  const sample={region,unit:region==='iad1'?210:211,profile:'desktop',status,readyMs,readyRequests,settledRequests:rows.length,lastRequestEndMs:Math.max(0,...rows.filter(r=>!/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page/.test(r.endpoint)).map(r=>r.endMs??0)),requests:rows,displayedStateChecked:status==='ok',savedEmailState:state.map(e=>({kind:e.kind,version:e.version,delivery_status:e.delivery_status,hasSentAt:!!e.sent_at,hasProviderReceipt:!!e.resend_message_id})),legalRegionsVerified:rows.filter(r=>r.category==='legal').every(r=>r.executionRegion===region),storageRequests:rows.filter(r=>r.category==='storage').length};
  report.samples.push(sample);save();console.log(JSON.stringify({mutation:true,region,unit:sample.unit,status,readyMs,requests:rows.length}));
  if(status!=='ok'||!sample.legalRegionsVerified||rows.some(r=>r.failed||r.status>=400)||state.length!==1||!state[0].sent_at||!state[0].resend_message_id)throw Error('Mutation or displayed-state verification failed; no retry');
  await sessions[region].context.close();
 }
 report.completed=true;
}catch(error){const allowed=/^(Configured test login|Fixture setup rejected HTTP|Reservation setup route|Fresh empty draft|Non-test recipient|Unexpected prepared legal state|Prepared fixture snapshots|Mutation or displayed-state verification|Staging inspection failed)/;const message=allowed.test(error.message)?error.message:'Diagnostic setup or browser action failed; sensitive details omitted';report.failures.push({message,errorType:error.name});console.log(JSON.stringify({stopped:true,message}));process.exitCode=1;}
finally{
 if(browser)await browser.close();
 for(const client of Object.values(clients))await client.auth.signOut();
 report.protectedAfter=await fingerprints();report.protectedUnchanged=JSON.stringify(report.protectedBefore)===JSON.stringify(report.protectedAfter);report.finishedAt=new Date().toISOString();save();
 if(!report.protectedUnchanged)throw Error('Protected records changed');
}
