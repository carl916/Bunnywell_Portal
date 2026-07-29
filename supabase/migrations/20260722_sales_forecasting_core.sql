-- Sales forecasting production foundation.
-- Forecasting is developer-only and consumes sales pipeline data without mutating sale files.

create table if not exists public.sales_forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  sell_unit_count integer not null default 0,
  retain_unit_count integer not null default 0,
  rent_unit_count integer not null default 0,
  refinance_unit_count integer not null default 0,
  average_sale_value numeric(14, 2),
  average_rent_per_unit numeric(14, 2) not null default 0,
  ltv_percent numeric(7, 4) not null default 70,
  monthly_interest_rate numeric(7, 4) not null default 0,
  completion_month integer not null default 1,
  refinance_month integer not null default 1,
  opening_debt numeric(14, 2) not null default 0,
  development_cost numeric(14, 2) not null default 0,
  investor_repayment numeric(14, 2) not null default 0,
  results jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_forecast_scenarios_status_check check (status in ('draft', 'active', 'archived')),
  constraint sales_forecast_scenarios_counts_check check (
    sell_unit_count >= 0
    and retain_unit_count >= 0
    and rent_unit_count >= 0
    and refinance_unit_count >= 0
  ),
  constraint sales_forecast_scenarios_money_check check (
    (average_sale_value is null or average_sale_value >= 0)
    and average_rent_per_unit >= 0
    and opening_debt >= 0
    and development_cost >= 0
    and investor_repayment >= 0
  ),
  constraint sales_forecast_scenarios_percent_check check (
    ltv_percent >= 0 and ltv_percent <= 100
    and monthly_interest_rate >= 0 and monthly_interest_rate <= 100
  ),
  constraint sales_forecast_scenarios_month_check check (
    completion_month >= 0
    and refinance_month >= 0
  )
);

create table if not exists public.sales_forecast_scenario_units (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.sales_forecast_scenarios(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  strategy text not null,
  assumed_value numeric(14, 2),
  monthly_rent numeric(14, 2),
  completion_month integer,
  refinance_ltv_percent numeric(7, 4),
  created_at timestamptz not null default now(),
  constraint sales_forecast_scenario_units_strategy_check check (strategy in ('sell', 'retain', 'rent', 'refinance')),
  constraint sales_forecast_scenario_units_money_check check (
    (assumed_value is null or assumed_value >= 0)
    and (monthly_rent is null or monthly_rent >= 0)
  ),
  constraint sales_forecast_scenario_units_month_check check (completion_month is null or completion_month >= 0),
  constraint sales_forecast_scenario_units_ltv_check check (refinance_ltv_percent is null or (refinance_ltv_percent >= 0 and refinance_ltv_percent <= 100)),
  unique (scenario_id, unit_id)
);

create index if not exists sales_forecast_scenarios_building_idx on public.sales_forecast_scenarios (building_id, status);
create index if not exists sales_forecast_scenario_units_scenario_idx on public.sales_forecast_scenario_units (scenario_id);
create index if not exists sales_forecast_scenario_units_building_idx on public.sales_forecast_scenario_units (building_id, strategy);

drop trigger if exists set_sales_forecast_scenarios_updated_at on public.sales_forecast_scenarios;
create trigger set_sales_forecast_scenarios_updated_at
before update on public.sales_forecast_scenarios
for each row execute function public.set_updated_at();

alter table public.sales_forecast_scenarios enable row level security;
alter table public.sales_forecast_scenario_units enable row level security;

drop policy if exists "sales internal users read forecast scenarios" on public.sales_forecast_scenarios;
create policy "sales internal users read forecast scenarios"
on public.sales_forecast_scenarios for select
to authenticated
using (public.is_sales_internal_user() and public.can_access_sales_building(building_id));

drop policy if exists "sales internal users manage forecast scenarios" on public.sales_forecast_scenarios;
create policy "sales internal users manage forecast scenarios"
on public.sales_forecast_scenarios for all
to authenticated
using (public.is_sales_internal_user() and public.can_access_sales_building(building_id))
with check (public.is_sales_internal_user() and public.can_access_sales_building(building_id));

drop policy if exists "sales internal users read forecast scenario units" on public.sales_forecast_scenario_units;
create policy "sales internal users read forecast scenario units"
on public.sales_forecast_scenario_units for select
to authenticated
using (public.is_sales_internal_user() and public.can_access_sales_building(building_id));

drop policy if exists "sales internal users manage forecast scenario units" on public.sales_forecast_scenario_units;
create policy "sales internal users manage forecast scenario units"
on public.sales_forecast_scenario_units for all
to authenticated
using (public.is_sales_internal_user() and public.can_access_sales_building(building_id))
with check (public.is_sales_internal_user() and public.can_access_sales_building(building_id));
