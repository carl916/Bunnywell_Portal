import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {sql,isolation} from '../backend-foundation/runtime.mjs';
import {loadTypescriptModule} from '../../tests/helpers/load-typescript-module.mjs';
if(process.env.WORKSPACE_REUSE_ISOLATION==='1'){
 const prior=JSON.parse(fs.readFileSync('tmp/backend-foundation/isolation-bunnywell-backend-foundation.json','utf8'));
 assert(prior.internalNetwork&&prior.publicTcpBlocked&&prior.loopbackPorts&&Date.now()-Date.parse(prior.checkedAt)<30*60000);
 console.log('Reusing unchanged local network isolation checked at '+prior.checkedAt);
}else{isolation();console.log('Local operations isolation verified');}
const cfg=JSON.parse(fs.readFileSync('backend-local/status.json','utf8').replace(/^\uFEFF/,'')),creds=JSON.parse(fs.readFileSync('backend-local/test-access.json')),local='http://127.0.0.1:55321',app='http://127.0.0.1:3037',hosted='https://mmwzhzziqvjbsphrkbqr.supabase.co';
assert.equal(cfg.API_URL,local);
let migration=fs.readFileSync('supabase/migrations/20261113140117_workspace_operations.sql','utf8');
migration=migration.replaceAll('create table workspace_commands.','create table if not exists workspace_commands.').replaceAll('create function ','create or replace function ');
migration=migration.replace("create policy \"exact visible workspace snag evidence\"", "drop policy if exists \"exact visible workspace snag evidence\" on storage.objects;\ncreate policy \"exact visible workspace snag evidence\"");
migration=migration.replace("array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);","array['image/jpeg','image/png','image/webp','video/mp4','video/webm']) on conflict(id) do nothing;");
sql(migration);sql("notify pgrst,'reload schema';");console.log('Local operations migration applied');
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:local,NEXT_PUBLIC_SUPABASE_ANON_KEY:cfg.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:cfg.SERVICE_ROLE_KEY,WORKSPACE_OPERATIONS_WRITES:'1'});
const nativeFetch=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert([local,hosted].includes(u.origin),'Blocked nonlocal rehearsal request');return nativeFetch(local+u.pathname+u.search,options)};
const staging=loadTypescriptModule('src/lib/workspace/staging.ts'),realGuard=loadTypescriptModule('src/lib/workspace/operations-fetch.ts').operationsFetch;
const guard=(actor,scope,service)=>async(input,options)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(u.origin,local);
 return realGuard(actor,scope,service)(hosted+u.pathname+u.search,options);
};
const overrides={'./staging':{...staging,stagingOrigin:local,hostedIntegration:false,optimizedReads:true,completionWritesEnabled:()=>true,coreSalesEnabled:()=>true,operationsWritesEnabled:()=>true},'./operations-fetch':{operationsFetch:guard}};
const {operationsBody,revision}=loadTypescriptModule('src/lib/workspace/operations.ts',{overrides}),{snagUpload}=loadTypescriptModule('src/lib/workspace/snag-upload.ts',{overrides}),server=loadTypescriptModule('src/lib/workspace/server.ts',{overrides});
const id=n=>'b1700000-0000-4000-8000-'+String(n).padStart(12,'0'),dev=id(901),tokens={},clients={};
async function login(alias,email,password){const c=createClient(local,cfg.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),r=await c.auth.signInWithPassword({email,password});assert.ifError(r.error);tokens[alias]=r.data.session.access_token;clients[alias]=c}
for(const alias of ['developer','agent']){const a=creds.accounts.find(a=>a.alias===alias);await login(alias,a.email,creds.password)}
const request=(alias,body)=>new Request(app+'/workspace/operations',{method:'POST',headers:{origin:app,Authorization:'Bearer '+tokens[alias],'Content-Type':'application/json'},body:JSON.stringify(body)});
const op=(action,targetId,payload={},requestId=randomUUID(),alias='developer')=>operationsBody(request(alias,{action,targetId,payload,requestId}));
const context=()=>operationsBody(request('developer',{action:'setup_context'}));
const building=randomUUID(),floor=randomUUID(),ground=randomUUID(),unit=randomUUID(),area=randomUUID(),type=randomUUID(),trade=randomUUID(),org=randomUUID(),repOrg=randomUUID(),contractor=randomUUID(),rep=randomUUID();
const changed={building,floor,ground,unit,area,type,trade,org,repOrg,contractor,rep};
const results=[];fs.mkdirSync('artifacts/hosted-operations',{recursive:true});
async function test(name,fn){try{await fn();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message});throw e}finally{console.log(results.at(-1));fs.writeFileSync('artifacts/hosted-operations/local-adapter-rehearsal.json',JSON.stringify({at:new Date().toISOString(),method:'Actual server adapters, local Auth/Postgres/private Storage; outbound traffic blocked. Not hosted-browser acceptance.',results,localRecords:changed,destinationBusinessRecordsChanged:[]},null,2)+'\n')}}
const setupRecord=async(kind,key)=>(await context())[kind].find(r=>r.id===key);
async function buildingData(){return server.buildingDetail(await server.viewer(request('developer',{})),building)}
await test('Setup requires developer role and never modifies imported reference configuration',async()=>{
 await assert.rejects(()=>operationsBody(request('agent',{action:'setup_context'})),/unavailable for this role/);
 await assert.rejects(()=>op('save_building',id(1),{name:'Forbidden'}),/reference records/);
 await assert.rejects(()=>op('set_person_status',id(904),{active:true}),/reference records/);
 await assert.rejects(()=>op('create_building',building,{name:'Fictional building'}),/Confirm this is fictional/);
 const req=randomUUID(),p={name:'Operations rehearsal '+building.slice(0,8),fictional:true,address:'Fictional address'};
 assert.deepEqual(await op('create_building',building,p,req),await op('create_building',building,p,req));
 await assert.rejects(()=>op('create_building',building,{...p,name:'Changed'},req),/reference conflicts/);
 assert.equal((await setupRecord('buildings',building)).allow_resident_access_requests,false);
});
await test('fictional organisations, types and trades persist with stale-edit protection',async()=>{
 await op('create_organisation',org,{name:'Fictional contractor',type:'contractor',email:'contractor@example.invalid',fictional:true});
 await op('create_organisation',repOrg,{name:'Fictional representative',type:'developer_representative',email:'rep@example.invalid',fictional:true});
 await assert.rejects(()=>op('create_organisation',randomUUID(),{name:'Bad email',type:'contractor',email:'someone@example.com',fictional:true}),/example.invalid/);
 await op('create_type',type,{name:'Test apartment '+type.slice(0,8),description:'Fictional',fictional:true});
 await op('create_trade',trade,{name:'Test carpentry '+trade.slice(0,8),sortOrder:1,active:true,fictional:true});
 const record=await setupRecord('trades',trade),req=randomUUID(),p={name:record.name,sortOrder:2,active:true,expected:record.updated_at};
 assert.deepEqual(await op('save_trade',trade,p,req),await op('save_trade',trade,p,req));
 await assert.rejects(()=>op('save_trade',trade,p),/changed/);
});
await test('floors, units, areas and baseline Sales enrollment are atomic',async()=>{
 await op('save_floor',floor,{buildingId:building,name:'First',sortOrder:1});
 await op('save_floor',ground,{buildingId:building,name:'Ground',sortOrder:0});
 const created=await op('save_unit',unit,{buildingId:building,number:'102',floor:'First',typeId:type,size:'58'});
 assert(created.saleAttemptId);changed.sale=created.saleAttemptId;
 assert.equal(sql("select count(*) from workspace_commands.test_journeys where sale_id='"+created.saleAttemptId+"'").trim(),'1');
 await op('save_area',area,{buildingId:building,unitId:unit,name:'Kitchen',type:'unit_room',sortOrder:0});
 await assert.rejects(async()=>op('delete_floor',floor,{buildingId:building,expected:(await buildingData()).floors.find(f=>f.id===floor).updated_at}),/Move this floor/);
 await assert.rejects(()=>op('save_floor',randomUUID(),{buildingId:building,name:' first ',sortOrder:3}),/already exists/);
 await assert.rejects(()=>op('save_unit',randomUUID(),{buildingId:building,number:'102',floor:'First',typeId:type,size:'58'}),/already exists/);
 const d=await buildingData();assert.equal(d.units.find(u=>u.id===unit).floor,'First');assert(d.defaultsRevision);
 await assert.rejects(()=>op('reorder_floors',building,{buildingId:building,ids:[floor,randomUUID()],expected:Object.fromEntries(d.floors.map(f=>[f.id,f.updated_at]))}),/belong|floor|order/i);
 const req=randomUUID(),payload={buildingId:building,ids:[floor,ground],expected:Object.fromEntries(d.floors.map(f=>[f.id,f.updated_at]))};
 assert.deepEqual(await op('reorder_floors',building,payload,req),await op('reorder_floors',building,payload,req));
 await assert.rejects(()=>op('reorder_floors',building,payload),/order changed/);
});
await test('Sales defaults replace schedule atomically and reject invalid percentages',async()=>{
 sql("insert into unit_sale_terms(sale_attempt_id,contract_price) values('"+changed.sale+"',100000)");
 const d=await buildingData(),form={buildCost:'50000',agentFeePercent:'2',exchangeAgentFeePercent:'1',completionAgentFeePercent:'1',reservationFee:'100',reservationFeeHolder:'sales_agent',exchangeDepositPercent:'10',secondDepositEnabled:true,secondDepositPercent:'5',months:'1',timing:{basis:'after_exchange',months:1}};
 await assert.rejects(()=>op('save_defaults',building,{buildingId:building,revision:d.defaultsRevision,form:{...form,exchangeAgentFeePercent:'3'}}),/equal the total/);
 const req=randomUUID(),p={buildingId:building,revision:d.defaultsRevision,form};
 assert.deepEqual(await op('save_defaults',building,p,req),await op('save_defaults',building,p,req));
 assert.equal(sql("select count(*) from building_sale_default_payment_schedule where building_id='"+building+"'").trim(),'3');
 await assert.rejects(()=>op('save_defaults',building,p),/changed/);
 assert.deepEqual(JSON.parse(sql("select jsonb_build_array(agent_fee_percent,exchange_agent_fee_percent,completion_agent_fee_percent) from unit_sale_terms where sale_attempt_id='"+changed.sale+"' and is_current").trim()),[2,1,1]);
});
await test('test account provisioning retries without email, and keeps access assignments scoped',async()=>{
 for(const [key,organisation,role]of[[contractor,org,'contractor'],[rep,repOrg,'developer_representative']]){
  const password=randomBytes(24).toString('base64url'),email='operations-'+key+'@example.invalid',req=randomUUID(),p={name:'Fictional '+role,email,password,role,organisationId:organisation,buildingIds:[building],fictional:true};
  assert.deepEqual(await op('create_test_user',key,p,req),await op('create_test_user',key,p,req));
  await assert.rejects(()=>op('create_test_user',key,{...p,password:password+'changed'},req),/reference conflicts/);
  await login(role,email,password);
 }
 const team=randomUUID();changed.team=team;
 await op('save_team',team,{buildingId:building,role:'main_contractor',organisationId:org});
 const team2=randomUUID();await op('save_team',team2,{buildingId:building,role:'developer_representative',organisationId:repOrg});
 const c=await setupRecord('people',contractor);assert.deepEqual(c.buildingIds,[building]);
 await assert.rejects(()=>op('save_person',contractor,{name:c.name,email:c.email,role:'contractor',organisationId:org,buildingIds:[id(1)],expected:c.updated_at}),/fictional test building/);
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const sc=(snag=null,b=building)=>({buildingId:b,snagId:snag});
const snagContext=(alias,snag=null,b=building)=>operationsBody(request(alias,{action:'snag_context',scope:sc(snag,b)}));
const snagAction=(alias,action,snag,payload,requestId=randomUUID(),b=building)=>operationsBody(request(alias,{action,scope:sc(snag,b),payload,requestId}));
const evidence=(alias,action,snag,payload,requestId=randomUUID(),bytes=png)=>{
 const form=new FormData();form.set('metadata',JSON.stringify({action,scope:sc(snag),payload,requestId}));form.set('file',new File([bytes],'fictional-snag.png',{type:'image/png'}));
 return snagUpload(new Request(app+'/workspace/snag-upload',{method:'POST',headers:{origin:app,Authorization:'Bearer '+tokens[alias]},body:form}));
};
let snag;
await test('snag creation includes private evidence and genuine activity exactly once',async()=>{
 const p={title:'Fictional kitchen handle',description:'Integration evidence only',unitId:unit,areaId:area,organisationId:org,tradeId:trade},req=randomUUID();
 await assert.rejects(()=>evidence('contractor','create_snag',null,p),/Developer snag creation/);
 const first=await evidence('developer_representative','create_snag',null,p,req);snag=first.id;changed.snag=snag;
 assert.deepEqual(await evidence('developer_representative','create_snag',null,p,req),first);
 await assert.rejects(()=>evidence('developer_representative','create_snag',null,p,req,Buffer.concat([png,Buffer.from('different')])),/reference conflicts|reference conflicts|submission reference conflicts/i);
 assert.equal(sql("select count(*) from snag_events where snag_id='"+snag+"' and event_type='created'").trim(),'1');
 assert.equal(sql("select count(*) from snag_photos where snag_id='"+snag+"'").trim(),'1');
 assert.equal(sql("select public from storage.buckets where id='workspace-snag-media'").trim(),'f');
 const c=await snagContext('contractor',snag);assert.equal(c.snag.title,p.title);
 const path=sql("select storage_path from snag_photos where snag_id='"+snag+"'").trim();
 const signed=await clients.contractor.storage.from('workspace-snag-media').createSignedUrl(path,60);assert.ifError(signed.error);
 const denied=await clients.agent.storage.from('workspace-snag-media').createSignedUrl(path,60);assert(denied.error);
});

await test('a failure after domain writes rolls back defaults, inherited terms, snag status and activity',async()=>{
 const req=randomUUID();
 sql(`begin;
 set local request.jwt.claims='{"role":"service_role"}';
 set local request.headers='{"x-bunnywell-audit-actor":"${dev}"}';
 create function public.workspace_rehearsal_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected write failure'; end $$;
 create trigger workspace_rehearsal_failure before insert on building_sale_default_payment_schedule for each row execute function public.workspace_rehearsal_failure();
 do $$ declare before_defaults jsonb;before_terms jsonb;before_schedule jsonb;begin
 select to_jsonb(d) into before_defaults from building_sale_defaults d where building_id='${building}';
 select jsonb_agg(to_jsonb(t)) into before_terms from unit_sale_terms t where sale_attempt_id='${changed.sale}';
 select jsonb_agg(to_jsonb(p)) into before_schedule from building_sale_default_payment_schedule p where building_id='${building}';
 begin
 perform workspace_setup_operation('${dev}','${req}','save_defaults','${building}',jsonb_build_object('buildingId','${building}','expectedDefaults',before_defaults,'defaults',before_defaults||'{"reservation_fee":333,"default_vat_rate":20,"default_sales_solicitor_fee":882}'::jsonb,'schedule','[{"sequenceNo":1,"paymentStage":"exchange","label":"Injected","dueOffsetDays":0,"percentOfContractPrice":10,"includesReservationFee":true}]'::jsonb));
 raise exception 'Expected failure missing';
 exception when raise_exception then if sqlerrm<>'Injected write failure' then raise;end if;end;
 if before_defaults is distinct from (select to_jsonb(d) from building_sale_defaults d where building_id='${building}')
 or before_terms is distinct from (select jsonb_agg(to_jsonb(t)) from unit_sale_terms t where sale_attempt_id='${changed.sale}')
 or before_schedule is distinct from (select jsonb_agg(to_jsonb(p)) from building_sale_default_payment_schedule p where building_id='${building}')
 or exists(select 1 from workspace_commands.operation_receipts where id='${req}') then raise exception 'Partial defaults persisted';end if;
 end $$;
 drop trigger workspace_rehearsal_failure on building_sale_default_payment_schedule;
 create trigger workspace_rehearsal_failure before insert on snag_photos for each row execute function public.workspace_rehearsal_failure();
 update workspace_commands.snag_media_intents set id='${req}',actor_id='${dev}',snag_id='${snag}',action='resolve_snag' where building_id='${building}' and action='create_snag';
 set local request.jwt.claims='{"role":"authenticated","sub":"${dev}"}';
 do $$ declare before_snag jsonb;events bigint;begin
 select to_jsonb(s) into before_snag from snags s where id='${snag}';
 select count(*) into events from snag_events where snag_id='${snag}';
 begin
 perform workspace_snag_operation('${building}','${snag}','${req}','resolve_snag',jsonb_build_object('expected',before_snag->>'updated_at','withMedia',true,'comment','Injected rollback verification'));
 raise exception 'Expected failure missing';
 exception when raise_exception then if sqlerrm<>'Injected write failure' then raise;end if;end;
 if before_snag is distinct from (select to_jsonb(s) from snags s where id='${snag}')
 or events<>(select count(*) from snag_events where snag_id='${snag}')
 or exists(select 1 from workspace_commands.operation_receipts where id='${req}') then raise exception 'Partial snag persisted';end if;
 end $$;
 rollback;`);
});

await test('wrong building, stale transition and wrong role cannot mutate a snag',async()=>{
 await assert.rejects(()=>snagContext('contractor',snag,id(2)),/Authorised|unavailable/);
 await assert.rejects(()=>snagAction('agent','close_snag',snag,{expected:new Date().toISOString()}),/Authorised/);
 await assert.rejects(()=>snagAction('contractor','close_snag',snag,{expected:new Date().toISOString()}),/developer review/i);
 await assert.rejects(()=>snagAction('contractor','resolve_snag',snag,{expected:'2000-01-01T00:00:00Z'}),/changed/);
 await assert.rejects(async()=>op('delete_area',area,{buildingId:building,expected:(await buildingData()).areas.find(a=>a.id===area).updated_at}),/snag history/);
});
await test('contractor query, developer answer, resolution, rejection and final close preserve activity',async()=>{
 let c=await snagContext('contractor',snag);
 const req=randomUUID(),p={expected:c.snag.updated_at,comment:'Fictional request for location detail'};
 assert.deepEqual(await snagAction('contractor','request_snag_info',snag,p,req),await snagAction('contractor','request_snag_info',snag,p,req));
 c=await snagContext('developer_representative',snag);assert.equal(c.snag.status,'needs_more_info');
 await snagAction('developer_representative','answer_snag_info',snag,{expected:c.snag.updated_at,comment:'Fictional location clarification'});
 c=await snagContext('contractor',snag);
 await evidence('contractor','resolve_snag',snag,{expected:c.snag.updated_at,comment:'Fictional first resolution'});
 c=await snagContext('developer_representative',snag);assert.equal(c.snag.status,'resolved_by_contractor');
 await snagAction('developer_representative','reject_snag',snag,{expected:c.snag.updated_at,comment:'Fictional inspection requests another adjustment'});
 c=await snagContext('contractor',snag);
 await snagAction('contractor','resolve_snag',snag,{expected:c.snag.updated_at,comment:'Fictional second resolution'});
 c=await snagContext('developer_representative',snag);
 await snagAction('developer_representative','close_snag',snag,{expected:c.snag.updated_at,comment:'Fictional inspection passed'});
 assert.equal((await snagContext('contractor',snag)).snag.status,'closed');
 assert.equal(sql("select count(*) from snag_events where snag_id='"+snag+"' and event_type='status_change'").trim(),'6');
 const note=randomUUID(),body={comment:'Fictional retained note after inspection'};assert.deepEqual(await snagAction('developer','snag_comment',snag,body,note),await snagAction('developer','snag_comment',snag,body,note));
});
await test('deactivating only a designated test person denies the existing app session',async()=>{
 const c=await setupRecord('people',contractor);
 await op('set_person_status',contractor,{active:false,expected:c.updated_at});
 await assert.rejects(()=>snagContext('contractor',snag),/access unavailable|cannot open/i);
 const next=await setupRecord('people',contractor);await op('set_person_status',contractor,{active:true,expected:next.updated_at});
 assert.equal((await snagContext('contractor',snag)).snag.status,'closed');
});
for(const c of Object.values(clients))await c.auth.signOut();


