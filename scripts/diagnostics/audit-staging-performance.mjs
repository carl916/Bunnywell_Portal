import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
dotenv.config({path:'.env.local',quiet:true});
const origin=process.env.AUDIT_PREVIEW_URL || 'https://staging.bunnywell.co.uk';
if (new URL(origin).hostname !== 'staging.bunnywell.co.uk' && !new URL(origin).hostname.endsWith('.vercel.app')) throw Error('Only staging or a staging preview is allowed');
const mode=process.argv[2] || 'baseline';
if(!['baseline','increment'].includes(mode)) throw Error('Choose baseline or increment');
if(!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('vxkpvdtrldwwqiddoyof')) throw Error('Staging configuration required');
const scope=JSON.parse(fs.readFileSync('.next/performance/staging-test-sales.json','utf8'));
const browser=await chromium.launch({headless:true});
const samples=[];
let step='navigate';
let page;
try {
  page=await browser.newPage({viewport:{width:1280,height:900}});
  let wrongDatabase=false;
  await page.route('**/*.supabase.co/**',route=>{
    if(new URL(route.request().url()).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co') {wrongDatabase=true;return route.abort();}
    return route.continue();
  });
  page.setDefaultTimeout(45000);
  await page.goto(origin);
  step='sign-in';
  await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);
  await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  if(wrongDatabase) throw Error('Preview attempted a non-staging database request');
  step='open-authorised-unit';
  const first=scope.units.find(u=>u.unit_number==='107');
  const other=scope.units.find(u=>u.unit_number==='108');
  await page.goto(`${origin}/?screen=sales&building=${scope.buildingId}&salesUnitId=${first.id}`);
  await page.locator('[data-sale-file] select').waitFor();
  let viewRequests=0;
  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/rpc/record_unit_open')) viewRequests++;});
  await page.reload(); await page.locator('[data-sale-file] select').waitFor();
  await page.waitForTimeout(1000);
  if(viewRequests) throw Error('Background page load recorded a unit open');
  for(let i=0;i<20;i++){
    const next=i%2?first:other;
    let requests=0,opens=0;
    const listener=r=>{requests++;if(new URL(r.url()).pathname.endsWith('/rpc/record_unit_open')) opens++;};
    page.on('request',listener);
    const start=performance.now();
    await page.locator('[data-sale-file] select').selectOption(next.id);
    await page.getByRole('heading',{name:`Unit ${next.unit_number}`,exact:true}).waitFor();
    const ms=performance.now()-start;
    await page.waitForTimeout(350);
    page.off('request',listener);
    samples.push({ms,requests,viewRequests:opens});
  }
  const times=samples.map(s=>s.ms).sort((a,b)=>a-b);
  const result={mode,sampleSize:samples.length,p50Ms:times[Math.ceil(times.length*.5)-1],p95Ms:times[Math.ceil(times.length*.95)-1],
    requests:samples.map(s=>s.requests),viewRequests:samples.reduce((n,s)=>n+s.viewRequests,0),backgroundViewRequests:0,samples};
  fs.mkdirSync('artifacts/audit',{recursive:true});fs.writeFileSync(`artifacts/audit/${mode}-unit-open.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,samples:undefined,requests:undefined}));
}catch(e){console.log(JSON.stringify({stopped:step,error:e.name,message:e.message.replace(/Bearer\s+[^\s]+/g,'Bearer [redacted]').slice(0,350),saleFiles:page?await page.locator('[data-sale-file]').count():0,salesButtons:page?await page.getByRole('button',{name:'Sales',exact:true}).count():0}));process.exitCode=1;}
finally{await browser.close();}
