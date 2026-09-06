-- Read-only follow-up for the production schema exported on 6 September 2026.
-- Returns counts only; no customer records. Run before the proposed migrations.
-- The four *_blockers values should be zero. This is not a full rehearsal.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';

select jsonb_pretty(jsonb_build_object(
  'captured_at', current_timestamp,
  'reservation_workflow_blockers', (
    select count(*) from public.unit_sale_attempts
    where workflow_status not in (
      'draft', 'awaiting_approval', 'approved', 'rejected',
      'reservation_submitted', 'reservation_query_raised', 'reservation_approved',
      'awaiting_commercial_approval', 'ready_for_exchange', 'exchanged',
      'completion_pending', 'completed', 'fallen_through', 'superseded'
    )
  ),
  'reservation_buyer_identity_blockers', (
    select count(*) from public.unit_sale_attempts
    where workflow_status in (
      'awaiting_approval', 'approved', 'reservation_submitted',
      'reservation_approved', 'awaiting_commercial_approval',
      'ready_for_exchange', 'exchanged', 'completion_pending', 'completed'
    )
    and nullif(trim(coalesce(buyer_person_name, '')), '') is null
    and nullif(trim(coalesce(buyer_company_name, '')), '') is null
  ),
  'organisation_type_blockers', (
    select count(*) from public.organisations
    where type not in ('developer_representative', 'contractor', 'supporting_trade',
      'sales_agent', 'conveyancer', 'letting_agent', 'managing_agent')
  ),
  'unit_sale_status_blockers', (
    select count(*) from public.units
    where sale_status not in ('not_released', 'not_for_sale', 'for_sale',
      'reserved', 'exchanged', 'completed', 'handed_over')
  ),
  'units_to_initialise_as_not_in_rental_portfolio', (select count(*) from public.units),
  'active_drafts_to_assess_for_baseline_backfill', (
    select count(*) from public.unit_sale_attempts where is_active is true and workflow_status = 'draft'
  ),
  'submission_identity_backfill_candidates', (
    select count(*) from public.unit_sale_attempts attempt
    join public.profiles profile on profile.id = attempt.reservation_submitted_by_user_id
    where nullif(trim(attempt.reservation_submitted_by_name), '') is null
      or trim(attempt.reservation_submitted_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(trim(attempt.reservation_submitted_by_email), '') is null
  ),
  'earlier_payment_recorder_backfill_candidates', (
    select count(*) from public.unit_sale_invoice_payments payment
    join public.profiles profile on profile.id = payment.recorded_by_user_id
    where payment.recorded_by_name is null
  ),
  'audit_events_to_categorise', (select count(*) from public.audit_events),
  'last_active_sign_in_backfill_candidates', (
    select count(*) from public.profiles profile
    join auth.users auth_user on auth_user.id = profile.id
    where auth_user.last_sign_in_at is not null
  ),
  'btree_gist_available', exists (select 1 from pg_available_extensions where name = 'btree_gist'),
  'btree_gist_installed', exists (select 1 from pg_extension where extname = 'btree_gist')
)) as migration_preflight;

commit;
