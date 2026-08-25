-- Compact, scoped portfolio data for the operational Agent Fees overview.
-- Financial status remains derived in the shared application helper; this RPC
-- only returns the current invoice per milestone and active payment inputs.
create or replace function public.get_agent_fee_portfolio(p_requester_id uuid)
returns table (
  sale_attempt_id uuid,
  building_id uuid,
  building_name text,
  unit_id uuid,
  unit_number text,
  unit_sale_status text,
  workflow_status text,
  sales_agent_organisation_id uuid,
  sales_agent_name text,
  contract_price numeric,
  exchange_fee_percent numeric,
  completion_fee_percent numeric,
  vat_rate numeric,
  exchange_invoice jsonb,
  completion_invoice jsonb,
  exchange_active_payments jsonb,
  completion_active_payments jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requester_role text;
  v_requester_active boolean;
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot view the Agent Fees portfolio.';
  end if;

  select profile.role, profile.active
  into v_requester_role, v_requester_active
  from public.profiles profile
  where profile.id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer') then
    raise exception 'Only developers or admins can view the Agent Fees portfolio.';
  end if;

  return query
  select
    attempt.id,
    attempt.building_id,
    building.name,
    attempt.unit_id,
    unit.unit_number,
    unit.sale_status::text,
    attempt.workflow_status,
    attempt.sales_agent_organisation_id,
    agent.name,
    terms.contract_price,
    terms.exchange_agent_fee_percent,
    terms.completion_agent_fee_percent,
    terms.vat_rate,
    case when exchange_invoice.id is null then null else jsonb_build_object(
      'id', exchange_invoice.id,
      'status', exchange_invoice.status,
      'approved_at', exchange_invoice.approved_at,
      'gross_amount', exchange_invoice.gross_amount,
      'expected_payable_amount', exchange_invoice.expected_payable_amount,
      'reservation_fee_deduction', exchange_invoice.reservation_fee_deduction,
      'agent_contribution_deduction', exchange_invoice.agent_contribution_deduction
    ) end,
    case when completion_invoice.id is null then null else jsonb_build_object(
      'id', completion_invoice.id,
      'status', completion_invoice.status,
      'approved_at', completion_invoice.approved_at,
      'gross_amount', completion_invoice.gross_amount,
      'expected_payable_amount', completion_invoice.expected_payable_amount,
      'reservation_fee_deduction', completion_invoice.reservation_fee_deduction,
      'agent_contribution_deduction', completion_invoice.agent_contribution_deduction
    ) end,
    coalesce(exchange_payments.payments, '[]'::jsonb),
    coalesce(completion_payments.payments, '[]'::jsonb)
  from public.unit_sale_attempts attempt
  join public.units unit on unit.id = attempt.unit_id
  join public.buildings building on building.id = attempt.building_id
  left join public.organisations agent on agent.id = attempt.sales_agent_organisation_id
  left join lateral (
    select sale_terms.*
    from public.unit_sale_terms sale_terms
    where sale_terms.sale_attempt_id = attempt.id
      and sale_terms.is_current is true
    order by sale_terms.version_number desc
    limit 1
  ) terms on true
  left join lateral (
    select invoice.*
    from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id
      and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'exchange'
      and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc
    limit 1
  ) exchange_invoice on true
  left join lateral (
    select invoice.*
    from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id
      and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'completion'
      and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc
    limit 1
  ) completion_invoice on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = exchange_invoice.id
      and payment.payment_source <> 'reservation_fee'
      and payment.voided_at is null
  ) exchange_payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = completion_invoice.id
      and payment.payment_source <> 'reservation_fee'
      and payment.voided_at is null
  ) completion_payments on true
  where attempt.is_active is true
    and attempt.workflow_status not in ('fallen_through', 'superseded')
    and (auth.role() = 'service_role' or public.can_access_sales_building(attempt.building_id))
  order by building.name, unit.unit_number;
end;
$$;

revoke all on function public.get_agent_fee_portfolio(uuid) from public;
grant execute on function public.get_agent_fee_portfolio(uuid) to authenticated, service_role;
