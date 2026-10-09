// Live, paired whole-portal trial. Stores only timing/count/hash metadata.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fixtures, login, installGuard, project, verifyOrigin, hash } from './full-region-safety.mjs';
const targets=JSON.parse(process.env.FULL_REGION_TARGETS), rounds=Number(process.env.FULL_REGION_ROUNDS??8);
const output=process.env.FULL_REGION_OUTPUT??'test-results/full-region-browser.json';
const focus=process.env.FULL_REGION_FOCUS;assert.ok(!focus||focus==='snags','Unknown browser focus');
Object.values(targets).forEach(verifyOrigin);
const f=await fixtures(), before=await f.fingerprints();
const result={startedAt:new Date().toISOString(),completed:false,rounds,focus:focus??'whole-portal',targets,samples:[],setup:[],errors:[],guards:[],before};
const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));
const browser=await chromium.launch({headless:true});
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const bg=p=>/sale_mentions_inbox|sale_comment_unread|auth\/activity|record_unit_open|sale_comment_read/.test(p);
function endpoint(u){return u.pathname.startsWith('/api/')?u.pathname:u.pathname.includes('/rest/v1/')?u.pathname.split('/').at(-1):u.pathname.endsWith('.js')?'javascript':u.pathname.endsWith('.css')?'stylesheet':u.pathname.includes('/auth/')?'auth':'document/asset';}
async function measure(s,action,run,act,ready,visual=ready){
 const rows=[],map=new Map(),active=new Set(),pending=[];let last=performance.now();
 console.log(JSON.stringify({begin:action,variant:s.variant,role:s.role,profile:s.profile,run}));
 const started=performance.now();
 const begin=q=>{const u=new URL(q.url()),name=endpoint(u);const category=u.hostname===project?(u.pathname.includes('/auth/')?'supabase-auth':u.pathname.includes('/storage/')?'supabase-storage':'supabase-data'):u.origin===s.origin?(u.pathname.startsWith('/api/')?'function':q.resourceType()==='document'?'document':'static'):'other';
  const row={endpoint:name,category,method:q.method(),offsetMs:performance.now()-started};rows.push(row);map.set(q,row);
  if(category!=='other'&&!bg(u.pathname)){active.add(q);last=performance.now();}
 };
 const response=r=>{const row=map.get(r.request());if(!row)return;const h=r.headers();Object.assign(row,{status:r.status(),region:h['x-vercel-id']??null,cache:h['x-vercel-cache']??null,serverTiming:h['server-timing']??null});
  if(row.endpoint==='/api/sales/register'||row.endpoint==='/api/dashboard')pending.push((async()=>{const data=await r.json();row.projectionHash=hash({...data,asOf:null});if(row.endpoint.endsWith('/register')){row.actionsAvailable=data.actionsAvailable;row.rows=data.rows?.length;}else{row.sourceStates=data.sources?.map(x=>({key:x.key,state:x.state}));row.tasks=data.items?.length;}})().catch(()=>{row.bodyError=true;}));
 };
 const finish=q=>{const row=map.get(q);if(!row)return;row.endMs=performance.now()-started;row.durationMs=row.endMs-row.offsetMs;row.timing=q.timing();if(active.delete(q))last=performance.now();pending.push(q.sizes().then(v=>{row.bytes=v.responseBodySize;}).catch(()=>{}));};
 const fail=q=>{const row=map.get(q);if(row){row.failed=q.failure()?.errorText==='net::ERR_ABORTED'?'aborted':'failed';row.endMs=performance.now()-started;}if(active.delete(q))last=performance.now();};
 const error=()=>result.errors.push({variant:s.variant,role:s.role,profile:s.profile,run,action,type:'pageerror'});
 s.page.on('request',begin);s.page.on('response',response);s.page.on('requestfinished',finish);s.page.on('requestfailed',fail);s.page.on('pageerror',error);
 let visualMs,readyMs,status='ok';
 try{await act();await visual();visualMs=performance.now()-started;await ready();await frames(s.page);readyMs=performance.now()-started;
  while((active.size||performance.now()-last<250)&&performance.now()-started<(action==='navigation.snags'?240000:60000))await s.page.waitForTimeout(25);
  if(active.size)throw Error('Request settlement timeout');await ready();
 }catch(e){status='failed';result.errors.push({variant:s.variant,role:s.role,profile:s.profile,run,action,type:e.name});}
 s.page.off('request',begin);s.page.off('response',response);s.page.off('requestfinished',finish);s.page.off('requestfailed',fail);s.page.off('pageerror',error);await Promise.all(pending);
 const critical=rows.filter(r=>r.category!=='other'&&!bg(r.endpoint));
 const sample={variant:s.variant,role:s.role,profile:s.profile,run,action,status,visualMs,actionableMs:readyMs,readyMs:Math.max(readyMs??0,...critical.map(r=>r.endMs??0)),requestCount:rows.length,bytes:rows.reduce((n,r)=>n+(r.bytes??0),0),requests:rows};
 if(rows.some(r=>r.category!=='other'&&(r.status>=400||r.failed&&r.failed!=='aborted')))sample.failures=true;
 result.samples.push(sample);save();console.log(JSON.stringify({variant:s.variant,role:s.role,profile:s.profile,run,action,status,readyMs:Math.round(sample.readyMs),requests:rows.length}));
 if(status!=='ok'||s.guard.blocked.length)throw Error(`Stopped at ${s.role}/${s.profile}/${action}`);
 return sample;
}
async function setup(variant,origin,role,profile){
 const auth=await login(role),context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),cdp=await context.newCDPSession(page),guard={blocked:[],suppressed:[]};
 page.setDefaultTimeout(45000);await installGuard(cdp,origin,f.taskSales.map(s=>s.id),guard);
 const hosts=new Set();page.on('request',r=>{const host=new URL(r.url()).hostname;if(host.endsWith('.supabase.co'))hosts.add(host);});
 await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill(auth.email);await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 assert.deepEqual([...hosts],[project]);
 if(profile==='mobile'){await page.setViewportSize({width:390,height:844});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
 const s={variant,origin,role,profile,auth,context,page,cdp,guard};result.setup.push({variant,role,profile,stagingVerified:true,browser:browser.version()});result.guards.push({variant,role,profile,guard});await page.goto('about:blank');return s;
}
const enabled=async locator=>{await locator.waitFor();await locator.page().waitForFunction(el=>el&&!el.disabled,await locator.elementHandle());};
async function dashboardReady(p){await enabled(p.getByRole('button',{name:'Refresh work',exact:true}));await p.getByRole('button',{name:/^Our actions /}).waitFor();assert.equal(await p.getByText(/Partial coverage:/).count(),0);}
async function salesReady(p,role){if(role==='conveyancer'){await enabled(p.getByLabel('Action with',{exact:true}));await p.waitForFunction(()=>!document.querySelector('section[aria-label="Sales register"]')?.textContent.includes('Refreshing…'));}else await p.getByRole('heading',{name:'Sales results',exact:true}).waitFor();}
async function fileReady(p){await p.locator('[data-sale-file]').waitFor();await p.getByRole('button',{name:/^Handover\b/}).waitFor();}
async function menu(s){if(s.profile==='mobile')await s.page.getByRole('button',{name:'Open menu',exact:true}).click();}
async function closeMenu(s){const b=s.page.getByRole('button',{name:'Close menu',exact:true});if(await b.isVisible())await b.click();}
async function nav(s,name){const n=s.page.getByRole('navigation',{name:s.profile==='mobile'?'Primary mobile navigation':'Primary navigation',exact:true});if(await n.getByRole('button',{name,exact:true}).count())await n.getByRole('button',{name,exact:true}).click();else{await menu(s);await s.page.getByRole('button',{name,exact:true}).filter({visible:true}).click();}}
async function building(s,value){await menu(s);await s.page.getByLabel('Current building',{exact:true}).filter({visible:true}).selectOption(value);await closeMenu(s);}
async function refresh(s){await menu(s);await s.page.getByRole('button',{name:'Refresh',exact:true}).filter({visible:true}).click();}
async function openSale(s,index=0){const sale=f.sales[index];if(s.role==='conveyancer'){await s.page.getByRole('searchbox').fill(sale.number);await s.page.getByRole('link',{name:`Unit ${sale.number}`,exact:true}).click();}else{await s.page.getByLabel('Search',{exact:true}).fill(sale.number);await s.page.locator('tbody tr').filter({has:s.page.locator('td').filter({hasText:new RegExp(`^Unit ${sale.number}(?:Comments|$)`)})}).first().click();}}
async function journey(s,run){
 const p=s.page,home=s.role==='admin'?'dashboard':'sales',ready=()=>s.role==='admin'?dashboardReady(p):salesReady(p,s.role),m=(name,act,check,visual)=>measure(s,name,run,act,check,visual);
 await s.cdp.send('Network.clearBrowserCache');
 if(focus==='snags'){
  assert.equal(s.role,'admin');
  await p.goto(`${s.origin}/?screen=sales&building=${f.building}`);await salesReady(p,s.role);await p.waitForLoadState('networkidle');
  await m('navigation.snags',()=>nav(s,'Snags'),async()=>{await p.getByRole('heading',{name:'Snags',exact:true}).waitFor();await p.getByLabel('Loading portal',{exact:true}).waitFor({state:'hidden'});});
  await p.goto('about:blank');return;
 }
 await m(`${home}.cold`,()=>p.goto(`${s.origin}/?screen=${home}&building=all`),ready,()=>p.getByRole('heading',{name:s.role==='admin'?'Portfolio overview':'Sales',exact:true}).waitFor());
 await m(`${home}.repeat`,()=>p.reload(),ready);
 if(s.role==='admin')await m('dashboard.refresh',async()=>{const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/dashboard');await p.getByRole('button',{name:'Refresh work',exact:true}).click();await response;},ready);
 else await m('register.refresh',async()=>{const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/register');await refresh(s);await response;},ready);
 await m(`${home}.building_change`,()=>building(s,f.building),ready);
 if(s.role==='admin')await m('navigation.sales',()=>nav(s,'Sales'),()=>salesReady(p,s.role));
 await p.waitForTimeout(300);
 await m('sale.open',()=>openSale(s),()=>fileReady(p));
 await m('sale.reservation',()=>p.getByRole('button',{name:/^Reservation\b/}).click(),()=>p.locator('#sales-stage-reservation').waitFor());
 await m('sale.exchange',()=>p.getByRole('button',{name:/^Exchange\b/}).click(),()=>p.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor());
 await m('sale.completion',()=>p.getByRole('button',{name:/^Completion\b/}).click(),()=>p.getByRole('list',{name:'Completion tasks',exact:true}).waitFor());
 await m('comments.open',()=>p.getByRole('button',{name:/^Comments/}).filter({visible:true}).first().click(),async()=>{await p.getByLabel('Write an update',{exact:true}).waitFor();await p.waitForFunction(()=>!document.querySelector('#sale-conversation')?.textContent.includes('Loading conversation'));});
 await p.getByRole('button',{name:'Close comments panel',exact:true}).click();
 await m('sale.return',()=>p.getByRole('button',{name:/Back to sales overview/}).click(),()=>salesReady(p,s.role));
 await m('sale.another',()=>openSale(s,1),()=>fileReady(p));
 await m('sale.browser_back',()=>p.goBack(),()=>salesReady(p,s.role));
 if(s.role==='admin'){
  if(run===0)await m('navigation.snags',()=>nav(s,'Snags'),async()=>{await p.getByRole('heading',{name:'Snags',exact:true}).waitFor();await p.getByLabel('Loading portal',{exact:true}).waitFor({state:'hidden'});});
  await m('navigation.rentals',()=>nav(s,'Rentals'),async()=>{await p.getByRole('heading',{name:'Unit performance',exact:true}).waitFor();await p.getByText('Loading rental portfolio…',{exact:true}).waitFor({state:'hidden'});});
  await m('navigation.setup',()=>nav(s,'Setup'),async()=>{await p.getByRole('tab',{name:'Buildings',exact:true}).waitFor();await p.getByRole('heading',{name:'Setup',exact:true}).waitFor();await p.getByLabel('Loading portal',{exact:true}).waitFor({state:'hidden'});});
  await m('setup.units',()=>p.getByRole('tab',{name:'Unit allocation',exact:true}).click(),()=>p.getByRole('heading',{name:'Unit allocation',exact:true}).waitFor());
  await m('setup.users',()=>p.getByRole('tab',{name:'Users & access',exact:true}).click(),()=>p.getByRole('heading',{name:'Users & access',exact:true}).waitFor());
  await m('navigation.dashboard',()=>nav(s,'Dashboard'),()=>dashboardReady(p));
  // Use only a task linking to a sale independently proven unable to expire.
  const links=p.locator('section[aria-label="Portfolio overview"] a[href*="salesUnitId="]');
  let safeLink;for(let i=0;i<await links.count();i++){const href=await links.nth(i).getAttribute('href');if(f.taskSales.some(s=>href.includes(s.unit_id))){safeLink=links.nth(i);break;}}
  if(safeLink)await m('dashboard.task_to_sale',()=>safeLink.click(),async()=>{await p.locator('[data-sale-file]').waitFor();await p.getByRole('button',{name:/Back to sales overview/}).waitFor();await p.getByLabel('Sales loading',{exact:true}).waitFor({state:'hidden'});});
 }
 await p.goto('about:blank');
}
try{
 for(const role of (process.env.FULL_REGION_ROLES??'admin,conveyancer').split(','))for(const profile of (process.env.FULL_REGION_PROFILES??'desktop,mobile').split(',')){
  const sessions={};for(const [variant,origin]of Object.entries(targets))sessions[variant]=await setup(variant,origin,role,profile);
  for(let run=0;run<rounds;run++){const order=Object.keys(sessions);if((run+Number(profile==='mobile'))%2)order.reverse();for(const variant of order)await journey(sessions[variant],run);}
  // The application intentionally signs out globally. Test that on the last
  // context only, after closing its paired peer, so it cannot invalidate a run.
  const entries=Object.values(sessions);
  for(let i=0;i<entries.length;i++){const s=entries[i];if(i===entries.length-1){await s.page.goto(s.origin);await s.page.waitForLoadState('networkidle');await menu(s);await s.page.getByRole('button',{name:'Sign out',exact:true}).filter({visible:true}).click();await s.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();result.setup.push({variant:s.variant,role,profile,logoutVerified:true});}await s.context.close();await s.auth.client.auth.signOut({scope:'local'});}
 }
 result.completed=true;
}catch(e){result.stopped=e.message.startsWith('Stopped at')?e.message:e.name;process.exitCode=1;console.log(JSON.stringify({stopped:result.stopped}));}
finally{await browser.close();result.after=await f.fingerprints();result.unchanged=JSON.stringify(before)===JSON.stringify(result.after);result.finishedAt=new Date().toISOString();save();if(!result.unchanged)throw Error('Protected sales state changed');}
