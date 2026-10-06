// Fresh staging fixture only; fault injection changes browser responses, never
// resets a sale or modifies production data. No business response bodies saved.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env,origin='https://staging.bunnywell.co.uk',unit='682b1440-ca58-4ff8-ac47-45b902dd47e1',sale='67e8cd4d-59a9-43a5-8fdf-a26d3af5477e',building='e120ef73-a720-4a25-ab99-362f21612118';
if(env.SALES_PERF_ALLOW_STAGING_MUTATIONS!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co')throw new Error('Verified staging opt-in required.');
const clients={},tokens={},roles={admin:env.PLAYWRIGHT_ADMIN_EMAIL,agent:'carl@bunnywell.co.uk',conveyancer:'carl@accoladeproperties.co.uk'};
for(const [role,email]of Object.entries(roles)){
  const c=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const r=await c.auth.signInWithPassword({email,password:env.PLAYWRIGHT_ADMIN_PASSWORD});if(r.error)throw new Error('Test login failed');clients[role]=c;tokens[role]=r.data.session.access_token;
}
const state=await clients.admin.from('unit_sale_attempts').select('workflow_status,buyer_person_name').eq('id',sale).single();
if(state.error||state.data.workflow_status!=='draft'||state.data.buyer_person_name)throw new Error('Fresh fixture 209 required.');
const today=new Date().toISOString().slice(0,10),evidence=[];
function pdf(){const doc=new jsPDF();doc.text('STAGING REFRESH TEST - NOT LEGAL',12,20);return Buffer.from(doc.output('arraybuffer'));}
async function post(role,path,body){const r=await fetch(origin+path,{method:'POST',headers:{Authorization:'Bearer '+tokens[role],...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});if(!r.ok)throw new Error('Fixture API rejected '+r.status);return r.json();}
const legal=(role,body)=>post(role,'/api/sales/legal',{sale,...body});
async function context(){const r=await fetch(origin+'/api/sales/legal?sale='+sale,{headers:{Authorization:'Bearer '+tokens.admin}});assert.equal(r.ok,true);return r.json();}
await post('admin','/api/sales/reservations',{action:'save_commercial_model',unitId:unit,saleAttemptId:sale,contractPrice:250000});
const reservation=new FormData();reservation.set('saleAttemptId',sale);reservation.set('file',new Blob([pdf()],{type:'application/pdf'}),'synthetic-reservation.pdf');await post('agent','/api/sales/reservations',reservation);
await post('agent','/api/sales/reservations',{action:'save_reservation',unitId:unit,buyerPersonName:'Performance test refresh failures',buyerEmail:'performance-test@example.invalid',buyerPhone:'00000000000',buyerSolicitorName:'Performance test solicitor',reservationDate:today,reservationTermsChecked:true});
await post('admin','/api/sales/reservations',{action:'approve_reservation',saleAttemptId:sale,reservationDate:today});
const browser=await chromium.launch({headless:true});const pages={};
async function open(role,stage){const page=pages[role];await page.goto(`${origin}/?screen=sales&building=${building}&salesUnitId=${unit}`);await page.getByRole('button',{name:new RegExp('^'+stage+'\\b')}).click();await page.getByRole('list',{name:stage+' tasks',exact:true}).waitFor();return page;}
try{
  for(const [role,email]of Object.entries(roles)){const p=await browser.newPage({viewport:{width:1280,height:900}});p.setDefaultTimeout(60000);pages[role]=p;await p.goto(origin);await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password',{exact:true}).fill(env.PLAYWRIGHT_ADMIN_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
  let page=await open('admin','Exchange');
  // Another authenticated user changes the sale while this panel stays open.
  await legal('agent',{action:'request_authority'});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText(/Requested by/).waitFor();
  evidence.push({case:'other-user-change-picked-up-by-existing-refresh',passed:true});
  await page.getByRole('button',{name:'Review authority and email',exact:true}).click();await page.getByRole('region',{name:'Final confirmation and email preview'}).getByRole('checkbox').check();
  // Send really commits, then the browser receives an uncertain-delivery error.
  let fault=true;
  const emailFault=async route=>{const body=route.request().postDataJSON();if(body?.action==='send'&&fault){fault=false;const response=await route.fetch();assert.equal(response.ok(),true);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected delivery response loss; reconcile the recorded email.'})});}else await route.continue();};
  await page.route('**/api/sales/legal',emailFault);await page.getByRole('button',{name:'Issue authority to exchange',exact:true}).click();await page.getByRole('alert').filter({hasText:'Injected delivery response loss'}).waitFor();await page.getByText('Active',{exact:true}).waitFor();assert.equal(await page.getByText('Authority to exchange issued.',{exact:true}).count(),0);await page.unroute('**/api/sales/legal',emailFault);
  evidence.push({case:'email-response-loss-keeps-error-and-refreshes-authority',passed:true});
  assert.equal(await page.getByRole('region',{name:'Final confirmation and email preview'}).count(),0);
  evidence.push({case:'recorded-email-closes-stale-unissued-preview',passed:true});
}finally{fs.mkdirSync('artifacts/performance/2026-10-04-action-refresh-release',{recursive:true});fs.writeFileSync('artifacts/performance/2026-10-04-action-refresh-release/authority-preview-recovery.json',JSON.stringify(evidence,null,2));await browser.close();}
console.log(JSON.stringify({checks:evidence.length,passed:evidence.every(row=>row.passed)}));
