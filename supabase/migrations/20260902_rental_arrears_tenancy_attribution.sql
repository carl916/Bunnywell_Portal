-- Keep rent-risk reporting tenancy-specific. Ambiguous historical attribution is
-- retained for review but excluded from operational reporting.

alter table public.rental_arrears_episodes
  add column if not exists attribution_status text not null default 'matched',
  add column if not exists attribution_review_reason text;

alter table public.rental_arrears_episodes
  drop constraint if exists rental_arrears_episode_attribution_status_check;

alter table public.rental_arrears_episodes
  add constraint rental_arrears_episode_attribution_status_check check (
    (attribution_status = 'matched' and attribution_review_reason is null)
    or (
      attribution_status = 'review_required'
      and nullif(btrim(attribution_review_reason), '') is not null
    )
  );

-- Correct an existing attribution only when the episode date identifies exactly
-- one tenancy on the same unit. This includes the Unit 78 episode dated
-- 7 August 2025, whose unique date match is the tenancy ending 28 August 2025.
with episode_candidates as (
  select
    episode.id as episode_id,
    candidate.id as candidate_tenancy_id,
    count(*) over (partition by episode.id) as candidate_count
  from public.rental_arrears_episodes episode
  join public.unit_tenancies linked_tenancy on linked_tenancy.id = episode.tenancy_id
  join public.unit_tenancies candidate
    on candidate.unit_id = linked_tenancy.unit_id
   and candidate.tenancy_start_date <= episode.first_reported_at::date
   and (candidate.tenancy_end_date is null or candidate.tenancy_end_date >= episode.first_reported_at::date)
), unique_candidates as (
  select episode_id, candidate_tenancy_id
  from episode_candidates
  where candidate_count = 1
)
update public.rental_arrears_episodes episode
set
  tenancy_id = candidate.candidate_tenancy_id,
  attribution_status = 'matched',
  attribution_review_reason = null
from unique_candidates candidate
where episode.id = candidate.episode_id;

with candidate_counts as (
  select
    episode.id as episode_id,
    count(candidate.id) as candidate_count
  from public.rental_arrears_episodes episode
  join public.unit_tenancies linked_tenancy on linked_tenancy.id = episode.tenancy_id
  left join public.unit_tenancies candidate
    on candidate.unit_id = linked_tenancy.unit_id
   and candidate.tenancy_start_date <= episode.first_reported_at::date
   and (candidate.tenancy_end_date is null or candidate.tenancy_end_date >= episode.first_reported_at::date)
  group by episode.id
)
update public.rental_arrears_episodes episode
set
  attribution_status = 'review_required',
  attribution_review_reason = format(
    'Episode date matched %s tenancies on the recorded unit; review attribution before reporting.',
    candidate.candidate_count
  )
from candidate_counts candidate
where episode.id = candidate.episode_id
  and candidate.candidate_count <> 1;

create index if not exists rental_arrears_episodes_matched_tenancy_idx
  on public.rental_arrears_episodes (tenancy_id, first_reported_at desc)
  where attribution_status = 'matched';

