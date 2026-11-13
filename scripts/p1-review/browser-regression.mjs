import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const origin=process.env.P1_REVIEW_URL||'http://127.0.0.1:3041';
if(new URL(origin).hostname!=='127.0.0.1')throw Error('This intercepted-write test runs only against a local application.');
const credentials=JSON.parse(fs.readFileSync(process.env.P1_REVIEW_ACCOUNTS,'utf8').replace(/^\uFEFF/,''));
assert.equal(credentials.project,'mmwzhzziqvjbsphrkbqr');
const results=[],output='artifacts/p1-review';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch();
async function check(name,run){try{await run();results.push({name,passed:true});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.message});throw error}finally{fs.writeFileSync(output+'/browser-regression.json',JSON.stringify({method:'Local app; real isolated integration Auth and authorised reads. Completion writes intercepted in the browser, never sent to the database.',results},null,2));}}
async function login(page,role){const account=credentials.accounts.find(a=>a.alias===role);await page.goto(origin+'/workspace');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Open Willow Court',exact:true}).waitFor();}
const focus=page=>page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
const ready=page=>page.locator('table[aria-label="Building sales"][aria-busy=false]').waitFor();
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();page.setDefaultTimeout(30000);
 let reads=[];page.on('request',r=>{if(r.url().includes('/workspace/read?'))reads.push(new URL(r.url()).searchParams.get('kind'))});
 await login(page,'developer');
 await check('complete authorised list filters locally with correct URL, pages and back navigation',async()=>{
  await page.getByRole('button',{name:'Open Willow Court',exact:true}).click();await page.getByRole('button',{name:'Open sales worklist',exact:true}).click();await ready(page);
  const before=reads.length;await page.getByRole('button',{name:/^Exchanged /}).click();await ready(page);
  assert.equal(reads.slice(before).filter(k=>k==='worklist').length,0);assert.equal(new URL(page.url()).searchParams.get('stage'),'exchanged');
  await page.getByLabel('Search units or buyers').fill('G11');await ready(page);assert.match(await page.getByRole('table').innerText(),/G11/);
 });
 let saleUrl;
 await check('fresh Completion opens Authority and tab refocus retains the mounted workspace',async()=>{
  await page.getByRole('table').locator('tbody tr').first().getByRole('link').first().click();await page.getByRole('heading',{name:'Authority to serve notice',exact:true}).first().waitFor();
  saleUrl=page.url();await page.locator('#sale-context-panel').evaluate(el=>el.dataset.p1Marker='mounted');const before=reads.length;
  await focus(page);await page.waitForTimeout(2000);
  assert.equal(await page.locator('#sale-context-panel').getAttribute('data-p1-marker'),'mounted');assert(!reads.slice(before).includes('record'));assert(reads.slice(before).includes('catalog'));
 });
 await check('persistent discussion composer fits laptop, wide desktop and short desktop; mobile stacks',async()=>{
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:1024,height:700},{width:1366,height:600},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const box=await page.locator('#sale-context-panel').boundingBox();assert(box.width>250);
   if(viewport.width>=1024){assert.equal(await page.locator('#sale-context-panel').evaluate(el=>getComputedStyle(el).position),'sticky');const input=await page.getByRole('textbox',{name:'Comment',exact:true}).boundingBox();assert(input.x>=box.x&&input.x+input.width<=box.x+box.width+1);await page.getByRole('button',{name:'Send comment',exact:true}).scrollIntoViewIfNeeded();const button=await page.getByRole('button',{name:'Send comment',exact:true}).boundingBox();assert(button.y+button.height<=viewport.height+1);}
  }
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:output+'/discussion-desktop.png'});
 });
 await check('developer sees connected commercial model on a fictional for-sale unit',async()=>{
  const params=new URL(saleUrl).searchParams;await page.goto(origin+'/workspace?'+new URLSearchParams({building:params.get('building'),view:'worklist',stage:'for_sale'}));await ready(page);
  await page.getByRole('table').locator('tbody tr').first().getByRole('link').first().click();await page.getByRole('link',{name:'Commercial Terms',exact:true}).click();
  await page.getByRole('region',{name:'Commercial model'}).waitFor();await page.getByRole('heading',{name:'Developer',exact:true}).waitFor();await page.getByRole('heading',{name:'Agent',exact:true}).waitFor();await page.getByRole('heading',{name:'Buyer · payment schedule',exact:true}).waitFor();
  await page.screenshot({path:output+'/commercial-developer.png'});
 });
 const forSaleUrl=page.url();
 await context.close();

 const c=await browser.newContext({viewport:{width:1366,height:768}}),p=await c.newPage();p.setDefaultTimeout(30000);
 let model=null,fail=false,metadata=null;
 await p.route('**/workspace/read?**',async route=>{
  const kind=new URL(route.request().url()).searchParams.get('kind');
  if(kind==='config'){const r=await route.fetch(),data=await r.json();return route.fulfill({response:r,json:{...data,readOnly:false,completionReview:true,coreSales:true}})}
  if(kind==='completion'){
   if(!model){const r=await route.fetch(),data=await r.json();model={...data,sale:{...data.sale,is_active:true,workflow_status:'exchanged',exchanged_at:'2026-11-01T10:00:00Z',legal_completed_at:null,completion_authority_given_at:'2026-11-02T10:00:00Z',completion_notice_issued_at:'2026-11-03',contractual_completion_date:'2026-11-20',completion_arrangements_confirmed_at:'2026-11-03T11:00:00Z'},noticeRecordedBy:'Fictional Conveyancer',documents:[{id:crypto.randomUUID(),document_type:'completion_correspondence',status:'uploaded',unit_sale_document_versions:[{id:crypto.randomUUID(),is_current:true,version_number:1,file_name:'fictional-notice.pdf',uploaded_at:'2026-11-03T11:00:00Z',redacted_at:null}]}]};}
   return route.fulfill({json:model});
  }
  return route.continue();
 });
 await p.route('**/workspace/command',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='comment_context')return route.fulfill({json:{writable:true}});
  if(body.action==='core_context'){while(!model)await new Promise(r=>setTimeout(r,20));return route.fulfill({json:{asOf:'2026-11-13T12:00:00Z',sale:model.sale,documents:model.documents,emails:[]}})}
  if(body.action==='extended_sales_context')return route.fulfill({json:{enrolled:true,sale:model?.sale,terms:null,emails:[]}});
  if(body.action==='prepare_completion_upload'){metadata=body.files[0];return route.fulfill({json:{completed:true}})}
  if(body.action==='finalize_completion_upload'){
   if(fail)return route.fulfill({status:409,json:{error:'Simulated version conflict. Reload the current document.'}});
   model.documents=model.documents.filter(d=>d.document_type!==metadata.type).concat({id:crypto.randomUUID(),document_type:metadata.type,status:'uploaded',approved_version_id:null,unit_sale_document_versions:[{id:crypto.randomUUID(),is_current:true,version_number:1,file_name:metadata.name,uploaded_at:'2026-11-13T12:00:00Z',redacted_at:null}]});return route.fulfill({json:{saved:true}});
  }
  throw Error('Unplanned write was blocked: '+body.action);
 });
 await login(p,'conveyancer');
 await check('conveyancer sees existing for-sale buyer terms without private fees or a developer-controls request',async()=>{
  const requests=[];p.on('request',r=>{if(r.url().endsWith('/workspace/command'))requests.push(r.postDataJSON())});
  await p.goto(forSaleUrl);await p.getByRole('region',{name:'Commercial model'}).waitFor();await p.getByRole('heading',{name:'Buyer · payment schedule',exact:true}).waitFor();
  assert.equal(await p.getByRole('heading',{name:'Developer',exact:true}).count(),0);assert.equal(await p.getByRole('heading',{name:'Agent',exact:true}).count(),0);assert(!requests.some(r=>r.action==='extended_sales_context'&&r.section==='commercial'));
  assert.doesNotMatch(await p.getByRole('region',{name:'Commercial model'}).innerText(),/net developer|agent-funded|solicitor fee|\bVAT\b/i);
  await p.screenshot({path:output+'/commercial-conveyancer.png'});
 });
 const step=async task=>{await p.goto(saleUrl+(saleUrl.includes('?')?'&':'?')+'task='+task);await p.getByRole('heading',{name:'Completion at a glance',exact:true}).waitFor();};
 const pdf=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFictional regression evidence only\n%%EOF')});
 const slot=name=>p.getByRole('region',{name,exact:true});
 await check('two staged PDFs survive refocus; uploading one preserves the other and confirms its own filename',async()=>{
  await step('documents');await slot('Completion statement').locator('input[type=file]').setInputFiles(pdf('statement-test.pdf'));await slot('Statement of account').locator('input[type=file]').setInputFiles(pdf('account-test.pdf'));
  await focus(p);await p.waitForTimeout(1500);assert.equal(await slot('Statement of account').locator('input[type=file]').evaluate(el=>el.files[0]?.name),'account-test.pdf');
  await p.evaluate(()=>{window.p1Now=Date.now;Date.now=()=>window.p1Now()+31000;});
  await focus(p);await p.waitForTimeout(1800);await p.evaluate(()=>{Date.now=window.p1Now;delete window.p1Now;});
  assert.equal(await slot('Statement of account').locator('input[type=file]').evaluate(el=>el.files[0]?.name),'account-test.pdf');
  await slot('Completion statement').getByRole('button',{name:'Upload document',exact:true}).click();await slot('Completion statement').getByText('Uploaded — awaiting approval',{exact:true}).waitFor();
  assert.equal(await slot('Statement of account').locator('input[type=file]').evaluate(el=>el.files[0]?.name),'account-test.pdf');assert.equal(await slot('Completion statement').locator('input[type=file]').evaluate(el=>el.files.length),0);
  assert.match(await slot('Completion statement').innerText(),/statement-test.pdf.*uploaded successfully/s);assert.match(await slot('Completion statement').innerText(),/Current version 1/);
 });
 await check('upload conflict retains the pending PDF; cancelled navigation preserves it; retry clears only on success',async()=>{
  fail=true;await slot('Statement of account').getByRole('button',{name:'Upload document',exact:true}).click();await p.getByText(/Simulated version conflict/).waitFor();
  assert.equal(await slot('Statement of account').locator('input[type=file]').evaluate(el=>el.files[0]?.name),'account-test.pdf');
  p.once('dialog',dialog=>dialog.dismiss());await p.getByRole('button',{name:/^Notice & due date/}).click();assert.equal(new URL(p.url()).searchParams.get('task'),'documents');
  fail=false;await slot('Statement of account').getByRole('button',{name:'Resume / retry upload',exact:true}).click();await slot('Statement of account').getByText('Uploaded — awaiting approval',{exact:true}).waitFor();assert.equal(await slot('Statement of account').locator('input[type=file]').evaluate(el=>el.files.length),0);
 });
 await check('each Completion step owns its actions and approval gates legal entry',async()=>{
  assert.equal(await p.getByLabel('Notice issue date',{exact:true}).count(),0);assert.equal(await p.getByLabel('Actual legal completion date and time',{exact:true}).count(),0);
  await step('notice');await p.getByRole('heading',{name:'Notice recorded · integration test',exact:true}).waitFor();assert.match(await p.getByRole('region',{name:'Recorded notice'}).innerText(),/Fictional Conveyancer/);assert.equal(await p.getByLabel('Notice issue date',{exact:true}).count(),0);
  await p.getByRole('button',{name:'Replace recorded notice PDF',exact:true}).click();await p.getByLabel('Notice issue date',{exact:true}).waitFor();await p.getByRole('button',{name:'Cancel replacement',exact:true}).click();
  await step('legal');await p.getByText('Approve both current Completion documents before recording legal completion.',{exact:true}).waitFor();assert.equal(await p.getByLabel('Actual legal completion date and time',{exact:true}).count(),0);
  for(const doc of model.documents.filter(d=>d.document_type!=='completion_correspondence')){doc.status='approved';doc.approved_version_id=doc.unit_sale_document_versions[0].id;}
  await p.reload();await p.getByLabel('Actual legal completion date and time',{exact:true}).waitFor();assert.equal(await p.getByLabel('Notice issue date',{exact:true}).count(),0);
 });
 await check('refresh preserves a deliberate Completion deep link',async()=>{await step('documents');await p.reload();await p.getByRole('region',{name:'Completion statement',exact:true}).waitFor();assert.equal(new URL(p.url()).searchParams.get('task'),'documents');});
 await c.close();
}finally{await browser.close();}
