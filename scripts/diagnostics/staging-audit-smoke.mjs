import fs from 'node:fs';
import dotenv from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
dotenv.config({path:'.env.local',quiet:true});
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(new URL(url).hostname!=='vxkpvdtrldwwqiddoyof.supabase.co') throw Error('Staging only');
const origin=process.env.AUDIT_PREVIEW_URL;
if(!origin || !new URL(origin).hostname.endsWith('.vercel.app')) throw Error('Verified feature preview required');
const results={};
const client=()=>createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const anonymous=client();
if(!(await anonymous.rpc('portal_audit_page')).error) throw Error('Anonymous audit access');
results.anonymousDenied=true;
for(const role of ['ADMIN','CONTRACTOR','RESIDENT']) {
  const db=client();
  const {error}=await db.auth.signInWithPassword({email:process.env[`PLAYWRIGHT_${role}_EMAIL`],password:process.env[`PLAYWRIGHT_${role}_PASSWORD`]});
  if(error) throw Error(`${role} fixture login failed`);
  const feed=await db.rpc('portal_audit_page');
  if(role!=='ADMIN') {
    if(!feed.error) throw Error(`${role} audit access leak`);
    const raw=await db.from('unit_open_events').select('id');
    if(raw.error || raw.data.length) throw Error(`${role} view RLS leak`);
    results[`${role.toLowerCase()}Denied`]=true;
  } else {
    if(feed.error || feed.data.length>51) throw Error('Admin feed failed');
    const first=feed.data;
    if(first.length===51) {
      const last=first[49];
      const second=await db.rpc('portal_audit_page',{p_before_time:last.created_at,p_before_id:last.id,p_before_source:last.source??''});
      if(second.error || first.slice(0,50).some(a=>second.data.some(b=>a.id===b.id))) throw Error('Live cursor repeated history');
    }
    const auth=await db.rpc('portal_audit_page',{p_filters:{stream:'authentication'}});
    if(auth.error || !auth.data.length || auth.data.some(e=>!['auth_login','auth_logout'].includes(e.event_type))) throw Error('Provider feed failed');
    const views=await db.rpc('portal_audit_page',{p_filters:{stream:'views'}});
    if(views.error || views.data.length!==2 || feed.data.some(e=>e.event_type==='unit_opened')) throw Error('View separation/dedup failed');
    results.livePagination=true;results.providerFeed=true;results.viewRecords=views.data.length;results.businessExcludesViews=true;
  }
  await db.auth.signOut();
}
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);
  await page.route('**/*.supabase.co/**',route=>new URL(route.request().url()).hostname==='vxkpvdtrldwwqiddoyof.supabase.co'?route.continue():route.abort());
  await page.goto(origin);
  await page.getByLabel('Email',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_EMAIL);
  await page.getByLabel('Password',{exact:true}).fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  const auditLoaded=page.waitForResponse(r=>r.url().endsWith('/rpc/portal_audit_page') && r.status()===200);
  await page.goto(`${origin}/?screen=activity_log`);
  await page.getByLabel('Audit stream').waitFor();
  await auditLoaded;
  const authLoaded=page.waitForResponse(r=>r.url().endsWith('/rpc/portal_audit_page') && r.status()===200);
  await page.getByLabel('Audit stream').selectOption('authentication');
  await authLoaded;
  await page.getByLabel('Audit stream').selectOption('views');
  await page.getByLabel('Enable unit-open recording').waitFor();
  results.auditUi=true;
} finally {await browser.close();}
fs.mkdirSync('artifacts/audit',{recursive:true});fs.writeFileSync('artifacts/audit/staging-smoke.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
