-- Management-intelligence records for material rent-risk changes only.
-- This deliberately does not create a rent ledger, statement-line model or
-- payment-allocation workflow; the letting agent remains the definitive source.

create table if not exists public.rental_arrears_episodes (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.unit_tenancies(id) on delete restrict,
  agent_tenancy_reference text,
  first_reported_at timestamptz not null,
  last_reported_at timestamptz not null,
  cleared_at timestamptz,
  initial_reported_amount numeric(12, 2) not null check (initial_reported_amount >= 0),
  maximum_reported_amount numeric(12, 2) not null check (maximum_reported_amount >= initial_reported_amount),
  latest_reported_amount numeric(12, 2) check (latest_reported_amount is null or latest_reported_amount >= 0),
  status text not null check (status in ('open', 'cleared', 'closed_reconciliation_review', 'ended_unreconciled')),
  intervention_level text not null check (intervention_level in ('information', 'watch', 'action_required')),
  owner_action_required boolean not null default false,
  resolution_basis text,
  management_summary text not null check (length(trim(management_summary)) > 0),
  source_reference text not null check (length(trim(source_reference)) > 0),
  source_import_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_arrears_episode_report_dates_check check (last_reported_at >= first_reported_at),
  constraint rental_arrears_episode_clearance_check check (
    (status = 'cleared' and cleared_at is not null and cleared_at >= first_reported_at)
    or (status <> 'cleared' and cleared_at is null)
  ),
  constraint rental_arrears_episode_latest_amount_check check (
    latest_reported_amount is null or maximum_reported_amount >= latest_reported_amount
  )
);

create index if not exists rental_arrears_episodes_tenancy_idx
  on public.rental_arrears_episodes (tenancy_id, first_reported_at desc);
create index if not exists rental_arrears_episodes_open_idx
  on public.rental_arrears_episodes (last_reported_at desc)
  where status = 'open';
create index if not exists rental_arrears_episodes_attention_idx
  on public.rental_arrears_episodes (intervention_level, last_reported_at desc)
  where intervention_level in ('watch', 'action_required');

drop trigger if exists set_rental_arrears_episodes_updated_at on public.rental_arrears_episodes;
create trigger set_rental_arrears_episodes_updated_at
before update on public.rental_arrears_episodes
for each row execute function public.set_updated_at();

create table if not exists public.rental_arrears_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.rental_arrears_episodes(id) on delete restrict,
  event_at timestamptz not null,
  event_type text not null check (event_type in (
    'first_arrears_notification',
    'balance_changed',
    'payment_or_clearance_evidence',
    'tenancy_ended_or_relet',
    'recovery_outcome',
    'owner_decision_requested'
  )),
  reported_amount numeric(12, 2) check (reported_amount is null or reported_amount >= 0),
  summary text not null check (length(trim(summary)) > 0),
  source_reference text not null check (length(trim(source_reference)) > 0),
  source_kind text,
  evidence_confidence text not null check (evidence_confidence in ('low', 'medium', 'high')),
  source_import_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists rental_arrears_events_episode_idx
  on public.rental_arrears_events (episode_id, event_at desc);

create or replace function public.prevent_rental_arrears_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Rental arrears events are append-only; record a new material event instead.';
end;
$$;

drop trigger if exists rental_arrears_events_append_only on public.rental_arrears_events;
create trigger rental_arrears_events_append_only
before update or delete on public.rental_arrears_events
for each row execute function public.prevent_rental_arrears_event_mutation();

create table if not exists public.rental_import_runs (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id) on delete set null,
  source_reference text not null check (length(trim(source_reference)) > 0),
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  data_as_of timestamptz,
  episodes_imported integer not null default 0 check (episodes_imported >= 0),
  events_imported integer not null default 0 check (events_imported >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  data_quality_issue_count integer not null default 0 check (data_quality_issue_count >= 0),
  data_quality_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(data_quality_issues) = 'array'),
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_import_runs_completion_check check (
    (status = 'started' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

create index if not exists rental_import_runs_success_idx
  on public.rental_import_runs (completed_at desc)
  where status = 'succeeded';
create index if not exists rental_import_runs_building_idx
  on public.rental_import_runs (building_id, completed_at desc);

drop trigger if exists set_rental_import_runs_updated_at on public.rental_import_runs;
create trigger set_rental_import_runs_updated_at
before update on public.rental_import_runs
for each row execute function public.set_updated_at();

alter table public.rental_arrears_episodes enable row level security;
alter table public.rental_arrears_events enable row level security;
alter table public.rental_import_runs enable row level security;

drop policy if exists "rental managers read arrears episodes" on public.rental_arrears_episodes;
create policy "rental managers read arrears episodes"
on public.rental_arrears_episodes for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and exists (
    select 1
    from public.unit_tenancies tenancy
    where tenancy.id = rental_arrears_episodes.tenancy_id
      and public.can_access_building(tenancy.building_id)
  )
);

drop policy if exists "rental managers read arrears events" on public.rental_arrears_events;
create policy "rental managers read arrears events"
on public.rental_arrears_events for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and exists (
    select 1
    from public.rental_arrears_episodes episode
    join public.unit_tenancies tenancy on tenancy.id = episode.tenancy_id
    where episode.id = rental_arrears_events.episode_id
      and public.can_access_building(tenancy.building_id)
  )
);

drop policy if exists "rental managers read import health" on public.rental_import_runs;
create policy "rental managers read import health"
on public.rental_import_runs for select
to authenticated
using (
  public.current_app_role() in ('admin', 'developer')
  and (building_id is null or public.can_access_building(building_id))
);

revoke insert, update, delete on public.rental_arrears_episodes from anon, authenticated;
revoke insert, update, delete on public.rental_arrears_events from anon, authenticated;
revoke insert, update, delete on public.rental_import_runs from anon, authenticated;
grant select on public.rental_arrears_episodes to authenticated;
grant select on public.rental_arrears_events to authenticated;
grant select on public.rental_import_runs to authenticated;

revoke all on function public.prevent_rental_arrears_event_mutation() from public, anon, authenticated;
