begin;
alter policy "permitted users read areas" on public.areas using ((is_back_office_user() OR ((unit_id IS NOT NULL) AND can_access_unit(unit_id)) OR ((unit_id IS NULL) AND (building_id IS NOT NULL) AND can_access_building(building_id))));
alter policy "sales users read sale document versions" on public.unit_sale_document_versions using ((EXISTS ( SELECT 1
   FROM unit_sale_documents usd
  WHERE ((usd.id = unit_sale_document_versions.document_id) AND can_access_sale_attempt(usd.sale_attempt_id) AND ((usd.visibility = 'shared_sale_file'::text) OR is_sales_internal_user() OR (usd.visibility = current_app_role()))))));
alter policy "sales users read sale documents" on public.unit_sale_documents using ((can_access_sale_attempt(sale_attempt_id) AND ((visibility = 'shared_sale_file'::text) OR is_sales_internal_user() OR (visibility = current_app_role()))));
drop index if exists public.snags_building_status_id,public.areas_building_unit_id,public.snag_events_latest_transition,public.snag_photos_snag_id;
commit;