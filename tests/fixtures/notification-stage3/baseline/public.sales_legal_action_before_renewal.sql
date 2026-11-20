CREATE OR REPLACE FUNCTION public.sales_legal_action_before_renewal(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if e.id is null or (e.sent_at is null and not workspace_commands.captured_authority(e.id,p_sale)) or e.revoked_at is not null or e.replaced_by is not null or e.expires_at<=now() or e.delivery_status in ('bounced','complained','suppressed','failed','unknown') then raise exception 'A sent, unexpired authority is required. Ask the developer to issue fresh authority.'; end if;
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
end $function$
