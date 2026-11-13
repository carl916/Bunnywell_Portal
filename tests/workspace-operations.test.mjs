import test from 'node:test';import assert from 'node:assert/strict';import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {operationsFetch}=loadTypescriptModule('src/lib/workspace/operations-fetch.ts');
const {operationsWritesEnabled}=loadTypescriptModule('src/lib/workspace/staging.ts');
const {proxy}=loadTypescriptModule('src/proxy.ts',{overrides:{'./lib/workspace/staging':{hostedIntegration:true,stagingEnabled:()=>true,completionWritesEnabled:()=>true,coreSalesEnabled:()=>true,operationsWritesEnabled:()=>true,stagingOrigin:'https://mmwzhzziqvjbsphrkbqr.supabase.co',integrationProject:'mmwzhzziqvjbsphrkbqr'}}});
const origin='https://mmwzhzziqvjbsphrkbqr.supabase.co', actor='a',scope={buildingId:'b',snagId:'s'};
test('operational writes require all isolation flags and the exact Vercel project',()=>{
 const env={NODE_ENV:'production',NEXT_PUBLIC_WORKSPACE_INTEGRATION:'1',NEXT_PUBLIC_SUPABASE_URL:origin,WORKSPACE_HOSTED_READS:'1',WORKSPACE_READ_GUARD:'1',WORKSPACE_COMPLETION_WRITES:'1',WORKSPACE_CORE_SALES_WRITES:'1',WORKSPACE_OPERATIONS_WRITES:'1',SUPABASE_SERVICE_ROLE_KEY:'test-only',VERCEL:'1',VERCEL_PROJECT_ID:'prj_YMaQDDgEtACwTijrmmh1SxQwsfe5'};
 assert(operationsWritesEnabled(env));for(const key of ['WORKSPACE_OPERATIONS_WRITES','WORKSPACE_CORE_SALES_WRITES','WORKSPACE_COMPLETION_WRITES'])assert.equal(operationsWritesEnabled({...env,[key]:'0'}),false);
 assert.equal(operationsWritesEnabled({...env,VERCEL_PROJECT_ID:'wrong'}),false);
});
test('operations transport rejects foreign scopes, origins, invites, account lists and mutable storage',async()=>{
 const call=(f,path,body,method='POST')=>f(path.startsWith('http')?path:origin+path,{method,body:JSON.stringify(body)});
 const user=operationsFetch(actor,scope),admin=operationsFetch(actor,{},true),auth=operationsFetch(actor,{accountId:'id',email:'test@example.invalid',requestId:'request'},true),media=operationsFetch(actor,{mediaPath:'b/request/evidence.png'},true);
 for(const [f,path,body,method]of[
 [user,'https://vxkpvdtrldwwqiddoyof.supabase.co/rest/v1/rpc/workspace_snag_operation',{}],
 [user,'/rest/v1/rpc/workspace_snag_operation',{p_building:'wrong',p_snag:'s'}],
 [user,'/rest/v1/rpc/workspace_snag_operation',{p_building:'b',p_snag:'wrong'}],
 [user,'/rest/v1/rpc/workspace_setup_operation',{p_actor:actor}],
 [admin,'/rest/v1/rpc/workspace_setup_operation',{p_actor:'wrong'}],
 [auth,'/auth/v1/admin/users',{},'GET'],[auth,'/auth/v1/invite',{email:'test@example.invalid'}],
 [auth,'/auth/v1/admin/users/id',{},'PUT'],
 [auth,'/auth/v1/admin/users',{id:'wrong',email:'test@example.invalid',email_confirm:true,app_metadata:{workspace_test_request:'request'}}],
 [media,'/storage/v1/object/workspace-snag-media/b/other/evidence.png',{}],
 [media,'/storage/v1/object/workspace-snag-media/b/request/evidence.png',{},'DELETE']
 ])await assert.rejects(()=>call(f,path,body,method),/rejected/);
});
test('proxy exposes only the selected workspace writes and blocks legacy delivery endpoints',()=>{
 for(const path of ['/workspace/operations','/workspace/snag-upload'])assert.notEqual(proxy({method:'POST',nextUrl:{pathname:path},url:'https://review.test'+path}).status,403);
 for(const path of ['/api/admin/users','/api/snag-reports/send','/api/cron/snag-digest','/api/sales/reservations'])assert.equal(proxy({method:'POST',nextUrl:{pathname:path},url:'https://review.test'+path}).status,403);
});

