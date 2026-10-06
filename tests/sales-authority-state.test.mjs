import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const {exchangeAuthorityState:state}=loadTypescriptModule('src/lib/sales/authority-state.ts');
const now=Date.parse('2026-09-22T12:00:00Z');
const authority={id:'one',kind:'authority',version:1,issued_at:'2026-09-20T10:00:00Z',expires_at:'2026-09-23T10:00:00Z',sent_at:'2026-09-20T10:01:00Z',delivery_status:'sent',revoked_at:null,replaced_by:null,exchanged_at:null};
const request={event_type:'authority_requested',created_at:'2026-09-19T10:00:00Z',created_by_user_id:'agent',actor_name:'Saved Agent'};
test('request controls follow issued, pending, exchanged, expired, revoked and superseded authorities',()=>{
  assert.equal(state([],[],null,false,now).canRequest,true);
  assert.equal(state([],[request],request.created_at,false,now).canRequest,false);
  for(const email of [authority,{...authority,delivery_status:'sending',sent_at:null},{...authority,exchanged_at:'2026-09-21'}]) assert.equal(state([email],[],null,Boolean(email.exchanged_at),now).canRequest,false);
  for(const [email,badge] of [[{...authority,expires_at:'2026-09-21T10:00:00Z'},'Expired'],[{...authority,revoked_at:'2026-09-21T10:00:00Z'},'Revoked']]) {
    const result=state([email],[request],request.created_at,false,now);assert.equal(result.canRequest,true);assert.equal(result.badge,badge);
    const renewal={...request,created_at:'2026-09-22T11:00:00Z'};assert.equal(state([email],[renewal,request],renewal.created_at,false,now).canRequest,false);
    assert.equal(state([email],[request],request.created_at,true,now).canRequest,false);
  }
  assert.equal(state([{...authority,replaced_by:'two'}],[],null,false,now).badge,'Superseded');
  assert.equal(state([{...authority,replaced_by:'two',expires_at:'2026-09-21T10:00:00Z'}],[],null,false,now).canRequest,false);
});
test('each authority displays its own request or direct issuance, not an obsolete prior request',()=>{
  assert.equal(state([authority],[request],request.created_at,false,now).request.actor_name,'Saved Agent');
  assert.equal(state([authority],[],null,false,now).requestDate,null);
  const next={...authority,id:'two',version:2,issued_at:'2026-09-22T10:00:00Z'};
  const old={...authority,replaced_by:'two'};
  const direct=state([old,next],[request],request.created_at,false,now);assert.equal(direct.current.id,'two');assert.equal(direct.requestDate,null);assert.equal(direct.canRequest,false);
  const renewed={...request,created_at:'2026-09-21T11:00:00Z'};assert.equal(state([next,old],[request,renewed],renewed.created_at,false,now).requestDate,renewed.created_at);
  assert.equal(state([authority],[],null,false,now).badge,'Active');
});
test('server rejects obsolete requests, appends one renewal per version and preserves authorities and audit events',async t=>{
  const f=await legalDatabase();t.after(()=>f.db.close());
  await f.action('agent','request_authority');const one=await f.sent(await f.prepare());
  await assert.rejects(f.action('agent','request_authority'),/already issued/);
  await f.action('developer','revoke_authority',{emailId:one.id,reason:'Revised authority required'});
  await f.service();const saved=(await f.db.query('select to_jsonb(e) record from sale_legal_emails e where id=$1',[one.id])).rows[0].record;
  await f.action('solicitor','request_authority');assert.equal((await f.action('agent','request_authority')).alreadyRequested,true);
  await f.service();assert.deepEqual((await f.db.query('select to_jsonb(e) record from sale_legal_emails e where id=$1',[one.id])).rows[0].record,saved);
  const events=(await f.db.query("select * from unit_sale_workflow_events where event_type='authority_requested' order by created_at")).rows;
  assert.equal(events.length,2);assert.equal(events[0].created_by_user_id,f.ids.agent);assert.equal(events[1].created_by_user_id,f.ids.solicitor);assert.equal(events[1].metadata.renewalOfAuthorityId,one.id);
  assert.equal((await f.db.query('select count(*)::int n from sale_mention_notifications where recipient_id=$1',[f.ids.developer])).rows[0].n,2);
  const two=await f.sent(await f.prepare());assert.equal(two.version,2);assert.notEqual(two.id,one.id);assert.equal(two.revoked_at,null);
  await assert.rejects(f.action('solicitor','request_authority'),/already issued/);
  await f.action('solicitor','confirm_exchange',{date:new Date().toISOString().slice(0,10)});await assert.rejects(f.action('agent','request_authority'),/unexchanged/);
});
test('expired authority accepts a renewal request without reactivating the previous version',async t=>{
  const f=await legalDatabase();t.after(()=>f.db.close());const one=await f.sent(await f.prepare({date:new Date(Date.now()+1200).toISOString()}));
  await new Promise(resolve=>setTimeout(resolve,1250));
  await f.action('agent','request_authority');await f.service();
  const saved=(await f.db.query('select to_jsonb(e) record from sale_legal_emails e where id=$1',[one.id])).rows[0].record;assert.deepEqual(saved,one);
  assert.equal((await f.action('solicitor','request_authority')).alreadyRequested,true);
  await assert.rejects(f.action('developer','request_authority'),/role/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.agent]);await assert.rejects(f.action('agent','request_authority'),/access denied/);
});
