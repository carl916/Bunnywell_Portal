import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {isolation,sql} from './runtime.mjs';
const origin='http://127.0.0.1:55321',read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
isolation();const cfg=read('backend-local/status.json'),creds=read('backend-local/test-access.json');assert.equal(cfg.API_URL,origin);
const id=n=>'b1700000-0000-4000-8000-'+String(n).padStart(12,'0');
const results=[];async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
async function request(path,token=cfg.SERVICE_ROLE_KEY,method='GET',body,type='application/json'){
 const r=await fetch(origin+path,{method,headers:{apikey:cfg.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':type},body:body==null?undefined:type==='application/json'?JSON.stringify(body):body,signal:AbortSignal.timeout(15000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return{status:r.status,data};
}
for(const a of [{alias:'resident',id:id(920),role:'resident'},{alias:'representative',id:id(921),role:'developer_representative'}]){
 a.email='foundation-'+a.alias+'@example.invalid';if(!creds.accounts.some(x=>x.id===a.id)){
 const r=await request('/auth/v1/admin/users',undefined,'POST',{id:a.id,email:a.email,password:creds.password,email_confirm:true});assert.equal(r.status,200,JSON.stringify(r.data));creds.accounts.push(a);fs.writeFileSync('backend-local/test-access.json',JSON.stringify(creds,null,2));
 }
 sql(`update public.profiles set role='${a.role}',active=true where id='${a.id}';`);
}
const units=JSON.parse(sql(`select json_agg(u) from (select id,building_id,unit_number from units order by building_id,unit_number) u;`).trim());
const one=units.find(u=>u.building_id===id(1)),other=units.find(u=>u.building_id===id(2));
sql(`begin;set local request.jwt.claims='{"role":"service_role"}';
update buildings set pc_confirmed=true,pc_date=current_date-10 where id='${id(1)}';
insert into user_unit_access(user_id,unit_id,access_type) values('${id(920)}','${one.id}','leaseholder') on conflict do nothing;
insert into user_building_access(user_id,building_id,role_on_building) values('${id(921)}','${id(1)}','developer_representative') on conflict do nothing;
insert into areas(id,building_id,unit_id,area_type,name) values('${id(8001)}','${id(1)}','${one.id}','unit_room','Test kitchen'),('${id(8002)}','${id(2)}','${other.id}','unit_room','Other kitchen'),('${id(8003)}','${id(1)}',null,'communal_area','Test lobby') on conflict(id) do nothing;
commit;`);
const tokens={};for(const a of creds.accounts){const r=await request('/auth/v1/token?grant_type=password',cfg.ANON_KEY,'POST',{email:a.email,password:creds.password});assert.equal(r.status,200,'Sign-in '+a.alias);tokens[a.alias]=r.data.access_token;}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=','base64');
async function upload(alias,path,allow){const r=await request('/storage/v1/object/snag-images/'+path,tokens[alias]||cfg.ANON_KEY,'POST',png,'image/png');assert.equal(r.status<300,allow,alias+' '+JSON.stringify(r.data));return path;}
for(const role of ['developer','representative'])await check(role+' can upload a scoped developer snag photo',()=>upload(role,`snags/${id(1)}/${one.id}/${randomUUID()}.png`,true));
await check('representative cross-building upload denied',()=>upload('representative',`snags/${id(2)}/${other.id}/${randomUUID()}.png`,false));
await check('resident own-unit upload permitted',()=>upload('resident',`defects/${id(1)}/${one.id}/${randomUUID()}.png`,true));
await check('resident other-unit upload denied',()=>upload('resident',`defects/${id(2)}/${other.id}/${randomUUID()}.png`,false));
for(const role of ['agent','inactive','conveyancer','anonymous'])await check(role+' unrelated upload denied',()=>upload(role,`snags/${id(1)}/${one.id}/${randomUUID()}.png`,false));
await check('unscoped legacy upload denied',()=>upload('developer',`snags/${randomUUID()}.png`,false));
await check('sensitive handover path rejected by public snag bucket',()=>upload('developer',`handover-signatures/${randomUUID()}.png`,false));
await check('existing public photo reading retained',async()=>{let path=await upload('developer',`snags/${id(1)}/communal/${randomUUID()}.png`,true);let r=await fetch(origin+'/storage/v1/object/public/snag-images/'+path);assert.equal(r.status,200);});
await check('resident correct room insert succeeds',async()=>{const r=await request('/rest/v1/snags',tokens.resident,'POST',{building_id:id(1),unit_id:one.id,area_id:id(8001),source_type:'leaseholder_defect',title:'Synthetic resident test',status:'open',created_by_user_id:id(920)});assert.equal(r.status,201,JSON.stringify(r.data));});
await check('resident wrong building room denied',async()=>{const r=await request('/rest/v1/snags',tokens.resident,'POST',{building_id:id(1),unit_id:one.id,area_id:id(8002),source_type:'leaseholder_defect',title:'Must be denied',status:'open',created_by_user_id:id(920)});assert.ok(r.status>=400,JSON.stringify(r));});
await check('resident communal room denied',async()=>{const r=await request('/rest/v1/snags',tokens.resident,'POST',{building_id:id(1),unit_id:one.id,area_id:id(8003),source_type:'leaseholder_defect',title:'Must be denied',status:'open',created_by_user_id:id(920)});assert.ok(r.status>=400);});
const report=`reports/${id(1)}/${randomUUID()}.pdf`;await request('/storage/v1/object/snag-reports/'+report,undefined,'POST',Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'),'application/pdf');
for(const [role,allowed]of [['developer',true],['representative',true],['resident',false],['agent',false],['restricted',true],['inactive',false]])await check(role+' private report '+(allowed?'allowed':'denied'),async()=>{const r=await request('/storage/v1/object/authenticated/snag-reports/'+report,tokens[role]);assert.equal(r.status<300,allowed,JSON.stringify(r.data));});
await check('contractor cannot read another building report',async()=>{const path=`reports/${id(2)}/${randomUUID()}.pdf`;await request('/storage/v1/object/snag-reports/'+path,undefined,'POST',Buffer.from('%PDF-1.4 synthetic'),'application/pdf');const r=await request('/storage/v1/object/authenticated/snag-reports/'+path,tokens.restricted);assert.ok(r.status>=400);});
const commercial={p_unit_id:one.id,p_requester_id:id(901),p_list_price_at_offer:100,p_contract_price:100,p_parking_value:0,p_developer_contribution:0,p_agent_contribution:0,p_reservation_fee:0,p_reservation_fee_holder:'developer',p_agent_fee_percent:1,p_vat_rate:20,p_solicitor_fee:0,p_exchange_deposit_percent:10,p_second_deposit_enabled:false,p_second_deposit_percent:0,p_second_deposit_months_after_exchange:0,p_completion_balance_percent:90,p_deposit_summary:'',p_commercial_summary:'',p_payment_schedule:[],p_developer_contribution_value:0,p_developer_contribution_value_type:'amount',p_agent_contribution_value:0,p_agent_contribution_value_type:'amount',p_parking_contribution_value:0,p_parking_location_details:null,p_additional_special_conditions:[]};
for(const role of ['anonymous','resident','conveyancer','developer'])await check(role+' direct commercial RPC denied',async()=>{const r=await request('/rest/v1/rpc/save_unit_commercial_model',tokens[role]||cfg.ANON_KEY,'POST',commercial);assert.ok([401,403].includes(r.status),JSON.stringify(r));assert.notEqual(r.data.code,'PGRST203','Ambiguity is not permission proof');});
await check('all commercial overloads lack anon/auth EXECUTE',()=>{const count=sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'save_unit_commercial_model%' and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'));").trim();assert.equal(count,'0');});
fs.mkdirSync('artifacts/backend-foundation',{recursive:true});fs.writeFileSync('artifacts/backend-foundation/security-tests.json',JSON.stringify({at:new Date().toISOString(),environment:'bunnywell-backend-foundation',authenticatedSessions:true,results},null,2));console.log(JSON.stringify(results,null,2));process.exitCode=results.some(r=>!r.passed)?1:0;
