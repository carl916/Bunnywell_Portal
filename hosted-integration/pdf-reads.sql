-- Independent hosted integration only. PDF reads follow existing document metadata RLS.
CREATE POLICY "visible completion PDF versions are readable"
ON storage.objects FOR SELECT TO authenticated
USING (
 bucket_id='sale-documents'
 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.active)
 AND EXISTS (
  SELECT 1 FROM public.unit_sale_document_versions v
  JOIN public.unit_sale_documents d ON d.id=v.document_id
  WHERE v.storage_bucket=storage.objects.bucket_id AND v.storage_path=storage.objects.name
   AND v.redacted_at IS NULL AND d.redacted_at IS NULL
   AND public.can_access_sale_attempt(d.sale_attempt_id)
   AND (d.visibility='shared_sale_file' OR public.is_sales_internal_user() OR d.visibility=public.current_app_role())
   AND d.document_type IN ('completion_statement','draft_statement_of_account','completion_correspondence')
 )
);