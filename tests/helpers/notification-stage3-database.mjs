import fs from 'node:fs';
import {legalDatabase} from './legal-database.mjs';
const root='tests/fixtures/notification-stage3/';
export async function stage3Database(){
 const f=await legalDatabase();await f.owner();
 const schema=JSON.parse(fs.readFileSync(root+'baseline/table-columns.json','utf8'));
 for(const name of [...new Set(schema.map(x=>x.table_name))]){
  await f.db.exec(`create table if not exists public.${name}()`);
  const current=(await f.db.query('select column_name from information_schema.columns where table_schema=\'public\' and table_name=$1',[name])).rows.map(x=>x.column_name);
  for(const c of schema.filter(x=>x.table_name===name&&!current.includes(x.column_name))){
   const type=c.data_type==='USER-DEFINED'?'text':c.data_type==='ARRAY'?(c.udt_name==='_uuid'?'uuid[]':'text[]'):c.data_type;
   const defaultValue=c.column_default&&/^(now\(\)|gen_random_uuid\(\)|true|false|[0-9]+|'.*'::(?:text|numeric|boolean|jsonb|text\[\]))$/.test(c.column_default)?' default '+c.column_default:'';
   await f.db.exec(`alter table public.${name} add column ${c.column_name} ${type}${defaultValue}`);
  }
 }
 await f.db.exec(`
 create schema workspace_commands;create schema portal_audit;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
 create function portal_audit.actor() returns uuid language sql stable as $$select auth.uid()$$;
 create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql as $$begin if not exists(select 1 from public.profiles where id=p_actor and active and role in ('admin','developer')) then raise exception 'Setup denied';end if;end $$;
 create table workspace_commands.operation_receipts(id uuid primary key,actor_id uuid,action text,target_id uuid,input jsonb,result jsonb);
 create table workspace_commands.receipts(id uuid primary key,sale_id uuid,actor_id uuid,action text,input jsonb,result jsonb);
 create table workspace_commands.test_journeys(sale_id uuid primary key,building_id uuid,unit_id uuid);
 create table workspace_commands.test_deliveries(email_id uuid primary key,sale_id uuid,actor_id uuid,request_input jsonb);
 insert into workspace_commands.test_journeys select id,building_id,unit_id from unit_sale_attempts;
 alter table audit_events add column category text,add column action_id uuid,add column source text,add column outcome text;
 update profiles set email='fixture-'||id||'@example.invalid';
 create function public.workspace_reservation_command(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_expected timestamptz,p_payload jsonb default '{}',p_expected_terms jsonb default null,p_expected_defaults jsonb default null,p_terms jsonb default null,p_schedule jsonb default null) returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 for(const name of ['20261119164807_email_notifications_stage1.sql','20261119172934_email_notifications_stage2_queue.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 for(const name of ['workspace_commands.reservation_command_before_notifications','public.return_pre_exchange_unit_for_sale','workspace_commands.captured_authority','public.sales_legal_action_before_renewal','public.sale_comment_write'])await f.db.exec(fs.readFileSync(root+'baseline/'+name+'.sql','utf8'));
 const allocation=fs.readFileSync('supabase/migrations/20260828_commercial_unit_allocation.sql','utf8');
 for(const name of ['sales_workflow_mark_unit_for_sale','sales_workflow_mark_unit_reserved']){const start=allocation.indexOf('create or replace function public.'+name+'(');await f.db.exec(allocation.slice(start,allocation.indexOf('$$;',start)+3));}
 await f.db.exec(`create function public.building_allows_flat_handover(uuid) returns boolean language sql as $$select true$$;`);
 await f.db.exec(fs.readFileSync(root+'baseline/public.complete_handover_unit.sql','utf8'));
 await f.db.exec(`create trigger complete_handover before insert on handovers for each row execute function public.complete_handover_unit();`);
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120090014_email_notifications_stage3.sql','utf8'));
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120091023_email_notifications_stage3_protocol_lock.sql','utf8'));
 await f.db.exec(fs.readFileSync('supabase/migrations/20261120091456_email_notifications_stage3_delivery_polling.sql','utf8'));
 await f.db.exec(`
  alter table workspace_commands.notification_events add column details jsonb;
  alter table public.unit_sale_workflow_events add column if not exists actor_name text;
 `);
 async function activate(){await f.owner();await f.db.exec('update workspace_commands.notification_dispatch_state set enabled=true,activated_at=clock_timestamp(),stage3_active=true,delivery_enabled_at=clock_timestamp()');}
 async function rows(sql,args=[]){await f.owner();return (await f.db.query(sql,args)).rows;}
 async function events(){return rows('select event_id,source_key,sale_id,id from workspace_commands.notification_events order by sequence');}
 async function worker(id,action,payload={}){await f.service();return f.rpc('workspace_notification_worker',{p_worker:id,p_action:action,p_payload:{protocol:3,...payload}});}
 async function delivery(id,action,payload={}){await f.service();return f.rpc('workspace_sales_email_delivery',{p_worker:id,p_action:action,p_payload:payload});}
 async function prepareReservation(sale = f.ids.sale, unit = f.ids.unit) {
  await rows("update unit_sale_attempts set workflow_status='draft',updated_at=clock_timestamp() where id=$1",[sale]);
  await rows("update units set sale_status='for_sale' where id=$1",[unit]);
  const [doc]=await rows("insert into unit_sale_documents(sale_attempt_id,document_type,status) values($1,'reservation_form','uploaded') returning id",[sale]);
  const [version]=await rows("insert into unit_sale_document_versions(document_id,version_number,file_name) values($1,1,'reservation.pdf') returning id",[doc.id]);
  return version.id;
 }
 async function reservation(action,version,{payload={},request=crypto.randomUUID(),user='developer',sale=f.ids.sale,unit=f.ids.unit}={}) {
  const [attempt]=await rows('select updated_at from unit_sale_attempts where id=$1',[sale]);
  const [terms]=await rows('select to_jsonb(t) value from unit_sale_terms t where sale_attempt_id=$1 and is_current',[sale]);
  await f.service(user);
  const args={p_building:f.ids.building,p_unit:unit,p_sale:sale,p_actor:f.ids[user],p_request:request,p_action:action,p_expected:attempt.updated_at,
   p_payload:{buyerPersonName:'Synthetic buyer',buyerEmail:'buyer@example.invalid',buyerPhone:'02000000000',buyerSolicitorName:'Test solicitor',reservationDate:new Date().toISOString().slice(0,10),reservationTermsChecked:true,versionId:version,...payload},
   p_expected_terms:terms?.value??null,p_expected_defaults:null,p_terms:{contract_price:250000,exchange_deposit_percent:10,completion_balance_percent:90},p_schedule:[{sequenceNo:1,paymentStage:'exchange',percentOfContractPrice:10},{sequenceNo:2,paymentStage:'completion',percentOfContractPrice:90}]};
  const result=await f.rpc('workspace_reservation_command',args);
  return {result,args};
 }
 return {...f,activate,rows,events,worker,delivery,prepareReservation,reservation};
}
