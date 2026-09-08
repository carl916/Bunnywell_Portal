-- Resolve historical sale actors without granting access to full profiles.
create or replace function public.sale_actor_names(p_sales uuid[])
returns jsonb
language sql stable security definer set search_path=public as $$
  with accessible as (
    select a.* from public.unit_sale_attempts a
    where a.id = any(p_sales)
      and public.sale_discussion_candidate(a.id, auth.uid())
  ), records as (
    select to_jsonb(a) payload from accessible a
    union all
    select to_jsonb(e) from public.unit_sale_workflow_events e
      join accessible a on a.id=e.sale_attempt_id
    union all
    select to_jsonb(d) from public.unit_sale_documents d
      join accessible a on a.id=d.sale_attempt_id
      where d.visibility='shared_sale_file'
        or public.is_sales_internal_user()
        or d.visibility=public.current_app_role()
  ), actors as (
    select distinct field.value actor_id
    from records r cross join lateral jsonb_each_text(r.payload) field
    where right(field.key,8)='_user_id' and field.value is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'full_name',p.full_name,'role',p.role)), '[]'::jsonb) from public.profiles p
  join actors a on a.actor_id=p.id::text
$$;
revoke all on function public.sale_actor_names(uuid[]) from public,anon;
grant execute on function public.sale_actor_names(uuid[]) to authenticated,service_role;
