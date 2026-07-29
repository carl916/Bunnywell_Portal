alter table public.building_sale_defaults
  add column if not exists build_cost numeric(14, 2),
  add column if not exists second_deposit_enabled boolean not null default false,
  add column if not exists second_deposit_percent numeric(7, 4),
  add column if not exists second_deposit_months_after_exchange integer;

alter table public.unit_sale_terms
  add column if not exists exchange_deposit_percent numeric(7, 4),
  add column if not exists second_deposit_enabled boolean not null default false,
  add column if not exists second_deposit_percent numeric(7, 4),
  add column if not exists second_deposit_months_after_exchange integer,
  add column if not exists completion_balance_percent numeric(7, 4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'building_sale_defaults_build_cost_check'
      and conrelid = 'public.building_sale_defaults'::regclass
  ) then
    alter table public.building_sale_defaults
      add constraint building_sale_defaults_build_cost_check check (build_cost is null or build_cost >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'building_sale_defaults_second_deposit_check'
      and conrelid = 'public.building_sale_defaults'::regclass
  ) then
    alter table public.building_sale_defaults
      add constraint building_sale_defaults_second_deposit_check check (
        second_deposit_percent is null or (second_deposit_percent >= 0 and second_deposit_percent <= 100)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'building_sale_defaults_second_deposit_timing_check'
      and conrelid = 'public.building_sale_defaults'::regclass
  ) then
    alter table public.building_sale_defaults
      add constraint building_sale_defaults_second_deposit_timing_check check (
        second_deposit_months_after_exchange is null or second_deposit_months_after_exchange >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'unit_sale_terms_deposit_structure_check'
      and conrelid = 'public.unit_sale_terms'::regclass
  ) then
    alter table public.unit_sale_terms
      add constraint unit_sale_terms_deposit_structure_check check (
        (exchange_deposit_percent is null or (exchange_deposit_percent >= 0 and exchange_deposit_percent <= 100))
        and (second_deposit_percent is null or (second_deposit_percent >= 0 and second_deposit_percent <= 100))
        and (completion_balance_percent is null or (completion_balance_percent >= 0 and completion_balance_percent <= 100))
        and (second_deposit_months_after_exchange is null or second_deposit_months_after_exchange >= 0)
        and (
          exchange_deposit_percent is null
          or completion_balance_percent is null
          or (
            coalesce(exchange_deposit_percent, 0)
            + coalesce(case when second_deposit_enabled then second_deposit_percent else 0 end, 0)
            + coalesce(completion_balance_percent, 0)
          ) = 100
        )
      );
  end if;
end $$;

with forum_house as (
  select id from public.buildings where lower(name) = 'forum house' limit 1
)
insert into public.building_sale_defaults (
  building_id,
  reservation_fee,
  reservation_fee_holder_default,
  exchange_deposit_percent,
  second_deposit_enabled,
  second_deposit_percent,
  second_deposit_months_after_exchange,
  default_agent_fee_percent,
  default_vat_rate,
  default_sales_solicitor_fee,
  notes
)
select
  id,
  5000,
  'sales_agent',
  10,
  true,
  5,
  6,
  10,
  20,
  882,
  'Seeded production sales default deal structure for Forum House.'
from forum_house
on conflict (building_id) do update set
  reservation_fee = coalesce(public.building_sale_defaults.reservation_fee, excluded.reservation_fee),
  reservation_fee_holder_default = coalesce(public.building_sale_defaults.reservation_fee_holder_default, excluded.reservation_fee_holder_default),
  exchange_deposit_percent = coalesce(public.building_sale_defaults.exchange_deposit_percent, excluded.exchange_deposit_percent),
  second_deposit_enabled = excluded.second_deposit_enabled,
  second_deposit_percent = coalesce(public.building_sale_defaults.second_deposit_percent, excluded.second_deposit_percent),
  second_deposit_months_after_exchange = coalesce(public.building_sale_defaults.second_deposit_months_after_exchange, excluded.second_deposit_months_after_exchange),
  default_agent_fee_percent = coalesce(public.building_sale_defaults.default_agent_fee_percent, excluded.default_agent_fee_percent),
  default_vat_rate = coalesce(public.building_sale_defaults.default_vat_rate, excluded.default_vat_rate),
  default_sales_solicitor_fee = coalesce(public.building_sale_defaults.default_sales_solicitor_fee, excluded.default_sales_solicitor_fee),
  notes = coalesce(public.building_sale_defaults.notes, excluded.notes),
  updated_at = now();

with forum_house as (
  select id from public.buildings where lower(name) = 'forum house' limit 1
),
schedule_rows as (
  select id as building_id, 1 as sequence_no, 'exchange'::text as payment_stage, '10% exchange deposit'::text as label, 0 as due_offset_days, 10::numeric as percent_of_contract_price, true as includes_reservation_fee from forum_house
  union all
  select id, 2, 'delayed_deposit', '5% second deposit', 186, 5::numeric, false from forum_house
  union all
  select id, 3, 'completion', '85% balance on completion', 0, 85::numeric, false from forum_house
)
insert into public.building_sale_default_payment_schedule (
  building_id,
  sequence_no,
  payment_stage,
  label,
  due_offset_days,
  percent_of_contract_price,
  includes_reservation_fee
)
select
  building_id,
  sequence_no,
  payment_stage,
  label,
  due_offset_days,
  percent_of_contract_price,
  includes_reservation_fee
from schedule_rows
on conflict (building_id, sequence_no) do update set
  payment_stage = excluded.payment_stage,
  label = excluded.label,
  due_offset_days = excluded.due_offset_days,
  percent_of_contract_price = excluded.percent_of_contract_price,
  includes_reservation_fee = excluded.includes_reservation_fee,
  updated_at = now();
