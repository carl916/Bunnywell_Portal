// Explicitly authorised staging scope only. No traces, screenshots, response
// bodies, credentials, URLs, buyer information or filenames enter the report.
import fs from 'node:fs';
import { recorder, attachVitals, out } from './action-refresh-recorder.mjs';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
dotenv.config({path:'.env.local',quiet:true});
const origin='https://staging.bunnywell.co.uk';
const env=process.env;
if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw new Error('Only the verified staging project is authorised.');
if(env.SALES_PERF_ALLOW_STAGING_MUTATIONS!=='1')throw new Error('Explicit staging diagnostic opt-in required.');
const scope=JSON.parse(fs.readFileSync('work/staging-test-sales.json','utf8'));
const verified=JSON.parse(fs.readFileSync('work/staging-access.json','utf8'));
if(!verified.matched)throw new Error('Staging project was not verified.');
const output=`${out}/workflow-samples.json`;
const samples=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):[];
const save=()=>fs.writeFileSync(output,JSON.stringify(samples,null,2));
const today=new Date().toISOString().slice(0,10);
const roles={admin:env.PLAYWRIGHT_ADMIN_EMAIL,conveyancer:'carl@accoladeproperties.co.uk',agent:'carl@bunnywell.co.uk'};
const clients={},tokens={};
for(const [role,email]of Object.entries(roles)){
  const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.auth.signInWithPassword({email,password:env.PLAYWRIGHT_ADMIN_PASSWORD});
  if(result.error)throw new Error(`Configured ${role} test login failed.`);clients[role]=client;tokens[role]=result.data.session.access_token;
}
function pdf(size=2048){const doc=new jsPDF();doc.text('STAGING PERFORMANCE TEST - NOT A LEGAL DOCUMENT',12,20);const source=Buffer.from(doc.output('arraybuffer'));return Buffer.concat([source,Buffer.alloc(Math.max(0,size-source.length),32)]);}
async function post(role,path,body){
  const response=await fetch(origin+path,{method:'POST',headers:{Authorization:`Bearer ${tokens[role]}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Fixture setup rejected: ${response.status}`);return response.json();
}
const allowedUnits=[111,112,113,114,201,202,203,204];
const units=scope.units.filter(u=>allowedUnits.includes(Number(u.unit_number)));
if(units.some(u=>!allowedUnits.includes(Number(u.unit_number))))throw new Error('Fixture outside authorised refresh scope.');
if(units.length!==4)throw new Error('Expected four fresh authorised units.');
// Preparation uses the normal reservation API, never direct status/approval edits.
for(const unit of units){
  const {data:attempt,error}=await clients.admin.from('unit_sale_attempts').select('id,workflow_status,buyer_person_name').eq('unit_id',unit.id).eq('is_active',true).single();
  if(error)throw new Error('Test sale unavailable.');unit.sale=attempt.id;
  if(attempt.workflow_status!=='draft' && !env.SALES_PERF_UNIT)throw Error('Fresh draft required.');
  if(attempt.workflow_status!=='draft')continue;
  if(attempt.buyer_person_name && !attempt.buyer_person_name.startsWith('Performance test'))throw new Error('Test unit contains pre-existing buyer details; setup stopped.');
  const {data:terms}=await clients.admin.from('unit_sale_terms').select('contract_price').eq('sale_attempt_id',attempt.id).eq('is_current',true).single();
  if(!terms?.contract_price)await post('admin','/api/sales/reservations',{action:'save_commercial_model',unitId:unit.id,saleAttemptId:attempt.id,contractPrice:250000});
  const form=new FormData();form.set('saleAttemptId',attempt.id);form.set('file',new Blob([pdf()],{type:'application/pdf'}),'synthetic-reservation.pdf');
  await post('agent','/api/sales/reservations',form);
  await post('agent','/api/sales/reservations',{action:'save_reservation',unitId:unit.id,buyerPersonName:'Performance test buyer',buyerEmail:'performance-test@example.invalid',buyerPhone:'00000000000',buyerSolicitorName:'Performance test solicitor',reservationDate:today,reservationTermsChecked:true});
  await post('admin','/api/sales/reservations',{action:'approve_reservation',saleAttemptId:attempt.id,reservationDate:today});
  console.log(JSON.stringify({fixture:'reservation_ready',unit:Number(unit.unit_number)}));
}
if(env.SALES_PERF_PREPARE_ONLY==='1')process.exit(0);

const browser=await chromium.launch({headless:true});const pages={},contexts={};
function browserObserver(){
  window.salesDiagnostic={start:0,click:null,feedback:null,mutation:0,longTasks:[]};const d=window.salesDiagnostic;let clicked=null;
  new PerformanceObserver(list=>{for(const entry of list.getEntries())d.longTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});
  document.addEventListener('click',event=>{if(d.start){d.click=performance.now();clicked=event.target.closest('button');}},true);
  new MutationObserver(()=>{if(!d.start)return;d.mutation=performance.now();if(d.feedback===null&&(clicked?.disabled||clicked?.getAttribute('aria-current')==='step'||document.querySelector('[role="group"][aria-label^="Selected "]')))requestAnimationFrame(()=>requestAnimationFrame(()=>{d.feedback??=performance.now();}));}).observe(document,{childList:true,subtree:true,attributes:true});
}
function category(request){const path=new URL(request.url()).pathname;if(path==='/api/sales/legal')return 'legal';if(path.includes('/rest/v1/'))return path.split('/').at(-1).replace(/[^a-z_]/g,'');if(path.includes('/auth/'))return 'auth';if(path.endsWith('.js'))return 'javascript';return 'other';}
const measure=recorder(samples,output);
const displayed=[];
async function verifySwitch(page,unit,stage,action){
  const picker=page.locator('[data-sale-file] select').filter({has:page.locator('option[value="'+unit.id+'"]')});
  const option=await picker.locator('option:checked').innerText();
  const other=units.find(item=>item.id!==unit.id);
  await picker.selectOption(other.id);await page.getByRole('heading',{name:'Unit '+other.unit_number,exact:true}).waitFor();
  await picker.selectOption(unit.id);await page.getByRole('heading',{name:'Unit '+unit.unit_number,exact:true}).waitFor();
  await page.getByRole('button',{name:new RegExp('^'+stage+'\\b')}).click();
  await page.getByRole('list',{name:stage+' tasks',exact:true}).waitFor();
  if(await picker.locator('option:checked').innerText()!==option)throw new Error('Sale status changed after cached switch.');
  const good=action==='authority.request'?await page.getByText(/Requested by/).count()>0:action==='authority.issue'?await page.getByText('Active',{exact:true}).count()>0:action==='exchange.record'?/Exchanged/.test(option):action==='completion.documents_approve'?await page.getByText('Completion documents approved',{exact:true}).count()>0:action==='completion.record'?/Completed/.test(option):true;
  if(!good)throw new Error('Displayed state verification failed.');
  if(action.startsWith('completion.documents_upload')) {
    if(!(await page.locator('#completion-documents-step').getByText('synthetic-completion.pdf',{exact:true}).first().isVisible()))throw new Error('Current completion version not visible.');
    if(action.includes('two-')&&!(await page.getByText('Both current documents uploaded.',{exact:true}).isVisible()))throw new Error('Current document pair not visible.');
  }
  await page.getByRole('tab',{name:/^Commercial/}).click();
  const price=await page.locator('[data-testid="commercial-summary-cards"]').getByText('Contract price',{exact:true}).locator('..').locator('strong').innerText();
  if(price!=='£250,000')throw new Error('Commercial figures changed unexpectedly.');
  await page.getByRole('tab',{name:/^Progression/}).click();
  await page.getByRole('button',{name:new RegExp('^'+stage+'\\b')}).click();await page.getByRole('list',{name:stage+' tasks',exact:true}).waitFor();
  displayed.push({unit:Number(unit.unit_number),action,switchedToOtherAndBack:true,statusConsistent:true,legalDataConsistent:true,commercialFiguresConsistent:true});fs.writeFileSync(out+'/displayed-data.json',JSON.stringify(displayed,null,2));
  await page.waitForLoadState('networkidle');
}
async function open(role,unit,stage='Exchange'){
  const page=pages[role];await page.goto(`${origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${unit.id}`);await page.getByRole('button',{name:new RegExp(`^${stage}\\b`)}).click();await page.getByRole('list',{name:`${stage} tasks`,exact:true}).waitFor();return page;
}
async function clickOutcome(page,button,text){await button.scrollIntoViewIfNeeded();await button.click();await page.getByText(text,{exact:true}).waitFor({timeout:60000});}
try{
  for(const [role,email]of Object.entries(roles)){
    const context=await browser.newContext({viewport:{width:1280,height:900}});contexts[role]=context;await context.addInitScript(browserObserver);const page=await context.newPage();page.setDefaultTimeout(60000);pages[role]=page;attachVitals(page,role);
    await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  }
  for(let i=0;i<units.length;i++){
    const unit=units[i],run=i+1,profile=i>=2?'mobile-throttled':'desktop';if(env.SALES_PERF_UNIT && !env.SALES_PERF_UNIT.split(',').includes(unit.unit_number))continue;
    const {data:state}=await clients.admin.from('unit_sale_attempts').select('workflow_status').eq('id',unit.sale).single();if(state.workflow_status==='completed')throw Error('Completed record cannot be mutated.');
    for(const page of Object.values(pages))page.baselineProfile=profile; if(i>=2)for(const [role,page]of Object.entries(pages)){await page.setViewportSize({width:390,height:844});const cdp=await contexts[role].newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
    let page=await open('agent',unit);
    const navigationCdp=await contexts.agent.newCDPSession(page);await navigationCdp.send('Network.enable');await navigationCdp.send('Network.clearBrowserCache');
    for(const mode of ['cold','repeat'])await measure(page,`sale.open.${mode}`,run,profile,()=>page.reload(),()=>page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor());
    if(await page.getByRole('button',{name:'Request authority to exchange',exact:true}).count()) await measure(page,'authority.request',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Request authority to exchange',exact:true}),'Exchange authority requested. The developer has been notified.'),async()=>{});
    await verifySwitch(page,unit,'Exchange','authority.request');
    page=await open('admin',unit);const preview=page.getByRole('region',{name:'Final confirmation and email preview',exact:true});
    await measure(page,'authority.preview_open',run,profile,()=>page.getByRole('button',{name:'Review authority and email',exact:true}).click(),()=>preview.waitFor());
    await preview.getByRole('checkbox').check();
    await measure(page,'authority.issue',run,profile,()=>clickOutcome(page,preview.getByRole('button',{name:'Issue authority to exchange',exact:true}),'Authority to exchange issued.'),async()=>{});
    await verifySwitch(page,unit,'Exchange','authority.issue');
    page=await open('conveyancer',unit);await page.getByLabel('Actual exchange date',{exact:true}).fill(today);
    await measure(page,'exchange.record',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Confirm exchange',exact:true}),'Exchange confirmed.'),async()=>{});
    await verifySwitch(page,unit,'Exchange','exchange.record');
    await measure(page,'completion.open',run,profile,()=>page.getByRole('button',{name:/^Completion\b/}).click(),()=>page.getByRole('list',{name:'Completion tasks',exact:true}).waitFor());
    page=await open('admin',unit,'Completion');await page.getByRole('button',{name:'Review authority to serve notice and email',exact:true}).click();await page.getByRole('region',{name:'Final confirmation and email preview'}).getByRole('checkbox').check();await measure(page,'notice.authority_issue',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Give authority to serve notice',exact:true}),'Authority to serve notice given.'),async()=>{});
    page=await open('conveyancer',unit,'Completion');await page.getByLabel('Notice PDF',{exact:true}).setInputFiles({name:'synthetic-notice.pdf',mimeType:'application/pdf',buffer:pdf()});await page.getByLabel('Notice issue date',{exact:true}).fill(today);await page.getByLabel('Completion due date',{exact:true}).fill(today);await measure(page,'notice.arrangements_confirm',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Confirm completion arrangements',exact:true}),'Completion arrangements confirmed. The notice PDF and dates have been saved.'),async()=>{});
    const docs=page.locator('#completion-documents-step');
    for(const [count,size,label]of [[1,1048576,'one-1MiB'],[2,1048576,'two-1MiB']]){
      const files=Array.from({length:count},(_,n)=>({name:n?'synthetic-account.pdf':'synthetic-completion.pdf',mimeType:'application/pdf',buffer:pdf(size)}));
      fs.mkdirSync('test-results/baseline-pdfs',{recursive:true});const paths=files.map(file=>{const path=`test-results/baseline-pdfs/${file.name}`;fs.writeFileSync(path,file.buffer);return path;});await docs.getByLabel('Choose completion documents',{exact:true}).setInputFiles(paths);await docs.locator('[role="group"][aria-label^="Selected "]').first().waitFor();
      await measure(page,`completion.documents_upload.${label}`,run,profile,async()=>{
        const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/legal'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='finalize_completion_upload',{timeout:360000});await docs.getByRole('button',{name:/^Upload (completion documents|replacement document)$/}).click();const response=await responsePromise;
        if(response.status()===413){await page.getByRole('alert').filter({hasText:/Unexpected|JSON|upload|large/i}).first().waitFor({timeout:60000});return;}
        if(!response.ok())throw new Error('Upload rejected');await page.getByText('Completion documents uploaded. Developer approval is required for the current files.',{exact:true}).waitFor({timeout:60000});await docs.locator('[role="group"][aria-label^="Selected "]').first().waitFor({state:'detached',timeout:60000});
      },async()=>{});
      await verifySwitch(page,unit,'Completion','completion.documents_upload.'+label);
      while(await docs.getByRole('button',{name:'Remove',exact:true}).count())await docs.getByRole('button',{name:'Remove',exact:true}).first().click();
    }
    page=await open('admin',unit,'Completion');await measure(page,'completion.documents_approve',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Approve completion documents',exact:true}),'Completion documents approved.'),async()=>{});
    await verifySwitch(page,unit,'Completion','completion.documents_approve');
    page=await open('conveyancer',unit,'Completion');await page.getByLabel('Actual legal completion date and time (your local time)').fill(`${today}T12:00`);await page.getByRole('checkbox',{name:/I confirm legal completion/}).check();await measure(page,'completion.record',run,profile,()=>clickOutcome(page,page.getByRole('button',{name:'Confirm legal completion',exact:true}),'Legal completion confirmed. Handover is now available.'),async()=>{});
    await verifySwitch(page,unit,'Completion','completion.record');
  }
}catch(error){console.log(JSON.stringify({stopped:error.message?.split('\n')[0]?.slice(0,240)}));process.exitCode=1;}
finally{save();await browser.close();}

