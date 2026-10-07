begin;
-- Reuse document approval fields and immutable, version-linked workflow events.
-- No stored rows, version history or legacy package approvals are rewritten.
create or replace function public.sales_completion_package_context(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare approved boolean; approval sale_completion_package_approvals%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select count(distinct d.document_type)=2 into approved
    from unit_sale_documents d join unit_sale_document_versions v on v.document_id=d.id
      and v.id=d.approved_version_id and v.is_current and v.redacted_at is null
    where d.sale_attempt_id=p_sale and d.document_type in ('completion_statement','draft_statement_of_account')
      and d.status='approved' and d.redacted_at is null and d.superseded_at is null;
  -- Preserve the old response for historical package approvals; new approvals
  -- are independent and do not manufacture a joint approver or timestamp.
  if approved then
    select p.* into approval from sale_completion_package_approvals p
      join unit_sale_document_versions s on s.id=p.statement_version_id and s.is_current and s.redacted_at is null
      join unit_sale_document_versions a on a.id=p.account_version_id and a.is_current and a.redacted_at is null
      where p.sale_attempt_id=p_sale order by p.approved_at desc limit 1;
  end if;
  return jsonb_build_object('approved',approved,'approval',case when approval.id is not null then to_jsonb(approval) end);
end $$;

create or replace function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
  reason text; title text; package jsonb;
begin
  if p_action not in ('approve_statement','query_statement','approve_completion_package','query_completion_package',
    'approve_completion_document','query_completion_document','confirm_completion') then
    return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  -- Serialize approval, replacement and completion on the same sale lock.
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_action='confirm_completion' then
    perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
    if a.completed_at is not null or a.workflow_status='completed' then return jsonb_build_object('alreadyCompleted',true); end if;
    package:=public.sales_completion_package_context(p_sale,p_actor);
    if not (package->>'approved')::boolean then raise exception 'The developer must approve both current completion documents.'; end if;
    return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  if p_action in ('approve_statement','query_statement','approve_completion_package','query_completion_package') then
    raise exception 'Review each current completion document separately. Reload the page.';
  end if;
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=p_payload->>'documentType'
    and document_type in ('completion_statement','draft_statement_of_account') and redacted_at is null and superseded_at is null for update;
  select * into v from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
  if v.id is null or v.id::text is distinct from p_payload->>'versionId' then raise exception 'The completion document changed. Review the current file.'; end if;
  if d.status='approved' then
    if p_action='approve_completion_document' and d.approved_version_id=v.id then return public.sales_completion_package_context(p_sale,p_actor); end if;
    raise exception 'Approved completion documents are locked.';
  end if;
  reason:=nullif(btrim(p_payload->>'reason'),'');
  if p_action='query_completion_document' and reason is null then raise exception 'Enter a query or rejection reason.'; end if;
  if p_action='query_completion_document' and d.status='query_raised' and d.query_note=reason then return public.sales_completion_package_context(p_sale,p_actor); end if;
  perform set_config('app.sales_legal_write','on',true); perform set_config('app.completion_package_write','on',true);
  title:=case d.document_type when 'completion_statement' then 'Completion statement' else 'Statement of account' end;
  if p_action='approve_completion_document' then
    update unit_sale_documents set status='approved',approved_version_id=v.id,approved_by_user_id=p_actor,approved_at=now(),
      query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_documents_approved',title||' approved: '||v.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name));
  else
    update unit_sale_documents set status='query_raised',query_note=reason,approved_version_id=null,approved_at=null,
      approved_by_user_id=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_documents_query_raised','Query raised against '||lower(title)||': '||v.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name,'queryNote',reason));
  end if;
  package:=public.sales_completion_package_context(p_sale,p_actor);
  update unit_sale_attempts set workflow_status=case when (package->>'approved')::boolean then 'completion_pending' else 'exchanged' end where id=p_sale;
  return package;
end $$;

-- Preserve upload idempotency and history; only unapproved slots may change.
create or replace function public.sales_completion_upload(p_sale uuid,p_actor uuid,p_request uuid,p_files jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; oldv unit_sale_document_versions%rowtype;
  file_item jsonb; vid uuid; title text; result jsonb:='[]'; prior jsonb; n int;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  if p_request is null or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 2 then raise exception 'Select one or two completion PDFs and a submission reference.'; end if;
  if exists(select 1 from jsonb_array_elements(p_files) f where coalesce(f->>'type','') not in ('completion_statement','draft_statement_of_account')) or
    (select count(distinct f->>'type') from jsonb_array_elements(p_files) f)<>jsonb_array_length(p_files) then raise exception 'Assign each PDF a different completion document type.'; end if;
  select jsonb_agg(jsonb_build_object('type',upload_doc.document_type,'versionId',v.id,'path',v.storage_path)) into prior
    from unit_sale_document_versions v join unit_sale_documents upload_doc on upload_doc.id=v.document_id where v.completion_upload_id=p_request and upload_doc.sale_attempt_id=p_sale and v.uploaded_by_user_id=p_actor;
  if prior is not null then
    if jsonb_array_length(prior)<>jsonb_array_length(p_files) or exists(select 1 from jsonb_array_elements(p_files) f where not exists(select 1 from jsonb_array_elements(prior) x where x->>'type'=f->>'type')) then raise exception 'Submission reference conflicts with the saved documents.'; end if;
    return prior;
  end if;
  if exists(select 1 from unit_sale_document_versions where completion_upload_id=p_request) then raise exception 'Submission reference conflict.'; end if;
  perform set_config('app.sales_legal_write','on',true); perform set_config('app.completion_package_write','on',true);
  for file_item in select value from jsonb_array_elements(p_files) loop
    if coalesce(file_item->>'mime','')<>'application/pdf' or coalesce((file_item->>'size')::bigint,0) not between 1 and 10485760 or nullif(file_item->>'name','') is null or coalesce(file_item->>'path','') not like a.building_id::text||'/'||p_sale::text||'/%' then raise exception 'Choose a PDF up to 10 MB for this sale.'; end if;
    select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=file_item->>'type' and redacted_at is null and superseded_at is null for update;
    select * into oldv from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
    if oldv.id is distinct from nullif(file_item->>'expectedVersionId','')::uuid then raise exception 'The current document changed. Reload before replacing it.'; end if;
    if d.status='approved' then raise exception 'Approved completion documents are locked.'; end if;
    title:=case file_item->>'type' when 'completion_statement' then 'Draft completion statement' else 'Draft statement of account' end;
    if d.id is null then
      insert into unit_sale_documents(sale_attempt_id,document_type,title,status,visibility,required,created_by_user_id,updated_by_user_id)
        values(p_sale,file_item->>'type',title,'uploaded','shared_sale_file',true,p_actor,p_actor) returning * into d;
    end if;
    select coalesce(max(version_number),0)+1 into n from unit_sale_document_versions where document_id=d.id;
    update unit_sale_document_versions set is_current=false where document_id=d.id and is_current;
    if oldv.id is not null then perform public.sales_legal_event(p_sale,p_actor,case file_item->>'type' when 'completion_statement' then 'completion_statement_superseded' else 'completion_draft_statement_of_account_superseded' end,title||' superseded: '||oldv.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',oldv.id,'fileName',oldv.file_name)); end if;
    insert into unit_sale_document_versions(document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id,completion_upload_id)
      values(d.id,n,true,'sale-documents',file_item->>'path',file_item->>'name','application/pdf',(file_item->>'size')::bigint,p_actor,p_request) returning id into vid;
    update unit_sale_documents set status='uploaded',approved_version_id=null,approved_at=null,approved_by_user_id=null,query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,(case d.document_type when 'completion_statement' then 'completion_statement' else 'completion_draft_statement_of_account' end)||case when oldv.id is null then '_uploaded' else '_replaced' end,
      title||case when oldv.id is null then ' uploaded: ' else ' replaced: ' end||(file_item->>'name'),jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',vid,'fileName',file_item->>'name','versionNumber',n));
    result:=result||jsonb_build_array(jsonb_build_object('type',d.document_type,'versionId',vid,'path',file_item->>'path'));
  end loop;
  update unit_sale_attempts set workflow_status='exchanged',updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
  return result;
end $$;

-- Check both before issuing capabilities and again at finalization.
create or replace function public.sales_completion_upload_session(p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_files jsonb default null) returns jsonb
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
    if exists(select 1 from unit_sale_documents where sale_attempt_id=p_sale and document_type=f->>'type'
      and redacted_at is null and superseded_at is null and status='approved') then raise exception 'Approved completion documents are locked.'; end if;
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

commit;
