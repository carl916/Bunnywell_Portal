// Caller-JWT staging reads only. Save timings/counts, never the input or output.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';
dotenv.config({ path: '.env.local', quiet: true });
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'vxkpvdtrldwwqiddoyof.supabase.co') throw Error('Staging required');
const { loadDashboardInput, dashboardAccessKey } = loadTypescriptModule('src/lib/dashboard/read.ts');
const { deriveSalesRegister } = loadTypescriptModule('src/lib/sales/register.ts');
let start, calls = [];
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, init) => {
    const at = performance.now(), result = await fetch(url, init);
    if (start) calls.push({ endpoint: new URL(url).pathname.split('/').at(-1), startMs: at - start, endMs: performance.now() - start });
    return result;
  } },
});
const login = await client.auth.signInWithPassword({ email: process.env.REGISTER_PERF_EMAIL ?? 'carl@accoladeproperties.co.uk', password: process.env.PLAYWRIGHT_ADMIN_PASSWORD });
if (login.error) throw Error('Test login failed');
const samples = [];
for (let run = 0; run < 8; run++) {
  calls = []; start = performance.now();
  const stages = [];
  async function stage(name, work) { const at = performance.now(); const value = await work(); stages.push({ name, startMs: at - start, durationMs: performance.now() - at }); return value; }
  const auth = await stage('auth', () => client.auth.getUser(login.data.session.access_token));
  const { data: viewer } = await stage('profile', () => client.from('profiles').select('id,role,organisation_id,active').eq('id', auth.data.user.id).single());
  if (viewer?.role !== 'conveyancer' || !viewer.active) throw Error('Authorised conveyancer required');
  const before = await stage('access', () => dashboardAccessKey(client, viewer));
  const input = await stage('input', () => loadDashboardInput(client, viewer, '', Date.now(), 'sales-register'));
  const { data: current } = await stage('profile-recheck', () => client.from('profiles').select('id,role,organisation_id,active').eq('id', viewer.id).single());
  if (JSON.stringify(viewer) !== JSON.stringify(current) || before !== await stage('access-recheck', () => dashboardAccessKey(client, current))) throw Error('Access changed');
  const deriveStart = performance.now(), response = deriveSalesRegister(input), deriveMs = performance.now() - deriveStart;
  samples.push({ run, elapsedMs: performance.now() - start, calls, stages, deriveMs, rows: response.rows.length, sales: input.sales.length, documents: input.documents.length, authorities: input.authorities.length, actionsAvailable: response.actionsAvailable, bytes: Buffer.byteLength(JSON.stringify(response)) });
}
fs.writeFileSync('test-results/register-local-read-profile.json', JSON.stringify({ environment: 'Local Node to live staging; not Vercel/database-engine execution', samples }, null, 2));
console.log(JSON.stringify(samples.map(({ run, elapsedMs, deriveMs, rows, sales, calls }) => ({ run, elapsedMs, deriveMs, rows, sales, requests: calls.length }))));
