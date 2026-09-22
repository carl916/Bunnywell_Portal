-- Renewals append request activity; issued authority snapshots are untouched.
begin;
alter function public.sales_legal_action(uuid,text,jsonb,uuid) rename to sales_legal_action_before_renewal;
revoke all on function public.sales_legal_action_before_renewal(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; comment_id uuid; seq bigint;
begin
  if p_action<>'request_authority' then return public.sales_legal_action_before_renewal(p_sale,p_action,p_payload,p_actor); end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  if not exists(select 1 from profiles where id=p_actor and role in ('sales_agent','conveyancer')) then raise exception 'Your role cannot perform this legal action.' using errcode='42501'; end if;
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if a.exchanged_at is not null or a.completed_at is not null or a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') then raise exception 'An approved, unexchanged reservation is required.'; end if;
  select * into e from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' order by version desc limit 1;
  if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' and revoked_at is null and replaced_by is null and (expires_at is null or expires_at>now()))
    or e.id is not null and (e.exchanged_at is not null or e.replaced_by is not null) then
    raise exception 'Authority is already issued or being sent. A renewed request is available only after expiry or revocation.';
  end if;
  if (e.id is null and a.authority_requested_at is not null) or exists(select 1 from unit_sale_workflow_events
    where sale_attempt_id=p_sale and event_type='authority_requested' and metadata->>'renewalOfAuthorityId'=e.id::text) then
    return jsonb_build_object('alreadyRequested',true);
  end if;
  perform set_config('app.sales_legal_write','on',true);
  update unit_sale_attempts set authority_requested_at=now() where id=p_sale;
  perform public.sales_legal_event(p_sale,p_actor,'authority_requested',case when e.id is null then 'Exchange authority requested — this is not authority to exchange' else 'Renewed exchange authority requested — this is not authority to exchange' end,
    jsonb_strip_nulls(jsonb_build_object('renewalOfAuthorityId',e.id,'previousAuthorityVersion',e.version)));
  select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
  insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
    select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,
      case when e.id is null then 'Exchange authority requested. Developer review and issued authority are required before exchange.' else 'Renewed exchange authority requested. The previous authority remains in history; fresh developer authority is required before exchange.' end,
      'exchange',gen_random_uuid() from profiles where id=p_actor returning id into comment_id;
  insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
    select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
  return jsonb_build_object('saleAttemptId',p_sale);
end $$;
revoke all on function public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;
commit;
