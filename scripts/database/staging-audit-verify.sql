-- Run with the Supabase SQL tool against vxkpvdtrldwwqiddoyof ONLY.
-- Entire diagnostic is rolled back. Never use completed diagnostic sales.
begin;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',
  (select id from public.profiles where active is true and role='admin' order by created_at limit 1))::text,true);
do $$
declare actor uuid:=auth.uid(); building uuid; unit uuid:=gen_random_uuid(); snag uuid:=gen_random_uuid();
  before_count bigint; first_page jsonb; second_page jsonb; last_row jsonb;
begin
  select id into building from public.buildings where name='Forum House' limit 1;
  if building is null or actor is null then raise exception 'Authorised staging fixtures missing'; end if;
  insert into public.units(id,building_id,unit_number,floor) values(unit,building,'[E2E AUDIT rollback]','Ground');
  update public.units set floor='First' where id=unit;
  if not exists(select 1 from public.audit_events where entity_id=unit and created_by_user_id=actor
    and source='database' and metadata->'changed_fields' ? 'floor') then raise exception 'Unit attribution missing'; end if;
  select count(*) into before_count from public.audit_events where entity_id=unit;
  update public.units set floor='First' where id=unit;
  if (select count(*) from public.audit_events where entity_id=unit)<>before_count then raise exception 'No-op duplicated history'; end if;
  begin update public.units set unit_number=null where id=unit;
    raise exception 'Expected constraint failure'; exception when not_null_violation then null; end;
  if (select count(*) from public.audit_events where entity_id=unit)<>before_count then raise exception 'Failed action recorded success'; end if;
  insert into public.snags(id,building_id,unit_id,title,status,source_type,created_by_user_id)
    values(snag,building,unit,'[E2E AUDIT rollback]','open','developer_snag',actor);
  perform public.change_snag(snag,'{"status":"accepted"}','Synthetic diagnostic');
  perform public.change_snag(snag,'{"status":"accepted"}','Synthetic diagnostic');
  if (select count(*) from public.snag_events where snag_id=snag and event_type='status_change' and created_by_user_id=actor)<>1 then raise exception 'Snag retry attribution failed'; end if;
  if not public.record_unit_open(unit) or public.record_unit_open(unit) then raise exception 'Unit-open dedupe failed'; end if;
  if public.portal_audit_page('{}')::text like '%unit_opened%' then raise exception 'Views leaked into business feed'; end if;
  first_page:=public.portal_audit_page('{}');
  if jsonb_array_length(first_page)<>51 then raise exception 'Expected bounded page'; end if;
  last_row:=first_page->49;
  second_page:=public.portal_audit_page('{}',(last_row->>'created_at')::timestamptz,(last_row->>'id')::uuid,last_row->>'source');
  if exists(select 1 from jsonb_array_elements(first_page) with ordinality f(v,n),jsonb_array_elements(second_page) s(v)
    where f.n<=50 and f.v->>'id'=s.v->>'id') then raise exception 'Pagination repeated a row'; end if;
  if public.portal_audit_page(jsonb_build_object('unit',unit,'event','units_changed'))->0->>'created_by_user_id'<>actor::text then raise exception 'Filter failed'; end if;
  if has_table_privilege('authenticated','public.audit_events','TRUNCATE')
    or has_table_privilege('anon','public.snag_events','TRUNCATE')
    or has_table_privilege('authenticated','public.unit_sale_workflow_events','TRUNCATE') then raise exception 'Unsafe truncate grant'; end if;
end $$;
-- Test the actual authenticated role, not the SQL owner's RLS bypass.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',
  (select id from public.profiles where active is true and role='contractor' order by created_at limit 1))::text,true);
set local role authenticated;
do $$ begin
  begin perform public.portal_audit_page('{}'); raise exception 'Contractor gained audit access';
    exception when insufficient_privilege then null; end;
  if exists(select 1 from public.audit_events) then raise exception 'Audit RLS leak'; end if;
end $$;
reset role;
rollback;
