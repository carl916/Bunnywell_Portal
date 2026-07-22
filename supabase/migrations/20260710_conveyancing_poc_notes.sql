-- Conveyancing POC sale notes.
-- Structured Admin/Developer-only timeline linked to the current unit sale record.

create table if not exists public.unit_sale_notes (
  id uuid primary key default gen_random_uuid(),
  sale_record_id uuid not null references public.unit_sale_records(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  category text not null default 'general' check (category in ('general', 'blocker', 'buyer_update', 'solicitor_update', 'strategy', 'financial')),
  body text not null,
  visibility text not null default 'admin_developer' check (visibility in ('admin_developer')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists unit_sale_notes_sale_record_created_idx on public.unit_sale_notes (sale_record_id, created_at desc);
create index if not exists unit_sale_notes_unit_created_idx on public.unit_sale_notes (unit_id, created_at desc);
create index if not exists unit_sale_notes_category_idx on public.unit_sale_notes (category);

alter table public.unit_sale_notes enable row level security;

drop policy if exists "setup admins manage unit sale notes" on public.unit_sale_notes;
create policy "setup admins manage unit sale notes"
on public.unit_sale_notes for all
to authenticated
using (public.is_setup_admin())
with check (public.is_setup_admin());
