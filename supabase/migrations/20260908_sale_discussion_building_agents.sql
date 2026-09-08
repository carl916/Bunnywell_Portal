-- Sales agents and conveyancers inherit discussion access from current building permissions.
-- Active accounts and direct or active organisation building access remain required.
-- No prior sale activity or individual assignment is required.
create or replace function public.sale_discussion_access(p_sale uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sale_discussion_candidate(p_sale,p_user) and (
    exists (select 1 from public.profiles where id=p_user and role in ('admin','developer','sales_agent','conveyancer'))
    or exists (select 1 from public.sale_participants where sale_attempt_id=p_sale and user_id=p_user and revoked_at is null)
  )
$$;

create or replace function public.sale_discussion_assign(p_sale uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.unit_sale_attempts where id=p_sale for update;
  perform public.assert_sale_discussion(p_sale);
  if not public.is_sales_internal_user() then raise exception 'Only developers can manage assignments.' using errcode='42501'; end if;
  if p_assigned and not public.sale_discussion_candidate(p_sale,p_user) then raise exception 'This person is not eligible for this sale.'; end if;
  if exists(select 1 from public.profiles where id=p_user and role in ('admin','developer','sales_agent','conveyancer')) then raise exception 'Access for this role is managed by existing portal and building permissions.'; end if;
  insert into public.sale_participants(sale_attempt_id,user_id,assigned_by,revoked_at)
    values(p_sale,p_user,auth.uid(),case when p_assigned then null else now() end)
    on conflict(sale_attempt_id,user_id) do update set assigned_by=auth.uid(),assigned_at=now(),revoked_at=excluded.revoked_at;
  if not p_assigned then delete from public.sale_mention_notifications where sale_attempt_id=p_sale and recipient_id=p_user; end if;
  insert into public.audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id)
    values('sale_participant_changed','sale_attempt',p_sale,'Sale discussion assignment updated.',jsonb_build_object('user_id',p_user,'assigned',p_assigned),auth.uid());
end $$;

