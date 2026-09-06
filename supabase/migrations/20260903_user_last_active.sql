alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- A successful sign-in is also known portal activity, so retain it as the
-- initial baseline until each user next opens the portal.
update public.profiles as profile
set last_active_at = auth_user.last_sign_in_at
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.last_active_at is null
  and auth_user.last_sign_in_at is not null;

create index if not exists profiles_last_active_at_idx
  on public.profiles (last_active_at desc nulls last);
