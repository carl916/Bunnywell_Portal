-- Conveyancing POC sale records.
-- Additive prototype table for Admin/Developer-only sales progression data.

create table if not exists public.unit_sale_records (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  reservation_date date,
  target_exchange_date date,
  actual_exchange_date date,
  target_completion_date date,
  actual_completion_date date,
  contract_price numeric(14, 2),
  reservation_fee numeric(14, 2),
  deposit_amount numeric(14, 2),
  sales_agent text,
  buyer_solicitor text,
  developer_solicitor text,
  key_risks text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id)
);

create index if not exists unit_sale_records_building_idx on public.unit_sale_records (building_id);
create index if not exists unit_sale_records_unit_idx on public.unit_sale_records (unit_id);
create index if not exists unit_sale_records_updated_idx on public.unit_sale_records (updated_at desc);

drop trigger if exists set_unit_sale_records_updated_at on public.unit_sale_records;
create trigger set_unit_sale_records_updated_at
before update on public.unit_sale_records
for each row execute function public.set_updated_at();

alter table public.unit_sale_records enable row level security;

drop policy if exists "setup admins manage unit sale records" on public.unit_sale_records;
create policy "setup admins manage unit sale records"
on public.unit_sale_records for all
to authenticated
using (public.is_setup_admin())
with check (public.is_setup_admin());
