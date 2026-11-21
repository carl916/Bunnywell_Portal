-- Preserve historical captures and their failure details. A restored transport
-- must not start sending emails from before this cutover.
alter table workspace_commands.sales_email_deliveries
  add column held_at timestamptz,
  add column consecutive_failures integer not null default 0,
  add column delivery_state text generated always as (
    case when held_at is not null then 'held'
         when status = 'unknown' then 'retry_pending'
         else status end
  ) stored;

update workspace_commands.sales_email_deliveries
set held_at = clock_timestamp()
where provider_id is null
  and status in ('queued', 'sending', 'unknown', 'failed');

create index sales_email_deliveries_claimable on workspace_commands.sales_email_deliveries(next_attempt_at)
where held_at is null and status in ('queued', 'sending', 'unknown', 'accepted');

create or replace function public.workspace_sales_email_delivery(
  p_worker uuid, p_action text, p_payload jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d workspace_commands.sales_email_deliveries%rowtype;
  context jsonb;
  eligible jsonb;
  e public.sale_legal_emails%rowtype;
  payload jsonb;
  outcome text;
  failures integer;
  next_attempt timestamptz;
  moment timestamptz := clock_timestamp();
  target_id uuid := nullif(p_payload->>'id', '')::uuid;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_worker is null then
    raise exception 'Server delivery required.' using errcode = '42501';
  end if;
  if not exists (select 1 from workspace_commands.notification_dispatch_state
                 where stage3_active and delivery_enabled_at is not null) then
    return null;
  end if;

  if p_action = 'claim' then
    -- An interrupted send may already have reached the provider. Leave an
    -- exhausted or too-old identity available for operator reconciliation.
    update workspace_commands.sales_email_deliveries
    set status = case when first_attempt_at is null then 'failed' else 'reconciliation_required' end,
        worker = null, lease_until = null, updated_at = moment,
        last_error = 'Delivery worker interrupted or provider idempotency window ended.'
    where held_at is null and provider_id is null
      and status in ('queued', 'sending', 'unknown')
      and (worker is null or lease_until <= moment)
      and (first_attempt_at <= moment - interval '23 hours'
           or (worker is not null and consecutive_failures >= 5));

    select * into d from workspace_commands.sales_email_deliveries
    where (target_id is null or id = target_id)
      and held_at is null
      and status in ('queued', 'sending', 'unknown', 'accepted')
      and (status <> 'accepted' or coalesce(p_payload->>'poll', 'true') = 'true')
      and next_attempt_at <= moment and (worker is null or lease_until <= moment)
    order by (status = 'accepted'), next_attempt_at, created_at
    for update skip locked limit 1;
    if not found then return null; end if;

    update workspace_commands.sales_email_deliveries
    set consecutive_failures = consecutive_failures + (worker is not null and provider_id is null)::integer,
        worker = p_worker, lease_until = moment + interval '60 seconds'
    where id = d.id returning * into d;
    if d.kind = 'routine' and d.provider_id is null then
      context := workspace_commands.notification_batch_context(d.source_id);
    end if;
    return to_jsonb(d) || jsonb_build_object('context', context);
  end if;

  if p_action = 'retry' then
    update workspace_commands.sales_email_deliveries
    set status = 'unknown', consecutive_failures = 0, next_attempt_at = moment, updated_at = moment
    where id = target_id and status = 'failed' and held_at is null and provider_id is null
      and (first_attempt_at is null or first_attempt_at > moment - interval '23 hours');
    return jsonb_build_object('scheduled', found);
  end if;

  select * into strict d from workspace_commands.sales_email_deliveries where id = target_id for update;
  if d.held_at is not null or d.worker is distinct from p_worker or d.lease_until <= moment then
    raise exception 'Delivery lease expired or held.' using errcode = '40001';
  end if;

  if p_action = 'release_for_send' then
    if d.provider_id is not null then
      return jsonb_build_object('send', false, 'providerId', d.provider_id);
    end if;
    if d.first_attempt_at <= moment - interval '23 hours' then
      update workspace_commands.sales_email_deliveries
      set status = 'reconciliation_required', worker = null, lease_until = null, updated_at = moment,
          last_error = 'Provider idempotency window ended; reconcile before any further send.'
      where id = d.id;
      return jsonb_build_object('send', false);
    end if;

    if d.kind = 'routine' then
      perform pg_advisory_xact_lock(hashtextextended('notification-sale:' || d.sale_id::text, 0));
      context := workspace_commands.notification_batch_context(d.source_id);
      eligible := workspace_commands.current_notification_items(context, d.recipient_id);
      if jsonb_array_length(eligible) = 0 or (d.first_attempt_at is not null and (
          eligible is distinct from (select items from workspace_commands.notification_captures where batch_id = d.source_id)
          or context->>'email' is distinct from d.intended#>>'{to,0,email}'
      )) then
        update workspace_commands.sales_email_deliveries
        set status = case when first_attempt_at is null then 'suppressed' else 'reconciliation_required' end,
            worker = null, lease_until = null, updated_at = moment,
            last_error = 'Recipient eligibility changed before release.'
        where id = d.id;
        return jsonb_build_object('send', false);
      end if;
      if d.first_attempt_at is null then
        if context->>'revision' is distinct from p_payload->>'revision' or eligible is distinct from p_payload->'items' then
          raise exception 'Recheck delivery eligibility.' using errcode = '40001';
        end if;
        update workspace_commands.notification_captures
        set subject = p_payload#>>'{mail,subject}', text_body = p_payload#>>'{mail,text}',
            html_body = p_payload#>>'{mail,html}', items = eligible, recipient_email = context->>'email'
        where batch_id = d.source_id;
        d.original_mail := p_payload->'mail';
        d.intended := jsonb_build_object(
          'to', jsonb_build_array(jsonb_build_object(
            'email', context->>'email', 'name', context->>'recipientName', 'role', context->>'recipientRole'
          )), 'cc', '[]'::jsonb, 'bcc', '[]'::jsonb
        );
      end if;
    else
      select * into e from public.sale_legal_emails where id = d.source_id;
      if not found or e.revoked_at is not null or e.replaced_by is not null or e.expires_at <= moment then
        update workspace_commands.sales_email_deliveries
        set status = case when first_attempt_at is null then 'suppressed' else 'reconciliation_required' end,
            worker = null, lease_until = null, updated_at = moment,
            last_error = 'Formal instruction is no longer available.'
        where id = d.id;
        return jsonb_build_object('send', false);
      end if;
    end if;

    payload := coalesce(d.provider_payload, p_payload->'providerPayload');
    if payload->'to' is distinct from '["carl@accoladeproperties.co.uk"]'::jsonb
      or payload->'cc' is distinct from '[]'::jsonb or payload->'bcc' is distinct from '[]'::jsonb
      or payload->>'reply_to' is distinct from 'carl@accoladeproperties.co.uk'
      or not coalesce(payload->>'subject' like '[STAGING] %', false) then
      raise exception 'Unsafe staging provider payload.';
    end if;
    update workspace_commands.sales_email_deliveries
    set provider_payload = payload, original_mail = d.original_mail, intended = d.intended,
        first_attempt_at = coalesce(first_attempt_at, moment), attempts = attempts + 1,
        status = 'sending', updated_at = moment
    where id = d.id;
    return jsonb_build_object('send', true, 'payload', payload,
      'idempotencyKey', 'staging-sales/' || d.kind || '/' || d.source_id::text);
  end if;

  if p_action = 'result' then
    outcome := p_payload->>'status';
    if outcome is null or outcome not in ('unknown', 'failed', 'accepted', 'delivered', 'bounced', 'complained') then
      raise exception 'Unsupported delivery result';
    end if;
    if outcome in ('accepted', 'delivered') and coalesce(d.provider_id, nullif(p_payload->>'providerId', '')) is null then
      raise exception 'Provider ID required';
    end if;
    failures := d.consecutive_failures;
    next_attempt := moment + case when outcome = 'accepted' and nullif(p_payload->>'error', '') is not null
                                 then interval '1 hour' else interval '1 minute' end;
    if outcome in ('unknown', 'failed') and d.provider_id is null then
      failures := failures + 1;
      next_attempt := moment + make_interval(mins => (array[1, 2, 5, 15, 30, 60])[least(failures, 6)]);
      outcome := case when failures < 6 then 'unknown'
                      when outcome = 'unknown' and d.first_attempt_at is not null then 'reconciliation_required'
                      else 'failed' end;
    elsif outcome in ('accepted', 'delivered') then
      failures := 0;
    end if;
    update workspace_commands.sales_email_deliveries
    set status = outcome, provider_id = coalesce(provider_id, nullif(p_payload->>'providerId', '')),
        accepted_at = case when outcome in ('accepted', 'delivered') then coalesce(accepted_at, moment) else accepted_at end,
        delivered_at = case when outcome = 'delivered' then coalesce(delivered_at, moment) else delivered_at end,
        consecutive_failures = failures, last_error = left(p_payload->>'error', 200),
        next_attempt_at = next_attempt, worker = null, lease_until = null, updated_at = moment
    where id = d.id returning * into d;
    return jsonb_build_object('id', d.id, 'status', d.delivery_state, 'actualDestination', d.actual_destination,
      'acceptedAt', d.accepted_at, 'deliveredAt', d.delivered_at);
  end if;
  raise exception 'Unknown delivery action';
end $$;

revoke all on function public.workspace_sales_email_delivery(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.workspace_sales_email_delivery(uuid,text,jsonb) to service_role;
