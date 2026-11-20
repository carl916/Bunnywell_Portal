-- Pending sends always precede accepted-message status polling. A sending-only
-- provider credential must not cause status checks to starve new mail.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.workspace_sales_email_delivery(uuid,text,jsonb)'::regprocedure);
 if position('order by created_at for update skip locked limit 1' in definition)=0 then raise exception 'Unexpected delivery claim definition';end if;
 definition:=replace(definition,'order by created_at for update skip locked limit 1',E'order by (status=''accepted''),created_at for update skip locked limit 1');
 if position(E'next_attempt_at=clock_timestamp()+interval ''1 minute''' in definition)=0 then raise exception 'Unexpected delivery retry definition';end if;
 definition:=replace(definition,E'next_attempt_at=clock_timestamp()+interval ''1 minute''',
  E'next_attempt_at=clock_timestamp()+case when p_payload->>''status''=''accepted'' and nullif(p_payload->>''error'','''') is not null then interval ''1 hour'' else interval ''1 minute'' end');
 execute definition;
end $$;
-- Existing accepted records stay accepted and retain their original provider ID.
update workspace_commands.sales_email_deliveries set next_attempt_at=clock_timestamp()+interval '1 hour'
 where status='accepted' and last_error like 'Provider status unavailable%';
