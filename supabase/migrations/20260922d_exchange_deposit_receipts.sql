-- Deposit receipt is evidence after legal exchange, never a completion gate.
begin;

create function public.sales_exchange_deposit_amount(p_snapshot jsonb) returns numeric
language plpgsql immutable set search_path=public as $$
declare row jsonb; amount numeric; total numeric:=0; found_stage boolean:=false;
begin
  for row in select value from jsonb_array_elements(coalesce(p_snapshot->'schedule','[]')) loop
    if row->>'payment_stage'='exchange' then
      found_stage:=true;
      -- An exchange-labelled row deferred to another event is not due now.
      if coalesce(row->>'due_event','exchange')<>'exchange' or coalesce((row->>'due_offset_days')::int,0)>0 then continue; end if;
      amount:=coalesce((row->>'expected_amount')::numeric,(row->>'fixed_amount')::numeric,
        (p_snapshot#>>'{terms,contract_price}')::numeric*(row->>'percent_of_contract_price')::numeric/100);
      if amount is null or amount<0 then return null; end if;
      total:=total+round(amount,2);
    end if;
  end loop;
  if not found_stage then
    -- Older authorities contain the agreed percentage without schedule rows.
    -- Only these frozen terms are used; no default rate or fee deduction.
    total:=round((p_snapshot#>>'{terms,contract_price}')::numeric*(p_snapshot#>>'{terms,exchange_deposit_percent}')::numeric/100,2);
  end if;
  if total is null or total<0 or total::text in ('NaN','Infinity','-Infinity') then return null; end if;
  return total;
end $$;

create table public.sale_exchange_deposit_sources (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null unique references public.unit_sale_attempts(id),
  authority_id uuid references public.sale_legal_emails(id),
  authority_version integer,
  terms_id uuid references public.unit_sale_terms(id),
  terms_version integer,
  source_kind text not null check(source_kind in ('executed_authority','legacy_locked_terms','unavailable')),
  snapshot jsonb not null,
  expected_amount numeric(16,2) check(expected_amount>=0),
  captured_at timestamptz not null default now(),
  unique(id,sale_attempt_id)
);
create table public.sale_exchange_deposit_receipts (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  source_id uuid not null,
  revision integer not null check(revision>0),
  supersedes_id uuid unique references public.sale_exchange_deposit_receipts(id),
  expected_amount numeric(16,2) not null check(expected_amount>=0),
  received_amount numeric(16,2) not null check(received_amount=expected_amount),
  received_date date not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_by_name text not null,
  recorded_at timestamptz not null default now(),
  correction_reason text,
  unique(sale_attempt_id,revision),
  foreign key(source_id,sale_attempt_id) references public.sale_exchange_deposit_sources(id,sale_attempt_id),
  check((revision=1 and supersedes_id is null and correction_reason is null) or
    (revision>1 and supersedes_id is not null and length(btrim(correction_reason))>0))
);
comment on table public.sale_exchange_deposit_receipts is 'Full receipt confirmations and append-only date corrections, not separate payments. Expected and received amounts are separate for future partial-payment support.';

-- Freeze existing executed authorities, or the retained, already locked legacy
-- commercial version. Never backfill a receipt, actor or receipt date. A missing
-- commercial record remains explicitly unavailable rather than inventing terms.
insert into public.sale_exchange_deposit_sources(sale_attempt_id,authority_id,authority_version,terms_id,terms_version,source_kind,snapshot,expected_amount)
select a.id,e.id,e.version,coalesce((e.snapshot#>>'{terms,id}')::uuid,t.id),
  coalesce((e.snapshot#>>'{terms,version_number}')::int,t.version_number),
  case when e.id is not null then 'executed_authority' when t.id is not null then 'legacy_locked_terms' else 'unavailable' end,
  frozen.snapshot,case when e.id is not null or t.id is not null then public.sales_exchange_deposit_amount(frozen.snapshot) end
from public.unit_sale_attempts a
left join lateral (select * from public.sale_legal_emails where sale_attempt_id=a.id and kind='authority' and exchanged_at is not null order by version desc limit 1) e on true
left join public.unit_sale_terms t on t.sale_attempt_id=a.id and t.is_current and e.id is null
cross join lateral (select coalesce(e.snapshot,jsonb_build_object('terms',coalesce(to_jsonb(t),'{}'),
  'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by s.sequence_no) from public.unit_sale_payment_schedule s
    where s.sale_attempt_id=a.id and (s.sale_terms_id=t.id or s.sale_terms_id is null)),'[]'))) as snapshot) frozen
where a.exchanged_at is not null or a.workflow_status in ('exchanged','completion_pending','completed');

alter table public.sale_exchange_deposit_sources enable row level security;
alter table public.sale_exchange_deposit_receipts enable row level security;
create policy deposit_source_read on public.sale_exchange_deposit_sources for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
create policy deposit_receipt_read on public.sale_exchange_deposit_receipts for select to authenticated using(public.can_access_sale_attempt(sale_attempt_id));
revoke all on public.sale_exchange_deposit_sources,public.sale_exchange_deposit_receipts from public,anon,authenticated,service_role;
grant select on public.sale_exchange_deposit_sources,public.sale_exchange_deposit_receipts to authenticated,service_role;

create function public.sales_exchange_deposit_immutable() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op<>'INSERT' then raise exception 'Exchange deposit history is immutable. Record an audited correction.'; end if;
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the legal workflow to record deposit receipt.'; end if;
  return new;
end $$;
create trigger deposit_source_immutable before insert or update or delete on public.sale_exchange_deposit_sources for each row execute function public.sales_exchange_deposit_immutable();
create trigger deposit_receipt_immutable before insert or update or delete on public.sale_exchange_deposit_receipts for each row execute function public.sales_exchange_deposit_immutable();

create function public.sales_exchange_deposit_context(p_sale uuid,p_actor uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare source jsonb; receipt jsonb;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select to_jsonb(s)-'snapshot' into source from sale_exchange_deposit_sources s where sale_attempt_id=p_sale;
  select to_jsonb(r) into receipt from sale_exchange_deposit_receipts r where sale_attempt_id=p_sale order by revision desc limit 1;
  return jsonb_build_object('source',source,'receipt',receipt);
end $$;

alter function public.sales_legal_action(uuid,text,jsonb,uuid) rename to sales_legal_action_before_deposit;
revoke all on function public.sales_legal_action_before_deposit(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.sales_legal_action(p_sale uuid,p_action text,p_payload jsonb default '{}',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; source sale_exchange_deposit_sources%rowtype;
  previous sale_exchange_deposit_receipts%rowtype; receipt sale_exchange_deposit_receipts%rowtype;
  actual_date date; actor_name text; reason text;
begin
  if p_action not in ('confirm_exchange','confirm_exchange_deposit','correct_exchange_deposit_date') then
    return public.sales_legal_action_before_deposit(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  if not exists(select 1 from profiles where id=p_actor and role='conveyancer') then raise exception 'Your role cannot perform this legal action.' using errcode='42501'; end if;
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  perform set_config('app.sales_legal_write','on',true);
  if p_action='confirm_exchange' and a.exchanged_at is not null then return jsonb_build_object('alreadyExchanged',true); end if;
  if coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid receipt or exchange date.'; end if;
  actual_date:=(p_payload->>'date')::date;
  if actual_date>(now() at time zone 'Europe/London')::date then raise exception 'The recorded date cannot be in the future.'; end if;
  if p_action='confirm_exchange' then
    select * into e from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' order by version desc limit 1 for update;
    if e.id is null or e.sent_at is null or e.revoked_at is not null or e.replaced_by is not null or e.expires_at<=now() or e.delivery_status in ('bounced','complained','suppressed','failed','unknown') then raise exception 'A sent, unexpired authority is required. Ask the developer to issue fresh authority.'; end if;
    if actual_date<(e.issued_at at time zone 'Europe/London')::date then raise exception 'Exchange cannot predate the authority.'; end if;
    update sale_legal_emails set exchanged_at=actual_date where id=e.id;
    update unit_sale_attempts set workflow_status='exchanged',exchanged_at=actual_date,stage_entered_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    insert into sale_exchange_deposit_sources(sale_attempt_id,authority_id,authority_version,terms_id,terms_version,source_kind,snapshot,expected_amount)
      values(p_sale,e.id,e.version,(e.snapshot#>>'{terms,id}')::uuid,(e.snapshot#>>'{terms,version_number}')::int,'executed_authority',e.snapshot,public.sales_exchange_deposit_amount(e.snapshot));
    perform public.sales_workflow_mark_unit_exchanged(a.unit_id,p_sale,p_actor,'legal_authority_exchange');
    perform public.sales_legal_event(p_sale,p_actor,'exchange_recorded','Exchange confirmed by conveyancer',jsonb_build_object('exchangeDate',actual_date,'emailId',e.id,'versionNumber',e.version));
    return jsonb_build_object('saleAttemptId',p_sale);
  end if;
  if a.exchanged_at is null and a.workflow_status not in ('exchanged','completion_pending','completed') then raise exception 'Record legal exchange before confirming deposit receipt.'; end if;
  select * into source from sale_exchange_deposit_sources where sale_attempt_id=p_sale;
  if source.expected_amount is null then raise exception 'The locked exchange deposit amount is unavailable. Raise the missing commercial record in Comments.'; end if;
  if source.id::text is distinct from p_payload->>'sourceId' then raise exception 'Reload the authorised deposit details before confirming.'; end if;
  -- No client-supplied amount, actor or authority is used.
  if p_payload ?| array['receivedAmount','expectedAmount','amount','recordedBy','authorityId'] then raise exception 'The amount, actor and authority are set by the legal workflow.'; end if;
  select * into previous from sale_exchange_deposit_receipts where sale_attempt_id=p_sale order by revision desc limit 1;
  if p_action='confirm_exchange_deposit' then
    if p_payload->>'confirmed' is distinct from 'true' then raise exception 'Confirm receipt of the full expected exchange deposit.'; end if;
    if previous.id is not null then
      if previous.received_date=actual_date then return to_jsonb(previous); end if;
      raise exception 'Receipt is already recorded. Use an audited date correction.';
    end if;
  else
    if previous.id is null then raise exception 'Record receipt before correcting its date.'; end if;
    if previous.id::text is distinct from p_payload->>'previousReceiptId' then raise exception 'Receipt changed. Reload before correcting the date.'; end if;
    if previous.received_date=actual_date then return to_jsonb(previous); end if;
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if reason is null then raise exception 'Add a reason for the date correction.'; end if;
  end if;
  select coalesce(nullif(full_name,''),nullif(name,''),'Unknown user') into actor_name from profiles where id=p_actor;
  insert into sale_exchange_deposit_receipts(sale_attempt_id,source_id,revision,supersedes_id,expected_amount,received_amount,received_date,recorded_by,recorded_by_name,correction_reason)
    values(p_sale,source.id,coalesce(previous.revision,0)+1,previous.id,source.expected_amount,source.expected_amount,actual_date,p_actor,actor_name,reason) returning * into receipt;
  perform public.sales_legal_event(p_sale,p_actor,case when previous.id is null then 'exchange_deposit_received' else 'exchange_deposit_date_corrected' end,
    'Exchange deposit of £'||to_char(receipt.received_amount,'FM999,999,999,999,990.00')||case when previous.id is null then ' recorded as received on ' else ' receipt date corrected to ' end||to_char(actual_date,'FMDD FMMonth YYYY')||' by '||actor_name||'.',
    jsonb_build_object('receiptId',receipt.id,'sourceId',source.id,'authorityId',source.authority_id,'authorityVersion',source.authority_version,'termsId',source.terms_id,'termsVersion',source.terms_version,
      'expectedAmount',receipt.expected_amount,'receivedAmount',receipt.received_amount,'receivedDate',actual_date,'recordedBy',p_actor,'recordedAt',receipt.recorded_at,
      'previousReceiptId',previous.id,'previousDate',previous.received_date,'reason',reason));
  return to_jsonb(receipt);
end $$;

-- Preserve the old guard and cover both OLD and NEW types so renaming an event
-- cannot turn immutable legal history into an editable ordinary activity.
create or replace function public.sales_legal_history_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.event_type,'') ~ '^(authority_|legal_email_|completion_instruction_|completion_arrangements_|exchange_deposit_|exchange_recorded$|completion_recorded$|completion_documents_|completion_statement_|completion_correspondence_|statement_of_account_)'
    or coalesce(old.event_type,'') ~ '^(authority_|legal_email_|completion_instruction_|completion_arrangements_|exchange_deposit_|exchange_recorded$|completion_recorded$|completion_documents_|completion_statement_|completion_correspondence_|statement_of_account_)' then
    if tg_op<>'INSERT' then raise exception 'Legal workflow history is immutable.'; end if;
    if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Legal events must be recorded by the legal workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;
alter function public.sale_event_projection(public.unit_sale_workflow_events) rename to sale_event_projection_before_deposit;
create function public.sale_event_projection(e public.unit_sale_workflow_events) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if e.event_type in ('exchange_deposit_received','exchange_deposit_date_corrected') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_deposit(e);
end $$;
revoke all on function public.sales_exchange_deposit_amount(jsonb),public.sales_exchange_deposit_context(uuid,uuid),public.sales_legal_action(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sales_exchange_deposit_context(uuid,uuid),public.sales_legal_action(uuid,text,jsonb,uuid) to authenticated,service_role;
commit;
