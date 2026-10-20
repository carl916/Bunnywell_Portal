begin;

-- A NULL total with zero tranches is the legacy "fee not initialised" shape.
-- Zero total is different: it is an explicit no-fee agreement.
create or replace function public.normalise_unit_sale_agent_fee_structure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare defaults record;
begin
  if tg_op = 'INSERT' and new.is_current and new.status = 'draft'
    and new.approved_at is null and new.approved_by_user_id is null
    and new.agent_fee_percent is null
    and coalesce(new.exchange_agent_fee_percent,0) = 0
    and coalesce(new.completion_agent_fee_percent,0) = 0 then
    select d.default_agent_fee_percent as total,
      d.default_exchange_agent_fee_percent as exchange,
      d.default_completion_agent_fee_percent as completion
    into defaults
    from public.unit_sale_attempts a
    join public.units u on u.id = a.unit_id
    join public.building_sale_defaults d on d.building_id = a.building_id
    where a.id = new.sale_attempt_id and a.is_active and a.is_system_baseline
      and a.workflow_status = 'draft'
      and u.sale_status in ('not_released','not_for_sale','for_sale')
      and a.reservation_date is null and a.reservation_submitted_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null
      and a.exchanged_at is null and a.completed_at is null and a.legal_completed_at is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,
        a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from public.unit_sale_documents doc where doc.sale_attempt_id=a.id
        and doc.document_type='reservation_form' and doc.redacted_at is null and doc.status<>'redacted')
      and not exists(select 1 from public.unit_sale_invoices invoice where invoice.sale_attempt_id=a.id)
      and not exists(select 1 from public.sale_legal_emails email where email.sale_attempt_id=a.id)
      and d.default_agent_fee_percent is not null
      and round(d.default_exchange_agent_fee_percent+d.default_completion_agent_fee_percent,4)
        = round(d.default_agent_fee_percent,4);
    if found then
      new.agent_fee_percent := defaults.total;
      new.exchange_agent_fee_percent := defaults.exchange;
      new.completion_agent_fee_percent := defaults.completion;
      return new;
    end if;
  end if;

  -- Preserve compatibility with legacy saves; the commercial-model wrapper
  -- subsequently writes the explicitly requested split.
  if new.exchange_agent_fee_percent is null or new.completion_agent_fee_percent is null then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent,0);
    new.completion_agent_fee_percent := 0;
  elsif tg_op = 'UPDATE'
    and new.agent_fee_percent is distinct from old.agent_fee_percent
    and new.exchange_agent_fee_percent is not distinct from old.exchange_agent_fee_percent
    and new.completion_agent_fee_percent is not distinct from old.completion_agent_fee_percent then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent,0);
    new.completion_agent_fee_percent := 0;
  end if;
  return new;
end;
$$;

-- Repair only untouched baseline fee configurations. Agreed fees, including
-- explicit zero fees, genuine reservation drafts and financial records remain.
do $$
declare candidate record;
begin
  for candidate in
    select t.id, d.default_agent_fee_percent as total,
      d.default_exchange_agent_fee_percent as exchange,
      d.default_completion_agent_fee_percent as completion
    from public.unit_sale_terms t
    join public.unit_sale_attempts a on a.id=t.sale_attempt_id
    join public.units u on u.id=a.unit_id
    join public.building_sale_defaults d on d.building_id=a.building_id
    where t.is_current and t.status='draft'
      and t.approved_at is null and t.approved_by_user_id is null
      and t.agent_fee_percent is null
      and coalesce(t.exchange_agent_fee_percent,0)=0
      and coalesce(t.completion_agent_fee_percent,0)=0
      and a.is_active and a.is_system_baseline and a.workflow_status='draft'
      and u.sale_status in ('not_released','not_for_sale','for_sale')
      and a.reservation_date is null and a.reservation_submitted_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null
      and a.exchanged_at is null and a.completed_at is null and a.legal_completed_at is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,
        a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from public.unit_sale_documents doc where doc.sale_attempt_id=a.id
        and doc.document_type='reservation_form' and doc.redacted_at is null and doc.status<>'redacted')
      and not exists(select 1 from public.unit_sale_invoices invoice where invoice.sale_attempt_id=a.id)
      and not exists(select 1 from public.sale_legal_emails email where email.sale_attempt_id=a.id)
      and d.default_agent_fee_percent is not null
      and round(d.default_exchange_agent_fee_percent+d.default_completion_agent_fee_percent,4)
        = round(d.default_agent_fee_percent,4)
    order by a.building_id,a.id
    for update of d,a,u,t
  loop
    update public.unit_sale_terms set
      agent_fee_percent=candidate.total,
      exchange_agent_fee_percent=candidate.exchange,
      completion_agent_fee_percent=candidate.completion,
      updated_at=now()
    where id=candidate.id;
  end loop;
end;
$$;

commit;
