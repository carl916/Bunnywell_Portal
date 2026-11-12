begin;
create function public.workspace_reservation_inputs(p_sale uuid,p_actor uuid,p_building uuid,p_unit uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501'; end if;
 perform sales_legal_assert(p_sale,p_actor,array['admin','developer','sales_agent']);
 select * into a from unit_sale_attempts where id=p_sale;
 if a.building_id is distinct from p_building or a.unit_id is distinct from p_unit or a.redacted_at is not null or not a.is_active then raise exception 'Exact active sale required.';end if;
 return jsonb_build_object('terms',(select to_jsonb(t) from unit_sale_terms t where t.sale_attempt_id=p_sale and t.is_current),'defaults',(select to_jsonb(d) from building_sale_defaults d where d.building_id=p_building));
end $$;
revoke all on function public.workspace_reservation_inputs(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_reservation_inputs(uuid,uuid,uuid,uuid) to service_role;
create policy "visible reservation PDF versions are readable" on storage.objects for select to authenticated using (
 bucket_id='sale-documents'
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
 and exists(select 1 from public.unit_sale_document_versions v join public.unit_sale_documents d on d.id=v.document_id
 join public.unit_sale_attempts a on a.id=d.sale_attempt_id
 where v.storage_bucket=objects.bucket_id and v.storage_path=objects.name and v.redacted_at is null and d.redacted_at is null
 and a.redacted_at is null and public.can_access_sale_attempt(d.sale_attempt_id)
 and (d.visibility='shared_sale_file' or public.is_sales_internal_user() or d.visibility=public.current_app_role())
 and d.document_type='reservation_form'));
commit;
