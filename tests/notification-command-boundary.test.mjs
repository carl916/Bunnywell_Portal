import test from 'node:test';import assert from 'node:assert/strict';import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {allowedCompletionRequest:allowed}=loadTypescriptModule('./src/lib/workspace/command-fetch.ts',{'./staging':{stagingProject:'vxkpvdtrldwwqiddoyof'}});
const scope={buildingId:crypto.randomUUID(),unitId:crypto.randomUUID(),saleId:crypto.randomUUID()},actor=crypto.randomUUID(),person=crypto.randomUUID(),url='https://vxkpvdtrldwwqiddoyof.supabase.co/rest/v1/rpc/';
test('mention writes and eligible-people reads retain narrow sale and egress boundaries',()=>{
 const body={p_sale:scope.saleId,p_mentions:[person]};assert(allowed(url+'sale_comment_write','POST',body,scope,actor));assert(allowed(url+'sale_comment_write','POST',{...body,p_mentions:[]},scope,actor));
 for(const mentions of [[person,person],['not-a-uuid'],Array.from({length:26},()=>crypto.randomUUID()),null])assert(!allowed(url+'sale_comment_write','POST',{...body,p_mentions:mentions},scope,actor));
 assert(!allowed(url+'sale_comment_write','POST',{...body,p_sale:crypto.randomUUID()},scope,actor));assert(!allowed('https://example.invalid/rest/v1/rpc/sale_comment_write','POST',body,scope,actor));assert(!allowed(url+'sale_comment_write','POST',{...body,p_comment:crypto.randomUUID()},scope,actor));
 assert(allowed(url+'sale_discussion_people','POST',{p_sale:scope.saleId},scope,actor));assert(!allowed(url+'sale_discussion_people','POST',{p_sale:scope.saleId,p_candidates:true},scope,actor));assert(!allowed(url+'sale_discussion_people','GET',{p_sale:scope.saleId},scope,actor));
});
