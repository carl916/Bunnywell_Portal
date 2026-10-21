-- Deposit terms are shared with every authorised sale viewer before approval.
-- Keep the existing sale-access assertion and receipt/deadline write permissions.
-- This changes only the read function; terms, receipts and sale stages are untouched.
create or replace function public.sales_deposit_context(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; f jsonb; t jsonb; snapshot jsonb; exchange jsonb; b buildings%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale;
  select to_jsonb(v) into f from sale_further_deposit_facts v where sale_attempt_id=p_sale;
  if f is null then
    select to_jsonb(terms) into t from unit_sale_terms terms where sale_attempt_id=p_sale and is_current;
    select * into b from buildings where id=a.building_id;
    f:=jsonb_build_object('id',null,'sale_attempt_id',p_sale,'required',coalesce((t->>'second_deposit_enabled')::boolean,false),
      'percent',(t->>'second_deposit_percent')::numeric,'expected_amount',round((t->>'contract_price')::numeric*(t->>'second_deposit_percent')::numeric/100,2),
      'received_amount',0,'timing',t->'further_deposit_timing','months_after_exchange',(t->>'second_deposit_months_after_exchange')::int,
      'exchanged_at',a.exchanged_at,'pc_date',coalesce(b.pc_date::text,b.practical_completion_date::text),'deadline',null,'terms_version',(t->>'version_number')::int);
  end if;
  select s.snapshot into snapshot from sale_exchange_deposit_sources s where s.sale_attempt_id=p_sale;
  if snapshot is null then
    snapshot:=jsonb_build_object('terms',t,'schedule',coalesce((select jsonb_agg(to_jsonb(p)) from unit_sale_payment_schedule p where p.sale_attempt_id=p_sale),'[]'::jsonb));
  end if;
  exchange:=public.sales_exchange_deposit_context(p_sale,p_actor)||jsonb_build_object('percent',(snapshot#>>'{terms,exchange_deposit_percent}')::numeric,
    'preview_amount',public.sales_exchange_deposit_amount(snapshot));
  return jsonb_build_object('exchange',exchange,'further',f,
    'completed',a.completed_at is not null or a.workflow_status='completed',
    'exchanged',a.exchanged_at is not null or a.workflow_status in ('exchanged','completion_pending','completed'),
    'active',a.is_active and a.redacted_at is null and a.workflow_status not in ('withdrawn','failed','fallen_through','superseded'),
    'canRecord',exists(select 1 from profiles p join buildings appointed on appointed.id=a.building_id where p.id=p_actor and p.role='conveyancer' and p.organisation_id=appointed.conveyancer_organisation_id),
    'canAmendDeadline',exists(select 1 from profiles where id=p_actor and role in ('admin','developer')),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r)-'request_payload' order by r.recorded_at,r.id) from sale_further_deposit_receipts r where r.sale_attempt_id=p_sale),'[]'),
    'deadlines',coalesce((select jsonb_agg(to_jsonb(d)-'request_payload' order by d.recorded_at,d.id) from sale_further_deposit_deadlines d where d.sale_attempt_id=p_sale),'[]'));
end $$;
