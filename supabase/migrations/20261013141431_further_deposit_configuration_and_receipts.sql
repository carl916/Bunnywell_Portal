-- Additive only: retained exchange sources/receipts and legal completion gates are untouched.
begin;
alter table public.building_sale_defaults add column further_deposit_timing jsonb;
alter table public.unit_sale_terms add column further_deposit_timing jsonb;

create function public.sales_deposit_timing(p_value jsonb, p_require_time boolean default false) returns jsonb
language plpgsql immutable set search_path=public as $$
declare d date; t time; local_stamp timestamp; instant timestamptz; months numeric;
begin
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if p_value->>'basis' in ('after_exchange','before_pc') then
    months:=(p_value->>'months')::numeric;
    if months is null or months<0 or months>1200 or months<>trunc(months) then raise exception 'Enter a whole number of calendar months (0–1200).'; end if;
    return jsonb_build_object('basis',p_value->>'basis','months',months);
  end if;
  if p_value->>'basis' is distinct from 'fixed' then raise exception 'Choose a valid further-deposit timing basis.'; end if;
  if coalesce(p_value->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a deadline date.'; end if;
  d:=(p_value->>'date')::date;
  if nullif(p_value->>'time','') is null then
    if p_require_time then raise exception 'Enter the deadline time in UK time.'; end if;
    return jsonb_build_object('basis','fixed','date',d,'time',null,'instant',null);
  end if;
  if p_value->>'time' !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Enter a valid UK time.'; end if;
  t:=(p_value->>'time')::time; local_stamp:=d+t; instant:=local_stamp at time zone 'Europe/London';
  if instant at time zone 'Europe/London' <> local_stamp
    or (instant-interval '1 hour') at time zone 'Europe/London'=local_stamp
    or (instant+interval '1 hour') at time zone 'Europe/London'=local_stamp then
    raise exception 'Choose an unambiguous UK time outside the daylight-saving clock change.';
  end if;
  return jsonb_build_object('basis','fixed','date',d,'time',to_char(t,'HH24:MI'),'instant',instant);
end $$;

create function public.sales_deposit_terms_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.exchange_deposit_percent,new.second_deposit_enabled,new.second_deposit_percent,new.second_deposit_months_after_exchange,new.further_deposit_timing)
    is not distinct from (old.exchange_deposit_percent,old.second_deposit_enabled,old.second_deposit_percent,old.second_deposit_months_after_exchange,old.further_deposit_timing) then return new; end if;
  if new.exchange_deposit_percent not between 0 and 100 or new.second_deposit_enabled and (new.second_deposit_percent is null or new.second_deposit_percent<=0 or new.second_deposit_percent>100)
    or coalesce(new.exchange_deposit_percent,0)+(case when new.second_deposit_enabled then coalesce(new.second_deposit_percent,0) else 0 end)>100 then raise exception 'Deposit percentages must be valid and must not exceed 100%% in total.'; end if;
  -- A null configuration preserves genuinely incomplete/date-only legacy terms.
  new.further_deposit_timing:=public.sales_deposit_timing(new.further_deposit_timing,
    tg_op='INSERT' or old.further_deposit_timing is distinct from new.further_deposit_timing);
  if not new.second_deposit_enabled then new.further_deposit_timing:=null; end if;
  return new;
end $$;
create trigger deposit_defaults_validate before insert or update on public.building_sale_defaults for each row execute function public.sales_deposit_terms_guard();
create trigger deposit_terms_validate before insert or update on public.unit_sale_terms for each row execute function public.sales_deposit_terms_guard();

-- No attempts are manufactured. Units with no sale record read the building defaults.
-- Only untouched baseline terms matching the PREVIOUS defaults inherit a change.
create function public.sales_cascade_deposit_defaults() returns trigger language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if (new.exchange_deposit_percent,new.second_deposit_enabled,new.second_deposit_percent,new.second_deposit_months_after_exchange,new.further_deposit_timing)
    is not distinct from (old.exchange_deposit_percent,old.second_deposit_enabled,old.second_deposit_percent,old.second_deposit_months_after_exchange,old.further_deposit_timing) then return new; end if;
  for r in select t.id,a.id as sale_id from unit_sale_terms t join unit_sale_attempts a on a.id=t.sale_attempt_id join units u on u.id=a.unit_id
    where a.building_id=new.building_id and a.is_active and a.workflow_status='draft' and t.is_current
      and u.sale_status in ('not_released','not_for_sale','for_sale') and a.exchanged_at is null and a.completed_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null and a.reservation_submitted_at is null and a.reservation_date is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from unit_sale_documents d where d.sale_attempt_id=a.id and d.document_type='reservation_form' and d.redacted_at is null and d.status<>'redacted')
      and not exists(select 1 from unit_sale_payment_schedule scheduled where scheduled.sale_attempt_id=a.id and
        (scheduled.payment_stage not in ('exchange','delayed_deposit','completion') or scheduled.fixed_amount is not null or nullif(btrim(scheduled.notes),'') is not null
          or scheduled.expected_amount is not null and scheduled.expected_amount is distinct from round(t.contract_price*scheduled.percent_of_contract_price/100,2)))
      and (t.exchange_deposit_percent,t.second_deposit_enabled,t.second_deposit_percent,t.second_deposit_months_after_exchange,t.further_deposit_timing)
        is not distinct from (old.exchange_deposit_percent,old.second_deposit_enabled,old.second_deposit_percent,old.second_deposit_months_after_exchange,old.further_deposit_timing)
    order by a.id for update of a,t,u
  loop
    update unit_sale_terms set exchange_deposit_percent=new.exchange_deposit_percent,second_deposit_enabled=new.second_deposit_enabled,
      second_deposit_percent=new.second_deposit_percent,second_deposit_months_after_exchange=new.second_deposit_months_after_exchange,
      further_deposit_timing=new.further_deposit_timing,
      completion_balance_percent=100-coalesce(new.exchange_deposit_percent,0)-case when new.second_deposit_enabled then coalesce(new.second_deposit_percent,0) else 0 end,
      deposit_summary=null,updated_at=now() where id=r.id;
    -- Remove stale copied schedules; the normal commercial workflow rebuilds them
    -- from these current terms before submission/authority. No locked schedule is touched.
    delete from unit_sale_payment_schedule where sale_attempt_id=r.sale_id;
  end loop;
  return new;
end $$;
create trigger deposit_defaults_cascade after update on public.building_sale_defaults for each row execute function public.sales_cascade_deposit_defaults();
revoke all on function public.sales_cascade_deposit_defaults() from public,anon,authenticated,service_role;

create table public.sale_further_deposit_receipts (
  id uuid primary key default gen_random_uuid(), sale_attempt_id uuid not null references unit_sale_attempts(id),
  source_id uuid not null, request_id uuid not null, receipt_key uuid not null,
  revision integer not null check(revision>0), supersedes_id uuid unique references sale_further_deposit_receipts(id),
  amount numeric(16,2) not null check(amount>0), received_date date not null, received_time time,
  received_instant timestamptz, note text, voided boolean not null default false, reason text,
  recorded_by uuid not null references profiles(id), recorded_by_name text not null, organisation_id uuid references organisations(id),
  recorded_at timestamptz not null default now(), request_payload jsonb not null,
  unique(sale_attempt_id,request_id), unique(sale_attempt_id,receipt_key,revision),
  foreign key(source_id,sale_attempt_id) references sale_exchange_deposit_sources(id,sale_attempt_id),
  check((revision=1 and supersedes_id is null and not voided) or (revision>1 and supersedes_id is not null and length(btrim(reason))>0)),
  check((received_time is null)=(received_instant is null))
);
create index further_receipt_source on public.sale_further_deposit_receipts(source_id,receipt_key,revision desc);
create table public.sale_further_deposit_deadlines (
  id uuid primary key default gen_random_uuid(), sale_attempt_id uuid not null references unit_sale_attempts(id),source_id uuid not null,
  request_id uuid not null, supersedes_id uuid unique references sale_further_deposit_deadlines(id),
  date date not null,time time,instant timestamptz,reason text not null check(length(btrim(reason))>0),
  recorded_by uuid not null references profiles(id),recorded_by_name text not null,recorded_at timestamptz not null default now(),request_payload jsonb not null,
  unique(sale_attempt_id,request_id),foreign key(source_id,sale_attempt_id) references sale_exchange_deposit_sources(id,sale_attempt_id),
  check((time is null)=(instant is null))
);
create index further_deadline_source on public.sale_further_deposit_deadlines(source_id,recorded_at desc);
alter table public.sale_further_deposit_receipts enable row level security;
alter table public.sale_further_deposit_deadlines enable row level security;
create policy further_receipts_read on public.sale_further_deposit_receipts for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
create policy further_deadlines_read on public.sale_further_deposit_deadlines for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
revoke all on public.sale_further_deposit_receipts,public.sale_further_deposit_deadlines from public,anon,authenticated,service_role;
grant select on public.sale_further_deposit_receipts,public.sale_further_deposit_deadlines to authenticated,service_role;
create trigger further_receipt_immutable before insert or update or delete on public.sale_further_deposit_receipts for each row execute function public.sales_exchange_deposit_immutable();
create trigger further_deadline_immutable before insert or update or delete on public.sale_further_deposit_deadlines for each row execute function public.sales_exchange_deposit_immutable();

-- Canonical compact projection; security_invoker preserves the source tables' RLS.
-- The existing immutable exchange source retains the entire agreed terms snapshot.
create function public.sales_further_deposit_amount(p_snapshot jsonb) returns numeric
language plpgsql immutable set search_path=public as $$
declare item jsonb; total numeric:=0; amount numeric; found_stage boolean:=false;
begin
  for item in select value from jsonb_array_elements(coalesce(p_snapshot->'schedule','[]')) loop
    if item->>'payment_stage' is distinct from 'delayed_deposit' then continue; end if;
    found_stage:=true;
    amount:=coalesce((item->>'expected_amount')::numeric,(item->>'fixed_amount')::numeric,
      (p_snapshot#>>'{terms,contract_price}')::numeric*(item->>'percent_of_contract_price')::numeric/100);
    if amount is null or amount<0 or amount::text in ('NaN','Infinity','-Infinity') then return null; end if;
    total:=total+round(amount,2);
  end loop;
  if not found_stage then total:=round((p_snapshot#>>'{terms,contract_price}')::numeric*(p_snapshot#>>'{terms,second_deposit_percent}')::numeric/100,2); end if;
  return case when total>=0 and total::text not in ('NaN','Infinity','-Infinity') then total else null end;
end $$;
create view public.sale_further_deposit_facts with (security_invoker=true) as
select s.id,s.sale_attempt_id,coalesce((s.snapshot#>>'{terms,second_deposit_enabled}')::boolean,false) as required,
  (s.snapshot#>>'{terms,second_deposit_percent}')::numeric as percent,
  public.sales_further_deposit_amount(s.snapshot) as expected_amount,
  s.snapshot#>'{terms,further_deposit_timing}' as timing,(s.snapshot#>>'{terms,second_deposit_months_after_exchange}')::integer as months_after_exchange,
  s.terms_version,a.exchanged_at,coalesce(b.pc_date::text,b.practical_completion_date::text) as pc_date,
  coalesce(receipts.amount,0) as received_amount,deadline.value as deadline
from public.sale_exchange_deposit_sources s join public.unit_sale_attempts a on a.id=s.sale_attempt_id join public.buildings b on b.id=a.building_id
left join lateral (select sum(r.amount) as amount from public.sale_further_deposit_receipts r where r.source_id=s.id and not r.voided
  and not exists(select 1 from public.sale_further_deposit_receipts next where next.supersedes_id=r.id)) receipts on true
left join lateral (select jsonb_build_object('id',d.id,'date',d.date,'time',to_char(d.time,'HH24:MI'),'instant',d.instant) as value
  from public.sale_further_deposit_deadlines d where d.source_id=s.id and not exists(select 1 from public.sale_further_deposit_deadlines next where next.supersedes_id=d.id) limit 1) deadline on true;
revoke all on public.sale_further_deposit_facts from public,anon,authenticated,service_role;
grant select on public.sale_further_deposit_facts to authenticated,service_role;

create function public.sales_deposit_context(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; f jsonb; t jsonb; snapshot jsonb; exchange jsonb; b buildings%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale;
  if a.exchanged_at is null and a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange','exchanged','completion_pending','completed')
    and not exists(select 1 from profiles where id=p_actor and role in ('admin','developer')) then raise exception 'Deposit terms become available after reservation approval.' using errcode='42501'; end if;
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

create function public.sales_further_deposit_action(p_sale uuid,p_action text,p_payload jsonb,p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; actor profiles%rowtype; f sale_further_deposit_facts%rowtype;
  previous sale_further_deposit_receipts%rowtype; receipt sale_further_deposit_receipts%rowtype;
  prior_deadline sale_further_deposit_deadlines%rowtype; amended sale_further_deposit_deadlines%rowtype;
  request uuid; amount numeric; actual_date date; timing jsonb; reason text; actor_name text; excess numeric;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale for update;
  select * into actor from profiles where id=p_actor;
  if p_action='confirm_further_deadline' then
    if actor.role not in ('admin','developer') then raise exception 'Only the developer can amend agreed commercial deadlines.' using errcode='42501'; end if;
  elsif p_action in ('record_further_receipt','correct_further_receipt','void_further_receipt') then
    if actor.role<>'conveyancer' or not exists(select 1 from buildings where id=a.building_id and conveyancer_organisation_id=actor.organisation_id) then
      raise exception 'Only the building authorised conveyancer organisation can record receipts.' using errcode='42501'; end if;
  else raise exception 'Unknown deposit action.'; end if;
  if not a.is_active or a.redacted_at is not null or a.workflow_status in ('withdrawn','failed','fallen_through','superseded') then raise exception 'The active sale file is required; historical receipts are retained.'; end if;
  if a.exchanged_at is null and a.workflow_status not in ('exchanged','completion_pending','completed') then raise exception 'Record legal exchange before recording further-deposit receipts.'; end if;
  select * into f from sale_further_deposit_facts where sale_attempt_id=p_sale;
  if f.id is null or not f.required or f.expected_amount is null or f.expected_amount<=0 then raise exception 'A retained further-deposit obligation is required.'; end if;
  if f.id::text is distinct from p_payload->>'sourceId' then raise exception 'Reload the retained deposit source.'; end if;
  request:=(p_payload->>'requestId')::uuid;
  if request is null then raise exception 'A request ID is required.'; end if;
  actor_name:=coalesce(nullif(actor.full_name,''),nullif(actor.name,''),'Unknown user');
  reason:=nullif(btrim(p_payload->>'reason'),'');
  perform set_config('app.sales_legal_write','on',true);
  if p_action='confirm_further_deadline' then
    select * into amended from sale_further_deposit_deadlines where sale_attempt_id=p_sale and request_id=request;
    if amended.id is not null then
      if amended.request_payload=p_payload then return to_jsonb(amended)-'request_payload'; end if;
      raise exception 'Request ID already used with different values.';
    end if;
    if reason is null then raise exception 'Add a reason and contractual basis for this deadline amendment.'; end if;
    select * into prior_deadline from sale_further_deposit_deadlines where source_id=f.id and not exists(select 1 from sale_further_deposit_deadlines n where n.supersedes_id=sale_further_deposit_deadlines.id);
    if prior_deadline.id::text is distinct from p_payload->>'previousDeadlineId' then raise exception 'Deadline changed; reload before amending.'; end if;
    timing:=sales_deposit_timing(jsonb_build_object('basis','fixed','date',p_payload->>'date','time',p_payload->>'time'),false);
    insert into sale_further_deposit_deadlines(sale_attempt_id,source_id,request_id,supersedes_id,date,time,instant,reason,recorded_by,recorded_by_name,request_payload)
      values(p_sale,f.id,request,prior_deadline.id,(timing->>'date')::date,(timing->>'time')::time,(timing->>'instant')::timestamptz,reason,p_actor,actor_name,p_payload) returning * into amended;
    perform sales_legal_event(p_sale,p_actor,'further_deposit_deadline_amended','Further deposit contractual deadline confirmed/amended',jsonb_build_object('previous',to_jsonb(prior_deadline)-'request_payload','amendment',to_jsonb(amended)-'request_payload','termsVersion',f.terms_version));
    return to_jsonb(amended)-'request_payload';
  end if;
  select * into receipt from sale_further_deposit_receipts where sale_attempt_id=p_sale and request_id=request;
  if receipt.id is not null then
    if receipt.request_payload=p_payload then return to_jsonb(receipt)-'request_payload'; end if;
    raise exception 'Request ID already used with different values.';
  end if;
  if (p_payload->>'expectedReceivedAmount')::numeric is distinct from f.received_amount then raise exception 'Receipt totals changed; refresh and review the balance before saving.'; end if;
  if p_action<>'record_further_receipt' then
    select * into previous from sale_further_deposit_receipts where id=(p_payload->>'previousReceiptId')::uuid and source_id=f.id;
    if previous.id is null or previous.voided or exists(select 1 from sale_further_deposit_receipts where supersedes_id=previous.id) then raise exception 'Receipt changed; reload before correcting.'; end if;
    if reason is null then raise exception 'Add a correction or void reason.'; end if;
  end if;
  if p_action='void_further_receipt' then amount:=previous.amount; actual_date:=previous.received_date;
    timing:=jsonb_build_object('time',to_char(previous.received_time,'HH24:MI'),'instant',previous.received_instant);
  else
    if coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Enter a positive GBP amount with at most two decimal places.'; end if;
    amount:=(p_payload->>'amount')::numeric;
    if amount<=0 or amount>99999999999999.99 then raise exception 'Receipt amount must be positive and within range.'; end if;
    timing:=sales_deposit_timing(jsonb_build_object('basis','fixed','date',p_payload->>'date','time',p_payload->>'time'),false);
    actual_date:=(timing->>'date')::date;
    if actual_date>(now() at time zone 'Europe/London')::date or (timing->>'instant')::timestamptz>now() then raise exception 'Actual receipt date/time cannot be in the future.'; end if;
  end if;
  excess:=f.received_amount-coalesce(previous.amount,0)+case when p_action='void_further_receipt' then 0 else amount end-f.expected_amount;
  if excess>0 and p_payload->>'acknowledgeExcess' is distinct from 'true' then raise exception 'This creates an overpayment review exception. Confirm the excess explicitly.'; end if;
  insert into sale_further_deposit_receipts(sale_attempt_id,source_id,request_id,receipt_key,revision,supersedes_id,amount,received_date,received_time,received_instant,note,voided,reason,recorded_by,recorded_by_name,organisation_id,request_payload)
    values(p_sale,f.id,request,coalesce(previous.receipt_key,request),coalesce(previous.revision,0)+1,previous.id,amount,actual_date,(timing->>'time')::time,(timing->>'instant')::timestamptz,
      nullif(btrim(p_payload->>'note'),''),p_action='void_further_receipt',reason,p_actor,actor_name,actor.organisation_id,p_payload) returning * into receipt;
  perform sales_legal_event(p_sale,p_actor,'further_deposit_'||case when p_action='record_further_receipt' then 'received' when p_action='void_further_receipt' then 'voided' else 'corrected' end,
    'Further deposit receipt '||case when p_action='record_further_receipt' then 'recorded' when p_action='void_further_receipt' then 'voided' else 'corrected' end,
    jsonb_build_object('receipt',to_jsonb(receipt)-'request_payload','previous',to_jsonb(previous)-'request_payload','expectedAmount',f.expected_amount,'excess',greatest(excess,0),'termsVersion',f.terms_version));
  return to_jsonb(receipt)-'request_payload';
end $$;
revoke all on function public.sales_deposit_context(uuid,uuid),public.sales_further_deposit_action(uuid,text,jsonb,uuid),public.sales_deposit_timing(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.sales_deposit_context(uuid,uuid),public.sales_further_deposit_action(uuid,text,jsonb,uuid) to authenticated,service_role;

create function public.sales_further_deposit_event_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.event_type,'') like 'further_deposit_%' or coalesce(old.event_type,'') like 'further_deposit_%' then
    if tg_op<>'INSERT' then raise exception 'Deposit history is immutable.'; end if;
    if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the deposit workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;
create trigger further_deposit_event_guard before insert or update or delete on unit_sale_workflow_events for each row execute function public.sales_further_deposit_event_guard();

alter function public.sale_event_projection(public.unit_sale_workflow_events) rename to sale_event_projection_before_further_deposit;
revoke all on function public.sale_event_projection_before_further_deposit(public.unit_sale_workflow_events) from public,anon,authenticated,service_role;
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if e.event_type like 'further_deposit_%' then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_further_deposit(e);
end $$;

-- Keep the existing commercial save/approval rules and save timing atomically.
create or replace function public.save_unit_commercial_model_with_deposits(
  p_unit_id uuid,
  p_requester_id uuid,
  p_list_price_at_offer numeric,
  p_contract_price numeric,
  p_parking_value numeric,
  p_developer_contribution numeric,
  p_agent_contribution numeric,
  p_reservation_fee numeric,
  p_reservation_fee_holder text,
  p_agent_fee_percent numeric,
  p_exchange_agent_fee_percent numeric,
  p_completion_agent_fee_percent numeric,
  p_vat_rate numeric,
  p_solicitor_fee numeric,
  p_exchange_deposit_percent numeric,
  p_second_deposit_enabled boolean,
  p_second_deposit_percent numeric,
  p_second_deposit_months_after_exchange integer,
  p_completion_balance_percent numeric,
  p_deposit_summary text,
  p_commercial_summary text,
  p_payment_schedule jsonb default '[]'::jsonb,
  p_developer_contribution_value numeric default null,
  p_developer_contribution_value_type text default 'amount',
  p_agent_contribution_value numeric default null,
  p_agent_contribution_value_type text default 'amount',
  p_parking_contribution_value numeric default 0,
  p_parking_location_details text default null,
  p_additional_special_conditions text[] default '{}'::text[],
  p_further_deposit_timing jsonb default null
)
returns table (sale_attempt_id uuid, sale_terms_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  if round(coalesce(p_exchange_agent_fee_percent, 0) + coalesce(p_completion_agent_fee_percent, 0), 4)
      <> round(coalesce(p_agent_fee_percent, 0), 4) then
    raise exception 'Exchange fee plus Completion fee must equal the total agent fee.';
  end if;

  select result.sale_attempt_id, result.sale_terms_id
  into v_result
  from public.save_unit_commercial_model(
    p_unit_id => p_unit_id,
    p_requester_id => p_requester_id,
    p_list_price_at_offer => p_list_price_at_offer,
    p_contract_price => p_contract_price,
    p_parking_value => p_parking_value,
    p_developer_contribution => p_developer_contribution,
    p_agent_contribution => p_agent_contribution,
    p_reservation_fee => p_reservation_fee,
    p_reservation_fee_holder => p_reservation_fee_holder,
    p_agent_fee_percent => p_agent_fee_percent,
    p_vat_rate => p_vat_rate,
    p_solicitor_fee => p_solicitor_fee,
    p_exchange_deposit_percent => p_exchange_deposit_percent,
    p_second_deposit_enabled => p_second_deposit_enabled,
    p_second_deposit_percent => p_second_deposit_percent,
    p_second_deposit_months_after_exchange => p_second_deposit_months_after_exchange,
    p_completion_balance_percent => p_completion_balance_percent,
    p_deposit_summary => p_deposit_summary,
    p_commercial_summary => p_commercial_summary,
    p_payment_schedule => p_payment_schedule,
    p_developer_contribution_value => p_developer_contribution_value,
    p_developer_contribution_value_type => p_developer_contribution_value_type,
    p_agent_contribution_value => p_agent_contribution_value,
    p_agent_contribution_value_type => p_agent_contribution_value_type,
    p_parking_contribution_value => p_parking_contribution_value,
    p_parking_location_details => p_parking_location_details,
    p_additional_special_conditions => p_additional_special_conditions
  ) result;

  update public.unit_sale_terms
  set
    further_deposit_timing = public.sales_deposit_timing(p_further_deposit_timing, false),
    exchange_agent_fee_percent = coalesce(p_exchange_agent_fee_percent, 0),
    completion_agent_fee_percent = coalesce(p_completion_agent_fee_percent, 0)
  where id = v_result.sale_terms_id;

  sale_attempt_id := v_result.sale_attempt_id;
  sale_terms_id := v_result.sale_terms_id;
  return next;
end;
$$;

revoke all on function public.save_unit_commercial_model_with_deposits(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric,
  integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric,
  text, text[], jsonb
) from public, authenticated;
grant execute on function public.save_unit_commercial_model_with_deposits(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric,
  integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric,
  text, text[], jsonb
) to service_role;


alter function public.sales_legal_snapshot(uuid,uuid) rename to sales_legal_snapshot_before_further_deposit;
revoke all on function public.sales_legal_snapshot_before_further_deposit(uuid,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_snapshot(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; timing jsonb;
begin
  result:=public.sales_legal_snapshot_before_further_deposit(p_sale,p_actor);
  select further_deposit_timing into timing from unit_sale_terms where id=(result#>>'{terms,id}')::uuid and sale_attempt_id=p_sale;
  return jsonb_set(result,'{terms,further_deposit_timing}',coalesce(timing,'null'::jsonb));
end $$;
revoke all on function public.sales_legal_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sales_legal_snapshot(uuid,uuid) to authenticated,service_role;
grant execute on function public.sales_deposit_timing(jsonb,boolean) to authenticated,service_role;
commit;
