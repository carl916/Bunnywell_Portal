import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
import {building,unit,sale} from './helpers/dashboard-fixture.mjs';

function setup({role='developer',active=true,failSource='',changingProfile=false,changingAccess=false,responseComposer}={}){
  const calls=[];let profileReads=0,accessReads=0;
  const profile={id:'viewer',role,organisation_id:'legal-org',active};
  const tables={user_building_access:[{id:'access',user_id:'viewer',building_id:building.id}],profiles:[profile],buildings:[building],units:[unit],building_floors:[],organisations:[],building_organisations:[],unit_sale_attempts:[sale],unit_sale_documents:[],sale_legal_emails:[],sale_exchange_deposit_receipts:[],sale_exchange_deposit_sources:[],unit_sale_invoices:[],unit_sale_invoice_payments:[],unit_sale_terms:[],snags:[],handovers:[],unit_tenancies:[],rental_arrears_episodes:[],rental_import_runs:[],resident_access_requests:[]};
  const client={auth:{getUser:async()=>({data:{user:{id:'viewer'}},error:null})},from(table){
    calls.push(table);let rows=[...(tables[table]??[])],single=false,start=0,end=Infinity;
    const q={select(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},limit(){return q;},not(){return q;},is(key){rows=rows.filter(r=>r[key]==null);return q;},in(key,ids){if(!key.includes('.'))rows=rows.filter(r=>ids.includes(r[key]));return q;},eq(key,val){if(!key.includes('.'))rows=rows.filter(r=>r[key]===val);return q;},single(){single=true;return q;},then(resolve){if(table==='user_building_access'&&changingAccess&&++accessReads>1)rows=[];if(table==='profiles'&&changingProfile&&++profileReads>1)rows=[{...profile,active:false}];return Promise.resolve({data:single?rows[0]:rows.slice(start,end+1),count:rows.length,error:table===failSource?{message:'PRIVATE database details'}:null}).then(resolve);}};return q;
  },rpc:async(name)=>{calls.push(name);return {data:[],error:null,count:0};}};
  const route=loadTypescriptModule('src/app/api/dashboard/route.ts',{overrides:{...(responseComposer?{'@/lib/dashboard/response':{dashboardResponse:responseComposer}}:{}),'@supabase/supabase-js':{createClient:(url,key,options)=>{assert.equal(key,'public-test-key');assert.equal(options.auth.persistSession,false);assert.equal(options.global.headers.Authorization,'Bearer synthetic');return client;}},'@/lib/supabase/admin':{requiredEnv:key=>key==='NEXT_PUBLIC_SUPABASE_ANON_KEY'?'public-test-key':'https://synthetic.invalid'}}});
  const get=(query='building=all',signed=true)=>route.GET(new Request(`http://local/api/dashboard?${query}`,{headers:signed?{authorization:'Bearer synthetic'}:{}}));
  return {get,calls,tables};
}
test('route denies unauthenticated, unknown and resident roles without reading portfolio data',async()=>{
  let f=setup();assert.equal((await f.get('building=all',false)).status,401);assert.deepEqual(f.calls,[]);
  for(const role of ['resident','user','legacy']){f=setup({role});assert.equal((await f.get()).status,403);assert.deepEqual(f.calls,['profiles']);}
  f=setup({active:false});assert.equal((await f.get()).status,403);
});
test('tampered building/unit parameters and inaccessible identifiers are denied',async()=>{
  const f=setup();assert.equal((await f.get('building=other')).status,400);assert.equal((await f.get('building=all&unit=other')).status,400);
  assert.equal((await f.get('building=10000000-0000-4000-8000-000000000099')).status,403);
  assert.ok(!f.calls.includes('unit_sale_attempts'));
});
test('compact scoped response is private no-store and never invokes legal expiry, provider or activity mutations',async()=>{
  const f=setup();const r=await f.get(`building=${building.id}`);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Authorization');const body=await r.json();assert.equal(body.scope.buildingId,building.id);
  assert.ok(!f.calls.some(name=>/sales_legal_|photos|sale_comments|audit_events|unit_views/.test(name)));
});
test('partial source failure reports unavailable instead of leaking DB details or converting to zero',async()=>{
  const f=setup({failSource:'sale_legal_emails'});const r=await f.get();assert.equal(r.status,200);const body=await r.json();assert.equal(body.sources.find(s=>s.key==='legal').state,'unavailable');assert.equal(body.summaries.find(s=>s.key==='document_reviews').value,null);assert.ok(!JSON.stringify(body).includes('PRIVATE'));
});
test('external sales never reads rentals, portfolio fees, snags or resident access requests',async()=>{
  const f=setup({role:'conveyancer'});assert.equal((await f.get()).status,200);
  for(const table of ['unit_sale_invoices','unit_sale_terms','unit_tenancies','snags','resident_access_requests','rental_import_runs'])assert.ok(!f.calls.includes(table),table);
});
test('representatives and contractors have operational sources only',async()=>{
  for(const role of ['developer_representative','contractor']){const f=setup({role});assert.equal((await f.get()).status,200);assert.ok(f.calls.includes('snags'));assert.ok(!f.calls.includes('unit_sale_attempts'));assert.ok(!f.calls.includes('unit_tenancies'));assert.ok(!f.calls.includes('resident_access_requests'));}
});
test('revocation during a read rejects the snapshot',async()=>{const f=setup({changingProfile:true});assert.equal((await f.get()).status,403);});
test('a source count larger than a page is paginated before aggregation',async()=>{
  const f=setup({role:'admin'});f.tables.resident_access_requests=Array.from({length:301},(_,i)=>({id:`r${i}`,status:'pending',created_at:'2026-10-01',requested_units:[{building_id:building.id}]}));
  const body=await (await f.get()).json();assert.equal(body.overview.additional.find(i=>i.key==='resident_access').count,301);assert.equal(f.calls.filter(t=>t==='resident_access_requests').length,2);
});

test("building access revoked during a read rejects the whole response",async()=>{const f=setup({changingAccess:true});assert.equal((await f.get()).status,403);});

test('simplified composition is returned only to internal admins and developers', async () => {
  for (const role of ['admin', 'developer', 'contractor', 'developer_representative', 'sales_agent', 'conveyancer']) {
    const f = setup({ role });
    const response = await f.get(`building=${building.id}`);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    if (role === 'admin' || role === 'developer') {
      assert.deepEqual(snapshot.overview.attention.map(row => row.key), ['sales', 'fees', 'snags', 'rentals']);
      assert.equal(new URL(snapshot.overview.attention[0].ours.href, 'https://test').searchParams.get('building'), building.id);
    } else assert.equal(snapshot.overview, undefined);
  }
});

test('transport reduction preserves the route read plan and complete authorised summaries', async () => {
  const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
  const { deriveInternalOverview, datesToReview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
  for (const role of ['admin', 'developer', 'sales_agent', 'conveyancer', 'contractor', 'developer_representative']) {
    const before = setup({ role, responseComposer: input => { const full = deriveDashboard(input); full.overview = deriveInternalOverview(input, full); return full; } });
    const after = setup({ role });
    const full = await (await before.get()).json(), reduced = await (await after.get()).json();
    assert.deepEqual(after.calls, before.calls, `${role}: no authentication/access or source reads removed`);
    assert.deepEqual(reduced.summaries, full.summaries);
    assert.deepEqual(reduced.overview, full.overview);
    assert.deepEqual(reduced.items, full.overview ? datesToReview(full) : full.items);
  }
});
