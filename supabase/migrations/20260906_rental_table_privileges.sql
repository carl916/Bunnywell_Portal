-- Supabase default table grants can include TRUNCATE and other privileges.
-- Revoking only INSERT/UPDATE/DELETE leaves those grants intact; RLS does not
-- protect TRUNCATE. Clients need only authenticated SELECT under existing RLS.
-- Trusted server writes retain their existing service_role permissions.
revoke all privileges on table
  public.unit_tenancies,
  public.rental_arrears_episodes,
  public.rental_arrears_events,
  public.rental_import_runs
from public, anon, authenticated;

grant select on table
  public.unit_tenancies,
  public.rental_arrears_episodes,
  public.rental_arrears_events,
  public.rental_import_runs
to authenticated;
