// Read-only browser navigation on the already authorised staging test sale.
// No trace, screenshot, DOM, credentials, URL, or response body is saved.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

dotenv.config({path:'.env.local',quiet:true});
const origin='https://staging.bunnywell.co.uk';
const scope=JSON.parse(fs.readFileSync('.next/performance/staging-test-sales.json','utf8'));
if(!JSON.parse(fs.readFileSync('.next/performance/staging-access.json','utf8')).matched)throw Error('Verify staging first.');
const unit=scope.units.find(u=>u.unit_number==='102');
const samples=[];
const output='artifacts/performance/navigation-samples.json';
const browser=await chromium.launch({headless:true});
let step='sign-in';
function observe(){
  window.salesDiagnostic={start:0,click:null,longTasks:[],lcp:null,cls:0};const d=window.salesDiagnostic;
  document.addEventListener('click',()=>{if(d.start)d.click=performance.now();},true);
  document.addEventListener('change',()=>{if(d.start)d.click=performance.now();},true);
  new PerformanceObserver(l=>{for(const e of l.getEntries())d.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  new PerformanceObserver(l=>{for(const e of l.getEntries())d.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
  new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)d.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
}
function category(request){const p=new URL(request.url()).pathname;if(p==='/api/sales/legal')return 'legal';if(p.includes('/rest/v1/'))return p.split('/').at(-1).replace(/[^a-z_]/g,'');if(p.endsWith('.js'))return 'javascript';if(p.includes('/auth/'))return 'auth';return 'other';}
async function measure(page,action,profile,run,act,ready){
  step=action;
  const starts=new Map(),requests=[],pending=[];
  const start=r=>starts.set(r,Date.now());
  const end=r=>{if(!starts.has(r))return;const durationMs=Date.now()-starts.get(r);pending.push((async()=>{const response=await r.response(),sizes=await r.sizes().catch(()=>null);requests.push({category:category(r),method:r.method(),status:response?.status(),durationMs,responseBytes:sizes?.responseBodySize??0,requestBytes:sizes?.requestBodySize??0});})());};
  page.on('request',start);page.on('requestfinished',end);
  await page.evaluate(()=>{window.salesDiagnostic.start=performance.now();window.salesDiagnostic.click=null;});
  await act();await ready();
  const result=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=window.salesDiagnostic;const n=performance.getEntriesByType('navigation')[0];const result={totalMs:performance.now()-(d.click??d.start),longTasks:d.longTasks.filter(t=>t.start>=d.start),navigation:{ttfbMs:n.responseStart-n.startTime,lcpMs:d.lcp,observedCls:d.cls,transferBytes:n.transferSize}};d.start=0;return result;});
  page.off('request',start);page.off('requestfinished',end);await Promise.all(pending);
  samples.push({action,run,profile,mode:'staging-readonly',...result,networkRequests:requests.length,responseBytes:requests.reduce((n,r)=>n+r.responseBytes,0),requests});
  fs.writeFileSync(output,JSON.stringify(samples,null,2));console.log(JSON.stringify({action,profile,run,ms:Math.round(result.totalMs),requests:requests.length}));
}
try{
  for(const profile of ['desktop','mobile-throttled']){
    const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(observe);const page=await context.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);
    await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
    if(profile==='mobile-throttled'){await page.setViewportSize({width:390,height:844});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
    await page.goto(`${origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${unit.id}`);
    const ready=()=>page.getByRole('button',{name:/^Completion\b/}).waitFor();await ready();
    for(let run=1;run<=5;run++){
      await page.goto(`${origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${unit.id}`);await ready();
      await cdp.send('Network.clearBrowserCache');
      await measure(page,'sale_file.navigation.cold',profile,run,()=>page.reload(),ready);
      await measure(page,'sale_file.navigation.repeat',profile,run,()=>page.reload(),ready);
      const picker=page.locator('[data-sale-file] select').filter({has:page.locator(`option[value="${unit.id}"]`)});
      step='select-other-test-unit';
      await picker.selectOption(scope.units.find(u=>u.unit_number==='107').id);
      step='wait-for-reservation-stage';
      await page.getByRole('list',{name:'Reservation tasks',exact:true}).waitFor();
      await measure(page,'sale.open.in_app',profile,run,()=>picker.selectOption(unit.id),ready);
      await measure(page,'progression.stage_change',profile,run,()=>page.getByRole('button',{name:/^Exchange\b/}).click(),()=>page.getByRole('list',{name:'Exchange tasks',exact:true}).waitFor());
      await measure(page,'completion.open',profile,run,()=>page.getByRole('button',{name:/^Completion\b/}).click(),()=>page.getByRole('list',{name:'Completion tasks',exact:true}).waitFor());
    }
    await context.close();
  }
}catch(error){console.log(JSON.stringify({stopped:step,errorType:error.name}));process.exitCode=1;}
finally{await browser.close();}
