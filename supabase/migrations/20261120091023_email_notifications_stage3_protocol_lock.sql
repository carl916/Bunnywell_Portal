create or replace function public.workspace_notification_worker(p_worker uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare active boolean; result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server dispatcher required.' using errcode='42501';end if;
 -- Serialize the protocol check with both activation and the underlying lease claim.
 select stage3_active into active from workspace_commands.notification_dispatch_state where singleton for update;
 if active and p_payload->>'protocol' is distinct from '3' then return jsonb_build_object('claimed',false,'upgradeRequired',true);end if;
 result:=public.workspace_notification_worker_v2(p_worker,p_action,p_payload);
 if p_action='claim' and (result->>'claimed')::boolean and active then perform workspace_commands.expire_notification_authorities();end if;
 return result;
end $$;
revoke all on function public.workspace_notification_worker(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_notification_worker(uuid,text,jsonb) to service_role;
