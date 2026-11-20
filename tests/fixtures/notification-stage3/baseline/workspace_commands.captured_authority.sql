CREATE OR REPLACE FUNCTION workspace_commands.captured_authority(p_id uuid, p_sale uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from workspace_commands.test_deliveries c
 join workspace_commands.test_journeys j on j.sale_id=c.sale_id
 join public.sale_legal_emails e on e.id=c.email_id
 where e.id=p_id and c.sale_id=p_sale and e.sale_attempt_id=p_sale
 and e.delivery_status='captured_test' and e.sent_at is null and e.resend_message_id is null);
$function$
