-- Backfill point-in-time reservation actor labels for records created before
-- reservation submission, approval and rejection identity snapshots existed.

update public.unit_sale_attempts attempt
set
  reservation_submitted_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_submitted_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_submitted_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_submitted_by_email = coalesce(
    nullif(trim(attempt.reservation_submitted_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_submitted_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_submitted_by_name), '') is null
    or trim(attempt.reservation_submitted_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_submitted_by_email), '') is null
  );

update public.unit_sale_attempts attempt
set
  reservation_approved_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_approved_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_approved_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_approved_by_email = coalesce(
    nullif(trim(attempt.reservation_approved_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_approved_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_approved_by_name), '') is null
    or trim(attempt.reservation_approved_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_approved_by_email), '') is null
  );

update public.unit_sale_attempts attempt
set
  reservation_rejected_by_name = coalesce(
    case
      when trim(coalesce(attempt.reservation_rejected_by_name, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then null
      else nullif(trim(attempt.reservation_rejected_by_name), '')
    end,
    nullif(trim(profile.full_name), ''),
    nullif(trim(profile.name), ''),
    nullif(trim(profile.email), '')
  ),
  reservation_rejected_by_email = coalesce(
    nullif(trim(attempt.reservation_rejected_by_email), ''),
    nullif(trim(profile.email), '')
  )
from public.profiles profile
where attempt.reservation_rejected_by_user_id = profile.id
  and (
    nullif(trim(attempt.reservation_rejected_by_name), '') is null
    or trim(attempt.reservation_rejected_by_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(trim(attempt.reservation_rejected_by_email), '') is null
  );
