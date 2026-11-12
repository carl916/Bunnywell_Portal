import fs from 'node:fs';
import {read,save,sql,DEST,q,ident} from './runtime.mjs';
const data=read('source-extraction').data,catalog=read('destination-catalog');
const checks=[];
for(const [table,rows] of Object.entries(data)){
 if(!rows.length)continue;
 const constraints=catalog.constraints.filter(c=>c.table===table&&c.type==='c');
 if(!constraints.length)continue;
 for(let i=0;i<rows.length;i+=75){
  const sub=constraints.map(c=>{const expr=c.definition.replace(/^CHECK \(/,'').replace(/\)( NOT VALID)?$/,'');return `select ${q(table)} as table_name,${q(c.name)} as constraint_name,coalesce(jsonb_agg(to_jsonb(x)->>'id'),'[]') ids from x where not (${expr}) having count(*)>0`;});
  checks.push(`with x as (select * from jsonb_populate_recordset(null::public.${ident(table)},${q(JSON.stringify(rows.slice(i,i+75)))}::jsonb)) ${sub.join(' union all ')}`);
 }
}
let conflicts=[];
for(const check of checks)conflicts.push(...sql(DEST,check));
save('check-conflicts',conflicts);
const ownership=[];
for(const [table,rows] of Object.entries(data))for(const fk of catalog.constraints.filter(c=>c.table===table&&c.type==='f'&&c.reference&&!c.reference.includes('.'))){
 const m=/FOREIGN KEY \(([^)]+)\) REFERENCES .*?\(([^)]+)\)/.exec(fk.definition);if(!m)continue;
 const from=m[1].split(', '),to=m[2].split(', '),parents=data[fk.reference]||[];
 for(const row of rows)if(from.every(k=>row[k]!=null)&&!parents.some(p=>from.every((k,i)=>row[k]===p[to[i]])))ownership.push({table,id:row.id,constraint:fk.name,reference:fk.reference,values:from.map(k=>row[k])});
}
save('relationship-conflicts',ownership);
const legacyCompleted=data.units.filter(u=>u.sale_status==='completed'&&data.unit_sale_attempts.some(a=>a.unit_id===u.id&&a.is_active&&!a.legal_completed_at));
save('historical-import-exceptions',{completedWithAttemptWithoutLegalTimestamp:legacyCompleted.map(u=>({building_id:u.building_id,unit_id:u.id,unit_number:u.unit_number,completion_date:u.completion_date})),handoverStatusNotHandedOver:data.handovers.filter(h=>data.units.find(u=>u.id===h.unit_id)?.sale_status!=='handed_over').map(h=>({handover_id:h.id,unit_id:h.unit_id}))});
console.log(JSON.stringify({checkConflicts:conflicts,relationshipConflicts:ownership,legacyCompleted:legacyCompleted.map(u=>({id:u.id,unit:u.unit_number})),historicalHandovers:data.handovers.length},null,2));
console.log('Completion upload file shape',Object.keys(data.sale_completion_uploads.find(r=>r.files?.length)?.files[0]||{}));
console.log('Storage references',data.unit_sale_document_versions.reduce((a,v)=>(a[v.storage_bucket]=(a[v.storage_bucket]||0)+1,a),{}));
