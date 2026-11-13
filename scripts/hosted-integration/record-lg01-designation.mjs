import fs from 'node:fs';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';import {keys,origin,project} from './runtime.mjs';
assert.equal(project,'mmwzhzziqvjbsphrkbqr');const scopes={LG01:['f29914be-cb37-4251-b3a7-fba6c73c431b','e36611ff-7423-48c9-83db-d6ebba85b685']};const label=process.argv[2],mode=process.argv[3]||'after';assert(scopes[label]);assert(['before','after','captured'].includes(mode));const [unit,sale]=scopes[label],building='35de5f9d-3217-4a11-beaf-83519bda9e5b';
const client=createClient(origin,keys().service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,options)=>{assert.equal(new URL(typeof input==='string'?input:input.url).origin,origin);assert.equal(options?.method||'GET','GET');return fetch(input,{...options,redirect:'error'})}}});
const rows=async(table,col,id)=>{const r=await client.from(table).select('*').eq(col,id);assert.ifError(r.error);return r.data};
const data={project,scope:{buildingId:building,unitId:unit,saleId:sale},at:new Date().toISOString(),unit:await rows('units','id',unit),sale:await rows('unit_sale_attempts','id',sale),terms:await rows('unit_sale_terms','sale_attempt_id',sale),schedule:await rows('unit_sale_payment_schedule','sale_attempt_id',sale),documents:await rows('unit_sale_documents','sale_attempt_id',sale),versions:[],emails:await rows('sale_legal_emails','sale_attempt_id',sale),events:await rows('unit_sale_workflow_events','sale_attempt_id',sale),comments:await rows('sale_comments','sale_attempt_id',sale)};
for(const d of data.documents)data.versions.push(...await rows('unit_sale_document_versions','document_id',d.id));
assert.equal(data.unit[0].building_id,building);assert.equal(data.sale[0].unit_id,unit);

fs.mkdirSync('tmp/hosted-lg01',{recursive:true});
const output='tmp/hosted-lg01/'+mode+'.json';
if(mode==='before'){assert(!fs.existsSync(output),'Preserve the recovery export');assert.equal(data.sale[0].workflow_status,'approved');assert.equal(data.sale[0].exchanged_at,null);assert.equal(data.emails.length,0);}
fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({project,scope:data.scope,mode,workflow:data.sale[0].workflow_status,emails:data.emails.map(e=>({id:e.id,kind:e.kind,status:e.delivery_status,sentAt:e.sent_at,providerId:e.resend_message_id})),eventCount:data.events.length,privateExport:output}));
if(mode==='after'){
 const before=JSON.parse(fs.readFileSync('tmp/hosted-lg01/before.json','utf8'));
 const unchanged=[];
 for(const key of ['unit','sale','terms','schedule','documents','versions','emails','events','comments']){assert.deepEqual(data[key],before[key],key+' was changed by designation');unchanged.push(key);}
 fs.mkdirSync('artifacts/hosted-lg01',{recursive:true});
 fs.writeFileSync('artifacts/hosted-lg01/designation-reconciliation.json',JSON.stringify({project,scope:data.scope,at:data.at,method:'Read-only hosted database comparison before and after explicit test enrollment',unchangedBusinessCollections:unchanged,changedRecords:[{table:'workspace_commands.test_journeys',saleId:sale,reason:'User explicitly confirmed fictional test details and requested LG01 designation'}],externalDelivery:'none'},null,2)+'\n');
 console.log('All LG01 business records unchanged by designation.');
}


if(mode==='captured'){
 const before=JSON.parse(fs.readFileSync('tmp/hosted-lg01/before.json','utf8'));
 const unchanged=['unit','terms','schedule','documents','versions','comments'];
 for(const key of unchanged)assert.deepEqual(data[key],before[key],key+' changed unexpectedly');
 const changedFields=Object.keys(data.sale[0]).filter(k=>JSON.stringify(data.sale[0][k])!==JSON.stringify(before.sale[0][k]));
 for(const k of changedFields)assert(['workflow_status','commercial_approved_at','commercial_approved_by_user_id','updated_at','stage_entered_at'].includes(k),'Unexpected sale change: '+k);
 assert.equal(data.sale[0].workflow_status,'ready_for_exchange');assert.equal(data.sale[0].exchanged_at,null);
 assert.equal(data.emails.length,1);assert.equal(data.emails[0].delivery_status,'captured_test');assert.equal(data.emails[0].sent_at,null);assert.equal(data.emails[0].resend_message_id,null);
 const previousEvents=new Map(before.events.map(e=>[e.id,e]));
 for(const e of data.events)if(previousEvents.has(e.id))assert.deepEqual(e,previousEvents.get(e.id),'Historical event changed');
 const journal={project,scope:data.scope,at:data.at,method:'Read-only comparison after genuine hosted developer capture and conveyancer enabled-button/refresh checks; exchange intentionally left for user',changedRecords:{
  testJourney:{table:'workspace_commands.test_journeys',saleId:sale,fictionalConfirmation:true},
  sale:{id:sale,fields:changedFields},
  legalEmails:data.emails.map(e=>({id:e.id,kind:e.kind,version:e.version,status:e.delivery_status,expiresAt:e.expires_at,sentAt:e.sent_at,providerId:e.resend_message_id})),
  testDeliveries:data.emails.map(e=>({emailId:e.id,saleId:sale})),
  events:data.events.filter(e=>!previousEvents.has(e.id)).map(e=>({id:e.id,type:e.event_type,at:e.created_at}))
 },unchangedBusinessCollections:unchanged,allBuyerFieldsUnchanged:true,exchangedAt:null,externalDelivery:'none'};
 fs.writeFileSync('artifacts/hosted-lg01/capture-reconciliation.json',JSON.stringify(journal,null,2)+'\n');
 console.log(JSON.stringify(journal));
}
