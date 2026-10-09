import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { building, unit, sale } from './helpers/dashboard-fixture.mjs';

function setup({role='conveyancer',active=true,failSource='',changingProfile=false,changingAccess=false,authFailure=false,incompleteSource='',failAfterPage=''}={}) {
  const calls=[];let profileReads=0,accessReads=0;
  const profile={id:'viewer',role,organisation_id:'legal-org',active};
  const tables={profiles:[profile],buildings:[building],units:[unit],building_floors:[],organisations:[],building_organisations:[],user_building_access:[{id:'access',user_id:'viewer',building_id:building.id}],unit_sale_attempts:[sale],unit_sale_documents:[],sale_legal_emails:[]};
  const client={auth:{getUser:async()=>({data:{user:authFailure?null:{id:'viewer'}},error:authFailure?{message:'expired'}:null})},from(table){
    let rows=[...(tables[table]??[])],single=false,start=0,end=Infinity;
    const call={table};calls.push(call);
    const q={select(columns){call.columns=columns;return q;},order(){return q;},range(a,b){start=a;end=b;return q;},limit(){return q;},not(){return q;},is(key){rows=rows.filter(r=>r[key]==null);return q;},in(key,ids){if(!key.includes('.'))rows=rows.filter(r=>ids.includes(r[key]));return q;},eq(key,val){if(!key.includes('.'))rows=rows.filter(r=>r[key]===val);return q;},single(){single=true;return q;},then(resolve){
      if(table==='profiles'&&changingProfile&&++profileReads>1)rows=[{...profile,active:false}];
      if(table==='user_building_access'&&changingAccess&&++accessReads>1)rows=[];
      return Promise.resolve({data:single?rows[0]:table===incompleteSource&&start>0?[]:rows.slice(start,end+1),count:rows.length,error:table===failSource||table===failAfterPage&&start>0?{message:'PRIVATE ERROR'}:null}).then(resolve);
    }};return q;
  },rpc(){throw new Error('Register must not load activity or actors');}};
  const route=loadTypescriptModule('src/app/api/sales/register/route.ts',{overrides:{'@supabase/supabase-js':{createClient:(url,key,options)=>{assert.equal(key,'public-test-key');assert.equal(options.global.headers.Authorization,'Bearer synthetic');return client;}},'@/lib/supabase/admin':{requiredEnv:key=>key==='NEXT_PUBLIC_SUPABASE_ANON_KEY'?'public-test-key':'https://synthetic.invalid'}}});
  return {calls,tables,get:(query='building=all',signed=true)=>route.GET(new Request(`http://local/api/sales/register?${query}`,{headers:signed?{authorization:'Bearer synthetic'}:{}}))};
}
test('register authenticates and enforces its role before reading any sale data',async()=>{
  const unsigned=setup();assert.equal((await unsigned.get('building=all',false)).status,401);assert.equal(unsigned.calls.length,0);
  for(const role of ['resident','user','sales_agent','developer','admin']){const f=setup({role});assert.equal((await f.get()).status,403);assert.deepEqual(f.calls.map(c=>c.table),['profiles']);}
  assert.equal((await setup({active:false}).get()).status,403);
});
test('no scope or organisation request parameter can grant access',async()=>{
  const f=setup();for(const query of ['building=bad','building=all&organisation=legal-org','building=all&unit=other'])assert.equal((await f.get(query)).status,400);
  assert.equal((await f.get('building=10000000-0000-4000-8000-000000000099')).status,403);assert.ok(!f.calls.some(c=>c.table==='unit_sale_attempts'));
});
test('register reads complete scoped compact sources and returns private nonfinancial data',async()=>{
  const f=setup();f.tables.unit_sale_attempts[0]={...sale,forecastRevenue:998877,net_proceeds:998877};
  const response=await f.get();assert.equal(response.status,200);assert.equal(response.headers.get('vary'),'Authorization');assert.match(response.headers.get('cache-control'),/private, no-store/);
  const result=await response.json();assert.equal(result.rows.length,1);assert.doesNotMatch(JSON.stringify(result),/998877|net_proceeds|forecastRevenue|summaries|activity/);
  assert.match(f.calls.find(c=>c.table==='buildings').columns,/conveyancer_organisation_id/);
  for(const c of f.calls){assert.notEqual(c.columns,'*');assert.doesNotMatch(c.table,/invoices|payments|terms|defaults|snags|tenancies|history|workflow_events|deposit|access_requests/);}
});
test('authorised inventory remains complete beyond server row limits',async()=>{
  const f=setup();f.tables.units=Array.from({length:601},(_,i)=>({...unit,id:`unit${i}`,unit_number:String(i)}));
  const result=await (await f.get()).json();assert.equal(result.rows.length,601);assert.equal(f.calls.filter(c=>c.table==='units').length,3);
});
test('source failure retains readable units but marks actions unavailable',async()=>{
  for(const failSource of ['unit_sale_attempts','sale_legal_emails','unit_sale_documents']){
    const result=await (await setup({failSource}).get()).json();assert.equal(result.rows.length,1);assert.equal(result.actionsAvailable,false);assert.equal(result.rows[0].neutral,'Next steps unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
});
test('identity/access changes during the read reject the full result',async()=>{
  assert.equal((await setup({changingProfile:true}).get()).status,403);assert.equal((await setup({changingAccess:true}).get()).status,403);
});

test('expired authentication stops before profile or scoped data reads',async()=>{
  const f=setup({authFailure:true});assert.equal((await f.get()).status,401);assert.deepEqual(f.calls,[]);
});

test('failed required dimensions and access reads cannot publish a successful register',async()=>{
  for(const failSource of ['buildings','units','building_floors','organisations','building_organisations','user_building_access','user_unit_access']){
    const response=await setup({failSource}).get();assert.equal(response.status,503,failSource);
    assert.doesNotMatch(JSON.stringify(await response.json()),/PRIVATE|rows/);
  }
});

test('All buildings and single-building reads preserve scope and complete batched legal progression',async()=>{
  const f=setup(),second={...building,id:'10000000-0000-4000-8000-000000000002',name:'Second House'};
  f.tables.buildings.push(second);
  f.tables.organisations=[{id:'legal-org',name:'Legal Team'}];
  f.tables.units=Array.from({length:601},(_,i)=>({...unit,id:`unit-${i}`,building_id:i%2?second.id:building.id,unit_number:String(i+1)}));
  f.tables.unit_sale_attempts=f.tables.units.map((u,i)=>({...sale,id:`sale-${i}`,unit_id:u.id,building_id:u.building_id}));
  f.tables.unit_sale_documents=f.tables.unit_sale_attempts.flatMap(s=>['completion_statement','draft_statement_of_account'].map(type=>({id:`${s.id}-${type}`,sale_attempt_id:s.id,document_type:type,status:'uploaded',unit_sale_document_versions:[]})));
  const all=await (await f.get()).json();assert.equal(all.rows.length,601);assert.equal(all.actionsAvailable,true);
  assert.equal(f.calls.filter(c=>c.table==='unit_sale_attempts').length,3);
  assert.equal(f.calls.filter(c=>c.table==='sale_legal_emails').length,5);
  assert.equal(f.calls.filter(c=>c.table==='unit_sale_documents').length,9);
  const scoped=await (await f.get(`building=${building.id}`)).json();
  assert.deepEqual(scoped.rows,all.rows.filter(r=>r.buildingId===building.id));
  assert.equal(scoped.rows.length,301);assert.ok(scoped.rows.every(r=>r.actions.length&&r.keyDate));
});

test('incomplete or failed later sales pages never publish authoritative workflow actions',async()=>{
  for(const option of ['incompleteSource','failAfterPage']){
    const f=setup({[option]:'unit_sale_attempts'});
    f.tables.unit_sale_attempts=Array.from({length:251},(_,i)=>({...sale,id:`sale-${i}`}));
    const response=await f.get();assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.actionsAvailable,false);assert.ok(result.rows.every(r=>!r.actions.length));
    assert.ok(!f.calls.some(c=>c.table==='sale_legal_emails'||c.table==='unit_sale_documents'));
  }
});
