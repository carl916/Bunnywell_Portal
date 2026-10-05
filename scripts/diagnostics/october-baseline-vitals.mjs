// Run only after the measured journeys have stopped. These are collector checks,
// not performance samples, and never submit a form or synthetic vital payload.
import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {attachVitals,out} from './baseline-recorder.mjs';
const browser=await chromium.launch({headless:true});
const checks=[];
try{
 for(const [path,expectedRoute] of [['/?baseline-check=synthetic#private-fragment','portal'],['/request-access?baseline-check=synthetic#private-fragment','request-access'],['/baseline-missing-route?baseline-check=synthetic#private-fragment','other']]){
  const page=await browser.newPage();attachVitals(page,'collector-check-desktop');
  const rows=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/performance/vitals')rows.push(r.postDataJSON());});
  const response=await page.goto(`https://staging.bunnywell.co.uk${path}`);
  await page.waitForTimeout(1200);
  await page.locator('body').click({position:{x:15,y:15}});
  await page.waitForTimeout(300);
  await page.goto('about:blank');await page.waitForTimeout(1500);
  checks.push({expectedRoute,documentStatus:response.status(),observedMetrics:[...new Set(rows.map(r=>r.metric))],observedRoutes:[...new Set(rows.map(r=>r.route))],payloadCount:rows.length,allPayloadsAllowed:rows.length>0&&rows.every(r=>r.route===expectedRoute&&Object.keys(r).sort().join(',')==='metric,rating,route,value')});
  await page.close();
 }
 fs.writeFileSync(`${out}/web-vitals-route-checks.json`,JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
 if(checks.some(c=>!c.allPayloadsAllowed))process.exitCode=1;
}finally{await browser.close();}
