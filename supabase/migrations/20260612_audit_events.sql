create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index if not exists audit_events_created_by_idx on public.audit_events (created_by_user_id);

alter table public.audit_events enable row level security;

drop policy if exists "back office read audit events" on public.audit_events;
drop policy if exists "back office add audit events" on public.audit_events;

create policy "back office read audit events"
on public.audit_events for select
to authenticated
using (public.is_back_office_user());

create policy "back office add audit events"
on public.audit_events for insert
to authenticated
with check (
  public.is_back_office_user()
  and created_by_user_id = auth.uid()
);
