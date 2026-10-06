-- Keep existing trusted service RPC attribution during the staged rollout.
-- Ordinary JWTs still cannot override their authenticated identity.
create or replace function portal_audit.stamp_general() returns trigger language plpgsql
security definer set search_path='' as $$
declare actor uuid := portal_audit.actor();
begin
  if actor is null and auth.jwt()->>'role'='service_role' then
    -- Existing service-only routes/RPCs derive this explicit actor after
    -- authentication. Do not erase their supplied actor during rollout.
    actor:=new.created_by_user_id;
  end if;
  new.created_by_user_id := actor;
  new.created_at := statement_timestamp();
  select organisation_id into new.actor_organisation_id from public.profiles where id=actor;
  select coalesce(nullif(full_name,''),nullif(name,'')),role::text into new.actor_name,new.actor_role from public.profiles where id=actor;
  if pg_trigger_depth()=1 and auth.jwt()->>'role'='authenticated' and coalesce(current_setting('portal_audit.internal_write',true),'')<>'true' then
    new.source := 'client_reported'; new.outcome := 'reported';
    select coalesce(jsonb_object_agg(key,value),'{}') into new.metadata
    from jsonb_each(new.metadata) where key in ('building_id','buildingId','unit_id','unitId','userId','action_id','source');
    if coalesce(new.field_name,'') ~* '(email|phone|password|token|buyer|notes|contact)' then
      new.previous_value:=null; new.new_value:=null;
    end if;
  end if;
  return new;
end $$;
revoke all on function portal_audit.stamp_general() from public,anon,authenticated;
