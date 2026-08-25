-- Attribute agent-fee payments to the authenticated recorder and retain a
-- point-in-time identity snapshot for historically meaningful audit rows.

alter table public.unit_sale_invoice_payments
  add column if not exists recorded_by_name text,
  add column if not exists recorded_by_email text,
  add column if not exists recorded_by_organisation_name text;

update public.unit_sale_invoice_payments payment
set
  recorded_by_name = coalesce(profile.full_name, profile.name, profile.email),
  recorded_by_email = profile.email,
  recorded_by_organisation_name = organisation.name
from public.profiles profile
left join public.organisations organisation on organisation.id = profile.organisation_id
where payment.recorded_by_user_id = profile.id
  and payment.recorded_by_name is null;

create or replace function public.stamp_unit_sale_invoice_payment_recorder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recorded_by_user_id is not null then
    select
      coalesce(profile.full_name, profile.name, profile.email),
      profile.email,
      organisation.name
    into
      new.recorded_by_name,
      new.recorded_by_email,
      new.recorded_by_organisation_name
    from public.profiles profile
    left join public.organisations organisation on organisation.id = profile.organisation_id
    where profile.id = new.recorded_by_user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.stamp_unit_sale_invoice_payment_recorder() from public;

drop trigger if exists stamp_unit_sale_invoice_payment_recorder on public.unit_sale_invoice_payments;
create trigger stamp_unit_sale_invoice_payment_recorder
before insert on public.unit_sale_invoice_payments
for each row execute function public.stamp_unit_sale_invoice_payment_recorder();

-- Extend the existing append-only guard to cover the new identity snapshots.
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
    new.recorded_by_name,
    new.recorded_by_email,
    new.recorded_by_organisation_name,
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
    old.recorded_by_name,
    old.recorded_by_email,
    old.recorded_by_organisation_name,
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
