import { test, expect, type Response } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { legalFixture } from './helpers/legal-ui-fixture';
import { deriveDashboard } from '../src/lib/dashboard/model';
const { fixture } = createRequire(__filename)('./helpers/dashboard-fixture.mjs');
const baseline = process.env.DASHBOARD_BENCHMARK === 'baseline';
test('five comparable synthetic journeys, three warm samples each', async ({ page }) => {
 test.skip(!process.env.DASHBOARD_BENCHMARK, 'Opt-in local baseline comparison'); test.setTimeout(120000);
 const f = await legalFixture(page);
 const input = fixture();
 f.rows.buildings.push({ ...f.rows.buildings[0], id:'10000000-0000-4000-8000-000000000002', name:'Synthetic Second House' });
 f.rows.units.push({ ...f.unit, id:'20000000-0000-4000-8000-000000000002', building_id:'10000000-0000-4000-8000-000000000002', unit_number:'2' });
 f.rows.user_building_access.push({ user_id:f.profile.id, building_id:'10000000-0000-4000-8000-000000000002' });
 await page.route('**/api/dashboard?*', route => {
  const scope=new URL(route.request().url()).searchParams.get('building');
  return route.fulfill({json:deriveDashboard({...input,now:Date.parse('2026-10-07T12:00:00Z'),viewer:{id:f.profile.id,role:f.profile.role,organisation_id:null},buildingId:scope==='all'?'':scope, sales:[{...input.sales[0],...f.attempt}],units:[{...input.units[0],...f.unit}]})});
 });
 const samples:Record<string,unknown>[]=[];
 async function measure(journey:string,run:number,act:()=>Promise<unknown>,ready:()=>Promise<unknown>){
  const responses:Response[]=[]; const collect=(response:Response)=>{if(/\/rest\/v1\/|\/api\/|\/auth\/v1\//.test(response.url()))responses.push(response);};
  page.on('response',collect);const start=performance.now();await act();await ready();const visibleMs=Math.round(performance.now()-start);await page.waitForLoadState('networkidle');page.off('response',collect);
  const sizes=await Promise.all(responses.map(async r=>{try{return (await r.body()).length;}catch{return 0;}}));
  const categories:Record<string,number>={};for(const r of responses){const path=new URL(r.url()).pathname;categories[path]=(categories[path]??0)+1;}
  samples.push({journey,run,visibleMs,dataRequests:responses.length,responseBytes:sizes.reduce((a,b)=>a+b,0),categories});
 }
 const dashReady=()=>page.getByRole('heading',{name:baseline?'Developer snags':'Portfolio overview',exact:true}).waitFor();
 await page.goto('/?screen=dashboard&building=all');await dashReady();await page.waitForLoadState('networkidle');
 for(let i=1;i<=3;i++){
  await measure('dashboard.open',i,()=>page.goto('/?screen=dashboard&building=all'),dashReady);
  await measure('dashboard.building_change',i,()=>page.getByLabel('Current building',{exact:true}).selectOption(String(f.unit.building_id)),async()=>{await expect(page.getByLabel('Current building',{exact:true})).toHaveValue(String(f.unit.building_id));if(!baseline)await expect(page.getByRole('button',{name:'Refresh work'})).toBeEnabled();});
 }
 f.profile.role='conveyancer';
 await page.goto('/?screen=sales&building=all');await page.getByRole('heading',{name:'Sales results',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 for(let i=1;i<=3;i++)await measure('external_sales.open',i,()=>page.goto('/?screen=sales&building=all'),()=>page.getByRole('heading',{name:'Sales results',exact:true}).waitFor());
 const salePath=`/?screen=sales&building=${f.unit.building_id}&salesUnitId=${f.unit.id}&section=progression#sales-stage-exchange`;
 await page.goto(salePath);await page.getByRole('button',{name:/^Exchange\b/}).click();await page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 for(let i=1;i<=3;i++){await page.goto('/?screen=sales&building=all');await page.getByRole('heading',{name:'Sales results',exact:true}).waitFor();await page.waitForLoadState('networkidle');await measure('task.open',i,async()=>{await page.goto(salePath);await page.getByRole('button',{name:/^Exchange\b/}).click();},()=>page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor());}
 for(let i=1;i<=3;i++){
  f.attempt.workflow_status='approved';f.attempt.exchanged_at=null;f.unit.sale_status='reserved';
  f.emails.splice(0,f.emails.length,{id:'authority',kind:'authority',version:1,delivery_status:'sent',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),snapshot:f.snapshot,to_recipients:['legal@example.test'],cc_recipients:[],resend_message_id:'synthetic-message'});
  await page.goto(salePath);await page.reload();await page.getByRole('button',{name:/^Exchange\b/}).click();await page.getByLabel('Actual exchange date',{exact:true}).fill(new Date().toISOString().slice(0,10));await page.waitForLoadState('networkidle');
  await measure('legal_mutation.return_to_sales',i,async()=>{await page.getByRole('button',{name:'Confirm exchange',exact:true}).click();await expect(page.getByText('Exchange confirmed.',{exact:true})).toBeVisible();await page.getByRole('button',{name:/Back to sales overview/}).click();},()=>page.getByRole('heading',{name:'Sales results',exact:true}).waitFor());
 }
 await mkdir('docs/organisation-dashboard/evidence',{recursive:true});await writeFile(`docs/organisation-dashboard/evidence/performance-${baseline?'baseline':'after'}.json`,JSON.stringify({mode:'Synthetic intercepted browser data, local Next dev, warm assets; durations end at visible UI, request bodies settle through network-idle. Not database latency.',origin:process.env.DASHBOARD_BROWSER_ORIGIN??'http://localhost:3011',samples},null,2));
});
