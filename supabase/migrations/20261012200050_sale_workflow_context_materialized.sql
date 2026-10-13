-- Reuse permission/projection results only within this statement.
-- CREATE OR REPLACE retains the existing owner, OID and execute ACL (including
-- revocations). Do not DROP the function or grant access to private helpers.
begin;

create or replace function public.sale_workflow_context(p_sales uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;

  with requested_sale_ids as materialized (
    select distinct e.sale_attempt_id
    from public.unit_sale_workflow_events e
    where e.sale_attempt_id=any(p_sales)
  ), accessible as materialized (
    select r.sale_attempt_id
    from requested_sale_ids r
    where public.can_access_sale_attempt(r.sale_attempt_id)
  ), projected as materialized (
    select e.sale_attempt_id,e.event_type,e.id,e.created_at,
      public.sale_event_projection(e) as item
    from public.unit_sale_workflow_events e
    join accessible a on a.sale_attempt_id=e.sale_attempt_id
  )
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]')
    into result
  from (
    -- Select the latest VISIBLE event, not the latest raw event. A newer
    -- hidden document event must not hide an older visible event of its type.
    select distinct on (sale_attempt_id,event_type) id,created_at,item
    from projected
    where item is not null
    order by sale_attempt_id,event_type,created_at desc,id desc
  ) q;
  return result;
end $$;

commit;
