begin;
-- Private quarantine: no browser SELECT/UPDATE/DELETE policy. A server-issued
-- capability permits INSERT at one unpredictable path, with upsert disabled.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('completion-uploads','completion-uploads',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

create table public.sale_completion_uploads (
  id uuid primary key,
  sale_id uuid not null references public.unit_sale_attempts(id),
  actor_id uuid not null references public.profiles(id),
  files jsonb not null,
  state text not null default 'pending' check(state in ('pending','finalized','expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '2 hours',
  cleaned_at timestamptz
);
alter table public.sale_completion_uploads enable row level security;
revoke all on public.sale_completion_uploads from public,anon,authenticated;
grant select,update on public.sale_completion_uploads to service_role;
create index sale_completion_uploads_cleanup on public.sale_completion_uploads(expires_at) where cleaned_at is null;
create index sale_completion_uploads_sale on public.sale_completion_uploads(sale_id);
create index sale_completion_uploads_actor on public.sale_completion_uploads(actor_id);

create function public.sales_completion_upload_session(p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_files jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; u sale_completion_uploads%rowtype; f jsonb; manifest jsonb:='[]'; current_id uuid; saved jsonb;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_request is null or p_action not in ('begin','get','finalize') then raise exception 'Invalid upload request.'; end if;
  select * into u from sale_completion_uploads where id=p_request for update;
  if found then
    if u.sale_id<>p_sale or u.actor_id<>p_actor then raise exception 'Upload access denied.' using errcode='42501'; end if;
    if p_action='begin' and (select jsonb_agg(value-'path') from jsonb_array_elements(u.files)) is distinct from p_files then raise exception 'Submission reference conflicts with the selected files.'; end if;
    -- Return the committed outcome even after legal completion / a later upload.
    if u.state='finalized' then return to_jsonb(u); end if;
    if u.state<>'pending' or u.expires_at<=now() then raise exception 'Upload expired. Remove the selected files and choose them again.'; end if;
  elsif p_action<>'begin' then raise exception 'Upload not found. Choose the files again.';
  end if;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements first.'; end if;
  if u.id is null then
    if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 2 then raise exception 'Choose one or two PDFs.'; end if;
    if (select count(distinct value->>'type') from jsonb_array_elements(p_files))<>jsonb_array_length(p_files) then raise exception 'Assign different document types.'; end if;
    for f in select value from jsonb_array_elements(p_files) loop
      if coalesce(f->>'type','') not in ('completion_statement','draft_statement_of_account') or coalesce(f->>'mime','')<>'application/pdf'
        or coalesce((f->>'size')::bigint,0) not between 5 and 10485760 or length(coalesce(f->>'name','')) not between 5 and 200
        or f->>'name' !~* '\.pdf$' or f->>'name' ~ '[/\\\x00-\x1f]' then raise exception 'Choose PDFs up to 10 MiB each.'; end if;
      manifest:=manifest||jsonb_build_array((f-'path')||jsonb_build_object('path',a.building_id::text||'/'||p_sale::text||'/completion-'||p_request::text||'/'||(f->>'type')||'.pdf'));
    end loop;
    insert into sale_completion_uploads(id,sale_id,actor_id,files) values(p_request,p_sale,p_actor,manifest) returning * into u;
  end if;
  for f in select value from jsonb_array_elements(u.files) loop
    select v.id into current_id from unit_sale_document_versions v join unit_sale_documents d on d.id=v.document_id
      where d.sale_attempt_id=p_sale and d.document_type=f->>'type' and d.redacted_at is null and d.superseded_at is null and v.is_current and v.redacted_at is null;
    if current_id is distinct from nullif(f->>'expectedVersionId','')::uuid then raise exception 'The current document changed. Reload before replacing it.'; end if;
  end loop;
  if p_action='finalize' then
    -- Only the service verifier can call this function. Independently check the
    -- final Storage metadata here, in the same transaction as document history.
    for f in select value from jsonb_array_elements(u.files) loop
      if not exists(select 1 from storage.objects where bucket_id='sale-documents' and name=f->>'path'
        and (metadata->>'size')::bigint=(f->>'size')::bigint and metadata->>'mimetype'='application/pdf') then raise exception 'A verified PDF is missing. Retry the upload.'; end if;
    end loop;
    saved:=public.sales_completion_upload(p_sale,p_actor,p_request,u.files);
    update sale_completion_uploads set state='finalized',result=saved where id=u.id returning * into u;
  end if;
  return to_jsonb(u);
end $$;
revoke all on function public.sales_completion_upload_session(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sales_completion_upload_session(uuid,uuid,uuid,text,jsonb) to service_role;

-- TUS upload URLs can live for 24 hours; allow a further safety margin after
-- the session expires before removing quarantine objects. Expire transactionally
-- before cleanup so a late finalizer can never register a deleted object.
create function public.sales_completion_upload_cleanup() returns setof public.sale_completion_uploads
language plpgsql security definer set search_path=public as $$
begin
  return query update sale_completion_uploads set state=case when state='finalized' then state else 'expired' end
  where id in (select id from sale_completion_uploads where cleaned_at is null and expires_at<now()-interval '26 hours' order by expires_at limit 30 for update skip locked)
  returning *;
end $$;
revoke all on function public.sales_completion_upload_cleanup() from public,anon,authenticated;
grant execute on function public.sales_completion_upload_cleanup() to service_role;
commit;
