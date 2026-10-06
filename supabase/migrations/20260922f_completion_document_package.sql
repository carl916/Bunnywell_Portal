begin;
alter table public.unit_sale_documents drop constraint unit_sale_documents_type_check;
alter table public.unit_sale_documents add constraint unit_sale_documents_type_check check(document_type in
  ('reservation_form','agent_invoice','completion_statement','draft_statement_of_account','statement_of_account','completion_correspondence','other'));
alter table public.unit_sale_document_versions add column completion_upload_id uuid;
create unique index completion_upload_document on public.unit_sale_document_versions(completion_upload_id,document_id) where completion_upload_id is not null;

create table public.sale_completion_package_approvals (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  statement_document_id uuid not null references public.unit_sale_documents(id),
  statement_version_id uuid not null references public.unit_sale_document_versions(id),
  account_document_id uuid not null references public.unit_sale_documents(id),
  account_version_id uuid not null references public.unit_sale_document_versions(id),
  approved_by uuid not null references public.profiles(id),
  approved_by_name text not null,
  approved_at timestamptz not null default now()
);
create index on public.sale_completion_package_approvals(sale_attempt_id,approved_at desc);
alter table public.sale_completion_package_approvals enable row level security;
create policy completion_package_read on public.sale_completion_package_approvals for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
revoke all on public.sale_completion_package_approvals from public,anon,authenticated,service_role;
grant select on public.sale_completion_package_approvals to authenticated,service_role;
create function public.sales_completion_approval_immutable() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op<>'INSERT' then raise exception 'Completion package approvals are immutable.'; end if;
  if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  return new;
end $$;
create trigger completion_package_immutable before insert or update or delete on public.sale_completion_package_approvals for each row execute function public.sales_completion_approval_immutable();

create function public.sales_completion_package_context(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare approval sale_completion_package_approvals%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select p.* into approval from sale_completion_package_approvals p
    join unit_sale_documents s on s.id=p.statement_document_id and s.sale_attempt_id=p_sale and s.document_type='completion_statement' and s.status='approved' and s.approved_version_id=p.statement_version_id and s.redacted_at is null and s.superseded_at is null
    join unit_sale_documents a on a.id=p.account_document_id and a.sale_attempt_id=p_sale and a.document_type='draft_statement_of_account' and a.status='approved' and a.approved_version_id=p.account_version_id and a.redacted_at is null and a.superseded_at is null
    join unit_sale_document_versions sv on sv.id=p.statement_version_id and sv.document_id=s.id and sv.is_current and sv.redacted_at is null
    join unit_sale_document_versions av on av.id=p.account_version_id and av.document_id=a.id and av.is_current and av.redacted_at is null
    where p.sale_attempt_id=p_sale order by p.approved_at desc limit 1;
  return jsonb_build_object('approved',approval.id is not null,'approval',case when approval.id is not null then to_jsonb(approval) end);
end $$;

-- Existing drafts retain their IDs and history; final accounts are not recast
-- as drafts. No approval or missing document is backfilled.
create function public.sales_completion_draft_guard() returns trigger language plpgsql set search_path=public as $$
declare protected boolean;
begin
  if tg_table_name='unit_sale_documents' then
    protected:=coalesce(new.document_type,'') in ('completion_statement','draft_statement_of_account') or coalesce(old.document_type,'') in ('completion_statement','draft_statement_of_account');
    if protected and tg_op='UPDATE' and (new.sale_attempt_id,new.document_type) is distinct from (old.sale_attempt_id,old.document_type) then raise exception 'Completion document identity is immutable.'; end if;
  else
    select exists(select 1 from unit_sale_documents where id in (new.document_id,old.document_id) and document_type in ('completion_statement','draft_statement_of_account')) into protected;
    if protected and tg_op='UPDATE' and (to_jsonb(new)-'is_current') is distinct from (to_jsonb(old)-'is_current') then raise exception 'Completion document versions are immutable.'; end if;
  end if;
  if protected then
    if tg_op='DELETE' then raise exception 'Completion document history is immutable.'; end if;
    if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;
create trigger completion_draft_guard before insert or update or delete on public.unit_sale_documents for each row execute function public.sales_completion_draft_guard();
create trigger completion_draft_version_guard before insert or update or delete on public.unit_sale_document_versions for each row execute function public.sales_completion_draft_guard();

create function public.sales_completion_upload(p_sale uuid,p_actor uuid,p_request uuid,p_files jsonb) returns jsonb
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

alter function public.sales_legal_action(uuid,text,jsonb,uuid) rename to sales_legal_action_before_package;
revoke all on function public.sales_legal_action_before_package(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; s unit_sale_documents%rowtype; d unit_sale_documents%rowtype;
  sv unit_sale_document_versions%rowtype; av unit_sale_document_versions%rowtype; item record; actor_name text; reason text; approval sale_completion_package_approvals%rowtype; package jsonb;
begin
  if p_action not in ('approve_statement','query_statement','approve_completion_package','query_completion_package','confirm_completion') then return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor); end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_action in ('approve_statement','query_statement') then raise exception 'Review both current completion documents together.'; end if;
  package:=public.sales_completion_package_context(p_sale,p_actor);
  if p_action='confirm_completion' then
    perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
    if a.completed_at is not null or a.workflow_status='completed' then return jsonb_build_object('alreadyCompleted',true); end if;
    if not (package->>'approved')::boolean then raise exception 'The developer must approve both current completion documents.'; end if;
    return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  select * into s from unit_sale_documents where sale_attempt_id=p_sale and document_type='completion_statement' and redacted_at is null and superseded_at is null;
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type='draft_statement_of_account' and redacted_at is null and superseded_at is null;
  select * into sv from unit_sale_document_versions where document_id=s.id and is_current and redacted_at is null;
  select * into av from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null;
  if sv.id is null or av.id is null then raise exception 'Upload both completion documents before developer review.'; end if;
  if sv.id::text is distinct from p_payload->>'statementVersionId' or av.id::text is distinct from p_payload->>'accountVersionId' then raise exception 'The completion documents changed. Review the current files.'; end if;
  perform set_config('app.sales_legal_write','on',true); perform set_config('app.completion_package_write','on',true);
  select coalesce(nullif(full_name,''),nullif(name,''),'Unknown user') into actor_name from profiles where id=p_actor;
  if p_action='approve_completion_package' then
    if (package->>'approved')::boolean then return package; end if;
    insert into sale_completion_package_approvals(sale_attempt_id,statement_document_id,statement_version_id,account_document_id,account_version_id,approved_by,approved_by_name)
      values(p_sale,s.id,sv.id,d.id,av.id,p_actor,actor_name) returning * into approval;
    update unit_sale_documents set status='approved',approved_version_id=case when id=s.id then sv.id else av.id end,approved_at=now(),approved_by_user_id=p_actor,query_note=null,updated_by_user_id=p_actor,updated_at=now() where id in (s.id,d.id);
    update unit_sale_attempts set workflow_status='completion_pending' where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_documents_approved','Completion documents approved by '||actor_name,jsonb_build_object('packageWorkflow',true,'approvalId',approval.id,'documents',jsonb_build_array(
      jsonb_build_object('documentType',s.document_type,'documentId',s.id,'versionId',sv.id,'fileName',sv.file_name),jsonb_build_object('documentType',d.document_type,'documentId',d.id,'versionId',av.id,'fileName',av.file_name))));
  else
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if reason is null or jsonb_typeof(p_payload->'documentTypes') is distinct from 'array' or jsonb_array_length(p_payload->'documentTypes') not between 1 and 2 then raise exception 'Select the affected documents and enter a query reason.'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_payload->'documentTypes') x where x not in ('completion_statement','draft_statement_of_account')) then raise exception 'Choose a draft completion document.'; end if;
    for item in select x.id,x.document_type,v.id version_id,v.file_name from unit_sale_documents x join unit_sale_document_versions v on v.document_id=x.id and v.is_current and v.redacted_at is null where x.id in (s.id,d.id) and p_payload->'documentTypes' ? x.document_type loop
      update unit_sale_documents set status='query_raised',query_note=reason,approved_version_id=null,approved_at=null,approved_by_user_id=null,updated_by_user_id=p_actor,updated_at=now() where id=item.id;
      perform public.sales_legal_event(p_sale,p_actor,'completion_documents_query_raised','Query raised against '||case item.document_type when 'completion_statement' then 'draft completion statement' else 'draft statement of account' end||': '||item.file_name,
        jsonb_build_object('packageWorkflow',true,'documentType',item.document_type,'documentId',item.id,'versionId',item.version_id,'fileName',item.file_name,'queryNote',reason));
    end loop;
    update unit_sale_attempts set workflow_status='exchanged' where id=p_sale;
  end if;
  return public.sales_completion_package_context(p_sale,p_actor);
end $$;

-- Old single-document endpoints cannot bypass the package transaction.
alter function public.sales_legal_register_document(uuid,uuid,text,jsonb) rename to sales_legal_register_document_before_package;
revoke all on function public.sales_legal_register_document_before_package(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.sales_legal_register_document(p_sale uuid,p_actor uuid,p_type text,p_file jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  if p_type in ('completion_statement','draft_statement_of_account') then raise exception 'Use the completion document package upload.'; end if;
  return public.sales_legal_register_document_before_package(p_sale,p_actor,p_type,p_file);
end $$;

alter function public.sale_event_projection(public.unit_sale_workflow_events) rename to sale_event_projection_before_package;
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if e.metadata->>'packageWorkflow'='true' and e.event_type like 'completion_%' then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata,'version_id',e.metadata->>'versionId');
  end if;
  return public.sale_event_projection_before_package(e);
end $$;
revoke all on function public.sales_completion_package_context(uuid,uuid),public.sales_completion_upload(uuid,uuid,uuid,jsonb),public.sales_legal_action(uuid,text,jsonb,uuid),public.sales_legal_register_document(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sales_completion_package_context(uuid,uuid),public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;
grant execute on function public.sales_completion_upload(uuid,uuid,uuid,jsonb),public.sales_legal_register_document(uuid,uuid,text,jsonb) to service_role;
create or replace function public.sale_document_activity() returns trigger language plpgsql security definer set search_path=public as $$
declare d public.unit_sale_documents%rowtype; v public.unit_sale_document_versions%rowtype; a public.unit_sale_attempts%rowtype; kind text; title text; actor uuid;
begin
  -- Package operations emit precise per-file events and one atomic approval event.
  if coalesce(current_setting('app.completion_package_write',true),'')='on' then
    if tg_table_name='unit_sale_document_versions' then
      if exists(select 1 from unit_sale_documents where id=new.document_id and document_type in ('completion_statement','draft_statement_of_account')) then return new; end if;
    elsif new.document_type in ('completion_statement','draft_statement_of_account') then return new;
    end if;
  end if;
  if tg_table_name='unit_sale_document_versions' then
    v:=new;
    select * into d from public.unit_sale_documents where id=v.document_id;
    kind:=case when v.version_number>1 then 'replaced' else 'uploaded' end;
    actor:=v.uploaded_by_user_id;
  else
    d:=new;
    if d.document_type not in ('completion_statement','statement_of_account') or old.status is not distinct from new.status or new.status not in ('approved','query_raised') then return new; end if;
    select * into v from public.unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null;
    kind:=case when new.status='approved' then 'approved' else 'rejected' end;
    actor:=new.updated_by_user_id;
  end if;
  select * into a from public.unit_sale_attempts where id=d.sale_attempt_id;
  title:=case d.document_type when 'completion_statement' then 'Completion statement' when 'statement_of_account' then 'Statement of account'
    when 'reservation_form' then 'Reservation form' when 'agent_invoice' then d.title else d.title end;
  insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
    values(a.id,a.building_id,a.unit_id,
      case kind when 'approved' then 'completion_documents_approved' when 'rejected' then 'completion_documents_query_raised' else d.document_type||'_'||kind end,
      a.workflow_status,case when kind='approved' then 'completion_pending' else a.workflow_status end,title||' '||kind,
      jsonb_strip_nulls(jsonb_build_object('documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name,
        'versionNumber',v.version_number,'feeMilestone',d.fee_milestone,'queryNote',case when kind='rejected' then d.query_note end,'outcome',kind)),actor);
  return new;
end $$;
create function public.sales_completion_package_history_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.event_type,'') like 'completion_draft_statement_of_account_%' or coalesce(old.event_type,'') like 'completion_draft_statement_of_account_%' then
    if tg_op<>'INSERT' then raise exception 'Completion document history is immutable.'; end if;
    if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;
create trigger completion_package_history_guard before insert or update or delete on public.unit_sale_workflow_events for each row execute function public.sales_completion_package_history_guard();
commit;
