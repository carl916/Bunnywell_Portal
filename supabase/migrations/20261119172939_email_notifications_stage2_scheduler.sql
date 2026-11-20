-- Applied only to staging project vxkpvdtrldwwqiddoyof. Initially disabled.
begin;
create extension if not exists pg_net with schema extensions;
create table workspace_commands.notification_schedule_requests(request_id bigint primary key,requested_at timestamptz not null default clock_timestamp());
alter table workspace_commands.notification_schedule_requests enable row level security;
revoke all on workspace_commands.notification_schedule_requests from public,anon,authenticated,service_role;
create function public.workspace_configure_notification_dispatch(p_secret text) returns void
language plpgsql security definer set search_path='' as $$begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server configuration required' using errcode='42501';end if;
 if length(p_secret)<32 or length(p_secret)>200 then raise exception 'Invalid dispatcher credential';end if;
 if exists(select 1 from vault.secrets where name='bunnywell_sales_notification_dispatch_staging') then raise exception 'Dispatcher credential already configured';end if;
 perform vault.create_secret(p_secret,'bunnywell_sales_notification_dispatch_staging','Staging sales capture dispatcher only');
end $$;
revoke all on function public.workspace_configure_notification_dispatch(text) from public,anon,authenticated;
grant execute on function public.workspace_configure_notification_dispatch(text) to service_role;
create function workspace_commands.dispatch_notification_tick() returns bigint
language plpgsql security definer set search_path='' as $$
declare credential text; request_id bigint;
begin
 if not exists(select 1 from workspace_commands.notification_dispatch_state where enabled and activated_at is not null) then return null;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='bunnywell_sales_notification_dispatch_staging';
 if credential is null then raise exception 'Staging dispatcher credential unavailable';end if;
 select net.http_post(url:='https://staging.bunnywell.co.uk/workspace/notification-dispatch',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||credential),timeout_milliseconds:=55000) into request_id;
 insert into workspace_commands.notification_schedule_requests(request_id) values(request_id);
 return request_id;
end $$;
revoke all on function workspace_commands.dispatch_notification_tick() from public,anon,authenticated,service_role;
select cron.schedule('bunnywell-sales-capture-staging','* * * * *','select workspace_commands.dispatch_notification_tick();');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='bunnywell-sales-capture-staging';
commit;
