
-- One-off, explicitly authorized cleanup of the named synthetic staging fixture.
-- Trigger changes and deletes are atomic; guards are restored before commit.
do $cleanup$
declare
  target_building uuid;
  target_units uuid[];
  target_sales uuid[];
  target_documents uuid[];
  target_versions uuid[];
  outside_before jsonb := '{}'::jsonb;
  relation_name text;
  condition_sql text;
  fingerprint text;
  affected integer;
begin
  perform set_config('lock_timeout','5s',true);
  perform set_config('statement_timeout','30s',true);
  lock table public.buildings, public.units, public.unit_sale_attempts,
    public.unit_sale_documents, public.unit_sale_document_versions,
    public.unit_sale_workflow_events, public.sale_completion_uploads,
    public.user_building_access, public.unit_open_events in share row exclusive mode;

  if (select count(*) from public.buildings where name='E2E Completion Upload 2026-09-22')<>1 then
    raise exception 'Expected exactly one authorized test building';
  end if;
  select id into target_building from public.buildings where name='E2E Completion Upload 2026-09-22';
  if (select array_agg(unit_number order by unit_number) from public.units where building_id=target_building)
    is distinct from array['UPLOAD-1','UPLOAD-2','UPLOAD-3']::text[] then
    raise exception 'Unexpected test unit set';
  end if;
  select array_agg(id) into target_units from public.units where building_id=target_building;
  select array_agg(id) into target_sales from public.unit_sale_attempts where building_id=target_building;
  if cardinality(target_sales)<>3 or exists(select 1 from public.unit_sale_attempts where building_id=target_building and not(unit_id=any(target_units))) then
    raise exception 'Unexpected test sale set';
  end if;
  if exists(select 1 from public.unit_sale_invoices where sale_attempt_id=any(target_sales))
    or exists(select 1 from public.unit_sale_invoice_payments where sale_attempt_id=any(target_sales))
    or exists(select 1 from public.sale_legal_emails where sale_attempt_id=any(target_sales))
    or exists(select 1 from public.sale_exchange_deposit_receipts where sale_attempt_id=any(target_sales))
    or exists(select 1 from public.sale_exchange_deposit_sources where sale_attempt_id=any(target_sales))
    or exists(select 1 from public.unit_tenancies where building_id=target_building or unit_id=any(target_units))
    or exists(select 1 from public.sale_completion_package_approvals where sale_attempt_id=any(target_sales))
  then raise exception 'Unexpected financial, legal or tenancy dependencies'; end if;

  select array_agg(id) into target_documents from public.unit_sale_documents where sale_attempt_id=any(target_sales);
  select array_agg(id) into target_versions from public.unit_sale_document_versions where document_id=any(target_documents);
  if cardinality(target_documents)<>6 or cardinality(target_versions)<>40
    or (select count(*) from public.sale_completion_uploads where sale_id=any(target_sales))<>31
    or (select count(*) from public.unit_sale_workflow_events where building_id=target_building)<>87
    or (select count(*) from public.user_building_access where building_id=target_building)<>18
    or (select count(*) from public.unit_open_events where building_id=target_building)<>1
  then raise exception 'Fixture dependencies changed since preflight'; end if;
  if exists(select 1 from public.unit_sale_documents where not(sale_attempt_id=any(target_sales)) and approved_version_id=any(target_versions))
    or exists(select 1 from public.unit_sale_invoices where document_id=any(target_documents))
    or exists(select 1 from public.sale_completion_package_approvals where statement_document_id=any(target_documents) or account_document_id=any(target_documents) or statement_version_id=any(target_versions) or account_version_id=any(target_versions))
  then raise exception 'Outside record references test documents'; end if;

  foreach relation_name in array array['buildings','units','unit_sale_attempts','unit_sale_documents','unit_sale_document_versions','unit_sale_workflow_events','sale_completion_uploads','user_building_access','unit_open_events'] loop
    condition_sql:=case relation_name
      when 'buildings' then format('t.id<>%L::uuid',target_building)
      when 'unit_sale_documents' then format('not(t.sale_attempt_id=any(%L::uuid[]))',target_sales)
      when 'unit_sale_document_versions' then format('not(t.document_id=any(%L::uuid[]))',target_documents)
      when 'sale_completion_uploads' then format('not(t.sale_id=any(%L::uuid[]))',target_sales)
      else format('t.building_id is distinct from %L::uuid',target_building) end;
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text),'''')) from public.%I t where %s',relation_name,condition_sql) into fingerprint;
    outside_before:=outside_before||jsonb_build_object(relation_name,fingerprint);
  end loop;

  alter table public.unit_sale_documents disable trigger completion_draft_guard;
  alter table public.unit_sale_documents disable trigger legal_document_guard;
  alter table public.unit_sale_document_versions disable trigger completion_draft_version_guard;
  alter table public.unit_sale_document_versions disable trigger legal_version_guard;
  alter table public.unit_sale_document_versions disable trigger notice_version_guard;
  alter table public.unit_sale_workflow_events disable trigger completion_package_history_guard;
  alter table public.unit_sale_workflow_events disable trigger legal_history_guard;

  delete from public.sale_completion_uploads where sale_id=any(target_sales);
  get diagnostics affected=row_count;
  if affected<>31 then raise exception 'Unexpected upload cleanup count'; end if;
  delete from public.unit_open_events where building_id=target_building and unit_id=any(target_units);
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Unexpected telemetry cleanup count'; end if;
  delete from public.buildings where id=target_building and name='E2E Completion Upload 2026-09-22';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Unexpected building deletion count'; end if;

  alter table public.unit_sale_documents enable trigger completion_draft_guard;
  alter table public.unit_sale_documents enable trigger legal_document_guard;
  alter table public.unit_sale_document_versions enable trigger completion_draft_version_guard;
  alter table public.unit_sale_document_versions enable trigger legal_version_guard;
  alter table public.unit_sale_document_versions enable trigger notice_version_guard;
  alter table public.unit_sale_workflow_events enable trigger completion_package_history_guard;
  alter table public.unit_sale_workflow_events enable trigger legal_history_guard;

  if exists(select 1 from public.units where id=any(target_units))
    or exists(select 1 from public.unit_sale_attempts where id=any(target_sales))
    or exists(select 1 from public.unit_sale_documents where id=any(target_documents))
    or exists(select 1 from public.unit_sale_document_versions where id=any(target_versions))
    or exists(select 1 from public.unit_sale_workflow_events where building_id=target_building or sale_attempt_id=any(target_sales))
    or exists(select 1 from public.user_building_access where building_id=target_building)
  then raise exception 'Fixture cleanup left dependent records'; end if;

  foreach relation_name in array array['buildings','units','unit_sale_attempts','unit_sale_documents','unit_sale_document_versions','unit_sale_workflow_events','sale_completion_uploads','user_building_access','unit_open_events'] loop
    condition_sql:=case relation_name
      when 'buildings' then format('t.id<>%L::uuid',target_building)
      when 'unit_sale_documents' then format('not(t.sale_attempt_id=any(%L::uuid[]))',target_sales)
      when 'unit_sale_document_versions' then format('not(t.document_id=any(%L::uuid[]))',target_documents)
      when 'sale_completion_uploads' then format('not(t.sale_id=any(%L::uuid[]))',target_sales)
      else format('t.building_id is distinct from %L::uuid',target_building) end;
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text),'''')) from public.%I t where %s',relation_name,condition_sql) into fingerprint;
    if fingerprint is distinct from outside_before->>relation_name then raise exception 'Outside records changed in %',relation_name; end if;
  end loop;
end;
$cleanup$;;
