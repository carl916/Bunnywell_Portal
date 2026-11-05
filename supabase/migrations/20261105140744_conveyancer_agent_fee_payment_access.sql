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
     or coalesce(v_requester_role, '') not in ('admin', 'developer', 'conveyancer') then
    raise exception 'Only developers, admins or conveyancers can record agent fee payments.';
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
  from public.unit_sale_invoices invoice
  where invoice.id = p_invoice_id
    and invoice.invoice_type = 'sales_agent'
  for update;

  if not found then
    raise exception 'Sales agent invoice not found.';
  end if;
  -- Match requesterBuildingIds in the sales API for the newly authorised role.
  if v_requester_role = 'conveyancer' and not exists (
    select 1 from public.unit_sale_attempts sale
    where sale.id = v_invoice.sale_attempt_id
      and (
        exists (select 1 from public.user_building_access access
          where access.user_id = p_requester_id and access.building_id = sale.building_id)
        or exists (select 1 from public.building_organisations appointment
          join public.profiles profile on profile.organisation_id = appointment.organisation_id
          where profile.id = p_requester_id and appointment.building_id = sale.building_id
            and appointment.role_on_project = 'conveyancer' and appointment.active <> false)
      )
  ) then
    raise exception 'You do not have sales access to this building.';
  end if;
  if v_invoice.approved_at is null
     and v_invoice.status not in ('approved', 'part_paid', 'paid', 'reconciled') then
    raise exception 'Approve the invoice before recording a payment.';
  end if;

  select *
  into v_existing
  from public.unit_sale_invoice_payments payment
  where payment.client_reference = p_client_reference;

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

  select coalesce(sum(payment.amount), 0)
  into v_paid
  from public.unit_sale_invoice_payments payment
  where payment.invoice_id = v_invoice.id
    and payment.payment_source <> 'reservation_fee'
    and payment.voided_at is null;

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
