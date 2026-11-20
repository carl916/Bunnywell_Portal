-- Stage 1 only. No triggers, mail delivery, queues or existing email paths change.
begin;

-- The sole event catalogue. Add events here without rewriting saved overrides.
create function workspace_commands.email_notification_catalogue() returns jsonb
language sql immutable set search_path = '' as $$
 select '[
  {"id":"reservation_submitted","label":"Reservation submitted / resubmitted","kind":"roles","roles":["developer"]},
  {"id":"reservation_approved","label":"Reservation approved","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"reservation_queried","label":"Reservation returned / queried","kind":"roles","roles":["sales_agent"]},
  {"id":"exchange_authority_requested","label":"Exchange authority requested","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"exchange_authority_expired","label":"Exchange authority expired","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"exchange_authority_revoked","label":"Exchange authority revoked","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"unit_exchanged","label":"Unit exchanged","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"notice_authority_requested","label":"Authority to serve notice requested","kind":"roles","roles":["developer"]},
  {"id":"contractual_completion_date_changed","label":"Contractual completion date confirmed / changed","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"completion_documents_uploaded","label":"Completion documents uploaded for review","kind":"roles","roles":["developer"]},
  {"id":"completion_document_queried","label":"Completion document queried","kind":"roles","roles":["conveyancer"]},
  {"id":"completion_documents_approved","label":"Both completion documents approved","kind":"roles","roles":["conveyancer"]},
  {"id":"unit_legally_completed","label":"Unit legally completed","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"handover_completed","label":"Handover completed","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"sale_fallen_through","label":"Sale falls through / returned to market","kind":"roles","roles":["developer","sales_agent","conveyancer"]},
  {"id":"comment_added","label":"Comment added","kind":"roles","roles":[]},
  {"id":"comment_mentioned","label":"Mentioned in a comment","kind":"mention","roles":[],"enabled":true}
 ]'::jsonb
$$;

create table workspace_commands.email_notification_settings (
 singleton boolean primary key default true check (singleton),
 role_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(role_overrides) = 'object'),
 mentions_enabled boolean not null default true,
 version integer not null default 0 check (version >= 0),
 updated_at timestamptz,
 updated_by uuid references public.profiles(id)
);
alter table workspace_commands.email_notification_settings enable row level security;
revoke all on workspace_commands.email_notification_settings from public, anon, authenticated, service_role;
insert into workspace_commands.email_notification_settings(singleton) values(true);

create function workspace_commands.email_notification_configuration() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('version',s.version,'updatedAt',s.updated_at,'events',
   (select jsonb_agg(e.value || jsonb_build_object(
     'roles',coalesce(s.role_overrides->(e.value->>'id'),e.value->'roles'),
     'enabled',case when e.value->>'kind'='mention' then s.mentions_enabled else true end
   ) order by e.ordinality)
   from jsonb_array_elements(workspace_commands.email_notification_catalogue()) with ordinality e)
 ) from workspace_commands.email_notification_settings s where s.singleton
$$;

create function public.workspace_email_notification_settings(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform workspace_commands.setup_actor(p_actor);
 return workspace_commands.email_notification_configuration();
end $$;

create function public.workspace_save_email_notifications(p_actor uuid,p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 current_settings workspace_commands.email_notification_settings%rowtype;
 prior workspace_commands.operation_receipts%rowtype;
 entry record; result jsonb; before_value jsonb;
 -- Stable identity of this system-wide configuration, never a building ID.
 settings_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
 perform workspace_commands.setup_actor(p_actor);
 if p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
   or jsonb_typeof(p_payload->'roles') is distinct from 'object'
   or jsonb_typeof(p_payload->'mentionsEnabled') is distinct from 'boolean'
   or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number'
   or (p_payload->>'expectedVersion') !~ '^[0-9]+$'
   or p_payload - array['roles','mentionsEnabled','expectedVersion'] <> '{}'::jsonb
 then raise exception 'Valid notification settings and version are required.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from workspace_commands.operation_receipts where id=p_request;
 if found then
   if prior.actor_id<>p_actor or prior.action<>'save_email_notifications' or prior.target_id<>settings_id or prior.input is distinct from p_payload
   then raise exception 'Submission reference conflicts with the saved operation.' using errcode='22023'; end if;
   return prior.result;
 end if;
 for entry in select * from jsonb_each(p_payload->'roles') loop
   if not exists(select 1 from jsonb_array_elements(workspace_commands.email_notification_catalogue()) e where e->>'id'=entry.key and e->>'kind'='roles')
     or jsonb_typeof(entry.value) is distinct from 'array'
   then raise exception 'Unknown notification event or invalid role selection.' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements(entry.value) r where jsonb_typeof(r)<>'string' or r#>>'{}' not in ('developer','sales_agent','conveyancer'))
     or jsonb_array_length(entry.value)<>(select count(distinct r) from jsonb_array_elements(entry.value) r)
   then raise exception 'Choose valid, distinct notification roles.' using errcode='22023'; end if;
 end loop;
 select * into strict current_settings from workspace_commands.email_notification_settings where singleton for update;
 if current_settings.version::text is distinct from p_payload->>'expectedVersion'
 then raise exception 'Email notification settings changed. Reload before saving.' using errcode='40001'; end if;
 before_value:=workspace_commands.email_notification_configuration();
 update workspace_commands.email_notification_settings
 set role_overrides=role_overrides||(p_payload->'roles'),mentions_enabled=(p_payload->>'mentionsEnabled')::boolean,
   version=version+1,updated_at=clock_timestamp(),updated_by=p_actor where singleton;
 result:=workspace_commands.email_notification_configuration();
 insert into public.audit_events(event_type,entity_type,entity_id,summary,category,created_by_user_id,metadata,action_id,source,outcome)
 values('email_notifications_updated','system_settings',settings_id,'Email notification settings saved for all buildings.','setup',p_actor,
   jsonb_build_object('before',before_value,'after',result,'request_id',p_request),p_request,'workspace_setup','success');
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result)
 values(p_request,p_actor,'save_email_notifications',settings_id,p_payload,result);
 return result;
end $$;

-- Trusted facts for the server resolver. No browser endpoint exposes this RPC.
-- Existing profiles have one role. The array contract also supports multiple roles
-- without duplicating recipients if the portal gains multi-role membership later.
create function public.workspace_email_notification_context(p_sale uuid,p_comment uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare comment_record public.sale_comments%rowtype; candidates jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
   raise exception 'Server notification selection required.' using errcode='42501';
 end if;
 if not exists(select 1 from public.unit_sale_attempts where id=p_sale and redacted_at is null) then
   raise exception 'Sale unavailable.' using errcode='22023';
 end if;
 if p_comment is not null then
   select * into comment_record from public.sale_comments where id=p_comment and sale_attempt_id=p_sale;
   if not found then raise exception 'Comment unavailable on this sale.' using errcode='22023'; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'userId',p.id,'email',p.email,'active',p.active,
   'roles',jsonb_build_array(case when p.role::text='admin' then 'developer' else p.role::text end),
   'canAccessSale',true,
   'canViewComment',p_comment is not null and public.sale_discussion_access(p_sale,p.id),
   'mentioned',p_comment is not null and p.id=any(coalesce(comment_record.mention_ids,'{}'::uuid[]))
 ) order by p.id),'[]'::jsonb) into candidates
 from public.profiles p
 where p.active and nullif(btrim(p.email),'') is not null
   and p.role::text in ('admin','developer','sales_agent','conveyancer')
   and public.can_access_sale(p_sale,p.id);
 return jsonb_build_object('settings',workspace_commands.email_notification_configuration(),
   'saleId',p_sale,'commentId',p_comment,'candidates',candidates);
end $$;

revoke all on function workspace_commands.email_notification_catalogue(),workspace_commands.email_notification_configuration() from public,anon,authenticated,service_role;
revoke all on function public.workspace_email_notification_settings(uuid),public.workspace_save_email_notifications(uuid,uuid,jsonb),public.workspace_email_notification_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_email_notification_settings(uuid),public.workspace_save_email_notifications(uuid,uuid,jsonb),public.workspace_email_notification_context(uuid,uuid) to service_role;
commit;
