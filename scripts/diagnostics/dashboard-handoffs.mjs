// Opt-in, synthetic staging only. Creates no invitations and sends no legal email.
// Four temporary identities are disabled in finally; fixtures/audit remain reviewable.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {chromium,expect} from '@playwright/test';
import {jsPDF} from 'jspdf';
dotenv.config({path:'.env.local',quiet:true});
const env=process.env,origin=env.DASHBOARD_TEST_ORIGIN,project='vxkpvdtrldwwqiddoyof';
if(env.DASHBOARD_TEST_STAGING!=='1'||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!==`${project}.supabase.co`||!/^http:\/\/localhost:\d+$/.test(origin??''))throw Error('Explicit verified staging/local-code opt-in required.');
const service=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=async promise=>{const r=await promise;if(r.error)throw Error(r.error.message);return r.data;};
const building=await checked(service.from('buildings').select('id').eq('name','E2E Completion Upload 2026-09-22').single());
const templateUnit=await checked(service.from('units').select('id,floor,unit_type_id,unit_type').eq('building_id',building.id).eq('unit_number','UPLOAD-2').single());
const template=await checked(service.from('unit_sale_attempts').select('conveyancer_organisation_id,sales_agent_organisation_id').eq('unit_id',templateUnit.id).eq('is_active',true).single());
if(!template.conveyancer_organisation_id){const known=await checked(service.from('profiles').select('organisation_id').eq('email','carl@accoladeproperties.co.uk').eq('role','conveyancer').single());template.conveyancer_organisation_id=known.organisation_id;}
assert.ok(template.conveyancer_organisation_id,'Dedicated test conveyancer organisation missing.');
const run=crypto.randomUUID(),accounts=[],checks=[];
let browser,sale,unit;
const continuing=env.DASHBOARD_TEST_CONTINUE==='1';
const out=`docs/organisation-dashboard/evidence/staging-handoffs${continuing?'-continued':''}.json`;
const save=()=>{fs.mkdirSync('docs/organisation-dashboard/evidence',{recursive:true});fs.writeFileSync(out,JSON.stringify({project,origin,run,building:building.id,unit:unit?.id,sale:sale?.id,fixture:'Existing dedicated UPLOAD-3 legacy-arrangements synthetic sale; no email dispatch',accounts:accounts.map(a=>({id:a.id,label:a.label,role:a.role,disabled:a.disabled??false})),checks},null,2));};
const pass=(name)=>{checks.push({name,passed:true});save();console.log(name);};
try{
 for(const label of ['developer1','developer2','conveyancer1','conveyancer2']){
  const role=label.startsWith('developer')?'developer':'conveyancer',password=crypto.randomBytes(32).toString('base64url'),email=`dashboard-${run}-${label}@example.invalid`;
  const user=await checked(service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`Synthetic dashboard ${label}`}}));
  const a={id:user.user.id,label,role,email,password};accounts.push(a);save();
  await checked(service.from('profiles').upsert({id:a.id,email,full_name:`Synthetic dashboard ${label}`,role,active:true,organisation_id:role==='conveyancer'?template.conveyancer_organisation_id:null}));
  await checked(service.from('user_building_access').insert({user_id:a.id,building_id:building.id,role_on_building:role}));
  a.client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await checked(a.client.auth.signInWithPassword({email,password}));a.token=auth.session.access_token;
 }
 unit=await checked(service.from('units').select('id,unit_number,sale_status').eq('building_id',building.id).eq('unit_number','UPLOAD-3').single());
 sale=await checked(service.from('unit_sale_attempts').select('id,workflow_status,completion_legacy_stage,contractual_completion_date,completion_notice_issued_at').eq('unit_id',unit.id).eq('is_active',true).single());
 assert.ok(['exchanged','completion_pending'].includes(sale.workflow_status));assert.equal(sale.completion_legacy_stage,'arrangements');
 const before=await checked(service.from('unit_sale_documents').select('status').eq('sale_attempt_id',sale.id));assert.ok(continuing||before.every(d=>d.status!=='approved'),'Do not repeat on already approved test documents.');
 await checked(service.from('unit_sale_attempts').update({conveyancer_organisation_id:template.conveyancer_organisation_id}).eq('id',sale.id));save();
 const [d1,d2,c1,c2]=accounts;
 async function snapshot(a){const r=await fetch(`${origin}/api/dashboard?building=${building.id}`,{headers:{Authorization:`Bearer ${a.token}`}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const s=await r.json();assert.equal(s.sources.find(x=>x.key==='legal').state,'ready');return s.items.filter(i=>i.recordKey===`sale:${sale.id}`);}
 assert.deepEqual(await snapshot(c1),await snapshot(c2));assert.deepEqual(await snapshot(d1),await snapshot(d2));pass('Two distinct conveyancers and two developers have identical respective team queues through real JWT/RLS reads');
 browser=await chromium.launch({headless:true});
 for(const a of [d1,c1,c2]){
  a.page=await browser.newPage({viewport:{width:1440,height:1000}});a.page.setDefaultTimeout(45000);
  await a.page.goto(`${origin}/?screen=${a.role==='developer'?'dashboard':'sales'}&building=${building.id}`);
  await a.page.getByLabel('Email',{exact:true}).fill(a.email);await a.page.getByLabel('Password',{exact:true}).fill(a.password);await a.page.getByRole('button',{name:'Sign in',exact:true}).click();await a.page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
 }
 const pdf=name=>{const p=new jsPDF();p.text('SYNTHETIC DASHBOARD TEST - NOT A LEGAL DOCUMENT',10,20);return {name,mimeType:'application/pdf',buffer:Buffer.from(p.output('arraybuffer'))};};
 async function visit(a){await a.page.goto(`${origin}/?screen=sales&building=${building.id}&salesUnitId=${unit.id}`);await a.page.getByRole('button',{name:/^Completion\b/}).click();await a.page.locator('#completion-documents-step').getByRole('article').first().waitFor();}
 const card=(a,type)=>a.page.locator('#completion-documents-step').getByRole('article',{name:type==='completion_statement'?'Completion statement':'Statement of account',exact:true});
 async function upload(a,types){for(const type of types)await card(a,type).locator('input[type=file]').setInputFiles(pdf(`${type}.pdf`));await a.page.locator('#completion-documents-step').getByRole('button',{name:/^Upload (completion documents|replacement document)$/}).click();await expect(a.page.locator('#completion-documents-step').locator('[role=group][aria-label^="Selected "]')).toHaveCount(0,{timeout:90000});}
 async function docs(){const result=await checked(service.from('unit_sale_documents').select('id,document_type,status,approved_version_id,query_note,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(id,is_current)').eq('sale_attempt_id',sale.id));return Object.fromEntries(result.map(d=>[d.document_type,{...d,version:d.unit_sale_document_versions.find(v=>v.is_current)?.id}]));}
 async function action(a,body,expected=200){const r=await fetch(`${origin}/api/sales/legal`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({sale:sale.id,...body})});if(r.status!==expected)throw Error(`Synthetic ${body.action} returned ${r.status}: ${JSON.stringify(await r.json())}`);return r.json();}
 if(!continuing){
 await visit(c1);await upload(c1,['completion_statement','draft_statement_of_account']);let state=await docs();assert.equal((await snapshot(d2)).filter(i=>i.kind.startsWith('review_')).length,2);pass('Real browser resumable upload creates two current developer reviews');
 await action(d2,{action:'approve_completion_document',documentType:'draft_statement_of_account',versionId:state.draft_statement_of_account.version});
 await action(d1,{action:'query_completion_document',documentType:'completion_statement',versionId:state.completion_statement.version,reason:'Synthetic handoff: clarify the final balance'});
 const old=state.completion_statement.version,approved=state.draft_statement_of_account.version;
 await c2.page.goto(`${origin}/?screen=sales&building=${building.id}`);await expect(c2.page.getByRole('region',{name:'Sales organisation worklist'}).or(c2.page.locator('section[aria-label="Sales organisation worklist"]'))).toContainText(unit.unit_number);
 const current=(await snapshot(c2)).find(i=>i.kind==='replace_completion_statement');assert.ok(current?.context?.text.includes('clarify the final balance'));pass('Another conveyancer sees the current query; independently approved account remains satisfied');
 await visit(c2);await upload(c2,['completion_statement']);state=await docs();assert.notEqual(state.completion_statement.version,old);assert.equal(state.draft_statement_of_account.approved_version_id,approved);
 await action(d1,{action:'approve_completion_document',documentType:'completion_statement',versionId:old},400);pass('Real authoritative endpoint rejects stale approval after colleague replacement');
 await action(d2,{action:'approve_completion_document',documentType:'completion_statement',versionId:state.completion_statement.version});assert.ok((await snapshot(c1)).some(i=>i.kind==='notice_dates'));assert.deepEqual(await snapshot(c1),await snapshot(c2));pass('Both conveyancers retain the missing contractual-date action after approval');
 }
 if(!sale.contractual_completion_date){
 assert.ok((await snapshot(c1)).some(i=>i.kind==='notice_dates'));
 const today=new Date().toISOString().slice(0,10);await action(c2,{action:'correct_completion_dates',noticeDate:today,date:today,previousNoticeDate:sale.completion_notice_issued_at,previousDate:null});pass('Legacy missing-date task clears only after canonical saved-date correction');
 }
 if(!['exchanged','completed'].includes(unit.sale_status)){
  assert.ok(!(await snapshot(c1)).some(i=>i.kind==='legal_completion'));assert.ok((await snapshot(d1)).some(i=>i.kind==='sale_unit_reconciliation'));
  await action(c1,{action:'confirm_completion',dateTime:new Date().toISOString(),confirmed:true},400);
  pass('Existing inconsistent synthetic unit stage is disclosed and real completion remains blocked');
  checks.push({name:'Live duplicate completion not exercised: legacy fixture unit is for_sale; full valid completion tested in local PostgreSQL',incomplete:true});save();
 }else{
  assert.ok((await snapshot(c1)).some(i=>i.kind==='legal_completion'));
  await action(c1,{action:'confirm_completion',dateTime:new Date().toISOString(),confirmed:true});await action(c2,{action:'confirm_completion',dateTime:new Date().toISOString(),confirmed:true});
  const events=await checked(service.from('unit_sale_workflow_events').select('id,created_by_user_id').eq('sale_attempt_id',sale.id).eq('event_type','completion_recorded'));assert.equal(events.length,1);assert.equal(events[0].created_by_user_id,c1.id);pass('Repeated completion creates one audited event');
 }
 const shared=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const again=await checked(shared.auth.signInWithPassword({email:c1.email,password:c1.password}));assert.deepEqual(await snapshot({...c1,token:again.session.access_token}),await snapshot(c1));await shared.auth.signOut();pass('A successive session of the same account derives the same complete business work');
 await checked(service.from('profiles').update({active:false}).eq('id',c2.id));const revoked=await fetch(`${origin}/api/dashboard?building=${building.id}`,{headers:{Authorization:`Bearer ${c2.token}`}});assert.equal(revoked.status,403);pass('A disabled account cannot reuse its JWT for the dashboard');
}catch(error){checks.push({name:'Run failure',passed:false,error:error.message});save();console.error(error.message);process.exitCode=1;}
finally{
 await browser?.close();
 for(const a of accounts){try{await a.client?.auth.signOut();await checked(service.from('profiles').update({active:false}).eq('id',a.id));await checked(service.auth.admin.updateUserById(a.id,{ban_duration:'876000h'}));a.disabled=true;}catch{checks.push({name:`Disable ${a.label}`,passed:false});process.exitCode=1;}}
 save();
}
