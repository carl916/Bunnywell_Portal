import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

async function apiFixture(t) {
  const f=await legalDatabase(); t.after(()=>f.db.close());
  let user='developer';
  const calls=[];
  const client={
    auth:{getUser:async()=>({data:{user:{id:f.ids[user]}},error:null})},
    rpc:async(name,args)=>{await f.service(user);try{return {data:await f.rpc(name,args),error:null};}catch(error){return {data:null,error};}},
    from(table){
      const conditions=[],values=[];let single=false;
      const query={
        select(){return query;},
        eq(key,value){values.push(value);conditions.push(`"${key}"=$${values.length}`);return query;},
        single(){single=true;return query;},
        then(resolve,reject){return (async()=>{await f.service(user);const rows=(await f.db.query(`select * from "${table}"${conditions.length?' where '+conditions.join(' and '):''}`,values)).rows;return {data:single?rows[0]:rows,error:null};})().then(resolve,reject);},
      };return query;
    },
  };
  const env={SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,RESEND_API_KEY:process.env.RESEND_API_KEY,DIGEST_DRY_RUN_EMAIL:process.env.DIGEST_DRY_RUN_EMAIL};
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-signing-key';process.env.RESEND_API_KEY='synthetic-resend-key';delete process.env.DIGEST_DRY_RUN_EMAIL;
  t.after(()=>{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  let response=()=>Response.json({id:'synthetic-resend-message'});
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');calls.push(init);return response();});
  const route=loadTypescriptModule('src/app/api/sales/legal/route.ts',{overrides:{'@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>client,requiredEnv:name=>{if(!process.env[name])throw new Error(`${name} missing`);return process.env[name];}}}});
  async function post(payload){const result=await route.POST(new Request('http://localhost/api/sales/legal',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify({sale:f.ids.sale,...payload})}));return {status:result.status,...await result.json()};}
  async function preview(){return post({action:'preview',kind:'authority',date:new Date(Date.now()+172800000).toISOString()});}
  return {...f,calls,post,preview,asUser:name=>{user=name;},respond:fn=>{response=fn;}};
}

test('server preview uses live contacts and rejects stale approval after recipient edits',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();
  assert.equal(preview.status,200);assert.equal(f.calls.length,0);
  assert.deepEqual(preview.to,['legal@example.test']);assert.deepEqual(preview.cc,['sales@example.test']);
  assert.match(preview.subject,/Authority to Exchange/);assert.match(preview.body,/Seller SPV Ltd/);assert.match(preview.body,/Test developer/);
  assert.match(preview.body,/expire automatically/);assert.match(preview.body,/£250,000/);
  await f.owner();await f.db.query("update organisations set shared_system_email='updated@example.test' where id=$1",[f.solicitorOrg]);
  const stale=await f.post({action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId:crypto.randomUUID()});
  assert.match(stale.error,/fresh preview/);assert.equal(f.calls.length,0);
  const current=await f.post({action:'preview',kind:'authority',date:preview.date});assert.deepEqual(current.to,['updated@example.test']);
  await f.owner();await f.db.query('update organisations set shared_system_email=null where id=$1',[f.solicitorOrg]);
  const missing=await f.preview();assert.equal(missing.status,400);assert.match(missing.settingsUrl,/organisation-/);assert.match(missing.error,/shared system email/);
});

test('send persists exact rendering and repeat confirmation does not duplicate the email',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();const payload={action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId:crypto.randomUUID()};
  const sent=await f.post(payload);assert.equal(sent.status,200);assert.equal(sent.email.resend_message_id,'synthetic-resend-message');
  assert.equal(sent.email.body,preview.body);assert.equal(sent.email.subject,preview.subject);assert.deepEqual(sent.email.to_recipients,preview.to);assert.deepEqual(sent.email.cc_recipients,preview.cc);
  assert.equal(JSON.parse(f.calls[0].body).from,sent.email.sending_address);
  assert.equal((await f.post(payload)).status,200);assert.equal(f.calls.length,1);
});

test('uncertain sends retry the exact saved message with the same Resend idempotency key',async t=>{
  const f=await apiFixture(t);const preview=await f.preview();const requestId=crypto.randomUUID();
  f.respond(()=>new Response('unavailable',{status:503}));
  const failed=await f.post({action:'send',kind:preview.kind,date:preview.date,token:preview.token,requestId});assert.equal(failed.status,400);
  await f.service();assert.equal((await f.db.query('select delivery_status from sale_legal_emails where id=$1',[requestId])).rows[0].delivery_status,'unknown');
  f.respond(()=>Response.json({id:'reconciled-message'}));
  const retry=await f.post({action:'retry_email',emailId:requestId});assert.equal(retry.status,200);
  assert.equal(f.calls[0].headers['Idempotency-Key'],f.calls[1].headers['Idempotency-Key']);assert.equal(f.calls[0].body,f.calls[1].body);
});

test('API rejects cross-role actions and preserves the database permission checks',async t=>{
  const f=await apiFixture(t);
  for(const role of ['agent','solicitor']) {f.asUser(role);assert.match((await f.preview()).error,/authorised developer/);}
  f.asUser('developer');assert.match((await f.post({action:'confirm_completion',dateTime:new Date().toISOString()})).error,/role/);
  f.asUser('agent');assert.match((await f.post({action:'approve_statement',versionId:crypto.randomUUID()})).error,/role/);
  await f.owner();await f.db.query('delete from user_building_access where user_id=$1',[f.ids.agent]);
  assert.match((await f.post({action:'request_authority'})).error,/access denied/);
  assert.equal(f.calls.length,0);
});
