-- Conveyancing POC financial impact fields.
-- Adds lightweight concession modelling to the current unit sale record.

alter table public.unit_sale_records
  add column if not exists estimated_list_price numeric(14, 2),
  add column if not exists incentives_value numeric(14, 2),
  add column if not exists parking_value numeric(14, 2),
  add column if not exists other_concessions_value numeric(14, 2),
  add column if not exists comparable_units_count integer not null default 0;

alter table public.unit_sale_records
  drop constraint if exists unit_sale_records_comparable_units_count_check;

alter table public.unit_sale_records
  add constraint unit_sale_records_comparable_units_count_check
  check (comparable_units_count >= 0);
