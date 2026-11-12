import {loadTypescriptModule} from "../../tests/helpers/load-typescript-module.mjs";
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {sql,isolation} from '../backend-foundation/runtime.mjs';
isolation();
const unit=randomUUID(),sale=randomUUID(),document=randomUUID(),version=randomUUID(),request=randomUUID(),submit=randomUUID(),approve=randomUUID();
const id=n=>'b1700000-0000-4000-8000-'+String(n).padStart(12,'0'),building=id(1),dev=id(901),agent=id(904);
const migration=fs.readFileSync('supabase/migrations/20261112184548_workspace_sales_commands.sql','utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
const payload={buyerPersonName:'Fictional Reservation Test',buyerEmail:'reservation-test@example.invalid',buyerPhone:'00000000000',buyerSolicitorName:'Fictional Test Solicitor',reservationDate:new Date().toISOString().slice(0,10),reservationTermsChecked:true,versionId:version};
const {termsSnapshotFromDefaults}=loadTypescriptModule("src/lib/sales/reservation-terms.ts");
const terms=termsSnapshotFromDefaults({currentTerms:{contract_price:100000,list_price_at_offer:100000,exchange_deposit_percent:10,second_deposit_enabled:false,completion_balance_percent:90,agent_fee_percent:2,exchange_agent_fee_percent:1,completion_agent_fee_percent:1,vat_rate:20}});
const schedule=[{sequenceNo:1,paymentStage:'exchange',label:'10% on exchange',dueEvent:'exchange',dueOffsetDays:0,percentOfContractPrice:10,expectedAmount:10000,includesReservationFee:true},{sequenceNo:2,paymentStage:'completion',label:'90% on completion',dueEvent:'completion',dueOffsetDays:0,percentOfContractPrice:90,expectedAmount:90000,includesReservationFee:false}];
const j=o=>"'"+JSON.stringify(o).replaceAll("'","''")+"'::jsonb";
const call=(action,req,body=payload,who=agent,expected="a.updated_at",extra="")=>"public.workspace_reservation_command('"+building+"','"+unit+"','"+sale+"','"+who+"','"+req+"','"+action+"',"+expected+","+j(body)+extra+")";
const extras=", (select to_jsonb(t) from unit_sale_terms t where sale_attempt_id='"+sale+"' and is_current),(select to_jsonb(d) from building_sale_defaults d where building_id='"+building+"'),"+j(terms)+","+j(schedule);
const main=`begin;
${migration}
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.headers','{"x-bunnywell-audit-actor":"${agent}"}',true);
insert into units(id,building_id,unit_number,sale_status) values('${unit}','${building}','Atomic reservation rehearsal','for_sale');
insert into unit_sale_attempts(id,building_id,unit_id,attempt_number,workflow_status) values('${sale}','${building}','${unit}',1,'draft');
insert into unit_sale_terms(sale_attempt_id,contract_price) values('${sale}',100000);
do $test$
declare a unit_sale_attempts%rowtype; before_state jsonb; out1 jsonb; out2 jsonb; denied boolean;
begin
 select * into a from unit_sale_attempts where id='${sale}';
 out1:=${call('save_reservation_draft',request)};
 out2:=${call('save_reservation_draft',request)};
 if out1 is distinct from out2 or (select count(*) from workspace_commands.receipts where id='${request}')<>1 or (select count(*) from unit_sale_workflow_events where sale_attempt_id='${sale}' and event_type='reservation_draft_saved')<>1 then raise exception 'Draft replay duplicated state'; end if;
 denied:=false;begin perform ${call('save_reservation_draft',request,{...payload,buyerPersonName:'Conflicting body'})};exception when others then denied:=sqlerrm like '%reference conflicts%';end;if not denied then raise exception 'Conflicting replay accepted';end if;
 denied:=false;begin perform ${call('save_reservation_draft',randomUUID(),payload,agent,"a.updated_at-interval '1 second'")};exception when others then denied:=sqlerrm like '%sale changed%';end;if not denied then raise exception 'Stale command accepted';end if;
 denied:=false;begin perform ${call('save_reservation',submit,payload,agent,'a.updated_at',extras)};exception when others then denied:=sqlerrm like '%current reservation PDF%';end;if not denied then raise exception 'Missing form accepted';end if;
 if exists(select 1 from workspace_commands.receipts where id='${submit}') then raise exception 'Failed submission receipt survived';end if;
end $test$;
insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status,visibility) values('${document}','${sale}','reservation_form','Fictional test form','uploaded','shared_sale_file');
insert into unit_sale_document_versions(id,document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes) values('${version}','${document}',1,true,'sale-documents','synthetic-rollback-only.pdf','Synthetic.pdf','application/pdf',100);
do $test$
declare a unit_sale_attempts%rowtype; before_terms jsonb; denied boolean; out1 jsonb; out2 jsonb;
begin
 select * into a from unit_sale_attempts where id='${sale}';
 select to_jsonb(t) into before_terms from unit_sale_terms t where sale_attempt_id='${sale}' and is_current;
 denied:=false;begin
 perform public.workspace_reservation_command('${building}','${unit}','${sale}','${agent}','${randomUUID()}','save_reservation',a.updated_at,${j(payload)},before_terms,(select to_jsonb(d) from building_sale_defaults d where building_id='${building}'),${j(terms)},${j([{...schedule[0],paymentStage:'invalid'},schedule[1]])});
 exception when check_violation then denied:=true;end;
 if not denied or (select to_jsonb(t) from unit_sale_terms t where sale_attempt_id='${sale}' and is_current) is distinct from before_terms or exists(select 1 from unit_sale_payment_schedule where sale_attempt_id='${sale}') then raise exception 'Failed schedule did not roll back all earlier writes';end if;
 out1:=${call('save_reservation',submit,payload,agent,'a.updated_at',extras)};
 if (select workflow_status from unit_sale_attempts where id='${sale}')<>'awaiting_approval' or (select count(*) from unit_sale_payment_schedule where sale_attempt_id='${sale}')<>2 then raise exception 'Submission not atomic';end if;
 denied:=false;begin perform ${call('approve_reservation',approve)};exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Agent could approve';end if;
 perform set_config('request.headers','{"x-bunnywell-audit-actor":"${dev}"}',true);
 select * into a from unit_sale_attempts where id='${sale}';
 out1:=${call('approve_reservation',approve,payload,dev)};
 out2:=${call('approve_reservation',approve,payload,dev)};
 if out1 is distinct from out2 or (select sale_status from units where id='${unit}')<>'reserved' or (select approved_version_id from unit_sale_documents where id='${document}')<>'${version}'::uuid or (select status from unit_sale_terms where sale_attempt_id='${sale}' and is_current)<>'approved' then raise exception 'Approval or retry inconsistent';end if;
 if (select count(*) from unit_sale_workflow_events where sale_attempt_id='${sale}' and event_type='reservation_approved')<>1 then raise exception 'Duplicate approval activity';end if;
 if has_function_privilege('authenticated','public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') or has_function_privilege('anon','public.workspace_reservation_command(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') then raise exception 'Client execution granted';end if;
end $test$;
select 'atomic-reservation-checks-passed';
rollback;`;
const output=sql(main);assert(output.includes('atomic-reservation-checks-passed'));
assert.equal(sql("select count(*) from unit_sale_attempts where id='"+sale+"';").trim(),'0');
fs.mkdirSync('artifacts/hosted-completion',{recursive:true});
const evidence={at:new Date().toISOString(),method:'Isolated local PostgreSQL; migration and fictional records inside a rolled-back transaction',checks:['draft retry produces one receipt and event','conflicting retry rejected','stale edit rejected','missing PDF rejected','mid-command schedule constraint failure rolls back terms and schedule','submission atomic','agent approval rejected','approval atomically updates sale, unit, terms, document and event','approval retry returns same result without duplicate event','anonymous and authenticated direct execution denied','outer rollback removes all rehearsal records and migration'],passed:true,destinationBusinessRecordsChanged:[]};
fs.writeFileSync('artifacts/hosted-completion/reservation-atomic-rehearsal.json',JSON.stringify(evidence,null,2)+'\n');console.log(evidence);
