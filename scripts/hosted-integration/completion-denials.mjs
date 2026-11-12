import fs from 'node:fs';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';import {origin,keys,privateDir,api} from './runtime.mjs';
const credentials=JSON.parse(fs.readFileSync(privateDir+'/test-access.json','utf8'));
const scope={buildingId:'35de5f9d-3217-4a11-beaf-83519bda9e5b',unitId:'5c874786-7b78-4f35-a430-a39130563979',saleId:'9c584a87-a447-4869-8e02-53215a3d9373'};
const results=[];async function test(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}console.log(results.at(-1));}
const tokens={};
for(const alias of ['developer','conveyancer','agent-single','inactive']){
 const account=credentials.accounts.find(a=>a.alias===alias);assert(account);
 const client=createClient(origin,keys().anon,{auth:{persistSession:false,autoRefreshToken:false}});const r=await client.auth.signInWithPassword({email:account.email,password:account.password});assert.ifError(r.error);tokens[alias]=r.data.session.access_token;
}
const local='http://127.0.0.1:3037';
async function denied(alias,action,extra={},headers={}){
 const r=await fetch(local+'/workspace/command',{method:'POST',redirect:'error',headers:{Origin:local,Authorization:'Bearer '+tokens[alias],'Content-Type':'application/json',...headers},body:JSON.stringify({scope,action,...extra})});
 assert.equal(r.status,403,await r.text());
}
await test('active available Priors unit cannot skip exchange and completion arrangements',()=>denied('conveyancer','prepare_completion_upload',{requestId:crypto.randomUUID(),files:[]}));
await test('wrong-building membership denied for exact Priors record',()=>denied('agent-single','comment',{body:'Must never be saved',clientId:crypto.randomUUID()}));
await test('inactive profile denied',()=>denied('inactive','comment',{body:'Must never be saved',clientId:crypto.randomUUID()}));
await test('mismatched building unit sale scope denied',()=>denied('developer','comment',{scope:{...scope,buildingId:'e120ef73-a720-4a25-ab99-362f21612118'},body:'Must never be saved',clientId:crypto.randomUUID()}));
await test('cross-origin command denied',()=>denied('developer','comment',{}, {Origin:'https://example.com'}));
for(const action of ['send','confirm_completion','confirm_exchange','record_agent_fee_payment','save_reservation'])await test('unconnected action rejected: '+action,()=>denied('developer',action));
for(const alias of ['developer','conveyancer'])for(const rpc of ['sales_completion_upload','sales_completion_upload_session','sales_legal_action','sales_legal_action_before_notice']){
 await test(alias+' cannot call server-only '+rpc,async()=>{
  const account=credentials.accounts.find(a=>a.alias===alias);
  const body=rpc==='sales_completion_upload'?{p_sale:scope.saleId,p_actor:account.id,p_request:crypto.randomUUID(),p_files:[]}:
   rpc==='sales_completion_upload_session'?{p_sale:scope.saleId,p_actor:account.id,p_request:crypto.randomUUID(),p_action:'begin',p_files:[]}:
   {p_sale:scope.saleId,p_actor:account.id,p_action:'query_completion_document',p_payload:{}};
  const r=await api('/rest/v1/rpc/'+rpc,{method:'POST',token:tokens[alias],body});assert.equal(r.status,403,await r.text());
 });
}
const evidence={at:new Date().toISOString(),environment:origin,method:'Local production HTTP route with genuine integration Auth/Postgres; not hosted-browser acceptance',changedBusinessRecords:[],results};
fs.mkdirSync('artifacts/hosted-completion',{recursive:true});fs.writeFileSync('artifacts/hosted-completion/command-denials.json',JSON.stringify(evidence,null,2)+'\n');
for(const token of Object.values(tokens))await api('/auth/v1/logout',{method:'POST',token});
process.exitCode=results.some(r=>!r.passed)?1:0;
