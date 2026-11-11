import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {sql,isolation} from './runtime.mjs';
isolation();const id=n=>'b1700000-0000-4000-8000-'+String(n).padStart(12,'0');const ids=Array.from({length:15},()=>randomUUID());const [u1,u2,a1,a2,s1,s2,d1,d2,v1,v2,i1,i2,payment]=ids;
const q=x=>"'"+x.replaceAll("'","''")+"'";
const cases=[
 ['sale cannot use another building unit',`insert into unit_sale_attempts(building_id,unit_id,attempt_number,is_active) values('${id(2)}','${u1}',2,false)`,false],
 ['area cannot use another building unit',`insert into areas(building_id,unit_id,area_type,name) values('${id(2)}','${u1}','unit_room','Wrong')`,false],
 ['snag cannot link another unit room',`insert into snags(building_id,unit_id,area_id,title,status) values('${id(1)}','${u2}','${a1}','Wrong','open')`,false],
 ['communal snag with null unit is valid',`insert into snags(building_id,unit_id,area_id,title,status) values('${id(1)}',null,'${a2}','Communal','open')`,true],
 ['legacy snag without modern location is retained',`insert into snags(title,status) values('Legacy flat-only record','open')`,true],
 ['area cannot detach an existing snag',`update areas set unit_id='${u2}' where id='${a1}'`,false],
 ['invoice document must belong to same attempt',`insert into unit_sale_invoices(sale_attempt_id,document_id) values('${s2}','${d1}')`,false],
 ['payment invoice must belong to same attempt',`insert into unit_sale_invoice_payments(sale_attempt_id,invoice_id,payment_source,payer_type,amount,paid_at) values('${s2}','${i1}','other','other',1,current_date)`,false],
 ['approval pointer cannot name another document version',`update unit_sale_documents set approved_version_id='${v2}' where id='${d1}'; set constraints all immediate`,false],
 ['historical same-document approval pointer is valid',`update unit_sale_documents set approved_version_id='${v1}' where id='${d1}'; set constraints all immediate`,true],
 ['historical invoice stays attached to its inactive attempt',`insert into unit_sale_invoices(sale_attempt_id,document_id) values('${s2}','${d2}')`,true],
 ['deleting an approved version preserves existing SET NULL behaviour',`delete from unit_sale_document_versions where id='${v1}'; set constraints all immediate`,true],
 ['historical document deletion preserves optional invoice attachment behaviour',`delete from unit_sale_documents where id='${d2}'; set constraints all immediate`,true]
];
const setup=`begin;set local request.jwt.claims='{"role":"service_role"}';set local app.sales_legal_write='on';set local app.completion_package_write='on';
insert into units(id,building_id,unit_number,sale_status) values('${u1}','${id(1)}','Constraint ${u1}','for_sale'),('${u2}','${id(1)}','Constraint ${u2}','for_sale');
insert into areas(id,building_id,unit_id,area_type,name) values('${a1}','${id(1)}','${u1}','unit_room','Room'),('${a2}','${id(1)}',null,'communal_area','Lobby');
insert into snags(building_id,unit_id,area_id,title,status) values('${id(1)}','${u1}','${a1}','Existing','open');
insert into unit_sale_attempts(id,building_id,unit_id,attempt_number,workflow_status,is_active) values('${s1}','${id(1)}','${u1}',1,'draft',true),('${s2}','${id(1)}','${u2}',1,'fallen_through',false);
insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status) values('${d1}','${s1}','reservation_form','Current','uploaded'),('${d2}','${s2}','reservation_form','Historic','uploaded');
insert into unit_sale_document_versions(id,document_id,version_number,storage_bucket,storage_path,file_name,mime_type,is_current) values('${v1}','${d1}',1,'sale-documents','constraints/${v1}.pdf','Historical.pdf','application/pdf',false),('${v2}','${d2}',1,'sale-documents','constraints/${v2}.pdf','Other.pdf','application/pdf',true);
insert into unit_sale_invoices(id,sale_attempt_id,status) values('${i1}','${s1}','approved');
create function pg_temp.try_change(q text) returns jsonb language plpgsql as $$begin execute q;return jsonb_build_object('accepted',true);exception when others then return jsonb_build_object('accepted',false,'code',SQLSTATE,'message',SQLERRM);end$$;
select json_agg(json_build_object('name',name,'expected',expected,'result',pg_temp.try_change(command))) from (values ${cases.map(([name,command,expected])=>`(${q(name)},${q(command)},${expected})`).join(',')}) v(name,command,expected);
rollback;`;
const output=sql(setup),line=output.split('\n').find(l=>l.startsWith('[{'));const results=JSON.parse(line);for(const t of results){assert.equal(t.result.accepted,t.expected,t.name+': '+JSON.stringify(t.result));if(!t.expected)assert.ok(['23503','23514'].includes(t.result.code),t.name+': '+JSON.stringify(t.result));}
fs.writeFileSync('artifacts/backend-foundation/ownership-tests.json',JSON.stringify({at:new Date().toISOString(),environment:'bunnywell-backend-foundation',method:'PostgreSQL constraint transactions; rolled back; not role permission tests',results:results.map(r=>({...r,passed:true}))},null,2));console.log(results.map(x=>({name:x.name,passed:true})));
