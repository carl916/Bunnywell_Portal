// Staging-only safety and data integrity checks. Never persist credentials or rows.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
export const project = 'vxkpvdtrldwwqiddoyof.supabase.co';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project) throw Error('Staging backend required');
export const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function read(query) { const r = await query; if (r.error) throw Error(`Staging read failed: ${r.error.code}`); return r.data; }
export function verifyOrigin(origin) {
  if (origin !== 'https://staging.bunnywell.co.uk' && !/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin)) throw Error('Staging or isolated Preview required');
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
export async function login(role) {
  const email = role === 'admin' ? process.env.PLAYWRIGHT_ADMIN_EMAIL : process.env.REGISTER_PERF_EMAIL;
  if (!email) throw Error(role === 'admin' ? 'PLAYWRIGHT_ADMIN_EMAIL is required' : 'REGISTER_PERF_EMAIL is required');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const result = await client.auth.signInWithPassword({ email, password: process.env.PLAYWRIGHT_ADMIN_PASSWORD });
  if (result.error) throw Error('Authorised staging sign-in failed');
  const profile = await read(client.from('profiles').select('role,active').eq('id', result.data.user.id).single());
  if (profile.role !== role || !profile.active) throw Error('Unexpected staging role');
  return { client, session: result.data.session, email };
}
export async function fixtures() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
  const building = await read(admin.from('buildings').select('id').eq('name', 'Forum House').single());
  const units = await read(admin.from('units').select('id,unit_number').eq('building_id', building.id).order('unit_number'));
  const attempts = await read(admin.from('unit_sale_attempts').select('id,unit_id,workflow_status').in('unit_id', units.map(u => u.id)).eq('is_active', true));
  const candidates = attempts.filter(s => s.workflow_status === 'completed').sort((a,b) => Number(units.find(u=>u.id===a.unit_id).unit_number)-Number(units.find(u=>u.id===b.unit_id).unit_number));
  const sales = [];
  // Require NO outstanding authority capable of expiring, even after a long run.
  for (const sale of candidates) {
    const emails = await read(admin.from('sale_legal_emails').select('sent_at,expiry_recorded_at,exchanged_at,revoked_at,replaced_by').eq('sale_attempt_id', sale.id).eq('kind', 'authority'));
    if (!emails.some(e => e.sent_at && !e.expiry_recorded_at && !e.exchanged_at && !e.revoked_at && !e.replaced_by)) sales.push({ ...sale, number: units.find(u=>u.id===sale.unit_id).unit_number });
    if (sales.length === 2) break;
  }
  if (sales.length !== 2) throw Error('Two safely completed sales required; do not invoke Legal GET');
  async function fingerprints() {
    const ids = attempts.map(s => s.id), result = {};
    for (const [key,table,select,column,values] of [
      ['units','units','*','id',units.map(u=>u.id)],
      ['attempts','unit_sale_attempts','*','unit_id',units.map(u=>u.id)],
      ['emails','sale_legal_emails','*','sale_attempt_id',ids],
      ['events','unit_sale_workflow_events','*','sale_attempt_id',ids],
      ['documents','unit_sale_documents','*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)','sale_attempt_id',ids],
    ]) { const rows = await read(admin.from(table).select(select).in(column,values).order('id')); result[key] = {count:rows.length,sha256:hash(rows)}; }
    return result;
  }
  const authorities = await read(admin.from('sale_legal_emails').select('sale_attempt_id,sent_at,expiry_recorded_at,exchanged_at,revoked_at,replaced_by').in('sale_attempt_id',attempts.map(s=>s.id)).eq('kind','authority'));
  const taskSales=attempts.filter(s=>!authorities.some(e=>e.sale_attempt_id===s.id&&e.sent_at&&!e.expiry_recorded_at&&!e.exchanged_at&&!e.revoked_at&&!e.replaced_by));
  return { building: building.id, sales, taskSales, fingerprints };
}
const readRpcs = new Set(['sale_mentions_inbox','sale_comment_unread','sale_comment_page','sale_discussion_people','sale_activity_page','sale_actor_names','sale_workflow_context','get_agent_fee_portfolio']);
export async function installGuard(cdp, origin, safeSales, log) {
  await cdp.send('Network.enable');
  await cdp.send('Fetch.enable', { patterns: [{urlPattern:'*',requestStage:'Request'}] });
  cdp.on('Fetch.requestPaused', async ({requestId,request}) => {
    const u = new URL(request.url), method = request.method, path = u.pathname;
    let allowed = ['GET','HEAD','OPTIONS'].includes(method);
    if (u.hostname.endsWith('.supabase.co')) {
      allowed &&= u.hostname === project;
      if (u.hostname === project && path.startsWith('/auth/v1/')) allowed = ['GET','POST','OPTIONS'].includes(method) && /^\/auth\/v1\/(token|user|logout)$/.test(path);
      if (u.hostname === project && path.includes('/rest/v1/rpc/')) allowed = method === 'OPTIONS' || readRpcs.has(path.split('/').at(-1));
      // Unit-open audit and comment-read receipts are ordinary navigation side effects,
      // but suppress them equally in both variants for this read-only experiment.
      if (u.hostname === project && ['record_unit_open','sale_comment_read'].includes(path.split('/').at(-1)) && method === 'POST') {
        log.suppressed.push(path.split('/').at(-1));
        await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'access-control-allow-origin',value:origin}],body:Buffer.from('null').toString('base64')});return;
      }
    } else if (u.origin === origin && path.startsWith('/api/')) {
      const apiReads = new Set(['/api/sales/register','/api/sales/legal','/api/dashboard','/api/rentals/tenancies','/api/rentals/rent-risk','/api/units/allocation']);
      allowed = method === 'OPTIONS' || method === 'GET' && apiReads.has(path);
      if (path === '/api/sales/legal' && method === 'GET') allowed &&= safeSales.includes(u.searchParams.get('sale'));
      if (path === '/api/auth/activity' && method === 'POST') allowed = true;
      // Shared staging's existing collector writes only these numeric vitals to
      // runtime logs. Preserve it during the real-host smoke, without business data.
      if (origin === 'https://staging.bunnywell.co.uk' && path === '/api/performance/vitals' && method === 'POST') {
        try {
          const payload=JSON.parse(request.postData??'');
          allowed=Object.keys(payload).sort().join(',')==='metric,rating,route,value'
            && ['INP','LCP','CLS','TTFB'].includes(payload.metric)
            && ['good','needs-improvement','poor'].includes(payload.rating)
            && ['portal','request-access','other'].includes(payload.route)
            && Number.isFinite(payload.value) && payload.value>=0;
        } catch { allowed=false; }
      }
    } else if (u.origin !== origin && u.protocol !== 'about:' && u.hostname !== 'vercel.live') allowed = false;
    if (!allowed) log.blocked.push({method,endpoint:path.split('/').at(-1)});
    await cdp.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId}:{requestId,errorReason:'BlockedByClient'});
  });
}
