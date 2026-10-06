-- Staging increment. Existing histories and legal/email RPCs are preserved.
create schema if not exists portal_audit;
revoke all on schema portal_audit from public, anon, authenticated;

alter table public.audit_events add column if not exists outcome text;
alter table public.audit_events add column if not exists actor_name text, add column if not exists actor_role text;
alter table public.snag_events add column if not exists audit_origin text;
alter table public.snag_events add column if not exists actor_name text, add column if not exists actor_role text;
create table portal_audit.options(singleton boolean primary key default true check(singleton), unit_opens_enabled boolean not null default true);
alter table portal_audit.options enable row level security;
insert into portal_audit.options values(true,true);
-- Minimal provider-log imports; no token, email, IP or request payload storage.
create table portal_audit.auth_events(id uuid primary key, actor_id uuid not null, created_at timestamptz not null,
  action text not null check(action in ('login','logout')), imported_at timestamptz not null default statement_timestamp());
alter table portal_audit.auth_events enable row level security;

-- Only service-role requests may supply the server-verified actor header.
-- A caller with an ordinary JWT cannot override auth.uid() with a header.
create function portal_audit.actor() returns uuid language plpgsql stable
security definer set search_path='' as $$
declare actor uuid; candidate text;
begin
  if auth.jwt()->>'role'='service_role' then
    candidate := nullif(current_setting('request.headers',true),'')::jsonb->>'x-bunnywell-audit-actor';
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then actor := candidate::uuid; end if;
  else actor := auth.uid(); end if;
  if actor is not null and not exists(select 1 from public.profiles where id=actor and active is true) then
    raise exception 'Active authenticated audit actor required' using errcode='42501';
  end if;
  return actor;
end $$;

create function portal_audit.stamp_general() returns trigger language plpgsql
security definer set search_path='' as $$
declare actor uuid := portal_audit.actor();
begin
  -- Unattributed service jobs stay system events; never infer the last editor.
  new.created_by_user_id := actor;
  new.created_at := statement_timestamp();
  select organisation_id into new.actor_organisation_id from public.profiles where id=actor;
  select coalesce(nullif(full_name,''),nullif(name,'')),role::text into new.actor_name,new.actor_role from public.profiles where id=actor;
  if pg_trigger_depth()=1 and auth.jwt()->>'role'='authenticated' and coalesce(current_setting('portal_audit.internal_write',true),'')<>'true' then
    new.source := 'client_reported'; new.outcome := 'reported';
    -- Legacy non-essential client reports remain compatible, with a narrow payload.
    select coalesce(jsonb_object_agg(key,value),'{}') into new.metadata
    from jsonb_each(new.metadata) where key in ('building_id','buildingId','unit_id','unitId','userId','action_id','source');
    if coalesce(new.field_name,'') ~* '(email|phone|password|token|buyer|notes|contact)' then
      new.previous_value:=null; new.new_value:=null;
    end if;
  end if;
  return new;
end $$;
create trigger audit_events_trusted_stamp before insert on public.audit_events
for each row execute function portal_audit.stamp_general();

-- Whitelisted values only. Changed names include sensitive fields, but their
-- old/new values are never copied. No-op saves create no essential event.
create function portal_audit.business_change() returns trigger language plpgsql
security definer set search_path='' as $$
declare before_row jsonb := case when tg_op='INSERT' then '{}' else to_jsonb(old) end;
  after_row jsonb := case when tg_op='DELETE' then '{}' else to_jsonb(new) end;
  row_data jsonb := case when tg_op='DELETE' then before_row else after_row end;
  actor uuid := portal_audit.actor(); fields text[]; values_allowed text[];
  field text; changed text[] := '{}'; previous jsonb := '{}'; next_values jsonb := '{}';
  bid uuid; uid uuid; affected uuid; sale uuid; object_id uuid := (row_data->>'id')::uuid;
  category text; kind text; a public.unit_sale_attempts%rowtype;
begin
  if actor is null then return coalesce(new,old); end if;
  case tg_table_name
    when 'profiles' then
      fields:=array['role','active','resident_type','organisation_id','full_name','name','phone','email'];
      values_allowed:=array['role','active','resident_type','organisation_id']; affected:=object_id; category:='users';
    when 'user_building_access' then
      fields:=array['user_id','building_id','role_on_building']; values_allowed:=fields;
      bid:=(row_data->>'building_id')::uuid; affected:=(row_data->>'user_id')::uuid; category:='users';
    when 'user_unit_access' then
      fields:=array['user_id','unit_id','access_type']; values_allowed:=fields;
      uid:=(row_data->>'unit_id')::uuid; affected:=(row_data->>'user_id')::uuid; category:='users';
    when 'resident_access_requests' then
      fields:=array['status','reviewed_by_user_id','admin_notes']; values_allowed:=array['status']; category:='users';
    when 'units' then
      fields:=array['building_id','unit_number','floor','size_sqm','parking_bays','unit_type_id','unit_type']; values_allowed:=fields;
      uid:=object_id; bid:=(row_data->>'building_id')::uuid; category:='setup';
    when 'areas' then
      fields:=array['building_id','unit_id','area_type','name','sort_order']; values_allowed:=fields;
      uid:=(row_data->>'unit_id')::uuid; bid:=(row_data->>'building_id')::uuid; category:='setup';
    when 'unit_sale_attempts' then
      fields:=array['workflow_status','is_active','reservation_date','reservation_submitted_at','reservation_approved_at',
        'reservation_rejected_at','reservation_terms_checked','buyer_name','buyer_person_name','buyer_company_name','buyer_email',
        'buyer_phone','buyer_solicitor_name','sales_agent_organisation_id','conveyancer_organisation_id'];
      values_allowed:=array['workflow_status','is_active','reservation_date','reservation_terms_checked','sales_agent_organisation_id','conveyancer_organisation_id'];
      sale:=object_id; category:='sales';
    when 'unit_sale_terms' then
      fields:=array['status','is_current','contract_price','list_price_at_offer','parking_value','developer_contribution','agent_contribution',
        'reservation_fee','reservation_fee_holder','agent_fee_percent','exchange_agent_fee_percent','completion_agent_fee_percent',
        'solicitor_fee','exchange_deposit_percent','second_deposit_enabled','second_deposit_percent','second_deposit_months_after_exchange',
        'developer_contribution_value','developer_contribution_value_type','agent_contribution_value','agent_contribution_value_type',
        'parking_contribution_value','parking_location_details','additional_special_conditions','commercial_summary','deposit_summary'];
      select array_agg(v) into values_allowed from unnest(fields) v
        where v not in ('parking_location_details','additional_special_conditions','commercial_summary','deposit_summary');
      sale:=(row_data->>'sale_attempt_id')::uuid; category:='sales';
    when 'unit_sale_invoices' then
      fields:=array['status','approved_at','net_amount','vat_amount','gross_amount','expected_payable_amount','query_note'];
      values_allowed:=array['status','net_amount','vat_amount','gross_amount','expected_payable_amount'];
      sale:=(row_data->>'sale_attempt_id')::uuid; category:='sales';
    else raise exception 'Unsupported audit table';
  end case;
  foreach field in array fields loop
    if before_row->field is distinct from after_row->field then
      changed:=array_append(changed,field);
      if field=any(values_allowed) then
        previous:=previous||jsonb_build_object(field,before_row->field);
        next_values:=next_values||jsonb_build_object(field,after_row->field);
      end if;
    end if;
  end loop;
  if cardinality(changed)=0 and tg_op='UPDATE' then return new; end if;
  if sale is not null then
    if tg_table_name='unit_sale_attempts' then
      bid:=(row_data->>'building_id')::uuid; uid:=(row_data->>'unit_id')::uuid;
    else select building_id,unit_id into bid,uid from public.unit_sale_attempts where id=sale; end if;
  end if;
  if uid is not null and bid is null then select building_id into bid from public.units where id=uid; end if;
  kind:=tg_table_name||'_'||case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'changed' end;
  if sale is not null and tg_op<>'DELETE' then
    select * into a from public.unit_sale_attempts where id=sale;
    insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,summary,metadata,created_by_user_id)
    values(sale,a.building_id,a.unit_id,'sale_record_changed','Sale record changed',
      jsonb_build_object('record_type',tg_table_name,'record_id',object_id,'operation',tg_op,'outcome','succeeded',
        'changed_fields',changed,'previous',previous,'next',next_values,'source','database'),actor);
  else
    insert into public.audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id,
      category,building_id,unit_id,affected_user_id,source,outcome)
    values(kind,tg_table_name,object_id,replace(kind,'_',' '),
      jsonb_build_object('changed_fields',changed,'previous',previous,'next',next_values,'outcome','succeeded',
        'building_id',bid,'unit_id',uid,'sale_id',sale,'affected_user_id',affected),actor,category,
      case when exists(select 1 from public.buildings where id=bid) then bid end,
      case when exists(select 1 from public.units where id=uid) then uid end,
      case when exists(select 1 from public.profiles where id=affected) then affected end,'database','succeeded');
  end if;
  return coalesce(new,old);
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','user_building_access','user_unit_access','resident_access_requests','units','areas',
    'unit_sale_attempts','unit_sale_terms','unit_sale_invoices'] loop
    execute format('create trigger essential_audit_change after insert or update or delete on public.%I for each row execute function portal_audit.business_change()',t);
  end loop;
end $$;

-- The existing money RPC still locks and deduplicates by client_reference.
-- Its successful insert now includes history in the same transaction.
create function portal_audit.payment_created() returns trigger language plpgsql
security definer set search_path='' as $$
declare a public.unit_sale_attempts%rowtype; actor uuid:=portal_audit.actor();
  invoice public.unit_sale_invoices%rowtype; paid numeric; payable numeric;
begin
  if actor is null then return new; end if;
  select * into invoice from public.unit_sale_invoices where id=new.invoice_id;
  if invoice.invoice_type<>'sales_agent' or new.payment_source='reservation_fee' then return new; end if;
  select * into a from public.unit_sale_attempts where id=new.sale_attempt_id;
  insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
  values(a.id,a.building_id,a.unit_id,'agent_fee_payment_recorded',a.workflow_status,a.workflow_status,'Agent fee payment recorded',
    jsonb_build_object('invoiceId',new.invoice_id,'paymentId',new.id,'amount',new.amount,'paymentDate',new.paid_at,'outcome','succeeded','source','database'),actor);
  select coalesce(sum(amount),0) into paid from public.unit_sale_invoice_payments where invoice_id=new.invoice_id and payment_source<>'reservation_fee' and voided_at is null;
  payable:=coalesce(invoice.expected_payable_amount,invoice.expected_gross_amount-invoice.reservation_fee_deduction-invoice.agent_contribution_deduction,
    invoice.gross_amount-invoice.reservation_fee_deduction-invoice.agent_contribution_deduction,0);
  if payable>0 and paid>=payable and paid-new.amount<payable then
    insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
      values(a.id,a.building_id,a.unit_id,'agent_fee_invoice_paid',a.workflow_status,a.workflow_status,'Agent fee invoice fully paid',
        jsonb_build_object('invoiceId',new.invoice_id,'outcome','succeeded','source','database'),actor);
  end if;
  return new;
end $$;
create trigger essential_payment_created after insert on public.unit_sale_invoice_payments
for each row execute function portal_audit.payment_created();

-- Essential snag history is sourced from the changed row, never client claims.
create function portal_audit.snag_changed() returns trigger language plpgsql
security definer set search_path='' as $$
declare actor uuid:=portal_audit.actor(); field text; before_row jsonb;
  kind text; comment_text text:=nullif(current_setting('portal_audit.snag_comment',true),'');
begin
  if actor is null then return new; end if;
  if tg_op='INSERT' then
    insert into public.snag_events(snag_id,event_type,new_value,created_by_user_id,audit_origin)
      values(new.id,'created',new.status,actor,'database');
  else
    before_row:=to_jsonb(old);
    foreach field in array array['status','priority_code','trade_id','assigned_to_organisation_id','assigned_to_user_id','sla_due_date','closed_at'] loop
      if before_row->field is distinct from to_jsonb(new)->field then
        kind:=case field when 'status' then 'status_change' when 'priority_code' then 'priority_changed' when 'trade_id' then 'trade_changed' else field||'_changed' end;
        insert into public.snag_events(snag_id,event_type,old_value,new_value,comment,created_by_user_id,audit_origin)
          values(new.id,kind,before_row->>field,to_jsonb(new)->>field,case when field='status' then comment_text end,actor,'database');
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger essential_snag_changed after insert or update on public.snags
for each row execute function portal_audit.snag_changed();

-- Reject direct invented transition events. Notes/media remain ordinary history.
-- During rollout old clients may attempt the second transition write: suppress
-- it without deleting any historical rows; preserve their comment as a note.
create function portal_audit.snag_event_stamp() returns trigger language plpgsql
security definer set search_path='' as $$
begin
  new.created_by_user_id:=portal_audit.actor(); new.created_at:=statement_timestamp();
  select coalesce(nullif(full_name,''),nullif(name,'')),role::text into new.actor_name,new.actor_role from public.profiles where id=new.created_by_user_id;
  if pg_trigger_depth()=1 then
    new.audit_origin:='client_reported';
    if new.event_type in ('created','status_change','triage','priority_changed','trade_changed') then
      if nullif(btrim(new.comment),'') is null then return null; end if;
      new.event_type:='note'; new.old_value:=null; new.new_value:=null;
    end if;
  end if;
  return new;
end $$;
create trigger snag_events_trusted_stamp before insert on public.snag_events
for each row execute function portal_audit.snag_event_stamp();

-- Invoker keeps exactly the existing snag update RLS and mutation fields.
create function public.change_snag(p_snag uuid,p_patch jsonb,p_comment text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_patch - array['status','priority_code','sla_due_date','closed_at','trade_id','assigned_to_organisation_id','assigned_to_user_id'] <> '{}'::jsonb then
    raise exception 'Unsupported snag field';
  end if;
  perform set_config('portal_audit.snag_comment',coalesce(p_comment,''),true);
  update public.snags set
    status=case when p_patch ? 'status' then (p_patch->>'status')::public.snag_status else status end,
    priority_code=case when p_patch ? 'priority_code' then p_patch->>'priority_code' else priority_code end,
    sla_due_date=case when p_patch ? 'sla_due_date' then (p_patch->>'sla_due_date')::timestamptz else sla_due_date end,
    closed_at=case when p_patch ? 'closed_at' then (p_patch->>'closed_at')::timestamptz else closed_at end,
    trade_id=case when p_patch ? 'trade_id' then (p_patch->>'trade_id')::uuid else trade_id end,
    assigned_to_organisation_id=case when p_patch ? 'assigned_to_organisation_id' then (p_patch->>'assigned_to_organisation_id')::uuid else assigned_to_organisation_id end,
    assigned_to_user_id=case when p_patch ? 'assigned_to_user_id' then (p_patch->>'assigned_to_user_id')::uuid else assigned_to_user_id end
  where id=p_snag;
  if not found then raise exception 'Snag not found or update denied' using errcode='42501'; end if;
  perform set_config('portal_audit.snag_comment','',true);
end $$;
revoke all on function public.change_snag(uuid,jsonb,text) from public,anon;
grant execute on function public.change_snag(uuid,jsonb,text) to authenticated;

-- Profile and effective access changes commit together. This service-only RPC
-- accepts the validated route fields, never an arbitrary row/request payload.
create function public.save_portal_user_access(p_user uuid,p_profile jsonb,p_buildings uuid[],p_units jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.jwt()->>'role'<>'service_role' then raise exception 'Server access required' using errcode='42501'; end if;
  if portal_audit.actor() is null then raise exception 'Authenticated server actor required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=portal_audit.actor() and role::text in ('admin','developer') and active is true) then
    raise exception 'Setup administrator required' using errcode='42501'; end if;
  insert into public.profiles(id,email,full_name,name,phone,role,resident_type,organisation_id,active)
  values(p_user,p_profile->>'email',p_profile->>'full_name',p_profile->>'name',p_profile->>'phone',
    (p_profile->>'role')::public.user_role,p_profile->>'resident_type',
    (p_profile->>'organisation_id')::uuid,coalesce((p_profile->>'active')::boolean,true))
  on conflict(id) do update set full_name=excluded.full_name,name=excluded.name,phone=excluded.phone,role=excluded.role,
    resident_type=excluded.resident_type,organisation_id=excluded.organisation_id;
  delete from public.user_building_access where user_id=p_user and not building_id=any(coalesce(p_buildings,'{}'));
  insert into public.user_building_access(user_id,building_id,role_on_building)
    select p_user,b,p_profile->>'role' from unnest(coalesce(p_buildings,'{}')) b
    on conflict(user_id,building_id) do update set role_on_building=excluded.role_on_building;
  delete from public.user_unit_access a where user_id=p_user and not exists(
    select 1 from jsonb_array_elements(p_units) u where (u->>'unitId')::uuid=a.unit_id and u->>'accessType'=a.access_type::text);
  insert into public.user_unit_access(user_id,unit_id,access_type)
    select p_user,(u->>'unitId')::uuid,u->>'accessType' from jsonb_array_elements(p_units) u
    on conflict(user_id,unit_id,access_type) do nothing;
end $$;
revoke all on function public.save_portal_user_access(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.save_portal_user_access(uuid,jsonb,uuid[],jsonb) to service_role;

-- Append-only history. RLS does not protect TRUNCATE.
revoke all on public.audit_events,public.snag_events,public.unit_sale_workflow_events from anon;
revoke update,delete,truncate,references,trigger on public.audit_events,public.snag_events,public.unit_sale_workflow_events from authenticated,service_role;
-- Keep existing authenticated INSERT and role-filtered SELECT/projection grants.

create table public.unit_open_events (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null,
  unit_id uuid not null,
  building_id uuid not null,
  created_at timestamptz not null default statement_timestamp()
);
create index unit_open_actor_unit_time on public.unit_open_events(created_by_user_id,unit_id,created_at desc);
create index unit_open_time on public.unit_open_events(created_at);
alter table public.unit_open_events enable row level security;
revoke all on public.unit_open_events from public,anon,authenticated,service_role;
grant select on public.unit_open_events to authenticated,service_role;
create policy unit_open_admin_read on public.unit_open_events for select to authenticated
using(public.is_setup_admin() and created_at >= statement_timestamp()-interval '30 days');

create function public.record_unit_open(p_unit uuid) returns boolean language plpgsql
security definer set search_path='' as $$
declare actor uuid:=auth.uid(); bid uuid;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and active is true)
    or not public.can_access_unit(p_unit) then raise exception 'Unit access denied' using errcode='42501'; end if;
  if not (select unit_opens_enabled from portal_audit.options where singleton) then return false; end if;
  select building_id into bid from public.units where id=p_unit;
  if bid is null then raise exception 'Unit access denied' using errcode='42501'; end if;
  -- Sliding five-minute window, serialized even for simultaneous tabs/retries.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_unit::text,0));
  if exists(select 1 from public.unit_open_events where created_by_user_id=actor and unit_id=p_unit
    and created_at>statement_timestamp()-interval '5 minutes') then return false; end if;
  insert into public.unit_open_events(created_by_user_id,unit_id,building_id) values(actor,p_unit,bid);
  return true;
end $$;
revoke all on function public.record_unit_open(uuid) from public,anon;
grant execute on function public.record_unit_open(uuid) to authenticated;

create function public.audit_unit_open_setting(p_enabled boolean default null) returns boolean language plpgsql
security definer set search_path='' as $$
declare enabled boolean;
begin
  if auth.uid() is null or not public.is_setup_admin() then raise exception 'Audit access denied' using errcode='42501'; end if;
  if p_enabled is not null then
    update portal_audit.options set unit_opens_enabled=p_enabled where singleton and unit_opens_enabled is distinct from p_enabled;
    if found then
      perform set_config('portal_audit.internal_write','true',true);
      insert into public.audit_events(event_type,entity_type,summary,metadata,created_by_user_id,category,source,outcome)
      values('unit_open_tracking_changed','audit_settings','Unit open tracking changed',jsonb_build_object('enabled',p_enabled),auth.uid(),'system','database','succeeded');
      perform set_config('portal_audit.internal_write','',true);
    end if;
  end if;
  select unit_opens_enabled into enabled from portal_audit.options where singleton; return enabled;
end $$;
revoke all on function public.audit_unit_open_setting(boolean) from public,anon;
grant execute on function public.audit_unit_open_setting(boolean) to authenticated;

create function portal_audit.purge_unit_opens() returns bigint language plpgsql
security definer set search_path='' as $$
declare removed bigint;
begin
  delete from public.unit_open_events where created_at < statement_timestamp()-interval '30 days';
  get diagnostics removed = row_count;
  delete from portal_audit.auth_events where created_at < statement_timestamp()-interval '90 days';
  return removed;
end $$;
create extension if not exists pg_cron with schema pg_catalog;
-- pg_cron is enabled by the staging migration process, not by a client.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('portal-unit-opens-retention','17 2 * * *','select portal_audit.purge_unit_opens()');
  else raise exception 'Enable pg_cron before applying unit-open retention'; end if;
end $$;

-- Query through a guarded projection rather than copying sale/snag/Auth logs.
create function public.portal_audit_page(p_filters jsonb default '{}',p_before_time timestamptz default null,
  p_before_id uuid default null,p_before_source text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; stream text:=coalesce(p_filters->>'stream','business');
begin
  if auth.uid() is null or not public.is_setup_admin() then raise exception 'Audit access denied' using errcode='42501'; end if;
  if stream not in ('business','authentication','views') then raise exception 'Invalid audit stream'; end if;
  with feed as (
    select e.id,e.created_at,e.created_by_user_id,e.event_type,e.entity_type,e.entity_id,e.summary,
      e.category,coalesce(e.building_id,case when e.source='database' and e.metadata->>'building_id' ~* '^[0-9a-f-]{36}$' then (e.metadata->>'building_id')::uuid end) as building_id,
      coalesce(e.unit_id,case when e.source='database' and e.metadata->>'unit_id' ~* '^[0-9a-f-]{36}$' then (e.metadata->>'unit_id')::uuid end) as unit_id,
      case when e.source='database' and e.metadata->>'sale_id' ~* '^[0-9a-f-]{36}$' then (e.metadata->>'sale_id')::uuid end as sale_id,null::uuid as snag_id,
      coalesce(e.outcome,'historical') outcome,e.source,
      case when e.source='database' then e.metadata else '{}'::jsonb end as metadata,e.actor_name,e.actor_role
    from public.audit_events e where stream='business'
    union all
    select e.id,e.created_at,e.created_by_user_id,e.event_type,'sale',e.sale_attempt_id,e.summary,'sales',
      e.building_id,e.unit_id,e.sale_attempt_id,null,'succeeded','sale_history',
      case when e.metadata->>'source'='database' then e.metadata else jsonb_strip_nulls(jsonb_build_object(
        'from_status',e.from_status,'to_status',e.to_status,'documentId',e.metadata->'documentId','versionId',e.metadata->'versionId',
        'paymentId',e.metadata->'paymentId','invoiceId',e.metadata->'invoiceId','amount',e.metadata->'amount','outcome',e.metadata->'outcome')) end,e.actor_name,e.actor_role
    from public.unit_sale_workflow_events e where stream='business'
    union all
    select e.id,e.created_at,e.created_by_user_id,e.event_type,'snag',e.snag_id,'Snag '||replace(e.event_type,'_',' '),'setup',
      s.building_id,s.unit_id,null,e.snag_id,case when e.audit_origin='database' then 'succeeded' else 'historical' end,'snag_history',
      case when e.audit_origin='database' then jsonb_build_object('changed_fields',array[e.event_type],'previous',jsonb_build_object(e.event_type,e.old_value),'next',jsonb_build_object(e.event_type,e.new_value)) else '{}'::jsonb end,e.actor_name,e.actor_role
    from public.snag_events e join public.snags s on s.id=e.snag_id where stream='business'
    union all
    select e.id,e.created_at,nullif(e.payload->>'actor_id','')::uuid,'auth_'||(e.payload->>'action'),'authentication',null,
      'Supabase Auth '||(e.payload->>'action'),'security',null,null,null,null,'provider_recorded','supabase_auth','{}'::jsonb,null,null
    from auth.audit_log_entries e where stream='authentication' and e.payload->>'action' in ('login','logout')
      and coalesce(e.payload->>'actor_id','') ~* '^[0-9a-f-]{36}$'
    union all
    select e.id,e.created_at,e.actor_id,'auth_'||e.action,'authentication',null,'Supabase Auth '||e.action,'security',
      null,null,null,null,'provider_recorded','supabase_auth_import','{}'::jsonb,null,null
    from portal_audit.auth_events e where stream='authentication' and e.created_at>=statement_timestamp()-interval '90 days' and not exists(select 1 from auth.audit_log_entries a where a.id=e.id)
    union all
    select e.id,e.created_at,e.created_by_user_id,'unit_opened','unit',e.unit_id,'Unit opened','system',e.building_id,e.unit_id,
      null,null,'observed','unit_views','{}'::jsonb,null,null from public.unit_open_events e where stream='views'
      and e.created_at>=statement_timestamp()-interval '30 days'
  ), page as (
    select * from feed f where
      (nullif(p_filters->>'actor','') is null or f.created_by_user_id=(p_filters->>'actor')::uuid)
      and (nullif(p_filters->>'building','') is null or f.building_id=(p_filters->>'building')::uuid)
      and (nullif(p_filters->>'unit','') is null or f.unit_id=(p_filters->>'unit')::uuid)
      and (nullif(p_filters->>'sale','') is null or f.sale_id=(p_filters->>'sale')::uuid)
      and (nullif(p_filters->>'snag','') is null or f.snag_id=(p_filters->>'snag')::uuid)
      and (nullif(p_filters->>'event','') is null or f.event_type=p_filters->>'event')
      and (nullif(p_filters->>'category','') is null or f.category=p_filters->>'category')
      and (nullif(p_filters->>'from','') is null or f.created_at>=(p_filters->>'from')::timestamptz)
      and (nullif(p_filters->>'to','') is null or f.created_at<(p_filters->>'to')::timestamptz)
      and (p_before_time is null or (f.created_at,f.id,coalesce(f.source,''))<(p_before_time,p_before_id,p_before_source))
    order by created_at desc,id desc,source desc limit 51
  ) select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id desc,source desc),'[]'::jsonb) into result from page;
  return result;
end $$;
revoke all on function public.portal_audit_page(jsonb,timestamptz,uuid,text) from public,anon;
grant execute on function public.portal_audit_page(jsonb,timestamptz,uuid,text) to authenticated;
revoke all on all functions in schema portal_audit from public,anon,authenticated;
grant usage on schema portal_audit to service_role;
grant execute on function portal_audit.actor() to service_role;
-- Trigger functions do not need client EXECUTE; cron runs as the migration owner.
