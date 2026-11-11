-- Read-only preflight for the separately proposed A1/A2 staging patch.
-- Confirm connection project is vxkpvdtrldwwqiddoyof outside SQL first.
-- Do not infer project identity from the database name (normally postgres).
select proname, pg_get_function_identity_arguments(oid) as arguments,
       md5(pg_get_functiondef(oid)) as definition_md5,
       has_function_privilege('anon',oid,'execute') as anon_execute,
       has_function_privilege('authenticated',oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',oid,'execute') as service_execute
from pg_proc where pronamespace='public'::regnamespace
and (proname like 'save_unit_commercial_model%' or proname='record_unit_sale_invoice_payment')
order by proname,arguments;
select schemaname,tablename,policyname,cmd,roles,qual,with_check from pg_policies
where (schemaname='storage' and tablename='objects')
   or (schemaname='public' and tablename='snags' and cmd='INSERT')
order by schemaname,tablename,policyname;
select id,public from storage.buckets where id in ('snag-images','snag-reports','sale-documents','completion-uploads');
select count(*) as reports_without_building_path from storage.objects
where bucket_id='snag-reports' and name !~ '^reports/[0-9a-fA-F-]{36}/';
select count(*) as existing_handover_objects_in_public_bucket from storage.objects
where bucket_id='snag-images' and name like 'handover%';
-- Counts only: no image content, personal records, file names or credentials.
