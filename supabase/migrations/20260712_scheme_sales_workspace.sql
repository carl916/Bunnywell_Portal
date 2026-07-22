-- Phase 1 scheme-level Sales workspace.
-- Commercial scheme settings are kept out of public.buildings because the
-- existing app legitimately exposes buildings to operational users.

create table if not exists public.building_sales_settings (
  building_id uuid primary key references public.buildings(id) on delete cascade,
  total_development_cost numeric(14, 2),
  total_debt numeric(14, 2),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_sales_settings_cost_check check (total_development_cost is null or total_development_cost >= 0),
  constraint building_sales_settings_debt_check check (total_debt is null or total_debt >= 0)
);

drop trigger if exists set_building_sales_settings_updated_at on public.building_sales_settings;
create trigger set_building_sales_settings_updated_at
before update on public.building_sales_settings
for each row execute function public.set_updated_at();

alter table public.unit_sale_records
  add column if not exists list_price numeric(14, 2),
  add column if not exists solicitor_fee_amount numeric(14, 2);

alter table public.unit_sale_records
  drop constraint if exists unit_sale_records_list_price_check,
  drop constraint if exists unit_sale_records_solicitor_fee_amount_check;

alter table public.unit_sale_records
  add constraint unit_sale_records_list_price_check check (list_price is null or list_price >= 0),
  add constraint unit_sale_records_solicitor_fee_amount_check check (solicitor_fee_amount is null or solicitor_fee_amount >= 0);

create index if not exists unit_sale_records_building_status_idx
on public.unit_sale_records (building_id, reservation_form_status, exchange_approval_status, agent_invoice_status);

alter table public.building_sales_settings enable row level security;

create or replace function public.is_commercial_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;

drop policy if exists "commercial admins manage building sales settings" on public.building_sales_settings;
create policy "commercial admins manage building sales settings"
on public.building_sales_settings for all
to authenticated
using (public.is_commercial_admin())
with check (public.is_commercial_admin());
