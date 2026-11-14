import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const origin=process.env.P1_REVIEW_URL,share=process.env.P1_SHARE;
assert(/^https:\/\/bunnywell-portal-integration-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin));
const credentials=JSON.parse(fs.readFileSync(process.env.P1_REVIEW_ACCOUNTS,'utf8').replace(/^\uFEFF/,''));assert.equal(credentials.project,'mmwzhzziqvjbsphrkbqr');
const scope={buildingId:'35de5f9d-3217-4a11-beaf-83519bda9e5b',unitId:'baf3da00-0412-4a67-b35e-8f0eb0323253',saleId:'c7c1ca12-3845-43ec-87f5-27e6c35147a8'};
const enrolled={buildingId:'35de5f9d-3217-4a11-beaf-83519bda9e5b',unitId:'f29914be-cb37-4251-b3a7-fba6c73c431b',saleId:'e36611ff-7423-48c9-83db-d6ebba85b685'};
const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(30000);
let authorization='';page.on('request',r=>{if(new URL(r.url()).origin===origin&&r.headers().authorization)authorization=r.headers().authorization;});
const results=[];fs.mkdirSync('artifacts/notice-eligibility',{recursive:true});
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.message});throw error}finally{fs.writeFileSync('artifacts/notice-eligibility/hosted-browser.json',JSON.stringify({origin,method:'Real integration Auth, context reads and non-mutating previews; no capture, uploads or business changes.',results},null,2));}}
async function command(target,body){return page.request.post(origin+'/workspace/command',{headers:{Origin:origin,Authorization:authorization},data:{...body,scope:target}});}
try{
 await context.route('**/workspace/command',route=>['core_context','extended_sales_context'].includes(route.request().postDataJSON()?.action)?route.continue():route.abort('blockedbyclient'));
 await context.route('**/workspace/upload',route=>route.abort('blockedbyclient'));
 await page.goto(origin+'/workspace?_vercel_share='+encodeURIComponent(share));const account=credentials.accounts.find(a=>a.alias==='developer');
 await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Open Willow Court',exact:true}).waitFor();
 await check('Priors Gate G11 clearly shows read-only status without offering authority capture',async()=>{
  await page.goto(origin+'/workspace?'+new URLSearchParams({view:'sale',building:scope.buildingId,unit:scope.unitId,sale:scope.saleId,section:'completion',task:'authority'}));
  await page.getByRole('region',{name:'Read-only integration sale',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Review authority to serve notice',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Capture test authority',exact:true}).count(),0);
  const response=await command(scope,{action:'core_context'});assert.equal(response.status(),200);assert.equal((await response.json()).enrolled,false);
 });
 await check('protected notice preview is denied before capture preparation',async()=>{
  const response=await command(scope,{action:'preview_capture',kind:'notice_authority'});assert.equal(response.status(),403);assert.match((await response.json()).error,/read-only in integration/);
 });
 await check('existing designated fictional sale retains its read-only authority preview capability',async()=>{
  const context=await command(enrolled,{action:'core_context'});assert.equal(context.status(),200);const data=await context.json();assert.equal(data.enrolled,true);
  const response=await command(enrolled,{action:'preview_capture',kind:data.sale.exchanged_at?'notice_authority':'authority'});assert.equal(response.status(),200);const preview=await response.json();assert.match(preview.email.subject,/INTEGRATION TEST/);assert.match(preview.email.body,/no external delivery/);assert.equal(typeof preview.token,'string');
 });
}finally{await browser.close();}
