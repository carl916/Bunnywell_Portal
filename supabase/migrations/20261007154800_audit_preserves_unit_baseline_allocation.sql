-- Trusted audit observations must not turn a generated price baseline into
-- intentional sales preparation. All business-field checks, workflow events,
-- and the outer discussion check remain authoritative. No history is deleted.
create or replace function public.sale_attempt_has_meaningful_activity_before_discussions(
  p_sale_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      attempt.workflow_status <> 'draft'
      or nullif(trim(coalesce(attempt.buyer_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_person_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_company_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_phone, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_phone, '')), '') is not null
      or attempt.sales_agent_organisation_id is not null
      or attempt.conveyancer_organisation_id is not null
      or attempt.reservation_date is not null
      or attempt.reservation_terms_checked is true
      or attempt.reservation_submitted_at is not null
      or attempt.reservation_approved_at is not null
      or attempt.commercial_approved_at is not null
      or attempt.exchanged_at is not null
      or attempt.completed_at is not null
      or exists (
        select 1
        from public.unit_sale_terms terms
        where terms.sale_attempt_id = attempt.id
          and (
            terms.status <> 'draft'
            or terms.approved_by_user_id is not null
            or terms.approved_at is not null
            or nullif(trim(coalesce(terms.commercial_summary, '')), '') is not null
            or nullif(trim(coalesce(terms.parking_location_details, '')), '') is not null
            or cardinality(coalesce(terms.additional_special_conditions, '{}'::text[])) > 0
            or coalesce(terms.developer_contribution_value, terms.developer_contribution, 0) <> 0
            or coalesce(terms.agent_contribution_value, terms.agent_contribution, 0) <> 0
            or coalesce(terms.parking_contribution_value, 0) <> 0
            or coalesce(terms.other_concessions, 0) <> 0
            or (
              terms.list_price_at_offer is not null
              and terms.contract_price is distinct from terms.list_price_at_offer
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_payment_schedule schedule
        where schedule.sale_attempt_id = attempt.id
          and (
            schedule.status <> 'pending'
            or nullif(trim(coalesce(schedule.notes, '')), '') is not null
          )
      )
      or exists (
        select 1
        from public.unit_sale_documents document
        where document.sale_attempt_id = attempt.id
          and (
            document.status <> 'not_uploaded'
            or document.approved_by_user_id is not null
            or nullif(trim(coalesce(document.query_note, '')), '') is not null
            or exists (
              select 1
              from public.unit_sale_document_versions version
              where version.document_id = document.id
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_invoices invoice
        where invoice.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_invoice_payments payment
        where payment.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_notes note
        where note.sale_attempt_id = attempt.id
          and note.category <> 'system'
      )
      or exists (
        select 1
        from public.unit_sale_workflow_events event
        where event.sale_attempt_id = attempt.id
          and (event.event_type <> 'sale_record_changed'
            or event.metadata->>'source' is distinct from 'database')
      )
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$$;

revoke all on function public.sale_attempt_has_meaningful_activity_before_discussions(uuid) from public, anon, authenticated;
grant execute on function public.sale_attempt_has_meaningful_activity_before_discussions(uuid) to service_role;

