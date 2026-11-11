begin;
-- Ownership keys preserve inactive sale attempts and nullable legacy/communal links.
alter table public.units add constraint units_id_building_unique unique(id,building_id);
alter table public.areas add constraint areas_id_building_unique unique(id,building_id);
alter table public.unit_sale_documents add constraint sale_documents_id_attempt_unique unique(id,sale_attempt_id);
alter table public.unit_sale_document_versions add constraint sale_versions_id_document_unique unique(id,document_id);
alter table public.unit_sale_invoices add constraint sale_invoices_id_attempt_unique unique(id,sale_attempt_id);
alter table public.unit_sale_attempts add constraint sale_unit_building_owner foreign key(unit_id,building_id) references public.units(id,building_id);
alter table public.areas add constraint area_unit_building_owner foreign key(unit_id,building_id) references public.units(id,building_id);
alter table public.snags add constraint snag_unit_building_owner foreign key(unit_id,building_id) references public.units(id,building_id);
alter table public.snags add constraint snag_area_building_owner foreign key(area_id,building_id) references public.areas(id,building_id);
alter table public.unit_sale_invoices add constraint invoice_document_attempt_owner foreign key(document_id,sale_attempt_id) references public.unit_sale_documents(id,sale_attempt_id);
alter table public.unit_sale_invoice_payments add constraint payment_invoice_attempt_owner foreign key(invoice_id,sale_attempt_id) references public.unit_sale_invoices(id,sale_attempt_id);
alter table public.unit_sale_documents add constraint approved_version_document_owner foreign key(approved_version_id,id) references public.unit_sale_document_versions(id,document_id) deferrable initially deferred;
-- A composite FK alone skips nulls. This enforces exact communal/null association too.
create function public.check_snag_area_ownership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='snags' then
  -- Serialize against a concurrent area move, including nullable communal links.
  if new.area_id is not null then perform 1 from public.areas where id=new.area_id for share; end if;
  if new.area_id is not null and exists(select 1 from public.areas a where a.id=new.area_id and (a.building_id is distinct from new.building_id or a.unit_id is distinct from new.unit_id)) then
   raise exception 'Snag area must belong to the same building and unit (or communal area)' using errcode='23514';
  end if;
 else
  if exists(select 1 from public.snags s where s.area_id=new.id and (s.building_id is distinct from new.building_id or s.unit_id is distinct from new.unit_id)) then
   raise exception 'Area move would detach existing snag ownership' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.check_snag_area_ownership() from public,anon,authenticated;
create constraint trigger snag_area_ownership after insert or update on public.snags deferrable initially immediate for each row execute function public.check_snag_area_ownership();
create constraint trigger area_snag_ownership after update on public.areas deferrable initially immediate for each row execute function public.check_snag_area_ownership();
-- Previously NOT VALID constraints: validate, do not weaken their rules.
alter table public.unit_sale_attempts validate constraint unit_sale_attempts_reservation_date_not_future;
alter table public.unit_sale_invoice_payments validate constraint unit_sale_invoice_payments_amount_check;
alter table public.unit_sale_invoice_payments validate constraint unit_sale_invoice_payments_paid_at_check;
alter table public.unit_sale_invoice_payments validate constraint unit_sale_invoice_payments_void_consistency_check;
alter table public.units validate constraint units_reservation_date_not_future;
notify pgrst,'reload schema';
commit;
