import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { tables, readDump, copyValue } from '../scripts/backups/read-dump.mjs';
import { buildModel, progression } from '../scripts/backups/model.mjs';
import { storageReference, safeStoragePath, collectAssets } from '../scripts/backups/assets.mjs';
import { generate } from '../scripts/backups/generate-workbook.mjs';

export const snapshot='2026-10-07T02:17:00Z';
export function fixture(){
  const d=Object.fromEntries(tables.map(t=>[t,[]]));
  d.buildings=[{id:'b',name:'Example House'}];
  d.building_floors=[{id:'lg',building_id:'b',name:'Lower Ground',sort_order:'-1'},{id:'g',building_id:'b',name:'Ground',sort_order:'0'},{id:'f',building_id:'b',name:'First',sort_order:'1'}];
  d.units=[{id:'u1',building_id:'b',floor:'First',unit_number:'101',sale_status:'for_sale'},{id:'ug',building_id:'b',floor:'Ground',unit_number:'G02',sale_status:'for_sale'},{id:'ul',building_id:'b',floor:'Lower Ground',unit_number:'LG01',sale_status:'exchanged'}];
  d.unit_sale_attempts=[{id:'s',unit_id:'ul',building_id:'b',is_active:'t',workflow_status:'exchanged',attempt_number:'1',buyer_name:'Example Buyer',exchanged_at:'2026-10-01',completion_authority_given_at:'2026-10-02T10:00:00Z',completion_arrangements_confirmed_at:'2026-10-03T10:00:00Z',contractual_completion_date:'2026-10-06'}];
  d.unit_sale_terms=[{id:'terms',sale_attempt_id:'s',version_number:'1',is_current:'t',status:'approved',contract_price:'300000',agent_fee_percent:'2',reservation_fee:'5000'}];
  d.unit_sale_documents=[{id:'doc',sale_attempt_id:'s',document_type:'completion_statement',status:'approved',approved_version_id:'v1'},{id:'account',sale_attempt_id:'s',document_type:'draft_statement_of_account',status:'approved',approved_version_id:'va'}];
  d.unit_sale_document_versions=[{id:'v1',document_id:'doc',version_number:'1',is_current:'f',storage_bucket:'sale-documents',storage_path:'s/old.pdf',file_name:'Original statement.pdf'},
    {id:'v2',document_id:'doc',version_number:'2',is_current:'t',storage_bucket:'sale-documents',storage_path:'s/new.pdf',file_name:'Replacement statement.pdf'},
    {id:'va',document_id:'account',version_number:'1',is_current:'t',storage_bucket:'sale-documents',storage_path:'s/account.pdf',file_name:'Account.pdf'}];
  d.unit_sale_invoices=[{id:'inv',sale_attempt_id:'s',expected_payable_amount:'6000',invoice_reference:'INV-1',status:'part_paid'}];
  d.unit_sale_invoice_payments=[{id:'pay',invoice_id:'inv',sale_attempt_id:'s',amount:'1000'},{id:'void',invoice_id:'inv',sale_attempt_id:'s',amount:'500',voided_at:'2026-10-06T00:00:00Z'}];
  d.sale_exchange_deposit_receipts=[{id:'r1',sale_attempt_id:'s',revision:'1',expected_amount:'30000',received_amount:'30000',received_date:'2026-10-01'},{id:'r2',sale_attempt_id:'s',revision:'2',supersedes_id:'r1',expected_amount:'30000',received_amount:'30000',received_date:'2026-10-02'}];
  d.snags=[{id:'snag',building_id:'b',unit_id:'ul',title:'=HYPERLINK("https://bad.invalid","Click")',description:'Repair wall\nThen inspect\tfinish',status:'open',priority_code:'P2',sla_due_date:'2026-10-05',created_at:'2026-10-01T10:00:00Z'}];
  d.snag_photos=[{id:'photo',snag_id:'snag',storage_path:'snag/original.jpg',file_url:'https://zxgezoiazsubopqhqhim.supabase.co/storage/v1/object/public/snag-images/snag/original.jpg',photo_type:'original'}];
  d.sale_legal_emails=[{id:'email',sale_attempt_id:'s',subject:'Authority example',body:'Saved original correspondence',kind:'authority',version:'1',issued_at:'2026-10-01T10:00:00Z',delivery_status:'sent'}];
  return d;
}
export function dump(data){return Object.entries(data).map(([table,rows])=>{
  const cols=[...new Set(rows.flatMap(Object.keys))];if(!cols.length)cols.push('id');
  const encode=value=>value==null?'\\N':String(value).replaceAll('\\','\\\\').replaceAll('\t','\\t').replaceAll('\n','\\n').replaceAll('\r','\\r');
  return `COPY "public"."${table}" (${cols.map(c=>`"${c}"`).join(', ')}) FROM stdin;\n${rows.map(row=>cols.map(c=>encode(row[c])).join('\t')+'\n').join('')}\\.\n`;
}).join('\n');}
async function temporary(t){const dir=await mkdtemp(path.join(tmpdir(),'bunnywell-workbook-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('COPY parser preserves escaped text and nulls while excluding Auth data',async t=>{
  const dir=await temporary(t),source=fixture(),file=path.join(dir,'data.sql');
  await writeFile(file,dump(source)+'COPY auth.users (id, encrypted_password) FROM stdin;\nx\tsecret-not-for-export\n\\.\n');
  const result=await readDump(file);assert.equal(result.snags[0].description,source.snags[0].description);assert.equal(result.snags[0].title,source.snags[0].title);
  assert.ok(!JSON.stringify(result).includes('secret-not-for-export'));assert.equal(copyValue('\\N'),null);assert.equal(copyValue('\\\\N'),'\\N');
  await writeFile(file,dump(source).replace(/COPY "public"\."units"[\s\S]*?\\\.\n/,''));await assert.rejects(readDump(file),/Missing required.*units/);
});
test('model uses configured floor order, exact approved versions, actual receipts and void handling',()=>{
  const m=buildModel(fixture(),{snapshot,projectRef:'zxgezoiazsubopqhqhim'});
  assert.deepEqual(m.sales.map(s=>s.unit),['LG01','G02','101']);
  assert.equal(m.sales[0].action,'Review current completion documents');assert.equal(m.sales[0].statement,'Current version awaiting approval');
  assert.equal(m.sales[0].account,'Current version approved');assert.equal(m.sales[0].deposit,30000);assert.equal(m.sales[0].depositDate,'2026-10-02');
  assert.equal(m.payments.find(p=>p.id==='inv').balance,5000);assert.equal(m.payments.find(p=>p.id==='r1').status,'Superseded confirmation (not another payment)');
  assert.ok(m.exceptions.some(e=>e.issue==='Snag deadline has passed'));
});
test('percentage concessions become currency and locked deposit expectations are not receipts',()=>{
  const d=fixture();Object.assign(d.unit_sale_terms[0],{developer_contribution_value:'2',developer_contribution_value_type:'percent'});
  d.sale_exchange_deposit_sources=[{id:'source',sale_attempt_id:'s',expected_amount:'30000',authority_version:'1',authority_id:'email',source_kind:'executed_authority'}];
  d.sale_exchange_deposit_receipts=[];
  d.unit_sale_notes=[{id:'hidden',sale_attempt_id:'s',body:'redacted information',redacted_at:snapshot}];
  const m=buildModel(d,{snapshot,projectRef:'zxgezoiazsubopqhqhim'});
  assert.equal(m.terms[0].developerContribution,6000);
  assert.equal(m.payments.find(p=>p.id==='source').expected,30000);
  assert.equal(m.payments.find(p=>p.id==='source').received,undefined);
  assert.equal(m.sales[0].deposit,null);
  assert.ok(!m.history.some(h=>h.id==='hidden'));
});
test('completion next action respects authority, notice and current document gates',()=>{
  const d=fixture(),a=d.unit_sale_attempts[0];
  assert.equal(progression({...a,completion_arrangements_confirmed_at:null,completion_authority_given_at:null},[],[],snapshot)[0],'Give authority to serve notice');
  assert.equal(progression({...a,completion_arrangements_confirmed_at:null},[],[],snapshot)[0],'Record notice and completion due date');
  assert.equal(progression(a,[],[],snapshot)[0],'Upload completion documents');
  assert.equal(progression({...a,completed_at:'2026-10-07'},[],[],snapshot)[0],'Arrange handover / check final account');
});
test('snag comments and earlier sales comments remain available in operational history',()=>{
  const d=fixture();
  d.snag_comments=[{id:'comment',snag_id:'snag',body:'Repair booked for Friday',created_at:'2026-10-06T10:00:00Z'}];
  d.sale_comment_revisions=[{sale_attempt_id:'s',comment_id:'sale-comment',version:'1',body:'Original instruction',recorded_at:'2026-10-01T12:00:00Z'}];
  const m=buildModel(d,{snapshot,projectRef:'zxgezoiazsubopqhqhim'});
  assert.equal(m.snags[0].latest,'Repair booked for Friday');
  assert.ok(m.history.some(h=>h.kind==='Snag comment'&&h.description==='Repair booked for Friday'));
  assert.ok(m.history.some(h=>h.kind==='Previous sales comment (version 1)'&&h.saleId==='s'));
});
test('redacted document versions are not reintroduced and external URLs are not fetched',()=>{
  const d=fixture();d.unit_sale_document_versions[0].redacted_at=snapshot;d.buildings[0].documents_url='https://example.test/building-documents';
  const m=buildModel(d,{snapshot,projectRef:'zxgezoiazsubopqhqhim'});assert.ok(!m.references.some(r=>r.id==='v1'));
  assert.ok(m.exceptions.some(e=>e.issue.startsWith('External link')));
  assert.equal(storageReference('https://other.supabase.co/storage/v1/object/public/files/a','zxgezoiazsubopqhqhim').external.startsWith('https://other'),true);
});
test('Storage mapping rejects traversal and wrong byte counts; missing files stop publication',async t=>{
  for(const key of ['../secret','a/../../secret','a\\secret','a/CON.txt','a/file:stream','a/file.'])assert.throws(()=>safeStoragePath('sale-documents',key));
  const dir=await temporary(t);await mkdir(path.join(dir,'media','sale-documents'),{recursive:true});await writeFile(path.join(dir,'media','sale-documents','a.pdf'),'pdf');
  await assert.rejects(collectAssets([{id:'x',bucket:'sale-documents',key:'missing.pdf'}],path.join(dir,'media'),path.join(dir,'out')),/missing/);
  await assert.rejects(collectAssets([{id:'x',bucket:'sale-documents',key:'a.pdf',expectedBytes:99}],path.join(dir,'media'),path.join(dir,'out')),/size changed/);
});
test('complete offline package has portable file links, typed currency, safe text and a separate working log',async t=>{
  const dir=await temporary(t),data=fixture(),input=path.join(dir,'data.sql'),media=path.join(dir,'media'),output=path.join(dir,'package');
  await writeFile(input,dump(data));
  for(const [bucket,key,bytes] of [['sale-documents','s/old.pdf','%PDF-old'],['sale-documents','s/new.pdf','%PDF-new'],['sale-documents','s/account.pdf','%PDF-account'],['snag-images','snag/original.jpg','photo']]){
    await mkdir(path.dirname(path.join(media,bucket,key)),{recursive:true});await writeFile(path.join(media,bucket,key),bytes);
  }
  const {manifest}=await generate({dump:input,media,output,snapshot});
  assert.equal(manifest.assets.length,5);for(const asset of manifest.assets)assert.ok((await readFile(path.join(output,asset.path))).length>0);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(output,'Bunnywell.xlsx'));
  assert.equal(book.getWorksheet('Sales progression').getCell('C5').value,'LG01');
  assert.equal(book.getWorksheet('Sales details').getCell('K5').value,300000);
  assert.equal(book.getWorksheet('Snags').getCell('E5').value,data.snags[0].title);assert.equal(book.getWorksheet('Snags').getCell('E5').type,ExcelJS.ValueType.String);
  const documents=book.getWorksheet('Documents');for(let r=5;r<=documents.rowCount;r++){const value=documents.getCell(r,6).value;if(value?.hyperlink)assert.ok((await readFile(path.join(output,value.hyperlink))).length>0);}
  assert.equal(book.getWorksheet('Payments and fees').getCell('I5').value.result,5000);
  assert.ok((await readFile(path.join(output,'Working log.xlsx'))).length>0);
  await assert.rejects(generate({dump:input,media,output,snapshot}),/immutable/);
});
