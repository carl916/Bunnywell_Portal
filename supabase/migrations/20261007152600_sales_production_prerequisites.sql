-- Reconcile prerequisites present in staging but missing from production.
-- Apply and COMMIT this migration BEFORE the September discussion/legal
-- migrations: PostgreSQL enum values cannot be used in the transaction that
-- first adds them. Existing role assignments and document objects are untouched.
alter type public.user_role add value if not exists 'sales_agent';
alter type public.user_role add value if not exists 'conveyancer';

-- Reservation uploads previously created this bucket on demand. Provision it
-- explicitly so legal/completion uploads and backups do not depend on that path.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('sale-documents','sale-documents',false,10485760,array['application/pdf'])
on conflict(id) do nothing;

do $$ begin
  if exists(select 1 from storage.buckets where id='sale-documents' and
    (public is distinct from false or file_size_limit is distinct from 10485760
      or allowed_mime_types is distinct from array['application/pdf'])) then
    raise exception 'Review existing sale-documents bucket settings before release';
  end if;
end $$;
