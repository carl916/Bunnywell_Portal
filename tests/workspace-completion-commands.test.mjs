import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {allowedCompletionRequest:allowed}=loadTypescriptModule('src/lib/workspace/command-fetch.ts');
const {completionWritesEnabled}=loadTypescriptModule('src/lib/workspace/staging.ts');
const scope={buildingId:'35de5f9d-3217-4a11-beaf-83519bda9e5b',unitId:'5c874786-7b78-4f35-a430-a39130563979',saleId:'9c584a87-a447-4869-8e02-53215a3d9373'},actor='b1700000-0000-4000-8000-000000000907',origin='https://mmwzhzziqvjbsphrkbqr.supabase.co';
const body={p_sale:scope.saleId,p_actor:actor,p_action:'begin'};
test('only the isolated integration with an explicit write capability enables Completion',()=>{
const env={NEXT_PUBLIC_WORKSPACE_INTEGRATION:'1',NEXT_PUBLIC_SUPABASE_URL:origin,WORKSPACE_HOSTED_READS:'1',WORKSPACE_READ_GUARD:'1',WORKSPACE_COMPLETION_WRITES:'1',SUPABASE_SERVICE_ROLE_KEY:'test'};
assert(completionWritesEnabled(env));for(const delta of [{WORKSPACE_COMPLETION_WRITES:'0'},{SUPABASE_SERVICE_ROLE_KEY:''},{NEXT_PUBLIC_SUPABASE_URL:'https://vxkpvdtrldwwqiddoyof.supabase.co'},{VERCEL:'1',VERCEL_PROJECT_ID:'wrong'}])assert.equal(completionWritesEnabled({...env,...delta}),false);
});
test('command fetch confines service RPCs to verified actor and exact sale',()=>{
const url=origin+'/rest/v1/rpc/sales_completion_upload_session';assert(allowed(url,'POST',body,scope,actor));
for(const delta of [{p_sale:scope.unitId},{p_actor:scope.unitId},{p_action:'cleanup'}])assert.equal(allowed(url,'POST',{...body,...delta},scope,actor),false);
for(const action of ['confirm_completion','send','confirm_exchange','record_agent_fee_payment'])assert.equal(allowed(origin+'/rest/v1/rpc/sales_legal_action','POST',{...body,p_action:action},scope,actor),false);
assert(allowed(origin+'/rest/v1/rpc/sales_legal_action','POST',{...body,p_action:'approve_completion_document'},scope,actor));
});
test('no bulk bucket operations, table writes, arbitrary files or external fetches',()=>{
const file=scope.buildingId+'/'+scope.saleId+'/completion-b1700000-0000-4000-8000-000000000999/completion_statement.pdf';
assert(allowed(origin+'/storage/v1/object/upload/sign/completion-uploads/'+file,'POST',{},scope,actor));
assert(allowed(origin+'/storage/v1/object/info/sale-documents/'+file,'GET',undefined,scope,actor));
assert(allowed(origin+'/storage/v1/object/copy','POST',{bucketId:'completion-uploads',destinationBucket:'sale-documents',sourceKey:file,destinationKey:file},scope,actor));
for(const url of [origin+'/rest/v1/units',origin+'/storage/v1/object/list/sale-documents',origin+'/storage/v1/object/upload/sign/sale-documents/'+file,origin+'/storage/v1/object/upload/sign/completion-uploads/'+file.replace(scope.saleId,scope.unitId),'https://api.resend.com/emails','https://vxkpvdtrldwwqiddoyof.supabase.co/rest/v1/rpc/sales_completion_upload_session'])assert.equal(allowed(url,'POST',body,scope,actor),false);
assert.equal(allowed(origin+'/storage/v1/object/copy','POST',{bucketId:'completion-uploads',destinationBucket:'sale-documents',sourceKey:file,destinationKey:file+'extra'},scope,actor),false);
});
test('comment write is confined to the exact sale with no mentions or edits',()=>{
const url=origin+'/rest/v1/rpc/sale_comment_write';assert(allowed(url,'POST',{p_sale:scope.saleId,p_mentions:[]},scope,actor));
for(const delta of [{p_mentions:[actor]},{p_comment:actor},{p_parent:actor},{p_sale:scope.unitId}])assert.equal(allowed(url,'POST',{p_sale:scope.saleId,p_mentions:[],...delta},scope,actor),false);
});
