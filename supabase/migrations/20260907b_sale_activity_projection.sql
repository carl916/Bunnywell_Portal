-- Extend the existing workflow log; do not create another audit stream.
alter table public.unit_sale_workflow_events
  add column actor_name text, add column actor_role text, add column actor_organisation text;
create index sale_activity_cursor_idx on public.unit_sale_workflow_events(sale_attempt_id,created_at desc,id desc);

create function public.sale_event_actor_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.role()='authenticated' then new.created_by_user_id:=auth.uid(); end if;
  select coalesce(nullif(p.full_name,''),nullif(p.name,'')),p.role,o.name into new.actor_name,new.actor_role,new.actor_organisation
    from public.profiles p left join public.organisations o on o.id=p.organisation_id where p.id=new.created_by_user_id;
  return new;
end $$;
create trigger sale_event_actor_snapshot before insert on public.unit_sale_workflow_events for each row execute function public.sale_event_actor_snapshot();

-- Document events belong to the successful database operation. Each approved /
-- returned document carries its own subject and exact version, even when the
-- existing workflow reviews two documents together.
create function public.sale_document_activity() returns trigger language plpgsql security definer set search_path=public as $$
declare d public.unit_sale_documents%rowtype; v public.unit_sale_document_versions%rowtype; a public.unit_sale_attempts%rowtype; kind text; title text; actor uuid;
begin
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
create trigger sale_document_uploaded_activity after insert on public.unit_sale_document_versions for each row execute function public.sale_document_activity();
create trigger sale_document_review_activity after update of status on public.unit_sale_documents for each row execute function public.sale_document_activity();

-- Explicit projection: restricted payloads are never returned to a browser.
-- Unknown historical events stay available to internal viewers. External
-- viewers receive known shared workflow types, with canonical titles only.
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare m jsonb:=coalesce(e.metadata,'{}'); safe jsonb; vid uuid; legacy_actor text; shared boolean; document_kind text; safe_summary text;
begin
  shared:=e.event_type ~ '^(reservation_(submitted|approved|rejected|query_raised|form_uploaded|form_replaced)|exchange_recorded|completion_recorded|completion_documents_(approved|query_raised)|completion_statement_(uploaded|replaced|approved|rejected)|statement_of_account_(uploaded|replaced|approved|rejected)|unit_returned_to_for_sale)$';
  if not public.is_sales_internal_user() and not shared then return null; end if;
  if not public.is_sales_internal_user() and coalesce(m->>'documentId','') ~* '^[0-9a-f-]{36}$' and exists(
    select 1 from public.unit_sale_documents d where d.id=(m->>'documentId')::uuid and (d.sale_attempt_id<>e.sale_attempt_id
      or d.visibility not in ('shared_sale_file',public.current_app_role()))) then return null; end if;
  document_kind:=coalesce(m->>'documentType',m->>'completionDocumentType',m->>'document_type');
  if document_kind is null and coalesce(m->>'documentId','') ~* '^[0-9a-f-]{36}$' then
    select document_type into document_kind from public.unit_sale_documents where id=(m->>'documentId')::uuid and sale_attempt_id=e.sale_attempt_id;
  end if;
  safe:=jsonb_strip_nulls(jsonb_build_object('documentType',document_kind,'fileName',m->'fileName','versionNumber',m->'versionNumber',
    'queryNote',m->'queryNote','rejectionReason',m->'rejectionReason','exchangeDate',m->'exchangeDate','completionDate',m->'completionDate','outcome',m->'outcome'));
  -- A legacy document ID alone is insufficient to identify a historical file.
  if coalesce(m->>'versionId','') ~* '^[0-9a-f-]{36}$' then
    select v.id into vid from public.unit_sale_document_versions v join public.unit_sale_documents d on d.id=v.document_id
    where v.id=(m->>'versionId')::uuid and d.sale_attempt_id=e.sale_attempt_id and d.redacted_at is null and v.redacted_at is null
      and (public.is_sales_internal_user() or d.visibility='shared_sale_file'
        or d.visibility=public.current_app_role());
  end if;
  -- A historical name explicitly stored on the event is reliable; the user's
  -- current organisation is not a historical snapshot.
  legacy_actor:=coalesce(m->>'actorName',m->>'actor_name',m->>'recordedByName');
  if legacy_actor is null and e.actor_name is null then
    select coalesce(nullif(full_name,''),nullif(name,'')) into legacy_actor from public.profiles where id=e.created_by_user_id;
  end if;
  -- Free-form summaries can contain internal values. External views only use
  -- known safe historical wording or a title derived from a shared event type.
  safe_summary:=case when public.is_sales_internal_user() then e.summary
    when e.summary in ('Completion statement and statement of account approved.','Completion document query raised.') then e.summary
    when e.event_type='completion_recorded' then 'Sale completed'
    else upper(left(replace(e.event_type,'_',' '),1))||substring(replace(e.event_type,'_',' ') from 2) end;
  return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,
    'created_by_user_id',e.created_by_user_id,'from_status',e.from_status,'to_status',e.to_status,
    'summary',safe_summary,
    'actor_name',coalesce(e.actor_name,legacy_actor),'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,
    'metadata',safe,'version_id',vid);
end $$;

create function public.sale_activity_page(p_sale uuid,p_before_time timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into result from (
    select e.id,e.created_at,public.sale_event_projection(e) item from public.unit_sale_workflow_events e
    where e.sale_attempt_id=p_sale and (p_before_time is null or (e.created_at,e.id)<(p_before_time,p_before_id))
      and public.sale_event_projection(e) is not null
    order by e.created_at desc,e.id desc limit 51
  ) q;
  return result;
end $$;

-- Existing stage tasks need dates from the same log under their existing access
-- rules, but no longer need raw audit payloads or arbitrary audit descriptions.
create function public.sale_workflow_context(p_sales uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into result from (
    select distinct on(e.sale_attempt_id,e.event_type) e.id,e.created_at,public.sale_event_projection(e) item from public.unit_sale_workflow_events e
      where e.sale_attempt_id=any(p_sales) and public.can_access_sale_attempt(e.sale_attempt_id) and public.sale_event_projection(e) is not null
      order by e.sale_attempt_id,e.event_type,e.created_at desc,e.id desc
  ) q;
  return result;
end $$;
revoke select on public.unit_sale_workflow_events from authenticated,anon;
revoke all on function public.sale_event_actor_snapshot(),public.sale_document_activity(),public.sale_event_projection(public.unit_sale_workflow_events),
  public.sale_activity_page(uuid,timestamptz,uuid),public.sale_workflow_context(uuid[]) from public,anon,authenticated;
grant execute on function public.sale_activity_page(uuid,timestamptz,uuid),public.sale_workflow_context(uuid[]) to authenticated;
grant execute on function public.sale_event_actor_snapshot(),public.sale_document_activity(),public.sale_event_projection(public.unit_sale_workflow_events),
  public.sale_activity_page(uuid,timestamptz,uuid),public.sale_workflow_context(uuid[]) to service_role;
