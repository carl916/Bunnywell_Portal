begin;

-- Imported system baselines may have a price but no deposit configuration.
-- A false column default on those rows is not an explicit "no further deposit".
-- Reuse the same eligibility rules for future changes and the one-off repair.
create function public.sales_apply_inherited_deposits(
  p_defaults public.building_sale_defaults,
  p_previous public.building_sale_defaults default null
) returns integer language plpgsql security definer set search_path='' as $$
declare r record; changed integer := 0;
begin
  for r in
    select t.id, a.id as sale_id
    from public.unit_sale_terms t
    join public.unit_sale_attempts a on a.id=t.sale_attempt_id
    join public.units u on u.id=a.unit_id
    where a.building_id=p_defaults.building_id and a.is_active and a.workflow_status='draft'
      and t.is_current and t.status='draft'
      and u.sale_status in ('not_released','not_for_sale','for_sale')
      and a.exchanged_at is null and a.completed_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null
      and a.reservation_submitted_at is null and a.reservation_date is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,
        a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from public.unit_sale_documents d where d.sale_attempt_id=a.id
        and d.document_type='reservation_form' and d.redacted_at is null and d.status<>'redacted')
      and not exists(select 1 from public.sale_exchange_deposit_sources s where s.sale_attempt_id=a.id)
      and not exists(select 1 from public.unit_sale_payment_schedule s where s.sale_attempt_id=a.id and (
        s.status is distinct from 'pending' or s.payment_stage not in ('exchange','delayed_deposit','completion')
        or s.fixed_amount is not null or nullif(btrim(s.notes),'') is not null
        or s.percent_of_contract_price is distinct from case s.payment_stage
          when 'exchange' then t.exchange_deposit_percent
          when 'delayed_deposit' then case when t.second_deposit_enabled then t.second_deposit_percent else null end
          when 'completion' then t.completion_balance_percent end
        or s.expected_amount is not null and s.expected_amount is distinct from round(t.contract_price*s.percent_of_contract_price/100,2)
      ))
      and (
        -- Only a completely uninitialised system baseline may adopt CURRENT
        -- defaults without evidence of its previous inherited configuration.
        (a.is_system_baseline and t.exchange_deposit_percent is null and t.completion_balance_percent is null
          and not coalesce(t.second_deposit_enabled,false) and t.second_deposit_percent is null
          and t.second_deposit_months_after_exchange is null and t.further_deposit_timing is null)
        or (
          p_previous.building_id is not null
          and t.exchange_deposit_percent is not distinct from p_previous.exchange_deposit_percent
          and coalesce(t.second_deposit_enabled,false)=coalesce(p_previous.second_deposit_enabled,false)
          -- Disabled deposits have no amount or timing. Legacy zero/null values
          -- must not accidentally turn an inherited schedule into an override.
          and (not coalesce(t.second_deposit_enabled,false) or
            (t.second_deposit_percent,t.second_deposit_months_after_exchange,t.further_deposit_timing)
            is not distinct from
            (p_previous.second_deposit_percent,p_previous.second_deposit_months_after_exchange,p_previous.further_deposit_timing))
          and (t.completion_balance_percent is null or t.completion_balance_percent =
            100-coalesce(p_previous.exchange_deposit_percent,0)
              -case when p_previous.second_deposit_enabled then coalesce(p_previous.second_deposit_percent,0) else 0 end)
        )
      )
      and (t.exchange_deposit_percent,t.second_deposit_enabled,t.second_deposit_percent,
        t.second_deposit_months_after_exchange,t.further_deposit_timing,t.completion_balance_percent)
        is distinct from (
          p_defaults.exchange_deposit_percent,coalesce(p_defaults.second_deposit_enabled,false),
          case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_percent end,
          case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_months_after_exchange end,
          case when p_defaults.second_deposit_enabled then p_defaults.further_deposit_timing end,
          100-coalesce(p_defaults.exchange_deposit_percent,0)
            -case when p_defaults.second_deposit_enabled then coalesce(p_defaults.second_deposit_percent,0) else 0 end
        )
    order by a.id for update of a,t,u
  loop
    update public.unit_sale_terms set
      exchange_deposit_percent=p_defaults.exchange_deposit_percent,
      second_deposit_enabled=coalesce(p_defaults.second_deposit_enabled,false),
      second_deposit_percent=case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_percent end,
      second_deposit_months_after_exchange=case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_months_after_exchange end,
      further_deposit_timing=case when p_defaults.second_deposit_enabled then p_defaults.further_deposit_timing end,
      completion_balance_percent=100-coalesce(p_defaults.exchange_deposit_percent,0)
        -case when p_defaults.second_deposit_enabled then coalesce(p_defaults.second_deposit_percent,0) else 0 end,
      deposit_summary=null,updated_at=now()
    where id=r.id;
    -- Only untouched generated schedules passed the checks above. The normal
    -- commercial workflow rebuilds them from the corrected terms.
    delete from public.unit_sale_payment_schedule where sale_attempt_id=r.sale_id;
    changed := changed+1;
  end loop;
  return changed;
end $$;
revoke all on function public.sales_apply_inherited_deposits(public.building_sale_defaults,public.building_sale_defaults)
  from public,anon,authenticated,service_role;

create or replace function public.sales_cascade_deposit_defaults()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform public.sales_apply_inherited_deposits(new);
  else
    perform public.sales_apply_inherited_deposits(new,old);
  end if;
  return new;
end $$;
revoke all on function public.sales_cascade_deposit_defaults() from public,anon,authenticated,service_role;
drop trigger deposit_defaults_cascade on public.building_sale_defaults;
create trigger deposit_defaults_cascade after insert or update on public.building_sale_defaults
  for each row execute function public.sales_cascade_deposit_defaults();

-- Repair the previously skipped records using current saved defaults. This
-- deliberately cannot rewrite populated overrides, drafts with buyer data,
-- submitted/reserved/exchanged/completed sales, or retained exchange sources.
do $$
declare d public.building_sale_defaults;
begin
  for d in select * from public.building_sale_defaults
    where exchange_deposit_percent is not null order by building_id for update
  loop
    perform public.sales_apply_inherited_deposits(d);
  end loop;
end $$;

commit;
