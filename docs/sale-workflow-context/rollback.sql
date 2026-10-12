-- After explicit environment approval, restore the pre-optimisation body.
-- CREATE OR REPLACE preserves ownership and execute ACLs. Never DROP.
begin;
CREATE OR REPLACE FUNCTION public.sale_workflow_context(p_sales uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into result from (
    select distinct on(e.sale_attempt_id,e.event_type) e.id,e.created_at,public.sale_event_projection(e) item from public.unit_sale_workflow_events e
      where e.sale_attempt_id=any(p_sales) and public.can_access_sale_attempt(e.sale_attempt_id) and public.sale_event_projection(e) is not null
      order by e.sale_attempt_id,e.event_type,e.created_at desc,e.id desc
  ) q;
  return result;
end $function$;
commit;
