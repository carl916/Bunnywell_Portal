-- Presentation-only occurrence metadata. Preserve selection, permissions and batching.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('workspace_commands.notification_batch_context(uuid)'::regprocedure) into definition;
 if position('''occurredAt'',e.occurred_at,''commentId''' in definition)=0 then
  raise exception 'Notification context changed; review before applying.';
 end if;
 definition:=replace(definition,'''occurredAt'',e.occurred_at,''commentId''',
  '''occurredAt'',e.occurred_at,''occurrence'',(select w.event_type from public.unit_sale_workflow_events w where e.source_key=''workflow:''||w.id::text and w.sale_attempt_id=a.id),''commentId''');
 execute definition;
end $migration$;
