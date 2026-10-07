-- Replacement projection functions inherited Supabase's default EXECUTE grants.
-- They accept internal event rows and must only be called by the guarded
-- SECURITY DEFINER activity RPC or the server, never directly by browser roles.
revoke all on function
  public.sale_event_projection(public.unit_sale_workflow_events),
  public.sale_event_projection_before_deposit(public.unit_sale_workflow_events),
  public.sale_event_projection_before_notice(public.unit_sale_workflow_events),
  public.sale_event_projection_before_package(public.unit_sale_workflow_events),
  public.sales_contact_audit(),
  public.sales_contact_guard(),
  public.sales_legal_unit_guard(),
  public.sales_legal_write_guard(),
  public.sales_notice_version_guard(),
  public.sales_notice_state_guard()
from public, anon, authenticated;

grant execute on function
  public.sale_event_projection(public.unit_sale_workflow_events),
  public.sale_event_projection_before_deposit(public.unit_sale_workflow_events),
  public.sale_event_projection_before_notice(public.unit_sale_workflow_events),
  public.sale_event_projection_before_package(public.unit_sale_workflow_events)
to service_role;

-- This guard uses only trigger records and pg_catalog built-ins.
alter function public.sales_notice_state_guard() set search_path = '';
