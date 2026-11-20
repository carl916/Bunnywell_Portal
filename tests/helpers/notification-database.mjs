import fs from 'node:fs';
import {discussionDatabase,ids} from './discussion-database.mjs';
export {ids};
export async function notificationDatabase() {
 const f=await discussionDatabase(); await f.owner();
 await f.db.exec(`
 create schema workspace_commands;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema portal_audit;
 create function portal_audit.actor() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$begin
  if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor or not exists(select 1 from profiles where id=p_actor and active and role in ('admin','developer')) then raise exception 'Verified Setup administrator required.' using errcode='42501';end if;
 end $$;
 create table workspace_commands.operation_receipts(id uuid primary key,actor_id uuid,action text,target_id uuid,input jsonb,result jsonb);
 alter table audit_events add column category text,add column action_id uuid,add column source text,add column outcome text;
 alter table unit_sale_attempts add column redacted_at timestamptz;
 update profiles set email='fixture-'||id||'@example.invalid';
 `);
 await f.db.exec(fs.readFileSync('supabase/migrations/20261119164807_email_notifications_stage1.sql','utf8'));
 await f.db.exec(`
 create table workspace_commands.test_journeys(sale_id uuid,building_id uuid,unit_id uuid);
 insert into workspace_commands.test_journeys select id,building_id,unit_id from unit_sale_attempts;
 create table workspace_commands.receipts(id uuid primary key,result jsonb);
 create function public.workspace_reservation_command(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_expected timestamptz,p_payload jsonb default '{}',p_expected_terms jsonb default null,p_expected_defaults jsonb default null,p_terms jsonb default null,p_schedule jsonb default null) returns jsonb language plpgsql as $$
 begin
 if exists(select 1 from workspace_commands.receipts where id=p_request) then return '{"replay":true}';end if;
 if p_payload->>'fail'='true' then raise exception 'Business command failed';end if;
 insert into workspace_commands.receipts values(p_request,'{}');return '{}';end $$;
 `);
 await f.db.exec(fs.readFileSync('supabase/migrations/20261119172934_email_notifications_stage2_queue.sql','utf8'));
 async function service(){await f.owner();await f.db.query("select set_config('request.jwt.claims',$1,false),set_config('test.actor',$2,false)",[JSON.stringify({role:'service_role'}),ids.developer]);await f.db.exec('set role service_role');}
 async function activate(){await f.owner();await f.db.exec('update workspace_commands.notification_dispatch_state set enabled=true,activated_at=clock_timestamp()');}
 async function rows(sql,args=[]){await f.owner();return (await f.db.query(sql,args)).rows;}
 const worker=async(id,action,payload={})=>{await service();return f.rpc('workspace_notification_worker',{p_worker:id,p_action:action,p_payload:payload});};
 return {...f,service,activate,rows,worker};
}
