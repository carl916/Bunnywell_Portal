-- Separate sales-agent fees from the legal sale lifecycle while preserving all
-- existing sale, invoice, document and payment records.

alter table public.building_sale_defaults
  add column if not exists default_exchange_agent_fee_percent numeric(7, 4),
  add column if not exists default_completion_agent_fee_percent numeric(7, 4);

update public.building_sale_defaults
set
  default_exchange_agent_fee_percent = coalesce(default_exchange_agent_fee_percent, default_agent_fee_percent, 0),
  default_completion_agent_fee_percent = coalesce(default_completion_agent_fee_percent, 0)
where default_exchange_agent_fee_percent is null
   or default_completion_agent_fee_percent is null;

alter table public.building_sale_defaults
  drop constraint if exists building_sale_defaults_agent_fee_structure_check;

alter table public.building_sale_defaults
  add constraint building_sale_defaults_agent_fee_structure_check check (
    (default_agent_fee_percent is null
      and default_exchange_agent_fee_percent = 0
      and default_completion_agent_fee_percent = 0)
    or (
      default_agent_fee_percent between 0 and 100
      and default_exchange_agent_fee_percent between 0 and 100
      and default_completion_agent_fee_percent between 0 and 100
      and round(default_exchange_agent_fee_percent + default_completion_agent_fee_percent, 4) = round(default_agent_fee_percent, 4)
    )
  );

alter table public.unit_sale_terms
  add column if not exists exchange_agent_fee_percent numeric(7, 4),
  add column if not exists completion_agent_fee_percent numeric(7, 4);

-- Existing sales and their invoices retain their original financial position:
-- the previous single fee is treated as the Exchange tranche and Completion is
-- zero until a future sale is established from the new building defaults.
update public.unit_sale_terms
set
  exchange_agent_fee_percent = coalesce(exchange_agent_fee_percent, agent_fee_percent, 0),
  completion_agent_fee_percent = coalesce(completion_agent_fee_percent, 0)
where exchange_agent_fee_percent is null
   or completion_agent_fee_percent is null;

alter table public.unit_sale_terms
  drop constraint if exists unit_sale_terms_agent_fee_structure_check;

alter table public.unit_sale_terms
  add constraint unit_sale_terms_agent_fee_structure_check check (
    (agent_fee_percent is null
      and exchange_agent_fee_percent = 0
      and completion_agent_fee_percent = 0)
    or (
      agent_fee_percent between 0 and 100
      and exchange_agent_fee_percent between 0 and 100
      and completion_agent_fee_percent between 0 and 100
      and round(exchange_agent_fee_percent + completion_agent_fee_percent, 4) = round(agent_fee_percent, 4)
    )
  );

-- Keep legacy callers of save_unit_commercial_model compatible. The wrapper
-- below immediately writes the requested split, while this trigger supplies a
-- valid Exchange-only interim split when the legacy function inserts a row or
-- changes the total percentage first.
create or replace function public.normalise_unit_sale_agent_fee_structure()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.exchange_agent_fee_percent is null or new.completion_agent_fee_percent is null then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent, 0);
    new.completion_agent_fee_percent := 0;
  elsif tg_op = 'UPDATE'
    and new.agent_fee_percent is distinct from old.agent_fee_percent
    and new.exchange_agent_fee_percent is not distinct from old.exchange_agent_fee_percent
    and new.completion_agent_fee_percent is not distinct from old.completion_agent_fee_percent then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent, 0);
    new.completion_agent_fee_percent := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists normalise_unit_sale_agent_fee_structure on public.unit_sale_terms;
create trigger normalise_unit_sale_agent_fee_structure
before insert or update of agent_fee_percent on public.unit_sale_terms
for each row execute function public.normalise_unit_sale_agent_fee_structure();

alter table public.unit_sale_documents
  add column if not exists fee_milestone text;

update public.unit_sale_documents
set fee_milestone = 'exchange'
where document_type = 'agent_invoice'
  and fee_milestone is null;

alter table public.unit_sale_documents
  drop constraint if exists unit_sale_documents_fee_milestone_check;

alter table public.unit_sale_documents
  add constraint unit_sale_documents_fee_milestone_check check (
    fee_milestone is null or fee_milestone in ('exchange', 'completion')
  );

create index if not exists unit_sale_documents_agent_fee_milestone_idx
  on public.unit_sale_documents (sale_attempt_id, fee_milestone)
  where document_type = 'agent_invoice';

alter table public.unit_sale_invoices
  add column if not exists fee_milestone text,
  add column if not exists fee_percentage numeric(7, 4),
  add column if not exists expected_gross_amount numeric(14, 2);

update public.unit_sale_invoices invoice
set
  fee_milestone = coalesce(invoice.fee_milestone, 'exchange'),
  fee_percentage = coalesce(invoice.fee_percentage, terms.exchange_agent_fee_percent, terms.agent_fee_percent),
  expected_gross_amount = coalesce(invoice.expected_gross_amount, invoice.net_amount + invoice.vat_amount)
from public.unit_sale_terms terms
where invoice.invoice_type = 'sales_agent'
  and terms.sale_attempt_id = invoice.sale_attempt_id
  and terms.is_current is true;

update public.unit_sale_invoices
set fee_milestone = 'exchange'
where invoice_type = 'sales_agent'
  and fee_milestone is null;

alter table public.unit_sale_invoices
  drop constraint if exists unit_sale_invoices_fee_milestone_check;

alter table public.unit_sale_invoices
  add constraint unit_sale_invoices_fee_milestone_check check (
    (invoice_type <> 'sales_agent' and fee_milestone is null)
    or (invoice_type = 'sales_agent' and fee_milestone in ('exchange', 'completion'))
  ),
  add constraint unit_sale_invoices_fee_percentage_check check (
    fee_percentage is null or fee_percentage between 0 and 100
  ),
  add constraint unit_sale_invoices_expected_gross_check check (
    expected_gross_amount is null or expected_gross_amount >= 0
  );

create unique index if not exists unit_sale_invoices_current_agent_milestone_idx
  on public.unit_sale_invoices (sale_attempt_id, fee_milestone)
  where invoice_type = 'sales_agent'
    and status not in ('superseded', 'redacted');

-- Payment rows were already present, but the old UI treated one row per source
-- as editable reconciliation state. Keep every row and make new writes append-only.
alter table public.unit_sale_invoice_payments
  add column if not exists payer_type text,
  add column if not exists client_reference uuid default gen_random_uuid();

update public.unit_sale_invoice_payments
set payer_type = case payment_source
  when 'developer_shortfall' then 'developer'
  when 'other' then 'other'
  else 'solicitor'
end
where payer_type is null;

update public.unit_sale_invoice_payments
set client_reference = gen_random_uuid()
where client_reference is null;

alter table public.unit_sale_invoice_payments
  alter column payer_type set not null,
  alter column client_reference set not null,
  drop constraint if exists unit_sale_invoice_payments_payer_type_check,
  drop constraint if exists unit_sale_invoice_payments_amount_check,
  drop constraint if exists unit_sale_invoice_payments_paid_at_check;

alter table public.unit_sale_invoice_payments
  add constraint unit_sale_invoice_payments_payer_type_check check (payer_type in ('solicitor', 'developer', 'other')),
  add constraint unit_sale_invoice_payments_amount_check check (amount > 0) not valid,
  add constraint unit_sale_invoice_payments_paid_at_check check (paid_at is not null) not valid;

create unique index if not exists unit_sale_invoice_payments_client_reference_idx
  on public.unit_sale_invoice_payments (client_reference);

-- Payment history is immutable to authenticated clients. New rows are written
-- only by record_unit_sale_invoice_payment, which applies the role, invoice,
-- idempotency and overpayment checks below. The existing SELECT policy remains
-- in place so sale users retain their scoped read access.
drop policy if exists "commercial admins manage sale invoice payments" on public.unit_sale_invoice_payments;

-- Payment state is derived from persisted rows. Restore the approval state for
-- legacy invoices whose status was previously overwritten by reconciliation.
update public.unit_sale_invoices
set status = 'approved'
where invoice_type = 'sales_agent'
  and approved_at is not null
  and status in ('part_paid', 'paid', 'reconciled');

create or replace function public.save_unit_commercial_model_with_agent_fees(
  p_unit_id uuid,
  p_requester_id uuid,
  p_list_price_at_offer numeric,
  p_contract_price numeric,
  p_parking_value numeric,
  p_developer_contribution numeric,
  p_agent_contribution numeric,
  p_reservation_fee numeric,
  p_reservation_fee_holder text,
  p_agent_fee_percent numeric,
  p_exchange_agent_fee_percent numeric,
  p_completion_agent_fee_percent numeric,
  p_vat_rate numeric,
  p_solicitor_fee numeric,
  p_exchange_deposit_percent numeric,
  p_second_deposit_enabled boolean,
  p_second_deposit_percent numeric,
  p_second_deposit_months_after_exchange integer,
  p_completion_balance_percent numeric,
  p_deposit_summary text,
  p_commercial_summary text,
  p_payment_schedule jsonb default '[]'::jsonb,
  p_developer_contribution_value numeric default null,
  p_developer_contribution_value_type text default 'amount',
  p_agent_contribution_value numeric default null,
  p_agent_contribution_value_type text default 'amount',
  p_parking_contribution_value numeric default 0,
  p_parking_location_details text default null,
  p_additional_special_conditions text[] default '{}'::text[]
)
returns table (sale_attempt_id uuid, sale_terms_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  if round(coalesce(p_exchange_agent_fee_percent, 0) + coalesce(p_completion_agent_fee_percent, 0), 4)
      <> round(coalesce(p_agent_fee_percent, 0), 4) then
    raise exception 'Exchange fee plus Completion fee must equal the total agent fee.';
  end if;

  select result.sale_attempt_id, result.sale_terms_id
  into v_result
  from public.save_unit_commercial_model(
    p_unit_id => p_unit_id,
    p_requester_id => p_requester_id,
    p_list_price_at_offer => p_list_price_at_offer,
    p_contract_price => p_contract_price,
    p_parking_value => p_parking_value,
    p_developer_contribution => p_developer_contribution,
    p_agent_contribution => p_agent_contribution,
    p_reservation_fee => p_reservation_fee,
    p_reservation_fee_holder => p_reservation_fee_holder,
    p_agent_fee_percent => p_agent_fee_percent,
    p_vat_rate => p_vat_rate,
    p_solicitor_fee => p_solicitor_fee,
    p_exchange_deposit_percent => p_exchange_deposit_percent,
    p_second_deposit_enabled => p_second_deposit_enabled,
    p_second_deposit_percent => p_second_deposit_percent,
    p_second_deposit_months_after_exchange => p_second_deposit_months_after_exchange,
    p_completion_balance_percent => p_completion_balance_percent,
    p_deposit_summary => p_deposit_summary,
    p_commercial_summary => p_commercial_summary,
    p_payment_schedule => p_payment_schedule,
    p_developer_contribution_value => p_developer_contribution_value,
    p_developer_contribution_value_type => p_developer_contribution_value_type,
    p_agent_contribution_value => p_agent_contribution_value,
    p_agent_contribution_value_type => p_agent_contribution_value_type,
    p_parking_contribution_value => p_parking_contribution_value,
    p_parking_location_details => p_parking_location_details,
    p_additional_special_conditions => p_additional_special_conditions
  ) result;

  update public.unit_sale_terms
  set
    exchange_agent_fee_percent = coalesce(p_exchange_agent_fee_percent, 0),
    completion_agent_fee_percent = coalesce(p_completion_agent_fee_percent, 0)
  where id = v_result.sale_terms_id;

  sale_attempt_id := v_result.sale_attempt_id;
  sale_terms_id := v_result.sale_terms_id;
  return next;
end;
$$;

revoke all on function public.save_unit_commercial_model_with_agent_fees(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric,
  integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric,
  text, text[]
) from public, authenticated;
grant execute on function public.save_unit_commercial_model_with_agent_fees(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric,
  integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric,
  text, text[]
) to service_role;

create or replace function public.record_unit_sale_invoice_payment(
  p_invoice_id uuid,
  p_payer_type text,
  p_amount numeric,
  p_payment_date date,
  p_note text,
  p_client_reference uuid,
  p_requester_id uuid
)
returns table (
  payment_id uuid,
  created boolean,
  paid_amount numeric,
  outstanding_balance numeric,
  payment_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.unit_sale_invoices%rowtype;
  v_existing public.unit_sale_invoice_payments%rowtype;
  v_payment_id uuid;
  v_requester_role text;
  v_requester_active boolean;
  v_cash_payable numeric(14, 2);
  v_paid numeric(14, 2);
  v_outstanding numeric(14, 2);
  v_source text;
  v_is_duplicate boolean := false;
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot record this payment.';
  end if;

  select role, active
  into v_requester_role, v_requester_active
  from public.profiles
  where id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer') then
    raise exception 'Only developers or admins can record agent fee payments.';
  end if;

  if p_payer_type not in ('solicitor', 'developer', 'other') then
    raise exception 'Choose a valid payer.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'Enter a valid payment date that is not in the future.';
  end if;
  if p_client_reference is null then
    raise exception 'Payment reference is required.';
  end if;

  select *
  into v_invoice
  from public.unit_sale_invoices
  where id = p_invoice_id
    and invoice_type = 'sales_agent'
  for update;

  if not found then
    raise exception 'Sales agent invoice not found.';
  end if;
  if v_invoice.approved_at is null
     and v_invoice.status not in ('approved', 'part_paid', 'paid', 'reconciled') then
    raise exception 'Approve the invoice before recording a payment.';
  end if;

  select *
  into v_existing
  from public.unit_sale_invoice_payments
  where client_reference = p_client_reference;

  if found and v_existing.invoice_id <> v_invoice.id then
    raise exception 'Payment reference has already been used.';
  end if;
  v_is_duplicate := found;

  v_cash_payable := greatest(
    0,
    coalesce(
      v_invoice.expected_payable_amount,
      v_invoice.expected_gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      v_invoice.gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      0
    )
  );

  select coalesce(sum(amount), 0)
  into v_paid
  from public.unit_sale_invoice_payments
  where invoice_id = v_invoice.id
    and payment_source <> 'reservation_fee';

  if v_is_duplicate then
    v_payment_id := v_existing.id;
  else
    v_outstanding := greatest(0, v_cash_payable - v_paid);
    if p_amount > v_outstanding then
      raise exception 'Payment amount cannot exceed the outstanding balance of %.', to_char(v_outstanding, 'FM999999999990.00');
    end if;

    v_source := case p_payer_type
      when 'solicitor' then 'solicitor_deposit'
      when 'developer' then 'developer_shortfall'
      else 'other'
    end;

    insert into public.unit_sale_invoice_payments (
      invoice_id,
      sale_attempt_id,
      payment_source,
      payer_type,
      amount,
      paid_at,
      recorded_by_user_id,
      notes,
      client_reference
    )
    values (
      v_invoice.id,
      v_invoice.sale_attempt_id,
      v_source,
      p_payer_type,
      round(p_amount, 2),
      p_payment_date,
      p_requester_id,
      nullif(trim(coalesce(p_note, '')), ''),
      p_client_reference
    )
    returning id into v_payment_id;

    v_paid := v_paid + round(p_amount, 2);
  end if;

  v_outstanding := greatest(0, v_cash_payable - v_paid);
  payment_id := v_payment_id;
  created := not v_is_duplicate;
  paid_amount := v_paid;
  outstanding_balance := v_outstanding;
  payment_status := case
    when v_outstanding = 0 and v_cash_payable > 0 then 'paid'
    when v_paid > 0 then 'part_paid'
    else 'unpaid'
  end;
  return next;
end;
$$;

revoke all on function public.record_unit_sale_invoice_payment(uuid, text, numeric, date, text, uuid, uuid) from public;
grant execute on function public.record_unit_sale_invoice_payment(uuid, text, numeric, date, text, uuid, uuid) to authenticated, service_role;
