alter table public.units
  add column if not exists reservation_date date;

alter table public.unit_sale_attempts
  add column if not exists reservation_date date,
  add column if not exists reservation_approved_by_name text,
  add column if not exists reservation_approved_by_email text,
  add column if not exists reservation_rejected_at timestamptz,
  add column if not exists reservation_rejected_by_user_id uuid references public.profiles(id),
  add column if not exists reservation_rejected_by_name text,
  add column if not exists reservation_rejected_by_email text,
  add column if not exists reservation_rejection_reason text;

do $$
begin
  alter table public.unit_sale_attempts
    drop constraint if exists unit_sale_attempts_workflow_status_check;

  alter table public.unit_sale_attempts
    add constraint unit_sale_attempts_workflow_status_check check (workflow_status in (
      'draft',
      'awaiting_approval',
      'approved',
      'rejected',
      'reservation_submitted',
      'reservation_query_raised',
      'reservation_approved',
      'awaiting_commercial_approval',
      'ready_for_exchange',
      'exchanged',
      'completion_pending',
      'completed',
      'fallen_through',
      'superseded'
    ));

  alter table public.unit_sale_attempts
    drop constraint if exists unit_sale_attempts_buyer_identity_check;

  alter table public.unit_sale_attempts
    add constraint unit_sale_attempts_buyer_identity_check check (
      workflow_status not in (
        'awaiting_approval',
        'approved',
        'reservation_submitted',
        'reservation_approved',
        'awaiting_commercial_approval',
        'ready_for_exchange',
        'exchanged',
        'completion_pending',
        'completed'
      )
      or nullif(trim(coalesce(buyer_person_name, '')), '') is not null
      or nullif(trim(coalesce(buyer_company_name, '')), '') is not null
    );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'unit_sale_attempts_reservation_date_not_future'
      and conrelid = 'public.unit_sale_attempts'::regclass
  ) then
    alter table public.unit_sale_attempts
      add constraint unit_sale_attempts_reservation_date_not_future
      check (reservation_date is null or reservation_date <= current_date)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'units_reservation_date_not_future'
      and conrelid = 'public.units'::regclass
  ) then
    alter table public.units
      add constraint units_reservation_date_not_future
      check (reservation_date is null or reservation_date <= current_date)
      not valid;
  end if;
end $$;
