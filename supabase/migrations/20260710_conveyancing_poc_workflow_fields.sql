-- Conveyancing POC workflow fields.
-- Adds explicit process gates for reservation, exchange, invoice and completion checks.

alter table public.unit_sale_records
  add column if not exists reservation_fee_holder text,
  add column if not exists reservation_form_status text not null default 'not_uploaded',
  add column if not exists reservation_form_url text,
  add column if not exists reservation_form_uploaded_at timestamptz,
  add column if not exists incentives_approval_status text not null default 'draft',
  add column if not exists incentives_approved_at timestamptz,
  add column if not exists exchange_approval_status text not null default 'not_requested',
  add column if not exists exchange_approval_requested_at timestamptz,
  add column if not exists exchange_approval_approved_at timestamptz,
  add column if not exists agent_invoice_url text,
  add column if not exists agent_invoice_uploaded_at timestamptz,
  add column if not exists agent_invoice_approved_at timestamptz,
  add column if not exists completion_statement_status text not null default 'not_uploaded',
  add column if not exists completion_statement_url text,
  add column if not exists completion_statement_uploaded_at timestamptz,
  add column if not exists completion_statement_approved_at timestamptz,
  add column if not exists statement_of_account_status text not null default 'not_uploaded',
  add column if not exists statement_of_account_url text,
  add column if not exists statement_of_account_uploaded_at timestamptz,
  add column if not exists statement_of_account_approved_at timestamptz;

alter table public.unit_sale_records
  drop constraint if exists unit_sale_records_reservation_form_status_check,
  drop constraint if exists unit_sale_records_incentives_approval_status_check,
  drop constraint if exists unit_sale_records_exchange_approval_status_check,
  drop constraint if exists unit_sale_records_completion_statement_status_check,
  drop constraint if exists unit_sale_records_statement_of_account_status_check;

alter table public.unit_sale_records
  add constraint unit_sale_records_reservation_form_status_check
  check (reservation_form_status in ('not_uploaded', 'uploaded', 'approved', 'query_raised')),
  add constraint unit_sale_records_incentives_approval_status_check
  check (incentives_approval_status in ('draft', 'submitted', 'approved', 'query_raised')),
  add constraint unit_sale_records_exchange_approval_status_check
  check (exchange_approval_status in ('not_requested', 'requested', 'approved', 'rejected')),
  add constraint unit_sale_records_completion_statement_status_check
  check (completion_statement_status in ('not_uploaded', 'uploaded', 'approved', 'query_raised')),
  add constraint unit_sale_records_statement_of_account_status_check
  check (statement_of_account_status in ('not_uploaded', 'uploaded', 'approved', 'query_raised'));
