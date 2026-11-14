import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';

const scope={buildingId:'b1700000-0000-4000-8000-000000000001',unitId:'b1700000-0000-4000-8000-000000000100',saleId:'b1700000-0000-4000-8000-000000001100'};
const actor='b1700000-0000-4000-8000-000000000901',requestId='b1700000-0000-4000-8000-000000009999';
class ReadError extends Error {constructor(message,status=403){super(message);this.status=status;}}
function fixture({enrolled=false,role='developer',exchanged=true,denied=false}={}){
 const state={enrolled},calls=[],sale={workflow_status:exchanged?'exchanged':'approved',exchanged_at:exchanged?'2026-11-01':null,legal_completed_at:null};
 const {coreCommand}=loadTypescriptModule('src/lib/workspace/core-commands.ts',{overrides:{
  './staging':{coreSalesEnabled:()=>true},
  './server':{completion:async()=>{if(denied)throw new ReadError('Exact sale denied');return {sale}},check:async()=>{},ReadError},
  './reads':{rows:async(_c,table)=>table==='unit_sale_attempts'?[sale]:[]},
  '@/lib/sales/legal-email':{renderLegalEmailContent:()=>({body:'Fictional authority',html:'<p>Fictional authority</p>'})},
  '@/lib/sales/legal-workflow':{renderLegalEmail:()=>({subject:'Fictional authority'})},
  '@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>({rpc:async(name,args)=>{
   calls.push({name,args});if(name==='workspace_sale_test_context')return {data:{enrolled:state.enrolled}};
   if(name==='sales_legal_snapshot')return {data:{fictional:true}};
   if(name==='workspace_capture_legal_email')return {data:{emailId:args.p_request,deliveryStatus:'captured_test',sent:false}};
   throw Error('Unexpected RPC '+name);
  }})}
 }});
 return {state,calls,run:p=>coreCommand({profile:{id:actor,role}},p,scope)};
}

test('core context reports exact-scope enrollment and denies inaccessible records before privileged reads',async()=>{
 for(const enrolled of [false,true]){const f=fixture({enrolled}),result=await f.run({action:'core_context'});assert.equal(result.enrolled,enrolled);assert.deepEqual(f.calls[0].args,{p_sale:scope.saleId,p_actor:actor,p_building:scope.buildingId,p_unit:scope.unitId});}
 const denied=fixture({denied:true,enrolled:true});await assert.rejects(denied.run({action:'core_context'}),/Exact sale denied/);assert.equal(denied.calls.length,0);
});

test('protected exchange and notice sales cannot obtain a capture preview or invoke the legal snapshot',async()=>{
 for(const exchanged of [false,true]){const f=fixture({exchanged});await assert.rejects(f.run({action:'preview_capture',kind:exchanged?'notice_authority':'authority'}),e=>e.status===403&&/read-only in integration/.test(e.message));assert.deepEqual(f.calls.map(c=>c.name),['workspace_sale_test_context']);}
});

test('enrolled notice capture works, but removing enrollment invalidates an already signed preview',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-test-signing-key';
 try{
  const f=fixture({enrolled:true}),preview=await f.run({action:'preview_capture',kind:'notice_authority'});
  assert.match(preview.email.subject,/INTEGRATION TEST/);assert.match(preview.email.body,/no external delivery/);
  const result=await f.run({action:'capture_authority',requestId,preview});assert.equal(result.sent,false);
  f.state.enrolled=false;const writes=f.calls.filter(c=>c.name==='workspace_capture_legal_email').length;
  await assert.rejects(f.run({action:'capture_authority',requestId,preview}),e=>e.status===403&&/read-only/.test(e.message));
  assert.equal(f.calls.filter(c=>c.name==='workspace_capture_legal_email').length,writes);
 }finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});

test('enrollment does not grant a conveyancer developer authority privileges',async()=>{
 const f=fixture({enrolled:true,role:'conveyancer'});await assert.rejects(f.run({action:'preview_capture',kind:'notice_authority'}),/Only developer reviewers/);assert.equal(f.calls.length,0);
});
