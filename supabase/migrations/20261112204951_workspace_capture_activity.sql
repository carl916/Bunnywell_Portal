begin;
-- Explicit test capture projection; historical events and permissions stay intact.
do $patch$
declare definition text; marker text:='  return public.sale_event_projection_before_further_deposit(e);'; added text:=$body$
  if e.event_type='integration_correspondence_captured' then
    if not public.can_access_sale_attempt(e.sale_attempt_id) then return null; end if;
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,
      'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,'from_status',e.from_status,'to_status',e.to_status,
      'summary','Integration test authority captured; no external delivery',
      'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,
      'metadata',jsonb_build_object('kind',e.metadata->'kind','deliveryStatus','captured_test','externalDelivery',false));
  end if;
$body$;
begin
 select pg_get_functiondef('public.sale_event_projection(public.unit_sale_workflow_events)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Unexpected activity projection; stop for review.';end if;
 execute replace(definition,marker,added||marker);
end $patch$;
commit;
