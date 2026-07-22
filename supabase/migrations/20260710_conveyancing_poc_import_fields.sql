-- Conveyancing POC spreadsheet import fields.
-- Captures the operational values present in the live conveyancing tracker.

alter table public.unit_sale_records
  add column if not exists spreadsheet_source text,
  add column if not exists source_row_number integer,
  add column if not exists expected_exchange_label text,
  add column if not exists parking_spaces_count integer,
  add column if not exists parking_allocation text,
  add column if not exists agent_fee_percent numeric(8, 4),
  add column if not exists agent_fee_amount numeric(14, 2),
  add column if not exists agent_gross_invoice_amount numeric(14, 2),
  add column if not exists agent_invoice_reference text,
  add column if not exists agent_invoice_date date,
  add column if not exists agent_invoice_status text not null default 'not_uploaded',
  add column if not exists amount_permitted_to_release numeric(14, 2),
  add column if not exists amount_paid_from_first_payment numeric(14, 2),
  add column if not exists first_payment_made_at date,
  add column if not exists invoice_shortfall_amount numeric(14, 2),
  add column if not exists invoice_shortfall_paid_at date,
  add column if not exists developer_contribution_value numeric(14, 2),
  add column if not exists agent_contribution_value numeric(14, 2),
  add column if not exists completion_funds_adjustment numeric(14, 2),
  add column if not exists agent_invoice_deduction_value numeric(14, 2),
  add column if not exists incentive_summary text,
  add column if not exists imported_at timestamptz;

alter table public.unit_sale_records
  drop constraint if exists unit_sale_records_agent_invoice_status_check,
  drop constraint if exists unit_sale_records_parking_spaces_count_check,
  drop constraint if exists unit_sale_records_agent_fee_percent_check;

alter table public.unit_sale_records
  add constraint unit_sale_records_agent_invoice_status_check
  check (agent_invoice_status in ('not_uploaded', 'recorded', 'uploaded', 'under_review', 'approved', 'query_raised', 'paid')),
  add constraint unit_sale_records_parking_spaces_count_check
  check (parking_spaces_count is null or parking_spaces_count >= 0),
  add constraint unit_sale_records_agent_fee_percent_check
  check (agent_fee_percent is null or agent_fee_percent >= 0);

alter table public.unit_sale_notes
  add column if not exists source_label text,
  add column if not exists source_row_number integer,
  add column if not exists source_import_key text;

create unique index if not exists unit_sale_notes_source_import_key_idx
on public.unit_sale_notes (source_import_key);

create index if not exists unit_sale_records_imported_idx
on public.unit_sale_records (spreadsheet_source, source_row_number);
