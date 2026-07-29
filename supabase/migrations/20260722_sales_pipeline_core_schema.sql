-- Sales pipeline production schema foundation.
-- This replaces the disposable conveyancing POC shape with normalized sale attempts,
-- commercial terms, payment schedules, document metadata, invoices, events and notes.

alter table public.profiles
  drop constraint if exists profiles_role_final_check;

alter table public.profiles
  add constraint profiles_role_final_check
  check (role::text in (
    'admin',
    'developer',
    'developer_representative',
    'contractor',
    'resident',
    'sales_agent',
    'conveyancer',
    'user'
  ));

alter table public.organisations
  drop constraint if exists organisations_type_check;

alter table public.organisations
  add constraint organisations_type_check
  check (type in (
    'developer_representative',
    'contractor',
    'supporting_trade',
    'sales_agent',
    'conveyancer'
  ));

alter table public.building_organisations
  drop constraint if exists building_organisations_role_on_project_check;

alter table public.building_organisations
  add constraint building_organisations_role_on_project_check
  check (
    role_on_project is null
    or role_on_project in (
      'main_contractor',
      'developer_representative',
      'supporting_trade',
      'sales_agent',
      'conveyancer'
    )
  );

create or replace function public.is_sales_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;

create or replace function public.is_sales_external_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('sales_agent', 'conveyancer'), false)
$$;

create or replace function public.can_access_sales_building(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_sales_internal_user()
    or (
      public.current_app_role() in ('sales_agent', 'conveyancer')
      and (
        exists (
          select 1
          from public.user_building_access uba
          where uba.user_id = auth.uid()
            and uba.building_id = target_building_id
        )
        or exists (
          select 1
          from public.building_organisations bo
          where bo.building_id = target_building_id
            and bo.organisation_id = public.current_organisation_id()
            and coalesce(bo.active, true)
            and bo.role_on_project = public.current_app_role()
        )
      )
    ),
    false
  )
$$;

create table if not exists public.building_sale_defaults (
  building_id uuid primary key references public.buildings(id) on delete cascade,
  reservation_fee numeric(14, 2),
  reservation_fee_holder_default text not null default 'sales_agent',
  exchange_deposit_percent numeric(7, 4),
  default_agent_fee_percent numeric(7, 4),
  default_vat_rate numeric(7, 4) not null default 20,
  default_sales_solicitor_fee numeric(14, 2),
  sales_agent_organisation_id uuid references public.organisations(id),
  conveyancer_organisation_id uuid references public.organisations(id),
  notes text,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_sale_defaults_reservation_fee_check check (reservation_fee is null or reservation_fee >= 0),
  constraint building_sale_defaults_holder_check check (reservation_fee_holder_default in ('sales_agent', 'developer', 'conveyancer', 'other')),
  constraint building_sale_defaults_exchange_deposit_check check (exchange_deposit_percent is null or (exchange_deposit_percent >= 0 and exchange_deposit_percent <= 100)),
  constraint building_sale_defaults_agent_fee_check check (default_agent_fee_percent is null or (default_agent_fee_percent >= 0 and default_agent_fee_percent <= 100)),
  constraint building_sale_defaults_vat_rate_check check (default_vat_rate >= 0 and default_vat_rate <= 100),
  constraint building_sale_defaults_solicitor_fee_check check (default_sales_solicitor_fee is null or default_sales_solicitor_fee >= 0)
);

create table if not exists public.building_sale_default_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  sequence_no integer not null,
  payment_stage text not null,
  label text not null,
  due_offset_days integer,
  percent_of_contract_price numeric(7, 4),
  fixed_amount numeric(14, 2),
  includes_reservation_fee boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_sale_default_payment_schedule_sequence_check check (sequence_no > 0),
  constraint building_sale_default_payment_schedule_stage_check check (payment_stage in ('reservation', 'exchange', 'delayed_deposit', 'completion', 'other')),
  constraint building_sale_default_payment_schedule_percent_check check (percent_of_contract_price is null or (percent_of_contract_price >= 0 and percent_of_contract_price <= 100)),
  constraint building_sale_default_payment_schedule_amount_check check (fixed_amount is null or fixed_amount >= 0),
  unique (building_id, sequence_no)
);

create table if not exists public.unit_sale_attempts (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  attempt_number integer not null default 1,
  is_active boolean not null default true,
  workflow_status text not null default 'draft',
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  buyer_solicitor_name text,
  buyer_solicitor_email text,
  buyer_solicitor_phone text,
  sales_agent_organisation_id uuid references public.organisations(id),
  conveyancer_organisation_id uuid references public.organisations(id),
  reservation_submitted_at timestamptz,
  reservation_approved_at timestamptz,
  reservation_approved_by_user_id uuid references public.profiles(id),
  commercial_approved_at timestamptz,
  commercial_approved_by_user_id uuid references public.profiles(id),
  exchanged_at date,
  completed_at date,
  fallen_through_at timestamptz,
  fall_through_reason text,
  redacted_at timestamptz,
  redacted_by_user_id uuid references public.profiles(id),
  redaction_note text,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_sale_attempts_attempt_number_check check (attempt_number > 0),
  constraint unit_sale_attempts_workflow_status_check check (workflow_status in (
    'draft',
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
  )),
  unique (unit_id, attempt_number)
);

create unique index if not exists unit_sale_attempts_one_active_per_unit_idx
  on public.unit_sale_attempts (unit_id)
  where is_active is true;

create table if not exists public.unit_sale_terms (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  version_number integer not null default 1,
  is_current boolean not null default true,
  status text not null default 'draft',
  list_price_at_offer numeric(14, 2),
  contract_price numeric(14, 2),
  parking_value numeric(14, 2) not null default 0,
  developer_contribution numeric(14, 2) not null default 0,
  agent_contribution numeric(14, 2) not null default 0,
  other_concessions numeric(14, 2) not null default 0,
  reservation_fee numeric(14, 2),
  reservation_fee_holder text,
  agent_fee_percent numeric(7, 4),
  vat_rate numeric(7, 4) not null default 20,
  solicitor_fee numeric(14, 2),
  deposit_summary text,
  commercial_summary text,
  approved_by_user_id uuid references public.profiles(id),
  approved_at timestamptz,
  superseded_at timestamptz,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_sale_terms_version_check check (version_number > 0),
  constraint unit_sale_terms_status_check check (status in ('draft', 'submitted', 'approved', 'superseded')),
  constraint unit_sale_terms_money_check check (
    (list_price_at_offer is null or list_price_at_offer >= 0)
    and (contract_price is null or contract_price >= 0)
    and parking_value >= 0
    and developer_contribution >= 0
    and agent_contribution >= 0
    and other_concessions >= 0
    and (reservation_fee is null or reservation_fee >= 0)
    and (solicitor_fee is null or solicitor_fee >= 0)
  ),
  constraint unit_sale_terms_holder_check check (reservation_fee_holder is null or reservation_fee_holder in ('sales_agent', 'developer', 'conveyancer', 'other')),
  constraint unit_sale_terms_agent_fee_check check (agent_fee_percent is null or (agent_fee_percent >= 0 and agent_fee_percent <= 100)),
  constraint unit_sale_terms_vat_rate_check check (vat_rate >= 0 and vat_rate <= 100),
  unique (sale_attempt_id, version_number)
);

create unique index if not exists unit_sale_terms_one_current_per_attempt_idx
  on public.unit_sale_terms (sale_attempt_id)
  where is_current is true;

create table if not exists public.unit_sale_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  sale_terms_id uuid references public.unit_sale_terms(id) on delete set null,
  sequence_no integer not null,
  payment_stage text not null,
  label text not null,
  due_event text,
  due_offset_days integer,
  percent_of_contract_price numeric(7, 4),
  fixed_amount numeric(14, 2),
  includes_reservation_fee boolean not null default false,
  expected_amount numeric(14, 2),
  status text not null default 'pending',
  notes text,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_sale_payment_schedule_sequence_check check (sequence_no > 0),
  constraint unit_sale_payment_schedule_stage_check check (payment_stage in ('reservation', 'exchange', 'delayed_deposit', 'completion', 'other')),
  constraint unit_sale_payment_schedule_due_event_check check (due_event is null or due_event in ('reservation', 'exchange', 'completion', 'manual_date')),
  constraint unit_sale_payment_schedule_percent_check check (percent_of_contract_price is null or (percent_of_contract_price >= 0 and percent_of_contract_price <= 100)),
  constraint unit_sale_payment_schedule_amount_check check (
    (fixed_amount is null or fixed_amount >= 0)
    and (expected_amount is null or expected_amount >= 0)
  ),
  constraint unit_sale_payment_schedule_status_check check (status in ('pending', 'due', 'paid', 'waived', 'superseded')),
  unique (sale_attempt_id, sequence_no)
);

create table if not exists public.unit_sale_documents (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  document_type text not null,
  title text not null,
  status text not null default 'not_uploaded',
  visibility text not null default 'shared_sale_file',
  required boolean not null default true,
  approved_by_user_id uuid references public.profiles(id),
  approved_at timestamptz,
  query_note text,
  superseded_at timestamptz,
  redacted_at timestamptz,
  redacted_by_user_id uuid references public.profiles(id),
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_sale_documents_type_check check (document_type in ('reservation_form', 'agent_invoice', 'completion_statement', 'statement_of_account', 'other')),
  constraint unit_sale_documents_status_check check (status in ('not_uploaded', 'uploaded', 'under_review', 'approved', 'query_raised', 'superseded', 'redacted')),
  constraint unit_sale_documents_visibility_check check (visibility in ('internal_only', 'sales_agent', 'conveyancer', 'shared_sale_file'))
);

create table if not exists public.unit_sale_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.unit_sale_documents(id) on delete cascade,
  version_number integer not null,
  is_current boolean not null default true,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  checksum text,
  uploaded_by_user_id uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by_user_id uuid references public.profiles(id),
  constraint unit_sale_document_versions_version_check check (version_number > 0),
  constraint unit_sale_document_versions_file_size_check check (file_size_bytes is null or file_size_bytes >= 0),
  unique (document_id, version_number),
  unique (storage_bucket, storage_path)
);

create unique index if not exists unit_sale_document_versions_one_current_idx
  on public.unit_sale_document_versions (document_id)
  where is_current is true;

create table if not exists public.unit_sale_invoices (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  document_id uuid references public.unit_sale_documents(id) on delete set null,
  invoice_type text not null default 'sales_agent',
  supplier_organisation_id uuid references public.organisations(id),
  invoice_reference text,
  invoice_date date,
  net_amount numeric(14, 2),
  vat_amount numeric(14, 2),
  gross_amount numeric(14, 2),
  reservation_fee_deduction numeric(14, 2) not null default 0,
  agent_contribution_deduction numeric(14, 2) not null default 0,
  expected_payable_amount numeric(14, 2),
  status text not null default 'draft',
  approved_by_user_id uuid references public.profiles(id),
  approved_at timestamptz,
  query_note text,
  created_by_user_id uuid references public.profiles(id),
  updated_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_sale_invoices_type_check check (invoice_type in ('sales_agent', 'other')),
  constraint unit_sale_invoices_money_check check (
    (net_amount is null or net_amount >= 0)
    and (vat_amount is null or vat_amount >= 0)
    and (gross_amount is null or gross_amount >= 0)
    and reservation_fee_deduction >= 0
    and agent_contribution_deduction >= 0
    and (expected_payable_amount is null or expected_payable_amount >= 0)
  ),
  constraint unit_sale_invoices_status_check check (status in ('draft', 'uploaded', 'under_review', 'approved', 'query_raised', 'part_paid', 'paid', 'reconciled', 'superseded', 'redacted'))
);

create table if not exists public.unit_sale_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.unit_sale_invoices(id) on delete cascade,
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  payment_source text not null,
  amount numeric(14, 2) not null,
  paid_at date,
  paid_by_organisation_id uuid references public.organisations(id),
  recorded_by_user_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  constraint unit_sale_invoice_payments_source_check check (payment_source in ('solicitor_deposit', 'developer_shortfall', 'reservation_fee', 'other')),
  constraint unit_sale_invoice_payments_amount_check check (amount >= 0)
);

create table if not exists public.unit_sale_workflow_events (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.unit_sale_notes (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  category text not null default 'general',
  visibility text not null default 'shared_sale_file',
  body text not null,
  redacted_at timestamptz,
  redacted_by_user_id uuid references public.profiles(id),
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint unit_sale_notes_category_check check (category in ('general', 'buyer_update', 'solicitor_update', 'financial', 'commercial', 'blocker', 'system')),
  constraint unit_sale_notes_visibility_check check (visibility in ('internal_only', 'sales_agent', 'conveyancer', 'shared_sale_file'))
);

create or replace function public.can_access_sale_attempt(target_sale_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.unit_sale_attempts usa
      where usa.id = target_sale_attempt_id
        and public.can_access_sales_building(usa.building_id)
    ),
    false
  )
$$;

create or replace function public.can_manage_sale_attempt(target_sale_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_sales_internal_user()
    and exists (
      select 1
      from public.unit_sale_attempts usa
      where usa.id = target_sale_attempt_id
    ),
    false
  )
$$;

create index if not exists building_sale_default_payment_schedule_building_idx on public.building_sale_default_payment_schedule (building_id, sequence_no);
create index if not exists unit_sale_attempts_building_status_idx on public.unit_sale_attempts (building_id, workflow_status);
create index if not exists unit_sale_attempts_unit_idx on public.unit_sale_attempts (unit_id);
create index if not exists unit_sale_attempts_active_status_idx on public.unit_sale_attempts (is_active, workflow_status);
create index if not exists unit_sale_terms_attempt_idx on public.unit_sale_terms (sale_attempt_id, is_current);
create index if not exists unit_sale_payment_schedule_attempt_idx on public.unit_sale_payment_schedule (sale_attempt_id, sequence_no);
create index if not exists unit_sale_documents_attempt_type_idx on public.unit_sale_documents (sale_attempt_id, document_type);
create index if not exists unit_sale_documents_status_idx on public.unit_sale_documents (status);
create index if not exists unit_sale_document_versions_document_idx on public.unit_sale_document_versions (document_id, uploaded_at desc);
create index if not exists unit_sale_invoices_attempt_status_idx on public.unit_sale_invoices (sale_attempt_id, status);
create index if not exists unit_sale_invoice_payments_invoice_idx on public.unit_sale_invoice_payments (invoice_id, paid_at);
create index if not exists unit_sale_workflow_events_attempt_created_idx on public.unit_sale_workflow_events (sale_attempt_id, created_at desc);
create index if not exists unit_sale_workflow_events_building_created_idx on public.unit_sale_workflow_events (building_id, created_at desc);
create index if not exists unit_sale_notes_attempt_created_idx on public.unit_sale_notes (sale_attempt_id, created_at desc);
create index if not exists unit_sale_notes_building_created_idx on public.unit_sale_notes (building_id, created_at desc);

drop trigger if exists set_building_sale_defaults_updated_at on public.building_sale_defaults;
create trigger set_building_sale_defaults_updated_at
before update on public.building_sale_defaults
for each row execute function public.set_updated_at();

drop trigger if exists set_building_sale_default_payment_schedule_updated_at on public.building_sale_default_payment_schedule;
create trigger set_building_sale_default_payment_schedule_updated_at
before update on public.building_sale_default_payment_schedule
for each row execute function public.set_updated_at();

drop trigger if exists set_unit_sale_attempts_updated_at on public.unit_sale_attempts;
create trigger set_unit_sale_attempts_updated_at
before update on public.unit_sale_attempts
for each row execute function public.set_updated_at();

drop trigger if exists set_unit_sale_terms_updated_at on public.unit_sale_terms;
create trigger set_unit_sale_terms_updated_at
before update on public.unit_sale_terms
for each row execute function public.set_updated_at();

drop trigger if exists set_unit_sale_payment_schedule_updated_at on public.unit_sale_payment_schedule;
create trigger set_unit_sale_payment_schedule_updated_at
before update on public.unit_sale_payment_schedule
for each row execute function public.set_updated_at();

drop trigger if exists set_unit_sale_documents_updated_at on public.unit_sale_documents;
create trigger set_unit_sale_documents_updated_at
before update on public.unit_sale_documents
for each row execute function public.set_updated_at();

drop trigger if exists set_unit_sale_invoices_updated_at on public.unit_sale_invoices;
create trigger set_unit_sale_invoices_updated_at
before update on public.unit_sale_invoices
for each row execute function public.set_updated_at();

alter table public.building_sale_defaults enable row level security;
alter table public.building_sale_default_payment_schedule enable row level security;
alter table public.unit_sale_attempts enable row level security;
alter table public.unit_sale_terms enable row level security;
alter table public.unit_sale_payment_schedule enable row level security;
alter table public.unit_sale_documents enable row level security;
alter table public.unit_sale_document_versions enable row level security;
alter table public.unit_sale_invoices enable row level security;
alter table public.unit_sale_invoice_payments enable row level security;
alter table public.unit_sale_workflow_events enable row level security;
alter table public.unit_sale_notes enable row level security;

drop policy if exists "sales users read building sale defaults" on public.building_sale_defaults;
create policy "sales users read building sale defaults"
on public.building_sale_defaults for select
to authenticated
using (public.can_access_sales_building(building_id));

drop policy if exists "commercial admins manage building sale defaults" on public.building_sale_defaults;
create policy "commercial admins manage building sale defaults"
on public.building_sale_defaults for all
to authenticated
using (public.is_sales_internal_user())
with check (public.is_sales_internal_user());

drop policy if exists "sales users read building default payment schedule" on public.building_sale_default_payment_schedule;
create policy "sales users read building default payment schedule"
on public.building_sale_default_payment_schedule for select
to authenticated
using (public.can_access_sales_building(building_id));

drop policy if exists "commercial admins manage building default payment schedule" on public.building_sale_default_payment_schedule;
create policy "commercial admins manage building default payment schedule"
on public.building_sale_default_payment_schedule for all
to authenticated
using (public.is_sales_internal_user())
with check (public.is_sales_internal_user());

drop policy if exists "sales users read sale attempts" on public.unit_sale_attempts;
create policy "sales users read sale attempts"
on public.unit_sale_attempts for select
to authenticated
using (public.can_access_sales_building(building_id));

drop policy if exists "commercial admins manage sale attempts" on public.unit_sale_attempts;
create policy "commercial admins manage sale attempts"
on public.unit_sale_attempts for all
to authenticated
using (public.is_sales_internal_user())
with check (public.is_sales_internal_user());

drop policy if exists "sales users read sale terms" on public.unit_sale_terms;
create policy "sales users read sale terms"
on public.unit_sale_terms for select
to authenticated
using (public.can_access_sale_attempt(sale_attempt_id));

drop policy if exists "commercial admins manage sale terms" on public.unit_sale_terms;
create policy "commercial admins manage sale terms"
on public.unit_sale_terms for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));

drop policy if exists "sales users read payment schedule" on public.unit_sale_payment_schedule;
create policy "sales users read payment schedule"
on public.unit_sale_payment_schedule for select
to authenticated
using (public.can_access_sale_attempt(sale_attempt_id));

drop policy if exists "commercial admins manage payment schedule" on public.unit_sale_payment_schedule;
create policy "commercial admins manage payment schedule"
on public.unit_sale_payment_schedule for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));

drop policy if exists "sales users read sale documents" on public.unit_sale_documents;
create policy "sales users read sale documents"
on public.unit_sale_documents for select
to authenticated
using (
  public.can_access_sale_attempt(sale_attempt_id)
  and (
    visibility = 'shared_sale_file'
    or public.is_sales_internal_user()
    or visibility = public.current_app_role()
  )
);

drop policy if exists "commercial admins manage sale documents" on public.unit_sale_documents;
create policy "commercial admins manage sale documents"
on public.unit_sale_documents for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));

drop policy if exists "sales users read sale document versions" on public.unit_sale_document_versions;
create policy "sales users read sale document versions"
on public.unit_sale_document_versions for select
to authenticated
using (
  exists (
    select 1
    from public.unit_sale_documents usd
    where usd.id = document_id
      and public.can_access_sale_attempt(usd.sale_attempt_id)
      and (
        usd.visibility = 'shared_sale_file'
        or public.is_sales_internal_user()
        or usd.visibility = public.current_app_role()
      )
  )
);

drop policy if exists "commercial admins manage sale document versions" on public.unit_sale_document_versions;
create policy "commercial admins manage sale document versions"
on public.unit_sale_document_versions for all
to authenticated
using (
  exists (
    select 1
    from public.unit_sale_documents usd
    where usd.id = document_id
      and public.can_manage_sale_attempt(usd.sale_attempt_id)
  )
)
with check (
  exists (
    select 1
    from public.unit_sale_documents usd
    where usd.id = document_id
      and public.can_manage_sale_attempt(usd.sale_attempt_id)
  )
);

drop policy if exists "sales users read sale invoices" on public.unit_sale_invoices;
create policy "sales users read sale invoices"
on public.unit_sale_invoices for select
to authenticated
using (public.can_access_sale_attempt(sale_attempt_id));

drop policy if exists "commercial admins manage sale invoices" on public.unit_sale_invoices;
create policy "commercial admins manage sale invoices"
on public.unit_sale_invoices for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));

drop policy if exists "sales users read sale invoice payments" on public.unit_sale_invoice_payments;
create policy "sales users read sale invoice payments"
on public.unit_sale_invoice_payments for select
to authenticated
using (public.can_access_sale_attempt(sale_attempt_id));

drop policy if exists "commercial admins manage sale invoice payments" on public.unit_sale_invoice_payments;
create policy "commercial admins manage sale invoice payments"
on public.unit_sale_invoice_payments for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));

drop policy if exists "sales users read workflow events" on public.unit_sale_workflow_events;
create policy "sales users read workflow events"
on public.unit_sale_workflow_events for select
to authenticated
using (public.can_access_sale_attempt(sale_attempt_id));

drop policy if exists "commercial admins add workflow events" on public.unit_sale_workflow_events;
create policy "commercial admins add workflow events"
on public.unit_sale_workflow_events for insert
to authenticated
with check (
  public.can_manage_sale_attempt(sale_attempt_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists "sales users read sale notes" on public.unit_sale_notes;
create policy "sales users read sale notes"
on public.unit_sale_notes for select
to authenticated
using (
  public.can_access_sale_attempt(sale_attempt_id)
  and (
    visibility = 'shared_sale_file'
    or public.is_sales_internal_user()
    or visibility = public.current_app_role()
  )
);

drop policy if exists "commercial admins manage sale notes" on public.unit_sale_notes;
create policy "commercial admins manage sale notes"
on public.unit_sale_notes for all
to authenticated
using (public.can_manage_sale_attempt(sale_attempt_id))
with check (public.can_manage_sale_attempt(sale_attempt_id));
