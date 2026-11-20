-- Preserve the existing staging verifier boundary after wrapping the legal action.
revoke all on function public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sales_legal_action(uuid,text,jsonb,uuid) to service_role;
