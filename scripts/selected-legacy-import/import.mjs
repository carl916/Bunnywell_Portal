// One-time, manifest-bound historical import. No source writes, resets, trigger
// disabling, replication-role changes, or weakened relational constraints.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,save,sql,DEST,SOURCE,dir,keys,q,ident,hash,integrationRoot} from './runtime.mjs';
const manifest=read('prepared-import'),catalog=read('destination-catalog'),run=manifest.runId;
assert.equal(manifest.source,SOURCE);assert.equal(manifest.destination,DEST);
let mode=process.argv[2];assert(['stage','actors','rehearse','commit','verify'].includes(mode),'Expected stage|actors|rehearse|commit|verify');
if(mode==='commit'&&sql(DEST,`select status from selected_legacy_import.runs where run_id=${q(run)}`)[0]?.status==='imported'){mode='verify';console.log('Run already committed; verifying without writing or replaying.');}
const rows=manifest.rows,tables=[...new Set(rows.map(r=>r.table_name))];
function object(parts){return Array.from({length:Math.ceil(parts.length/35)},(_,i)=>`jsonb_build_object(${parts.slice(i*35,i*35+35).join(',')})`).join(' || ');}
function invariantCurrent(){
 const current=sql(DEST,`select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','portal_audit','integration_controls') and p.prokind='f'`);
 assert.deepEqual(current.map(x=>x.definition).sort(),[...catalog.functions].sort(),'Reviewed functions changed since snapshot');
 assert.equal(sql(DEST,"select count(*) n from pg_extension where extname in ('pg_cron','pg_net','http')")[0].n,0,'Outbound-capable extension present');
}
if(mode==='stage'){
 invariantCurrent();
 sql(DEST,`begin;
 create schema if not exists selected_legacy_import;
 revoke all on schema selected_legacy_import from public,anon,authenticated,service_role;
 create table if not exists selected_legacy_import.runs(run_id text primary key,source_ref text not null,destination_ref text not null,manifest_hash text not null,source_extracted_at timestamptz not null,created_at timestamptz not null default now(),status text not null default 'staging',active_backend integer,imported_at timestamptz);
 create table if not exists selected_legacy_import.records(run_id text not null references selected_legacy_import.runs,table_name text not null,source_key jsonb not null,destination_key jsonb not null,source_hash text not null,payload jsonb not null,expected_hash text not null,primary key(run_id,table_name,source_key));
 create table if not exists selected_legacy_import.files(run_id text not null references selected_legacy_import.runs,bucket text not null,name text not null,sha256 text not null,size bigint not null,primary key(run_id,bucket,name));
 alter table selected_legacy_import.runs enable row level security;
 alter table selected_legacy_import.records enable row level security;
 alter table selected_legacy_import.files enable row level security;
 revoke all on all tables in schema selected_legacy_import from public,anon,authenticated,service_role;
 do $check$ begin
 if exists(select 1 from selected_legacy_import.runs where run_id=${q(run)} and manifest_hash<>${q(hash(manifest))}) then raise exception 'Manifest changed; refusing to restage'; end if;
 end $check$;
 insert into selected_legacy_import.runs(run_id,source_ref,destination_ref,manifest_hash,source_extracted_at) values(${q(run)},${q(SOURCE)},${q(DEST)},${q(hash(manifest))},${q(manifest.extractedAt)}) on conflict do nothing;
 commit;`,{write:true});
 for(let i=0;i<rows.length;){
  const part=[];let bytes=0;
  while(i<rows.length){const item={...rows[i],run_id:run},size=Buffer.byteLength(JSON.stringify(item));if(part.length&&bytes+size>400000)break;part.push(item);bytes+=size;i++;}
  sql(DEST,`begin;insert into selected_legacy_import.records select * from jsonb_populate_recordset(null::selected_legacy_import.records,${q(JSON.stringify(part))}::jsonb) on conflict do nothing;commit;`,{write:true});
  console.log('Staged rows',i,'/',rows.length);
 }
 const files=manifest.files.map(f=>({run_id:run,bucket:f.bucket,name:f.name,sha256:f.sha256,size:f.size}));
 for(let i=0;i<files.length;i+=100)sql(DEST,`insert into selected_legacy_import.files select * from jsonb_populate_recordset(null::selected_legacy_import.files,${q(JSON.stringify(files.slice(i,i+100)))}::jsonb) on conflict do nothing;`,{write:true});
 const actual=sql(DEST,`select (select count(*) from selected_legacy_import.records where run_id=${q(run)}) records,(select count(*) from selected_legacy_import.files where run_id=${q(run)}) files`)[0];assert.equal(actual.records,rows.length);assert.equal(actual.files,files.length);console.log('Private manifest staged',actual);
}
if(mode==='actors'){
 const k=keys(DEST),origin='https://'+DEST+'.supabase.co';
 const settings=await fetch(origin+'/auth/v1/settings',{headers:{apikey:k.anon}});assert(settings.ok);const cfg=await settings.json();assert.equal(cfg.disable_signup,true,'Public signup must be disabled');
 const audit=sql(DEST,"select has_function_privilege('supabase_auth_admin','integration_controls.block_delivery(jsonb)','EXECUTE') and not has_function_privilege('anon','integration_controls.block_delivery(jsonb)','EXECUTE') ok")[0];assert.equal(audit.ok,true);
 const file=path.join(dir,'created-actors.json'),created=fs.existsSync(file)?read('created-actors'):[];
 for(const r of rows.filter(r=>r.table_name==='profiles')){
  const id=r.payload.id,email='legacy-'+id+'@example.invalid';
  const present=sql(DEST,`select a.id,a.email,a.banned_until>now() banned,a.email_confirmed_at is null unconfirmed,p.active is false inactive from auth.users a join public.profiles p on p.id=a.id where a.id=${q(id)}::uuid`);
  if(present.length){assert(created.some(c=>c.id===id),'Unrecognised existing Auth identity');assert.equal(present[0].email,email);assert(present[0].banned&&present[0].unconfirmed&&present[0].inactive,'Historical actor was activated; stop');continue;}
  const response=await fetch(origin+'/auth/v1/admin/users',{method:'POST',redirect:'error',headers:{apikey:k.service,Authorization:'Bearer '+k.service,'Content-Type':'application/json'},body:JSON.stringify({id,email,email_confirm:false,ban_duration:'876000h',user_metadata:{full_name:r.payload.full_name||r.payload.name||'Historical actor'}})});
  if(!response.ok){fs.writeFileSync(path.join(dir,'last-auth-error.txt'),await response.text());throw Error('Dormant actor creation failed; private error saved');}
  sql(DEST,`update public.profiles set active=false where id=${q(id)}::uuid and email=${q(email)} and role='user'`,{write:true});
  const profile=sql(DEST,`select to_jsonb(p) data from public.profiles p where id=${q(id)}::uuid`)[0].data;
  created.push({id,email,profile});save('created-actors',created);
 }
 console.log('Dormant historical identities prepared',created.length);
}
// Only these operational and stamping hooks need historical treatment. All
// CHECK/FK/exclusion constraints and ownership/tenancy guards remain active.
const historicalHooks=new Set([
 'portal_audit.stamp_general','portal_audit.snag_event_stamp',
 'public.populate_audit_event_context','public.sale_event_actor_snapshot',
 'public.stamp_unit_sale_invoice_payment_recorder','public.sale_document_activity',
 'public.sales_cascade_deposit_defaults','public.normalise_unit_sale_agent_fee_structure',
 'public.complete_handover_unit','public.sales_legal_unit_guard',
 'public.validate_active_sale_attempt_entry','public.set_updated_at','public.set_sale_attempt_stage_entered_at',
]);
function buildTransaction(commit){
 const original=catalog.functions.filter(f=>historicalHooks.has(/FUNCTION ([^(]+)/.exec(f)?.[1]));assert.equal(original.length,historicalHooks.size);
 const order=[];let left=[...tables];
 // Documents and their approved version form a real, non-deferrable cycle.
 // Import the nullable approval pointer first, then restore it after versions.
 while(left.length){const ready=left.filter(t=>!catalog.constraints.some(c=>c.table===t&&c.type==='f'&&tables.includes(c.reference)&&c.reference!==t&&!(t==='unit_sale_documents'&&c.reference==='unit_sale_document_versions')&&left.includes(c.reference)));
  assert(ready.length,'Unresolved cross-table dependency cycle: '+left.join(','));order.push(...ready);left=left.filter(t=>!ready.includes(t));}
 const actorPlaceholders=read('created-actors');
 const helper=`create or replace function selected_legacy_import.accepts(p_table text,p_row jsonb) returns boolean language sql stable security invoker set search_path='' as $gate$
 select session_user='postgres' and coalesce(auth.jwt()->>'role','')='service_role'
 and exists(select 1 from selected_legacy_import.runs run join selected_legacy_import.records r on r.run_id=run.run_id
 where run.run_id=current_setting('app.selected_legacy_import',true) and run.status='importing' and run.active_backend=pg_backend_pid()
 and r.table_name=p_table and (r.payload=p_row or (p_table='unit_sale_documents' and current_setting('app.selected_legacy_phase',true)='document-shells' and (r.payload||'{"approved_version_id":null}'::jsonb)=p_row)))
 $gate$; revoke all on function selected_legacy_import.accepts(text,jsonb) from public,anon,authenticated,service_role;`;
 const modified=original.map(f=>{assert(/\bbegin\b/i.test(f));return f.replace(/\bbegin\b/i,`begin\n if TG_OP in ('INSERT','UPDATE') and selected_legacy_import.accepts(TG_TABLE_NAME,to_jsonb(new)) then return new; end if;`);}).join(';\n');
 const conflictChecks=tables.map(t=>`if exists(select 1 from public.${ident(t)} x join selected_legacy_import.records r on r.run_id=${q(run)} and r.table_name=${q(t)} and to_jsonb(x) @> r.destination_key ${t==='profiles'?`where not exists(select 1 from jsonb_array_elements(${q(JSON.stringify(actorPlaceholders))}::jsonb) a where a->>'id'=x.id::text and a->'profile'=to_jsonb(x))`:t==='trades'?'where r.source_key=r.destination_key or to_jsonb(x) is distinct from r.payload':''}) then raise exception 'Pre-existing or changed destination rows: ${t}'; end if;`).join('\n');
 const insertions=order.map(t=>{
  const cols=catalog.columns.filter(c=>c.table_schema==='public'&&c.table_name===t&&c.is_generated==='NEVER').map(c=>c.column_name);
  const payload=t==='unit_sale_documents'?`r.payload||'{"approved_version_id":null}'::jsonb`:'r.payload';
  if(t==='profiles')return `update public.profiles p set ${cols.filter(c=>c!=='id').map(c=>`${ident(c)}=v.${ident(c)}`).join(',')} from selected_legacy_import.records r cross join lateral jsonb_populate_record(null::public.profiles,r.payload) v where r.run_id=${q(run)} and r.table_name='profiles' and p.id=v.id;`;
  return `${t==='unit_sale_documents'?"select set_config('app.selected_legacy_phase','document-shells',true);":''}
 insert into public.${ident(t)}(${cols.map(ident).join(',')}) select ${cols.map(c=>'v.'+ident(c)).join(',')} from selected_legacy_import.records r cross join lateral jsonb_populate_record(null::public.${ident(t)},${payload}) v where r.run_id=${q(run)} and r.table_name=${q(t)} ${t==='trades'?'and r.source_key=r.destination_key':''};
 ${t==='unit_sale_documents'?"select set_config('app.selected_legacy_phase','',true);":''}`;
 }).join('\n');
 const exactChecks=tables.map(t=>`if exists(select 1 from selected_legacy_import.records r left join public.${ident(t)} x on to_jsonb(x) @> r.destination_key where r.run_id=${q(run)} and r.table_name=${q(t)} and to_jsonb(x) is distinct from r.payload) then raise exception 'Exact historical row reconciliation failed: ${t}'; end if;`).join('\n');
 return `begin;set local statement_timeout='120s';set local lock_timeout='10s';
 select pg_advisory_xact_lock(hashtext(${q(run)}));
 lock table ${tables.map(t=>'public.'+ident(t)).join(',')} in share row exclusive mode;
 do $check$ begin
 if (select manifest_hash from selected_legacy_import.runs where run_id=${q(run)}) is distinct from ${q(hash(manifest))} or (select count(*) from selected_legacy_import.records where run_id=${q(run)})<>${rows.length} then raise exception 'Manifest identity or staged row count changed'; end if;
 if (select status from selected_legacy_import.runs where run_id=${q(run)} for update)<>'staging' then raise exception 'Run must be staging; verify a completed run instead of replaying'; end if;
 ${conflictChecks} end $check$;
 update selected_legacy_import.runs set status='importing',active_backend=pg_backend_pid() where run_id=${q(run)};
 select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.headers','{}',true),set_config('app.selected_legacy_import',${q(run)},true),set_config('app.sales_legal_write','on',true),set_config('app.completion_package_write','on',true);
 ${helper}
 ${modified};
 ${insertions}
 update public.unit_sale_documents d set approved_version_id=(r.payload->>'approved_version_id')::uuid from selected_legacy_import.records r where r.run_id=${q(run)} and r.table_name='unit_sale_documents' and d.id=(r.payload->>'id')::uuid;
 insert into public.unit_import_origins(unit_id,source,sale_status,completion_date) select (payload->>'id')::uuid,${q(SOURCE+':'+run)},payload->>'sale_status',(payload->>'completion_date')::date from selected_legacy_import.records where run_id=${q(run)} and table_name='units';
 set constraints all immediate;
 do $exact$ begin ${exactChecks} end $exact$;
 ${original.join(';\n')};
 update selected_legacy_import.runs set status='imported',active_backend=null,imported_at=now() where run_id=${q(run)};
 select 'exact_rows_verified' result,${rows.length} records;
 ${commit?'commit':'rollback'};`;
}
if(['rehearse','commit'].includes(mode)){
 invariantCurrent();
 if(mode==='commit'){const copied=read('uploaded-files');assert.equal(copied.length,manifest.files.length);for(const f of manifest.files)assert(copied.some(c=>c.bucket===f.bucket&&c.name===f.name&&c.sha256===f.sha256),'Unverified destination file');}
 const query=buildTransaction(mode==='commit');fs.writeFileSync(path.join(dir,mode+'.sql'),query);
 const result=sql(DEST,query,{write:true});save(mode+'-result',{at:new Date().toISOString(),result});invariantCurrent();console.log(mode,result);
}
if(mode==='verify'){
 invariantCurrent();
 const parts=tables.map(t=>`${q(t)},(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${ident(t)} x join selected_legacy_import.records r on r.run_id=${q(run)} and r.table_name=${q(t)} and to_jsonb(x) @> r.destination_key)`);
 const actual=sql(DEST,`select ${object(parts)} data`)[0].data;save('destination-imported',actual);
 const differences=[];
 for(const r of rows){const x=actual[r.table_name].find(x=>Object.entries(r.destination_key).every(([k,v])=>x[k]===v));if(!x)differences.push({table:r.table_name,key:r.destination_key,missing:true});else for(const key of Object.keys(r.payload))if(JSON.stringify(x[key])!==JSON.stringify(r.payload[key]))differences.push({table:r.table_name,key:r.destination_key,column:key});}
 save('destination-differences',differences);console.log('Imported row differences',differences.length);assert.equal(differences.length,0,'Imported rows changed or did not reconcile');
}
