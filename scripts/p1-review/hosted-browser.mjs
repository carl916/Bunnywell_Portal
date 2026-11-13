import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const origin=process.env.P1_REVIEW_URL;
assert(/^https:\/\/bunnywell-portal-integration-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin));
const credentials=JSON.parse(fs.readFileSync(process.env.P1_REVIEW_ACCOUNTS,'utf8').replace(/^\uFEFF/,''));
assert.equal(credentials.project,'mmwzhzziqvjbsphrkbqr');
const browser=await chromium.launch(),results=[],output='artifacts/p1-review';
const share=process.env.P1_SHARE;delete process.env.P1_SHARE;
async function check(name,run){try{await run();results.push({name,passed:true});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.message});throw error}finally{fs.writeFileSync(output+'/hosted-browser.json',JSON.stringify({origin,method:'Actual protected integration deployment; real Auth and authorised reads. All business writes blocked by the browser test.',businessRecordsChanged:[],results},null,2));}}
async function login(role){
 const c=await browser.newContext({viewport:{width:1366,height:768}}),p=await c.newPage();p.setDefaultTimeout(30000);
 await c.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.origin===origin&&/^\/workspace\/(command|operations|upload|snag-upload)$/.test(u.pathname)&&request.method()!=='GET'){
   const action=request.postDataJSON()?.action;
   if(!/^(core_context|extended_sales_context|setup_context|snag_context|document)$/.test(action||''))return route.abort('blockedbyclient');
  }
  return route.continue();
 });
 await p.goto(origin+'/workspace?_vercel_share='+encodeURIComponent(share));
 const a=credentials.accounts.find(a=>a.alias===role);await p.getByLabel('Email',{exact:true}).fill(a.email);await p.getByLabel('Password',{exact:true}).fill(a.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('button',{name:'Open Willow Court',exact:true}).waitFor();
 return {c,p};
}
const ready=p=>p.locator('table[aria-label="Building sales"][aria-busy=false]').waitFor();
const focus=p=>p.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
try{
 const {c,p}=await login('developer');let reads=[];p.on('request',r=>{if(r.url().includes('/workspace/read?'))reads.push(new URL(r.url()).searchParams.get('kind'))});
 await check('hosted filter uses the complete authorised cache without a worklist round trip',async()=>{
  await p.getByRole('button',{name:'Open Willow Court',exact:true}).click();await p.getByRole('button',{name:'Open sales worklist',exact:true}).click();await ready(p);
  reads=[];await p.getByRole('button',{name:/^Exchanged /}).click();await ready(p);assert(!reads.includes('worklist'));await p.getByLabel('Search units or buyers').fill('G11');await ready(p);
 });
 let saleUrl,forSaleUrl;
 await check('hosted Completion starts with Authority and refocus preserves its mounted state',async()=>{
  await p.getByRole('table').locator('tbody tr').first().getByRole('link').first().click();await p.getByRole('heading',{name:'Authority to serve notice',exact:true}).first().waitFor();saleUrl=p.url();
  await p.locator('#sale-context-panel').evaluate(el=>el.dataset.p1Marker='mounted');reads=[];await focus(p);await p.waitForTimeout(1800);assert.equal(await p.locator('#sale-context-panel').getAttribute('data-p1-marker'),'mounted');assert(reads.includes('catalog'));assert(!reads.includes('record'));
 });
 await check('Dashboard, Sales, Snags, Buildings and Setup retain mounted content after idle refocus',async()=>{
  for(const module of ['Dashboard','Sales','Snags','Buildings','Setup']){
   await p.getByRole('navigation',{name:'Building modules',exact:true}).getByRole('button',{name:module,exact:true}).click();
   const names={Dashboard:'Your building at a glance',Sales:'Sales worklist',Snags:'Snags register',Buildings:'Building configuration',Setup:'Setup'};
   const heading=p.getByRole('heading',{name:names[module],exact:true,level:1});await heading.waitFor();await p.waitForTimeout(300);await heading.evaluate(el=>el.dataset.p1Marker='mounted');
   const url=p.url();await p.evaluate(()=>{window.p1Now=Date.now;Date.now=()=>window.p1Now()+31000;});await focus(p);await p.waitForTimeout(1600);await p.evaluate(()=>{Date.now=window.p1Now;delete window.p1Now;});
   assert.equal(p.url(),url);assert.equal(await heading.getAttribute('data-p1-marker'),'mounted',module+' remounted on focus');
  }
 });
 await check('hosted developer commercial summary has Developer, Agent and Buyer groups',async()=>{
  const q=new URL(saleUrl).searchParams;await p.goto(origin+'/workspace?'+new URLSearchParams({building:q.get('building'),view:'worklist',stage:'for_sale'}));await ready(p);await p.getByRole('table').locator('tbody tr').first().getByRole('link').first().click();await p.getByRole('link',{name:'Commercial Terms',exact:true}).click();
  for(const name of ['Developer','Agent','Buyer · payment schedule'])await p.getByRole('heading',{name,exact:true}).waitFor();forSaleUrl=p.url();
 });
 await c.close();const {c:cc,p:cp}=await login('conveyancer');
 await check('hosted conveyancer sees for-sale buyer terms and receives no private commercial group',async()=>{
  await cp.goto(forSaleUrl);const region=cp.getByRole('region',{name:'Commercial model'});await region.waitFor();await cp.getByRole('heading',{name:'Buyer · payment schedule',exact:true}).waitFor();assert.doesNotMatch(await region.innerText(),/net developer|agent-funded|solicitor fee|\bVAT\b/i);assert.equal(await cp.getByRole('heading',{name:'Developer',exact:true}).count(),0);await cp.screenshot({path:output+'/hosted-buyer-terms.png'});
 });
 await check('hosted staged PDFs survive focus and a cancelled step change without sending an upload',async()=>{
  await cp.goto(saleUrl+'&task=documents');const slots=['Completion statement','Statement of account'];for(const name of slots)await cp.getByRole('region',{name,exact:true}).locator('input[type=file]').setInputFiles({name:name+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFictional test only\n%%EOF')});
  await focus(cp);await cp.waitForTimeout(1800);for(const name of slots)assert.equal(await cp.getByRole('region',{name,exact:true}).locator('input[type=file]').evaluate(el=>el.files[0]?.name),name+'.pdf');
  cp.once('dialog',d=>d.dismiss());await cp.getByRole('button',{name:/^Notice & due date/}).click();assert.equal(new URL(cp.url()).searchParams.get('task'),'documents');
  for(const name of slots)await cp.getByRole('region',{name,exact:true}).locator('input[type=file]').setInputFiles([]);
 });
 await check('hosted notice has recorded evidence and Legal completion remains gated',async()=>{
  await cp.getByRole('button',{name:/^Notice & due date/}).click();await cp.getByRole('region',{name:'Recorded notice'}).waitFor();assert.equal(await cp.getByLabel('Notice issue date',{exact:true}).count(),0);await cp.getByRole('button',{name:'Replace recorded notice PDF',exact:true}).waitFor();
  await cp.getByRole('button',{name:/^Legal completion/}).click();await cp.getByText('Approve both current Completion documents before recording legal completion.',{exact:true}).waitFor();assert.equal(await cp.getByLabel('Actual legal completion date and time',{exact:true}).count(),0);
 });
 await check('hosted wrong-building commercial direct read is denied',async()=>{
  const params=new URL(forSaleUrl).searchParams;params.set('kind','sale-details');params.set('building','b1700000-0000-4000-8000-000000000002');
  const authorisedRead=cp.waitForRequest(r=>r.url().includes('/workspace/read?')&&Boolean(r.headers().authorization));await cp.goto(forSaleUrl);const request=await authorisedRead;
  const response=await cp.request.get(origin+'/workspace/read?'+params,{headers:{Authorization:request.headers().authorization}});assert.equal(response.status(),403);
 });
 await cc.close();
}finally{await browser.close();}
