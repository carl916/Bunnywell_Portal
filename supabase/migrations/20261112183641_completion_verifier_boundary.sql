begin;
-- Integration prerequisite for the existing verified server operations.
-- These functions were explicitly service-only in their original migrations;
-- broad baseline/default grants must not expose verifier or predecessor paths.
do $$
declare f record; n integer:=0;
begin
 for f in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname=any(array['sales_completion_upload','sales_completion_upload_session','sales_completion_upload_cleanup','sales_legal_action','sales_legal_action_before_deposit','sales_legal_action_before_notice','sales_legal_action_before_package','sales_legal_action_before_renewal','sales_legal_dispatch','sales_legal_event','sales_legal_expire','sales_legal_prepare_email','sales_legal_register_document','sales_legal_register_document_before_notice','sales_legal_register_document_before_package','sales_legal_submit_notice'])
 loop
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.args);
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.args);
  n:=n+1;
 end loop;
 if n<>16 then raise exception 'Unexpected Completion function inventory: %',n; end if;
end $$;
commit;
