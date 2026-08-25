-- Add an auditable void-and-re-record correction path for sales-agent invoice
-- payments. Existing payment rows remain active because the new fields default
-- to null; historical amounts are never edited or deleted.

alter table public.unit_sale_invoice_payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_user_id uuid references public.profiles(id),
  add column if not exists void_reason text;

alter table public.unit_sale_invoice_payments
  drop constraint if exists unit_sale_invoice_payments_void_consistency_check;

alter table public.unit_sale_invoice_payments
  add constraint unit_sale_invoice_payments_void_consistency_check check (
    (voided_at is null and voided_by_user_id is null and void_reason is null)
    or (
      voided_at is not null
      and voided_by_user_id is not null
      and length(trim(coalesce(void_reason, ''))) > 0
    )
  ) not valid;

create index if not exists unit_sale_invoice_payments_active_invoice_idx
  on public.unit_sale_invoice_payments (invoice_id, paid_at)
  where voided_at is null;

-- Historical transaction fields are immutable even for trusted server paths.
-- The only permitted update is the first complete active-to-voided transition.
create or replace function public.protect_unit_sale_invoice_payment_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Historical agent fee payments cannot be deleted.';
  end if;

  if row(
    new.id,
    new.invoice_id,
    new.sale_attempt_id,
    new.payment_source,
    new.payer_type,
    new.amount,
    new.paid_at,
    new.paid_by_organisation_id,
    new.recorded_by_user_id,
    new.notes,
    new.client_reference,
    new.created_at
  ) is distinct from row(
    old.id,
    old.invoice_id,
    old.sale_attempt_id,
    old.payment_source,
    old.payer_type,
    old.amount,
    old.paid_at,
    old.paid_by_organisation_id,
    old.recorded_by_user_id,
    old.notes,
    old.client_reference,
    old.created_at
  ) then
    raise exception 'Historical agent fee payment details cannot be edited. Void and re-record the payment instead.';
  end if;

  if old.voided_at is not null and row(new.voided_at, new.voided_by_user_id, new.void_reason)
    is distinct from row(old.voided_at, old.voided_by_user_id, old.void_reason) then
    raise exception 'A voided agent fee payment cannot be changed.';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_unit_sale_invoice_payment_history() from public;

drop trigger if exists protect_unit_sale_invoice_payment_history_update on public.unit_sale_invoice_payments;
create trigger protect_unit_sale_invoice_payment_history_update
before update on public.unit_sale_invoice_payments
for each row execute function public.protect_unit_sale_invoice_payment_history();

drop trigger if exists protect_unit_sale_invoice_payment_history_delete on public.unit_sale_invoice_payments;
create trigger protect_unit_sale_invoice_payment_history_delete
before delete on public.unit_sale_invoice_payments
for each row execute function public.protect_unit_sale_invoice_payment_history();

-- Keep the user-facing activity record in the same transaction as the
-- correction. This also guarantees an audit event if the service-role path is
-- called anywhere other than the sales route in future.
create or replace function public.audit_unit_sale_invoice_payment_void()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
  v_invoice public.unit_sale_invoices%rowtype;
  v_actor_label text;
  v_payer_label text;
begin
  if old.voided_at is null and new.voided_at is not null then
    select attempt.*
    into v_attempt
    from public.unit_sale_attempts attempt
    where attempt.id = new.sale_attempt_id;

    select invoice.*
    into v_invoice
    from public.unit_sale_invoices invoice
    where invoice.id = new.invoice_id;

    select coalesce(profile.full_name, profile.name, profile.email, 'an authorised user')
    into v_actor_label
    from public.profiles profile
    where profile.id = new.voided_by_user_id;

    v_actor_label := coalesce(v_actor_label, 'an authorised user');
    v_payer_label := case new.payer_type
      when 'developer' then 'Developer'
      when 'other' then 'Other'
      else 'Solicitor'
    end;

    insert into public.unit_sale_workflow_events (
      sale_attempt_id,
      building_id,
      unit_id,
      event_type,
      from_status,
      to_status,
      summary,
      metadata,
      created_by_user_id
    )
    values (
      v_attempt.id,
      v_attempt.building_id,
      v_attempt.unit_id,
      'agent_fee_payment_voided',
      v_attempt.workflow_status,
      v_attempt.workflow_status,
      format(
        'Agent payment voided. %s payment of £%s voided by %s. Reason: %s.',
        v_payer_label,
        to_char(new.amount, 'FM999999999990.00'),
        v_actor_label,
        new.void_reason
      ),
      jsonb_build_object(
        'invoiceId', new.invoice_id,
        'paymentId', new.id,
        'feeMilestone', v_invoice.fee_milestone,
        'payerType', new.payer_type,
        'amount', new.amount,
        'paymentDate', new.paid_at,
        'voidReason', new.void_reason,
        'voidedByUserId', new.voided_by_user_id
      ),
      new.voided_by_user_id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_unit_sale_invoice_payment_void() from public;

drop trigger if exists audit_unit_sale_invoice_payment_void on public.unit_sale_invoice_payments;
create trigger audit_unit_sale_invoice_payment_void
after update of voided_at on public.unit_sale_invoice_payments
for each row execute function public.audit_unit_sale_invoice_payment_void();

-- Preserve the existing append-only record-payment API while excluding voided
-- rows from every persisted balance calculation.
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
  from public.unit_sale_invoices invoice
  where invoice.id = p_invoice_id
    and invoice.invoice_type = 'sales_agent'
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

-- A payment can transition from active to voided exactly once. Invoice and
-- payment row locks serialise corrections with concurrent payment recording.
create or replace function public.void_unit_sale_invoice_payment(
  p_payment_id uuid,
  p_reason text,
  p_requester_id uuid
)
returns table (
  payment_id uuid,
  invoice_id uuid,
  sale_attempt_id uuid,
  voided boolean,
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
  v_payment public.unit_sale_invoice_payments%rowtype;
  v_requester_role text;
  v_requester_active boolean;
  v_cash_payable numeric(14, 2);
  v_paid numeric(14, 2);
  v_outstanding numeric(14, 2);
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot void this payment.';
  end if;

  select role, active
  into v_requester_role, v_requester_active
  from public.profiles
  where id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer') then
    raise exception 'Only developers or admins can void agent fee payments.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Add a reason for voiding the payment.';
  end if;

  select payment.*
  into v_payment
  from public.unit_sale_invoice_payments payment
  where payment.id = p_payment_id;

  if not found then
    raise exception 'Agent fee payment not found.';
  end if;

  select invoice.*
  into v_invoice
  from public.unit_sale_invoices invoice
  where invoice.id = v_payment.invoice_id
    and invoice.invoice_type = 'sales_agent'
  for update;

  if not found then
    raise exception 'Sales agent invoice not found.';
  end if;

  select payment.*
  into v_payment
  from public.unit_sale_invoice_payments payment
  where payment.id = p_payment_id
  for update;

  if not found then
    raise exception 'Agent fee payment not found.';
  end if;

  if v_payment.payment_source = 'reservation_fee' then
    raise exception 'Reservation fee credits cannot be voided as cash payments.';
  end if;

  if v_payment.voided_at is null then
    update public.unit_sale_invoice_payments payment
    set
      voided_at = now(),
      voided_by_user_id = p_requester_id,
      void_reason = trim(p_reason)
    where payment.id = v_payment.id;
    voided := true;
  else
    voided := false;
  end if;

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

  v_outstanding := greatest(0, v_cash_payable - v_paid);
  payment_id := v_payment.id;
  invoice_id := v_invoice.id;
  sale_attempt_id := v_invoice.sale_attempt_id;
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

revoke all on function public.void_unit_sale_invoice_payment(uuid, text, uuid) from public;
grant execute on function public.void_unit_sale_invoice_payment(uuid, text, uuid) to authenticated, service_role;
