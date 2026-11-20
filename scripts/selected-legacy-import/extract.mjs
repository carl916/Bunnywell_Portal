import fs from 'node:fs';
import path from 'node:path';
import {SOURCE,DEST,dir,sql,save,read,ids,q,ident,hash,cli,storage} from './runtime.mjs';
const s=read('source-catalog'),d=read('destination-catalog');
const json=(table,where='true')=>`select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) data from ${table} x where ${where}`;
const object=parts=>Array.from({length:Math.ceil(parts.length/40)},(_,i)=>`jsonb_build_object(${parts.slice(i*40,i*40+40).join(',')})`).join(' || ');
const selected={buildings:`id in (${ids})`};
const omit=new Set(['profiles','organisations','trades','unit_types','unit_type_areas','flats','resident_access_requests','digest_runs','sale_mention_notifications']);
// Building ownership is the root. Descendant predicates always use exact IDs.
for(const t of s.tables.filter(t=>t.schema==='public'&&!omit.has(t.name)&&t.name!=='buildings')){
 const cols=s.columns.filter(c=>c.table_name===t.name).map(c=>c.column_name);
 if(cols.includes('building_id'))selected[t.name]=`building_id in (${ids})`;
 else if(cols.includes('unit_id'))selected[t.name]=`unit_id in (select id from units where building_id in (${ids}))`;
 else if(cols.includes('sale_attempt_id'))selected[t.name]=`sale_attempt_id in (select id from unit_sale_attempts where building_id in (${ids}))`;
 else if(cols.includes('sale_id'))selected[t.name]=`sale_id in (select id from unit_sale_attempts where building_id in (${ids}))`;
 else if(cols.includes('snag_id'))selected[t.name]=`snag_id in (select id from snags where building_id in (${ids}))`;
 else if(cols.includes('handover_id'))selected[t.name]=`handover_id in (select h.id from handovers h join units u on u.id=h.unit_id where u.building_id in (${ids}))`;
 else if(t.name==='unit_sale_document_versions')selected[t.name]=`document_id in (select d.id from unit_sale_documents d join unit_sale_attempts a on a.id=d.sale_attempt_id where a.building_id in (${ids}))`;
 else if(t.name==='rental_arrears_episodes')selected[t.name]=`tenancy_id in (select id from unit_tenancies where building_id in (${ids}))`;
 else if(t.name==='rental_arrears_events')selected[t.name]=`episode_id in (select e.id from rental_arrears_episodes e join unit_tenancies t on t.id=e.tenancy_id where t.building_id in (${ids}))`;
 else if(t.name==='snag_report_recipients')selected[t.name]=`report_id in (select id from snag_reports where building_id in (${ids}))`;
 else throw Error('Unclassified table '+t.name);
}
// One read-only statement provides a consistent snapshot of selected business rows.
const parts=Object.entries(selected).map(([t,w])=>`${q(t)},(${json(ident(t),w)})`);
const extraction=sql(SOURCE,`select now() at, ${object(parts)} data`)[0];
save('source-extraction',extraction);
const data=extraction.data;
// Follow required reference FKs only; never reverse-expand shared actors/orgs to other buildings.
const referenceTables=['profiles','organisations','trades','unit_types','flats'];
for(let pass=0;pass<4;pass++){
 let changed=false;
 for(const target of referenceTables){
  const wanted=new Set((data[target]||[]).map(r=>r.id));
  for(const fk of s.constraints.filter(c=>c.type==='f'&&c.reference===target)){
   const match=/FOREIGN KEY \(([^)]+)\) REFERENCES .*\(id\)/.exec(fk.definition);if(!match||match[1].includes(','))continue;
   for(const row of data[fk.table]||[])if(row[match[1]])wanted.add(row[match[1]]);
  }
  // Legacy columns may point directly to auth.users; export profile attribution, never Auth credentials.
  if(target==='profiles')for(const [table,rows]of Object.entries(data)){
   const cols=s.columns.filter(c=>c.table_name===table&&(/(_by|_user_id|author_id|actor_id|user_id|recipient_id|created_by)$/.test(c.column_name))).map(c=>c.column_name);
   for(const row of rows){for(const c of cols)if(typeof row[c]==='string'&&/^[0-9a-f-]{36}$/i.test(row[c]))wanted.add(row[c]);for(const id of row.mention_ids||[])wanted.add(id);}
  }
  if(wanted.size>(data[target]||[]).length){data[target]=sql(SOURCE,json(ident(target),`id in (${[...wanted].map(q).join(',')})`))[0].data;changed=true;}
 }
 if(!changed)break;
}
data.unit_type_areas=data.unit_types.length?sql(SOURCE,json('unit_type_areas',`unit_type_id in (${data.unit_types.map(r=>q(r.id)).join(',')})`))[0].data:[];
// Include legacy audit rows whose exact entity or metadata links to the selected business scope.
const relatedIds=new Set(Object.entries(data).filter(([t])=>!referenceTables.includes(t)).flatMap(([,r])=>r.map(x=>x.id).filter(Boolean)));
const auditIds=[...relatedIds].map(q).join(',');
data.audit_events=sql(SOURCE,json('audit_events',`building_id in (${ids}) or entity_id::text in (${auditIds}) or metadata->>'building_id' in (${ids}) or metadata->>'buildingId' in (${ids}) or metadata->>'unit_id' in (${data.units.map(r=>q(r.id)).join(',')})`))[0].data;
save('source-extraction',{...extraction,dependenciesCompletedAt:new Date().toISOString(),data});
const counts=Object.fromEntries(Object.entries(data).map(([t,r])=>[t,r.length]));save('source-counts',counts);
const backupFile=path.join(dir,'destination-before.json');
if(!fs.existsSync(backupFile)){
 const tables=d.tables.filter(t=>['public','portal_audit','integration_controls'].includes(t.schema));
 const backup=sql(DEST,`select now() at,${object(tables.map(t=>`${q(t.schema+'.'+t.name)},(${json(ident(t.schema)+'.'+ident(t.name))})`))} data,(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from storage.objects o) storage`)[0];
 save('destination-before',backup);save('destination-before-checksum',{sha256:hash(fs.readFileSync(backupFile))});
 console.log('Recovery export saved:',tables.length,'tables,',backup.storage.length,'storage objects');
}
console.log('Scoped source rows:',counts);
console.log('Rental check:',{units:new Set(data.unit_tenancies.map(t=>t.unit_id)).size,tenancies:data.unit_tenancies.length,episodes:data.rental_arrears_episodes.length,events:data.rental_arrears_events.length,runs:data.rental_import_runs.length});
