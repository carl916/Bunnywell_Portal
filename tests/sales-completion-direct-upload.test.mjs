import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalDatabase } from './helpers/legal-database.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const {completionUploadFiles}=loadTypescriptModule('src/lib/sales/completion-upload.ts');
const file=(type='completion_statement',size=10485760)=>({type,size,name:type+'.pdf',mime:'application/pdf',expectedVersionId:null});
test('server metadata validation accepts boundary and rejects invalid count, type, size, names and versions',()=>{
  assert.equal(completionUploadFiles([file(),file('draft_statement_of_account')]).length,2);
  for(const files of [[],[file(),file()],[file(),file(),file()], [file('',10)],[file('completion_statement',10485761)],[file('completion_statement',0)], [{...file(),mime:'text/plain'}],[{...file(),name:'../x.pdf'}],[{...file(),expectedVersionId:'wrong'}]]) assert.throws(()=>completionUploadFiles(files));
});
async function ready(t) {
  const f=await legalDatabase();t.after(()=>f.db.close());await f.owner();
  await f.db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text,metadata jsonb);`);
  await f.db.exec(readFileSync('supabase/migrations/20260922194750_completion_direct_upload.sql','utf8'));
  await f.sent(await f.prepare());await f.action('solicitor','confirm_exchange',{date:'2026-09-22'});
  await f.sent(await f.prepare({kind:'notice_authority',date:''}));await f.notice();
  const call=async(action,id,files=null,actor='solicitor',sale=f.ids.sale)=>{await f.service(actor);return f.rpc('sales_completion_upload_session',{p_sale:sale,p_actor:f.ids[actor],p_request:id,p_action:action,p_files:files});};
  const objects=async(u)=>{await f.owner();for(const item of u.files)await f.db.query("insert into storage.objects values('sale-documents',$1,$2)",[item.path,{size:item.size,mimetype:item.mime}]);};
  return {...f,call,objects};
}
test('sale-scoped private session checks access, state and exact manifest before any transfer',async t=>{
  const f=await ready(t),id=crypto.randomUUID();
  for(const actor of ['developer','agent','outsider','revoked'])await assert.rejects(f.call('begin',id,[file()],actor),/denied/);
  await assert.rejects(f.call('begin',id,[file()],'solicitor',f.ids.replacement),/awaiting completion/);
  const session=await f.call('begin',id,[file()]);assert.equal(session.files[0].path,`${f.ids.building}/${f.ids.sale}/completion-${id}/completion_statement.pdf`);
  assert.equal((await f.call('begin',id,[file()])).id,id);
  await assert.rejects(f.call('begin',id,[{...file(),name:'different.pdf'}]),/conflicts/);
  await f.as('solicitor');await assert.rejects(f.rpc('sales_completion_upload_session',{p_sale:f.ids.sale,p_actor:f.ids.solicitor,p_request:id,p_action:'get'}),/permission denied/);
  await assert.rejects(f.db.query('select * from sale_completion_uploads'),/permission denied/);
});
test('one/two PDFs, interrupted upload, retry and duplicate finalisation preserve exact versions and audit',async t=>{
  const f=await ready(t),id=crypto.randomUUID();const u=await f.call('begin',id,[file(),file('draft_statement_of_account')]);
  await assert.rejects(f.call('finalize',id),/missing/);await f.objects({...u,files:[u.files[0]]});
  await assert.rejects(f.call('finalize',id),/missing/);await f.objects({...u,files:[u.files[1]]});
  const saved=await f.call('finalize',id);assert.equal(saved.result.length,2);assert.deepEqual(await f.call('finalize',id),saved);
  assert.equal((await f.action('developer','approve_completion_package',await f.packageVersions())).approved,true);
  await f.call('finalize',id);
  await f.service();assert.equal((await f.rpc('sales_completion_package_context',{p_sale:f.ids.sale,p_actor:f.ids.developer})).approved,true);
  await f.service();assert.equal((await f.db.query('select count(*)::int n from unit_sale_document_versions where completion_upload_id=$1',[id])).rows[0].n,2);
  const next=crypto.randomUUID(),replacement=await f.call('begin',next,[{...file(),expectedVersionId:saved.result.find(x=>x.type==='completion_statement').versionId}]);
  await f.objects(replacement);await f.call('finalize',next);
  await f.service();assert.equal((await f.rpc('sales_completion_package_context',{p_sale:f.ids.sale,p_actor:f.ids.developer})).approved,false);
  assert.deepEqual((await f.call('finalize',id)).result,saved.result);
  await f.service();assert.equal((await f.db.query("select count(*)::int n from unit_sale_workflow_events where event_type='completion_statement_uploaded'")).rows[0].n,1);
});
test('expired sessions cannot finalize; cleanup retains committed versions and rejects late finalisation',async t=>{
  const f=await ready(t),id=crypto.randomUUID(),u=await f.call('begin',id,[file()]);await f.objects(u);
  await f.owner();await f.db.query("update sale_completion_uploads set expires_at=now()-interval '27 hours' where id=$1",[id]);
  await assert.rejects(f.call('finalize',id),/expired/);await f.service();const pending=(await f.db.query('select * from sales_completion_upload_cleanup()')).rows;assert.equal(pending[0].state,'expired');
  await assert.rejects(f.call('finalize',id),/expired/);
});

test('stale versions, changed access and foreign sale references cannot finalise a pending session',async t=>{
  const f=await ready(t),first=crypto.randomUUID(),second=crypto.randomUUID();
  const a=await f.call('begin',first,[file()]),b=await f.call('begin',second,[file()]);await f.objects(a);await f.objects(b);
  await assert.rejects(f.call('get',first,null,'solicitor',f.ids.replacement),/access denied/);
  await f.call('finalize',second);await assert.rejects(f.call('finalize',first),/current document changed/);
  await f.owner();await f.db.query('update profiles set active=false where id=$1',[f.ids.solicitor]);
  await assert.rejects(f.call('finalize',second),/denied/);
});

test('server verifies actual objects, rejects forged PDFs, and reconciles a lost finalisation response',async t=>{
  const f=await ready(t),stored=new Map();let loseResponse=false,deny=false;let signed=0;
  const client={
    rpc:async(name,args)=>{await f.service();try{const data=await f.rpc(name,args);if(loseResponse&&args.p_action==='finalize')return {error:new Error('Response interrupted')};return {data,error:null};}catch(error){return {error};}},
    storage:{from:bucket=>({
      info:async path=>{const item=stored.get(bucket+'/'+path);return item?{data:{size:item.length,contentType:'application/pdf'},error:null}:{error:{statusCode:404,message:'Object not found'}};},
      createSignedUploadUrl:async(path,options)=>{assert.equal(options.upsert,false);signed++;return {data:{token:'synthetic-token',path},error:null};},
      copy:async(path,to,{destinationBucket})=>{if(deny)return {error:new Error('Storage unavailable')};const key=destinationBucket+'/'+to;if(stored.has(key))return {error:new Error('The resource already exists')};stored.set(key,stored.get(bucket+'/'+path));await f.owner();await f.db.query('insert into storage.objects values($1,$2,$3)',[destinationBucket,to,{size:stored.get(key).length,mimetype:'application/pdf'}]);return {error:null};},
    })},
  };
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(options.headers.Range,'bytes=0-4');const key=new URL(url).pathname.split('/authenticated/')[1];return new Response(stored.get(key)?.subarray(0,5),{status:206});});
  const {completionUploadAction:act}=loadTypescriptModule('src/lib/sales/completion-upload-server.ts',{overrides:{'@/lib/supabase/admin':{requiredEnv:name=>name==='NEXT_PUBLIC_SUPABASE_URL'?'https://fixture.supabase.co':'synthetic-service-key'}}});
  const id=crypto.randomUUID(),payload={sale:f.ids.sale,requestId:id,files:[file('completion_statement',8)],action:'prepare_completion_upload'};
  await assert.rejects(act(client,f.ids.agent,payload),/denied/);assert.equal(signed,0);
  const prepared=await act(client,f.ids.solicitor,payload);assert.equal(signed,1);const path=prepared.files[0].path;const finalize={...payload,action:'finalize_completion_upload'};
  await assert.rejects(act(client,f.ids.solicitor,finalize),/not finished/);
  stored.set('completion-uploads/'+path,Buffer.from('wrongPDF'));await assert.rejects(act(client,f.ids.solicitor,finalize),/not a PDF/);
  stored.set('completion-uploads/'+path,Buffer.from('%PDF-12'));await assert.rejects(act(client,f.ids.solicitor,finalize),/wrong size/);
  stored.set('completion-uploads/'+path,Buffer.from('%PDF-123'));deny=true;await assert.rejects(act(client,f.ids.solicitor,finalize),/unavailable/);deny=false;
  assert.equal((await act(client,f.ids.solicitor,payload)).files[0].ready,true);assert.equal(signed,1);
  loseResponse=true;await assert.rejects(act(client,f.ids.solicitor,finalize),/interrupted/);loseResponse=false;
  const result=await act(client,f.ids.solicitor,finalize);assert.equal(result.documents.length,1);assert.deepEqual(await act(client,f.ids.solicitor,finalize),result);
});

test('cleanup removes expired private files, preserves referenced versions and retries Storage failures',async()=>{
  const removed=[],marked=[];
  const sessions=[{id:'committed',state:'finalized',files:[{path:'saved.pdf'}]},{id:'abandoned',state:'expired',files:[{path:'orphan.pdf'},{path:'referenced.pdf'}]},{id:'retry',state:'expired',files:[{path:'unavailable.pdf'}]}];
  const client={rpc:async()=>({data:sessions}),storage:{from:bucket=>({remove:async paths=>{removed.push({bucket,paths});return {error:paths.includes('unavailable.pdf')?new Error('Unavailable'):null};}})},
    from:table=>table==='unit_sale_document_versions'?{select:()=>({in:async()=>({data:[{storage_path:'referenced.pdf'}]})})}:{update:()=>({eq:async(_,id)=>{marked.push(id);return {error:null};}})},
  };
  const {cleanCompletionUploads}=loadTypescriptModule('src/lib/sales/completion-upload-server.ts');
  assert.equal((await cleanCompletionUploads(client)).cleaned,2);assert.deepEqual(marked,['committed','abandoned']);
  assert.deepEqual(removed.filter(x=>x.bucket==='sale-documents'),[{bucket:'sale-documents',paths:['orphan.pdf']}]);
});

test('client sends metadata only, resumes interrupted transfer, skips completed files and reports progress',async t=>{
  let prepares=0;const constructed=[],progress=[];const files=[new File(['%PDF-123'],'statement.pdf',{type:'application/pdf'}),new File(['%PDF-456'],'account.pdf',{type:'application/pdf'})];
  class MockUpload {
    constructor(file,options){this.file=file;this.options=options;this.starts=0;constructed.push(this);}
    start(){this.starts++;this.options.onProgress(4,8);if(this.options.metadata.objectName==='second'&&this.starts===1)this.options.onError(new Error('Interrupted'));else this.options.onSuccess();}
    abort(){return Promise.resolve();}
  }
  t.mock.method(globalThis,'fetch',async(_,init)=>{assert.ok(init.body.length<1000);assert.ok(!init.body.includes('%PDF-'));prepares++;return Response.json({completed:false,endpoint:'https://fixture.test/sign',bucket:'completion-uploads',files:[{path:'first',token:'synthetic',ready:prepares>1},{path:'second',token:'synthetic',ready:false}]});});
  const {uploadCompletionFiles}=loadTypescriptModule('src/lib/sales/completion-upload-client.ts',{overrides:{'tus-js-client':{Upload:MockUpload},'@/lib/supabase/client':{createSupabaseBrowserClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}})}}});
  const attempts=new Map(),controller=new AbortController(),metadata=[file('completion_statement',8),file('draft_statement_of_account',8)];
  const run=()=>uploadCompletionFiles(crypto.randomUUID(),'same-request',files,metadata,p=>progress.push(p),controller.signal,attempts);
  await assert.rejects(run(),/interrupted/);await run();
  assert.equal(constructed.length,2);assert.equal(constructed[0].starts,1);assert.equal(constructed[1].starts,2);assert.equal(attempts.size,0);
  assert.equal(progress.at(-1).phase,'verifying');assert.equal(progress.at(-1).loaded,16);
  await assert.rejects(uploadCompletionFiles('', '',files,[file('completion_statement',10485761)],()=>{},controller.signal,attempts),/10 MiB/);assert.equal(prepares,2);
});

test('cleanup HTTP endpoint requires an explicitly configured cron secret',async t=>{
  const previous=process.env.CRON_SECRET;t.after(()=>{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;});
  let calls=0;const {GET}=loadTypescriptModule('src/app/api/cron/completion-uploads/route.ts',{overrides:{'@/lib/supabase/admin':{createSupabaseServiceRoleClient:()=>({})},'@/lib/sales/completion-upload-server':{cleanCompletionUploads:async()=>{calls++;return {cleaned:0};}}}});
  delete process.env.CRON_SECRET;assert.equal((await GET(new Request('http://localhost'))).status,401);
  process.env.CRON_SECRET='synthetic-cron-secret';assert.equal((await GET(new Request('http://localhost'))).status,401);assert.equal(calls,0);
  assert.equal((await GET(new Request('http://localhost',{headers:{Authorization:'Bearer synthetic-cron-secret'}}))).status,200);assert.equal(calls,1);
});
