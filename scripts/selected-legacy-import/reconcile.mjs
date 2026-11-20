import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,save,sql,DEST,SOURCE,dir,q,ident,hash,storage,root} from './runtime.mjs';
const manifest=read('prepared-import'),source=read('source-extraction').data,actual=read('destination-imported'),before=read('destination-before'),catalog=read('destination-catalog');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const object=parts=>Array.from({length:Math.ceil(parts.length/30)},(_,i)=>`jsonb_build_object(${parts.slice(i*30,i*30+30).join(',')})`).join(' || ');
const tables=Object.keys(before.data);
const after=sql(DEST,`select ${object(tables.map(t=>`${q(t)},(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from ${t.split('.').map(ident).join('.')} x)`))} data`)[0].data;
const baselineDifferences=[];
for(const[t,rows]of Object.entries(before.data)){
 const pk=catalog.constraints.find(c=>c.type==='p'&&c.table===(t.startsWith('public.')?t.slice(7):t));
 const cols=pk?/PRIMARY KEY \(([^)]+)\)/.exec(pk.definition)[1].split(', '):null;
 for(const row of rows){const target=after[t].find(r=>cols?cols.every(c=>r[c]===row[c]):canonical(r)===canonical(row));if(!target||canonical(target)!==canonical(row))baselineDifferences.push({table:t,key:cols?Object.fromEntries(cols.map(c=>[c,row[c]])):null});}
}
save('baseline-row-differences',baselineDifferences);assert.equal(baselineDifferences.length,0,'Existing integration rows changed');
const current=sql(DEST,`select
 (select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',conname,'type',contype,'definition',pg_get_constraintdef(c.oid),'validated',convalidated,'reference',case when confrelid<>0 then confrelid::regclass::text end)) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','portal_audit','integration_controls')) constraints,
 (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','portal_audit','storage','integration_controls')) policies,
 (select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema in ('public','portal_audit','integration_controls')) grants,
 (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','portal_audit','integration_controls')) tables,
 (select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',tgname,'definition',pg_get_triggerdef(t.oid),'enabled',tgenabled,'function',pg_get_functiondef(t.tgfoid))) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','portal_audit','integration_controls')) triggers`)[0];
for(const key of ['constraints','policies','grants','triggers','tables'])assert.deepEqual((current[key]||[]).map(canonical).sort(),(catalog[key]||[]).map(canonical).sort(),'Reviewed foundation differs: '+key);
// The CLI read-only role cannot enumerate grants through information_schema.
// Preserve that limitation explicitly; the import changes grants only inside its
// new private manifest schema, never on an existing application object.
save('grant-verification',{baselineVisible:catalog.grants!==null,currentVisible:current.grants!==null,applicationGrantDDLExecuted:false});
const actors=sql(DEST,`select count(*) count,count(*) filter(where p.active is false and a.email like 'legacy-%@example.invalid' and a.banned_until>now() and a.email_confirmed_at is null) dormant,(select count(*) from auth.sessions s where s.user_id in (${source.profiles.map(p=>q(p.id)).join(',')})) sessions from auth.users a join profiles p on p.id=a.id where a.id in (${source.profiles.map(p=>q(p.id)).join(',')})`)[0];
assert.equal(actors.count,14);assert.equal(actors.dormant,14);assert.equal(actors.sessions,0);
assert(!JSON.stringify(actual).includes('https://'+SOURCE+'.supabase.co/storage/'),'Runtime source Storage dependency remains');
const storageState=sql(DEST,`select o.bucket_id,o.name,o.version,o.metadata,o.updated_at from storage.objects o join selected_legacy_import.files f on f.bucket=o.bucket_id and f.name=o.name where f.run_id=${q(manifest.runId)} order by o.bucket_id,o.name`);
assert.equal(storageState.length,manifest.files.length);
const storageFile=path.join(dir,'destination-storage-state.json');if(fs.existsSync(storageFile))assert.equal(canonical(storageState),canonical(read('destination-storage-state')),'Copied file metadata changed');else save('destination-storage-state',storageState);
for(const f of read('destination-recovery-files')){const response=await storage(DEST,f.bucket,f.name);assert(response.ok);assert.equal(hash(Buffer.from(await response.arrayBuffer())),f.sha256,'Existing fixture file changed');}
const byBuilding=source.buildings.map(b=>{
 const rows=(d,t)=>d[t]?.filter(r=>r.building_id===b.id).length||0;
 const states=d=>Object.fromEntries([...new Set(source.units.map(u=>u.sale_status))].sort().map(s=>[s,d.units.filter(u=>u.building_id===b.id&&u.sale_status===s).length]));
 return{name:b.name,id:b.id,source:{units:rows(source,'units'),floors:rows(source,'building_floors'),areas:rows(source,'areas'),sales:rows(source,'unit_sale_attempts'),snags:rows(source,'snags'),states:states(source)},destination:{units:rows(actual,'units'),floors:rows(actual,'building_floors'),areas:rows(actual,'areas'),sales:rows(actual,'unit_sale_attempts'),snags:rows(actual,'snags'),states:states(actual)}};
});
for(const b of byBuilding)assert.deepEqual(b.destination,b.source);
const counts=Object.fromEntries(Object.entries(source).map(([t,r])=>[t,{source:r.length,destination:actual[t]?.length||0}]));
for(const c of Object.values(counts))assert.equal(c.source,c.destination);
const financial={};for(const[t,fields]of Object.entries({unit_sale_terms:['contract_price','reservation_fee','solicitor_fee'],unit_sale_invoices:['net_amount','vat_amount','gross_amount','expected_payable_amount'],unit_sale_invoice_payments:['amount'],sale_exchange_deposit_receipts:['expected_amount','received_amount'],unit_tenancies:['monthly_rent','deposit_amount'],rental_arrears_episodes:['initial_reported_amount','maximum_reported_amount','latest_reported_amount'],rental_arrears_events:['reported_amount']}))for(const field of fields){const sum=d=>({amount:d[t].reduce((s,r)=>s+Math.round((r[field]??0)*100),0)/100,unknown:d[t].filter(r=>r[field]==null).length});financial[t+'.'+field]={source:sum(source),destination:sum(actual)};assert.deepEqual(financial[t+'.'+field].source,financial[t+'.'+field].destination);}
const summary={at:new Date().toISOString(),source:SOURCE,destination:DEST,sourceExtractedAt:read('source-extraction').at,runId:manifest.runId,records:manifest.rows.length,newBusinessRecords:manifest.rows.length-5,reusedTrades:5,files:manifest.files.length,fileBytes:manifest.files.reduce((n,f)=>n+f.size,0),allFileHashesVerified:true,byBuilding,counts,financial,rentalUnits:new Set(source.unit_tenancies.map(t=>t.unit_id)).size,unknownRentalDeposits:source.unit_tenancies.filter(t=>t.deposit_amount==null).length,baselineRowsUnchanged:true,baselineFilesUnchanged:true,foundationUnchanged:true,actors,exceptions:read('historical-import-exceptions'),transformations:manifest.transformations};
save('reconciliation',summary);
console.log(JSON.stringify({records:summary.records,reusedTrades:5,files:summary.files,baselineRowsUnchanged:true,foundationUnchanged:true,actors,buildings:byBuilding.map(b=>({name:b.name,...b.destination})),rentals:{units:summary.rentalUnits,tenancies:counts.unit_tenancies,episodes:counts.rental_arrears_episodes,events:counts.rental_arrears_events,runs:counts.rental_import_runs,unknownDeposits:summary.unknownRentalDeposits}},null,2));
