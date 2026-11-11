-- Reviewed empty-database application baseline. Supabase-managed Auth/Storage/extensions/roles required.
-- No migration replay, users, business records or spreadsheet data.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') THEN RAISE EXCEPTION 'Baseline requires an empty application schema'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Supabase prerequisites missing'; END IF;
END $$;
--
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: portal_audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA portal_audit;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: snag_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.snag_status AS ENUM (
    'Open',
    'Pending',
    'Resolved',
    'open',
    'resolved_by_contractor',
    'rejected_back_to_contractor',
    'closed',
    'submitted',
    'needs_more_info',
    'rejected',
    'accepted',
    'assigned_to_contractor',
    'in_progress',
    'resolved'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'user',
    'developer',
    'developer_representative',
    'contractor',
    'trade',
    'leaseholder',
    'agent',
    'resident',
    'sales_agent',
    'conveyancer'
);


--
-- Name: actor(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.actor() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
end $_$;


--
-- Name: business_change(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.business_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: payment_created(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.payment_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: purge_unit_opens(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.purge_unit_opens() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare removed bigint;
begin
  delete from public.unit_open_events where created_at < statement_timestamp()-interval '30 days';
  get diagnostics removed = row_count;
  delete from portal_audit.auth_events where created_at < statement_timestamp()-interval '90 days';
  return removed;
end $$;


--
-- Name: snag_changed(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.snag_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: snag_event_stamp(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.snag_event_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: stamp_general(); Type: FUNCTION; Schema: portal_audit; Owner: -
--

CREATE FUNCTION portal_audit.stamp_general() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare actor uuid := portal_audit.actor();
begin
  if actor is null and auth.jwt()->>'role'='service_role' then
    -- Existing service-only routes/RPCs derive this explicit actor after
    -- authentication. Do not erase their supplied actor during rollout.
    actor:=new.created_by_user_id;
  end if;
  new.created_by_user_id := actor;
  new.created_at := statement_timestamp();
  select organisation_id into new.actor_organisation_id from public.profiles where id=actor;
  select coalesce(nullif(full_name,''),nullif(name,'')),role::text into new.actor_name,new.actor_role from public.profiles where id=actor;
  if pg_trigger_depth()=1 and auth.jwt()->>'role'='authenticated' and coalesce(current_setting('portal_audit.internal_write',true),'')<>'true' then
    new.source := 'client_reported'; new.outcome := 'reported';
    select coalesce(jsonb_object_agg(key,value),'{}') into new.metadata
    from jsonb_each(new.metadata) where key in ('building_id','buildingId','unit_id','unitId','userId','action_id','source');
    if coalesce(new.field_name,'') ~* '(email|phone|password|token|buyer|notes|contact)' then
      new.previous_value:=null; new.new_value:=null;
    end if;
  end if;
  return new;
end $$;


--
-- Name: assert_commercial_unit_actor(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_commercial_unit_actor(p_actor_user_id uuid, p_allowed_roles text[]) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text;
  v_active boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Commercial unit changes must use an authorised server path.';
  end if;

  select profile.role::text, profile.active
  into v_role, v_active
  from public.profiles profile
  where profile.id = p_actor_user_id;

  if coalesce(v_active, false) is not true or not (coalesce(v_role, '') = any(p_allowed_roles)) then
    raise exception 'You do not have permission to change commercial unit allocation.';
  end if;

  return v_role;
end;
$$;


--
-- Name: assert_sale_discussion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_sale_discussion(p_sale uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.can_access_sale_attempt(p_sale) then
    raise exception 'Sale access denied. Check your building access and account status.' using errcode='42501';
  end if;
end $$;


--
-- Name: assert_tenancy_manager(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_tenancy_manager(p_actor_user_id uuid, p_admin_only boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text;
  v_active boolean;
begin
  select lower(trim(role)), active into v_role, v_active
  from public.profiles where id = p_actor_user_id;

  if coalesce(v_active, false) is not true
    or (p_admin_only and v_role <> 'admin')
    or (not p_admin_only and v_role not in ('admin', 'developer')) then
    raise exception 'You do not have permission to manage tenancies.';
  end if;
end;
$$;


--
-- Name: audit_unit_open_setting(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_unit_open_setting(p_enabled boolean DEFAULT NULL::boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: audit_unit_sale_invoice_payment_void(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_unit_sale_invoice_payment_void() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
  v_invoice public.unit_sale_invoices%rowtype;
  v_actor_label text;
  v_payer_label text;
begin
  if old.voided_at is null and new.voided_at is not null then
    select attempt.*
    into v_attempt
    from public.unit_sale_attempts attempt
    where attempt.id = new.sale_attempt_id;

    select invoice.*
    into v_invoice
    from public.unit_sale_invoices invoice
    where invoice.id = new.invoice_id;

    select coalesce(profile.full_name, profile.name, profile.email, 'an authorised user')
    into v_actor_label
    from public.profiles profile
    where profile.id = new.voided_by_user_id;

    v_actor_label := coalesce(v_actor_label, 'an authorised user');
    v_payer_label := case new.payer_type
      when 'developer' then 'Developer'
      when 'other' then 'Other'
      else 'Solicitor'
    end;

    insert into public.unit_sale_workflow_events (
      sale_attempt_id,
      building_id,
      unit_id,
      event_type,
      from_status,
      to_status,
      summary,
      metadata,
      created_by_user_id
    )
    values (
      v_attempt.id,
      v_attempt.building_id,
      v_attempt.unit_id,
      'agent_fee_payment_voided',
      v_attempt.workflow_status,
      v_attempt.workflow_status,
      format(
        'Agent payment voided. %s payment of £%s voided by %s. Reason: %s.',
        v_payer_label,
        to_char(new.amount, 'FM999999999990.00'),
        v_actor_label,
        new.void_reason
      ),
      jsonb_build_object(
        'invoiceId', new.invoice_id,
        'paymentId', new.id,
        'feeMilestone', v_invoice.fee_milestone,
        'payerType', new.payer_type,
        'amount', new.amount,
        'paymentDate', new.paid_at,
        'voidReason', new.void_reason,
        'voidedByUserId', new.voided_by_user_id
      ),
      new.voided_by_user_id
    );
  end if;

  return new;
end;
$$;


--
-- Name: building_allows_flat_handover(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_allows_flat_handover(target_building_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (
      select b.status <> 'archived'
        and b.pc_confirmed = true
        and b.pc_date is not null
        and b.pc_date <= current_date
      from public.buildings b
      where b.id = target_building_id
    ),
    false
  )
$$;


--
-- Name: building_allows_resident_routine_snags(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_allows_resident_routine_snags(target_building_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.building_derived_lifecycle_status(target_building_id) in ('dlp_active', 'dlp_closing')
$$;


--
-- Name: building_closing_notice_start(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_closing_notice_start(target_building_id uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when public.building_initial_defects_reporting_end(target_building_id) is not null
      then (public.building_initial_defects_reporting_end(target_building_id) - interval '2 months')::date
    else null
  end
$$;


--
-- Name: building_derived_lifecycle_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_derived_lifecycle_status(target_building_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (
      select case
        when b.status = 'archived' then 'archived'
        when b.pc_confirmed = false or b.pc_date is null or b.pc_date > current_date then 'pre_pc'
        when current_date >= (b.pc_date + interval '12 months')::date then 'post_dlp_readonly'
        when current_date >= ((b.pc_date + interval '12 months') - interval '2 months')::date then 'dlp_closing'
        else 'dlp_active'
      end
      from public.buildings b
      where b.id = target_building_id
    ),
    'pre_pc'
  )
$$;


--
-- Name: building_initial_defects_reporting_end(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_initial_defects_reporting_end(target_building_id uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when b.pc_confirmed = true and b.pc_date is not null and b.pc_date <= current_date
      then (b.pc_date + interval '12 months')::date
    else null
  end
  from public.buildings b
  where b.id = target_building_id
$$;


--
-- Name: can_access_building(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_building(target_building_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.is_setup_admin()
    or exists (
      select 1
      from public.user_building_access uba
      where uba.user_id = auth.uid()
        and uba.building_id = target_building_id
    )
    or exists (
      select 1
      from public.user_unit_access uua
      join public.units u on u.id = uua.unit_id
      where uua.user_id = auth.uid()
        and u.building_id = target_building_id
    )
    or exists (
      select 1
      from public.building_organisations bo
      where bo.building_id = target_building_id
        and bo.organisation_id = public.current_organisation_id()
        and coalesce(bo.active, true)
        and public.current_app_role() in ('developer_representative', 'contractor')
    ),
    false
  )
$$;


--
-- Name: can_access_sale(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_sale(p_sale_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(select 1 from public.unit_sale_attempts a where a.id=p_sale_id
    and public.sales_building_access(a.building_id,p_user_id))
$$;


--
-- Name: can_access_sale_attempt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_sale_attempt(target_sale_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.can_access_sale(target_sale_attempt_id,auth.uid())
$$;


--
-- Name: can_access_sales_building(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_sales_building(target_building_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.sales_building_access(target_building_id,auth.uid())
$$;


--
-- Name: can_access_snag(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_snag(target_snag_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    exists (
      select 1
      from public.snags s
      where s.id = target_snag_id
        and public.can_access_snag_row(s.source_type, s.building_id, s.unit_id, s.assigned_to_organisation_id, s.created_by_user_id)
    ),
    false
  )
$$;


--
-- Name: can_access_snag_row(text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_snag_row(target_source_type text, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.is_back_office_user()
    or target_created_by_user_id = auth.uid()
    or (
      public.current_app_role() = 'contractor'
      and public.current_organisation_id() is not null
      and target_assigned_organisation_id = public.current_organisation_id()
    )
    or (
      public.current_app_role() = 'resident'
      and target_source_type = 'leaseholder_defect'
      and target_unit_id is not null
      and public.can_access_unit(target_unit_id)
    ),
    false
  )
$$;


--
-- Name: can_access_snag_row(text, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_snag_row(target_source_type text, target_building_id uuid, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.is_setup_admin()
    or target_created_by_user_id = auth.uid()
    or (
      public.current_app_role() = 'developer_representative'
      and (
        (target_building_id is not null and public.can_access_building(target_building_id))
        or (target_unit_id is not null and public.can_access_unit(target_unit_id))
      )
    )
    or public.contractor_can_access_developer_snag(target_building_id, target_assigned_organisation_id)
    or (
      public.current_app_role() = 'resident'
      and target_source_type = 'leaseholder_defect'
      and target_unit_id is not null
      and public.can_access_unit(target_unit_id)
    ),
    false
  )
$$;


--
-- Name: can_access_unit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_unit(target_unit_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.is_setup_admin()
    or exists (
      select 1
      from public.user_unit_access uua
      where uua.user_id = auth.uid()
        and uua.unit_id = target_unit_id
    )
    or exists (
      select 1
      from public.units u
      join public.user_building_access uba on uba.building_id = u.building_id
      where u.id = target_unit_id
        and uba.user_id = auth.uid()
    ),
    false
  )
$$;


--
-- Name: can_discuss_sale(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_discuss_sale(p_sale uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.sale_discussion_access(p_sale,auth.uid())
$$;


--
-- Name: can_manage_sale_attempt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_sale_attempt(target_sale_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.is_sales_internal_user()
    and exists (
      select 1
      from public.unit_sale_attempts usa
      where usa.id = target_sale_attempt_id
    ),
    false
  )
$$;


--
-- Name: change_snag(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_snag(p_snag uuid, p_patch jsonb, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: complete_handover_unit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_handover_unit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  target_building_id uuid;
begin
  select u.building_id
  into target_building_id
  from public.units u
  where u.id = new.unit_id
    and u.sale_status = 'completed';

  if target_building_id is null then
    raise exception 'Handovers can only be created for completed units.';
  end if;

  if not public.building_allows_flat_handover(target_building_id) then
    raise exception 'Flat handover can only be completed once Practical Completion has been confirmed.';
  end if;

  perform set_config('app.handover_completion', 'on', true);

  update public.units
  set sale_status = 'handed_over',
      handover_date = new.handover_date,
      updated_at = now()
  where id = new.unit_id;

  return new;
end;
$$;


--
-- Name: contractor_can_access_developer_snag(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contractor_can_access_developer_snag(target_building_id uuid, target_assigned_organisation_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    public.current_app_role() = 'contractor'
    and public.current_organisation_id() is not null
    and target_building_id is not null
    and exists (
      select 1
      from public.building_organisations bo
      where bo.building_id = target_building_id
        and bo.organisation_id = public.current_organisation_id()
        and bo.role_on_project = 'main_contractor'
        and coalesce(bo.active, true)
    )
    and (
      target_assigned_organisation_id is null
      or target_assigned_organisation_id = public.current_organisation_id()
    ),
    false
  )
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: unit_tenancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_tenancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    tenant_name text NOT NULL,
    tenancy_start_date date NOT NULL,
    fixed_term_end_date date,
    tenancy_end_date date,
    monthly_rent numeric(12,2) NOT NULL,
    rent_due_day integer,
    deposit_amount numeric(12,2),
    letting_agent_organisation_id uuid,
    notes text,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_reference text,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unit_tenancies_actual_end_dates_check CHECK (((tenancy_end_date IS NULL) OR (tenancy_end_date >= tenancy_start_date))),
    CONSTRAINT unit_tenancies_deposit_amount_check CHECK ((deposit_amount >= (0)::numeric)),
    CONSTRAINT unit_tenancies_fixed_term_dates_check CHECK (((fixed_term_end_date IS NULL) OR (fixed_term_end_date >= tenancy_start_date))),
    CONSTRAINT unit_tenancies_monthly_rent_check CHECK ((monthly_rent >= (0)::numeric)),
    CONSTRAINT unit_tenancies_rent_due_day_check CHECK (((rent_due_day >= 1) AND (rent_due_day <= 31))),
    CONSTRAINT unit_tenancies_source_type_check CHECK ((source_type = ANY (ARRAY['manual'::text, 'spreadsheet_import'::text, 'document'::text, 'email'::text]))),
    CONSTRAINT unit_tenancies_tenant_name_check CHECK ((length(TRIM(BOTH FROM tenant_name)) > 0))
);


--
-- Name: create_unit_tenancy(uuid, uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_unit_tenancy(p_actor_user_id uuid, p_building_id uuid, p_unit_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) RETURNS public.unit_tenancies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_created public.unit_tenancies%rowtype;
begin
  perform public.assert_tenancy_manager(p_actor_user_id);
  v_unit := public.validate_tenancy_unit_eligibility(p_unit_id, p_tenancy_start_date, p_tenancy_end_date);
  if v_unit.building_id <> p_building_id then raise exception 'Unit does not belong to the selected building.'; end if;

  insert into public.unit_tenancies (
    building_id, unit_id, tenant_name, tenancy_start_date, fixed_term_end_date, tenancy_end_date,
    monthly_rent, rent_due_day, deposit_amount, letting_agent_organisation_id, notes,
    source_type, source_reference, created_by_user_id, updated_by_user_id
  ) values (
    p_building_id, p_unit_id, trim(p_tenant_name), p_tenancy_start_date, p_fixed_term_end_date, p_tenancy_end_date,
    p_monthly_rent, p_rent_due_day, p_deposit_amount, p_letting_agent_organisation_id, nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source_type), ''), 'manual'), nullif(trim(p_source_reference), ''), p_actor_user_id, p_actor_user_id
  ) returning * into v_created;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_created', 'unit_tenancy', v_created.id, format('Tenancy created for Unit %s.', v_unit.unit_number), jsonb_build_object('tenancy', to_jsonb(v_created)), p_actor_user_id);
  return v_created;
end;
$$;


--
-- Name: current_app_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role::text
  from public.profiles
  where id = auth.uid()
    and active is true
$$;


--
-- Name: current_organisation_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_organisation_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select organisation_id
  from public.profiles
  where id = auth.uid()
    and active is true
$$;


--
-- Name: delete_unit_tenancy(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old public.unit_tenancies%rowtype;
  v_unit_number text;
begin
  perform public.assert_tenancy_manager(p_actor_user_id, true);
  if nullif(trim(p_reason), '') is null then raise exception 'A deletion reason is required.'; end if;
  select * into v_old from public.unit_tenancies where id = p_tenancy_id for update;
  if v_old.id is null then raise exception 'Tenancy not found.'; end if;
  select unit_number into v_unit_number from public.units where id = v_old.unit_id;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_deleted', 'unit_tenancy', v_old.id, format('Erroneous tenancy deleted for Unit %s.', v_unit_number), jsonb_build_object('reason', trim(p_reason), 'deleted_tenancy', to_jsonb(v_old)), p_actor_user_id);
  delete from public.unit_tenancies where id = p_tenancy_id;
  return p_tenancy_id;
end;
$$;


--
-- Name: get_agent_fee_portfolio(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agent_fee_portfolio(p_requester_id uuid) RETURNS TABLE(sale_attempt_id uuid, building_id uuid, building_name text, unit_id uuid, unit_number text, unit_sale_status text, workflow_status text, sales_agent_organisation_id uuid, sales_agent_name text, contract_price numeric, exchange_fee_percent numeric, completion_fee_percent numeric, vat_rate numeric, exchange_invoice jsonb, completion_invoice jsonb, exchange_active_payments jsonb, completion_active_payments jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    select sale_terms.* from public.unit_sale_terms sale_terms
    where sale_terms.sale_attempt_id = attempt.id
    order by sale_terms.is_current desc, sale_terms.version_number desc limit 1
  ) terms on true
  left join lateral (
    select invoice.* from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'exchange' and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc limit 1
  ) exchange_invoice on true
  left join lateral (
    select invoice.* from public.unit_sale_invoices invoice
    where invoice.sale_attempt_id = attempt.id and invoice.invoice_type = 'sales_agent'
      and invoice.fee_milestone = 'completion' and invoice.status not in ('superseded', 'redacted')
    order by invoice.created_at desc limit 1
  ) completion_invoice on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = exchange_invoice.id and payment.payment_source <> 'reservation_fee' and payment.voided_at is null
  ) exchange_payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'payer_type', payment.payer_type,
      'payment_source', payment.payment_source,
      'amount', payment.amount,
      'voided_at', payment.voided_at
    ) order by payment.paid_at, payment.created_at) as payments
    from public.unit_sale_invoice_payments payment
    where payment.invoice_id = completion_invoice.id and payment.payment_source <> 'reservation_fee' and payment.voided_at is null
  ) completion_payments on true
  where (
    (
      attempt.is_active is true
      and attempt.workflow_status not in ('fallen_through', 'superseded')
      and unit.sale_status in ('for_sale', 'reserved', 'exchanged', 'completed', 'handed_over')
    )
    or exchange_invoice.id is not null
    or completion_invoice.id is not null
  )
    and (auth.role() = 'service_role' or public.can_access_sales_building(attempt.building_id))
  order by building.name, unit.unit_number, attempt.attempt_number;
end;
$$;


--
-- Name: get_unit_allocation_sale_workflows(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unit_allocation_sale_workflows(p_actor_user_id uuid) RETURNS TABLE(id uuid, unit_id uuid, workflow_status text, is_active boolean, blocks_allocation boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  return query
  select
    attempt.id,
    attempt.unit_id,
    attempt.workflow_status,
    attempt.is_active,
    public.sale_attempt_blocks_unit_allocation(attempt.id)
  from public.unit_sale_attempts attempt
  where attempt.is_active is true;
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    'user'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


--
-- Name: initialize_imported_unit_sale_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.initialize_imported_unit_sale_status(p_unit_id uuid, p_sale_status text, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Imported unit status initialization requires the service role.';
  end if;
  if p_sale_status not in ('not_released', 'not_for_sale', 'for_sale', 'reserved', 'exchanged', 'completed') then
    raise exception 'Unsupported imported unit sale status.';
  end if;
  if exists (select 1 from public.unit_sale_attempts attempt where attempt.unit_id = p_unit_id) then
    raise exception 'Imported status cannot overwrite a unit with sale history.';
  end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = p_sale_status, updated_at = now() where id = p_unit_id;
  if not found then raise exception 'Imported unit not found.'; end if;
end;
$$;


--
-- Name: is_back_office_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_back_office_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_setup_admin()
$$;


--
-- Name: is_operational_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_operational_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role() in ('admin', 'developer', 'developer_representative'), false)
$$;


--
-- Name: is_sales_external_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_sales_external_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role() in ('sales_agent', 'conveyancer'), false)
$$;


--
-- Name: is_sales_internal_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_sales_internal_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;


--
-- Name: is_setup_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_setup_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role() in ('admin', 'developer'), false)
$$;


--
-- Name: mark_sale_attempt_substantive(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_sale_attempt_substantive(p_sale_attempt_id uuid, p_actor_user_id uuid, p_event_type text, p_summary text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  select *
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id
    and attempt.is_active is true
  for update;

  if not found then
    raise exception 'Active sale attempt not found.';
  end if;

  update public.unit_sale_attempts
  set is_system_baseline = false,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = v_attempt.id;

  insert into public.unit_sale_workflow_events (
    sale_attempt_id,
    building_id,
    unit_id,
    event_type,
    from_status,
    to_status,
    summary,
    metadata,
    created_by_user_id
  ) values (
    v_attempt.id,
    v_attempt.building_id,
    v_attempt.unit_id,
    coalesce(nullif(trim(p_event_type), ''), 'commercial_model_saved'),
    v_attempt.workflow_status,
    v_attempt.workflow_status,
    coalesce(nullif(trim(p_summary), ''), 'Commercial sale model saved.'),
    jsonb_build_object('source', 'sales_workspace'),
    p_actor_user_id
  );
end;
$$;


--
-- Name: normalise_unit_sale_agent_fee_structure(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_unit_sale_agent_fee_structure() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare defaults record;
begin
  if tg_op = 'INSERT' and new.is_current and new.status = 'draft'
    and new.approved_at is null and new.approved_by_user_id is null
    and new.agent_fee_percent is null
    and coalesce(new.exchange_agent_fee_percent,0) = 0
    and coalesce(new.completion_agent_fee_percent,0) = 0 then
    select d.default_agent_fee_percent as total,
      d.default_exchange_agent_fee_percent as exchange,
      d.default_completion_agent_fee_percent as completion
    into defaults
    from public.unit_sale_attempts a
    join public.units u on u.id = a.unit_id
    join public.building_sale_defaults d on d.building_id = a.building_id
    where a.id = new.sale_attempt_id and a.is_active and a.is_system_baseline
      and a.workflow_status = 'draft'
      and u.sale_status in ('not_released','not_for_sale','for_sale')
      and a.reservation_date is null and a.reservation_submitted_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null
      and a.exchanged_at is null and a.completed_at is null and a.legal_completed_at is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,
        a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from public.unit_sale_documents doc where doc.sale_attempt_id=a.id
        and doc.document_type='reservation_form' and doc.redacted_at is null and doc.status<>'redacted')
      and not exists(select 1 from public.unit_sale_invoices invoice where invoice.sale_attempt_id=a.id)
      and not exists(select 1 from public.sale_legal_emails email where email.sale_attempt_id=a.id)
      and d.default_agent_fee_percent is not null
      and round(d.default_exchange_agent_fee_percent+d.default_completion_agent_fee_percent,4)
        = round(d.default_agent_fee_percent,4);
    if found then
      new.agent_fee_percent := defaults.total;
      new.exchange_agent_fee_percent := defaults.exchange;
      new.completion_agent_fee_percent := defaults.completion;
      return new;
    end if;
  end if;

  -- Preserve compatibility with legacy saves; the commercial-model wrapper
  -- subsequently writes the explicitly requested split.
  if new.exchange_agent_fee_percent is null or new.completion_agent_fee_percent is null then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent,0);
    new.completion_agent_fee_percent := 0;
  elsif tg_op = 'UPDATE'
    and new.agent_fee_percent is distinct from old.agent_fee_percent
    and new.exchange_agent_fee_percent is not distinct from old.exchange_agent_fee_percent
    and new.completion_agent_fee_percent is not distinct from old.completion_agent_fee_percent then
    new.exchange_agent_fee_percent := coalesce(new.agent_fee_percent,0);
    new.completion_agent_fee_percent := 0;
  end if;
  return new;
end;
$$;


--
-- Name: populate_audit_event_context(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_audit_event_context() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  candidate text;
begin
  if new.category is null then
    new.category := case
      when lower(new.event_type || ' ' || new.entity_type) ~ '(password|login|security|auth)' then 'security'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(report|digest)' then 'reports'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(tenan|rental|rent_)' then 'rentals'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(sale|reservation|exchange|completion|deal)' then 'sales'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(user|profile|access_request)' then 'users'
      when lower(new.event_type || ' ' || new.entity_type) ~ '(building|organisation|handover|trade|unit)' then 'setup'
      else 'system'
    end;
  end if;

  if new.actor_organisation_id is null and new.created_by_user_id is not null then
    select organisation_id into new.actor_organisation_id
    from public.profiles
    where id = new.created_by_user_id;
  end if;

  new.source := coalesce(new.source, nullif(new.metadata ->> 'source', ''));

  if new.building_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'building_id', ''), nullif(new.metadata ->> 'buildingId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.buildings where id = candidate::uuid) then
      new.building_id := candidate::uuid;
    elsif new.entity_type = 'building' and exists (select 1 from public.buildings where id = new.entity_id) then
      new.building_id := new.entity_id;
    end if;
  end if;

  if new.unit_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'unit_id', ''), nullif(new.metadata ->> 'unitId', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.units where id = candidate::uuid) then
      new.unit_id := candidate::uuid;
    elsif new.entity_type = 'unit' and exists (select 1 from public.units where id = new.entity_id) then
      new.unit_id := new.entity_id;
    end if;
  end if;

  if new.affected_user_id is null and new.entity_type in ('user', 'profile')
    and exists (select 1 from public.profiles where id = new.entity_id) then
    new.affected_user_id := new.entity_id;
  end if;

  if new.action_id is null then
    candidate := coalesce(nullif(new.metadata ->> 'action_id', ''), nullif(new.metadata ->> 'actionId', ''), nullif(new.metadata ->> 'batch_identifier', ''));
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      new.action_id := candidate::uuid;
    end if;
  end if;

  if new.field_name is null and new.metadata ? 'old_sale_status' and new.metadata ? 'new_sale_status' then
    new.field_name := 'sale_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_sale_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_sale_status');
  elsif new.field_name is null and new.metadata ? 'old_rental_portfolio_status' and new.metadata ? 'new_rental_portfolio_status' then
    new.field_name := 'rental_portfolio_status';
    new.previous_value := to_jsonb(new.metadata ->> 'old_rental_portfolio_status');
    new.new_value := to_jsonb(new.metadata ->> 'new_rental_portfolio_status');
  end if;

  return new;
end;
$_$;


--
-- Name: portal_audit_page(jsonb, timestamp with time zone, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_audit_page(p_filters jsonb DEFAULT '{}'::jsonb, p_before_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_before_source text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
end $_$;


--
-- Name: prepare_unit_baseline_sale_record(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_unit_baseline_sale_record(p_unit_id uuid, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  select *
  into v_unit
  from public.units unit
  where unit.id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit not found.';
  end if;
  if v_unit.sale_status not in ('not_released', 'not_for_sale', 'for_sale') then
    raise exception 'Unit % is controlled by the formal sales workflow.', v_unit.unit_number;
  end if;

  select *
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.unit_id = p_unit_id
    and attempt.is_active is true
  order by attempt.attempt_number desc
  limit 1
  for update;

  if found then
    if v_attempt.workflow_status <> 'draft'
       or public.sale_attempt_has_meaningful_activity(v_attempt.id) then
      raise exception 'Unit % already has sales preparation in progress.', v_unit.unit_number;
    end if;

    update public.unit_sale_attempts
    set is_system_baseline = true,
        updated_at = now()
    where id = v_attempt.id;

    return v_attempt.id;
  end if;

  perform set_config('app.unit_baseline_initialization', 'on', true);

  insert into public.unit_sale_attempts (
    building_id,
    unit_id,
    attempt_number,
    workflow_status,
    is_active,
    is_system_baseline,
    stage_entered_at,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_unit.building_id,
    v_unit.id,
    coalesce((
      select max(attempt.attempt_number) + 1
      from public.unit_sale_attempts attempt
      where attempt.unit_id = v_unit.id
    ), 1),
    'draft',
    true,
    true,
    now(),
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into v_attempt;

  return v_attempt.id;
end;
$$;


--
-- Name: prevent_direct_sale_baseline_marker_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_direct_sale_baseline_marker_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' and new.is_system_baseline is true then
    if tg_op = 'INSERT' then
      raise exception 'System sale baselines can only be managed through an authorised server path.';
    elsif old.is_system_baseline is distinct from new.is_system_baseline then
      raise exception 'System sale baselines can only be managed through an authorised server path.';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: prevent_direct_unit_commercial_status_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_direct_unit_commercial_status_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if (
    old.sale_status is distinct from new.sale_status
    or old.rental_portfolio_status is distinct from new.rental_portfolio_status
  )
  and coalesce(current_setting('app.unit_commercial_mutation', true), '') <> 'on'
  and coalesce(current_setting('app.handover_completion', true), '') <> 'on'
  then
    raise exception 'Sale and rental allocation can only be changed through a protected workflow.';
  end if;

  return new;
end;
$$;


--
-- Name: prevent_manual_handed_over_unit_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_manual_handed_over_unit_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.sale_status = 'handed_over'
    and (
      tg_op = 'INSERT'
      or old.sale_status is distinct from 'handed_over'
    )
    and coalesce(current_setting('app.handover_completion', true), '') <> 'on'
  then
    raise exception 'Handed Over can only be set by completing the handover workflow.';
  end if;

  return new;
end;
$$;


--
-- Name: prevent_rental_arrears_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_rental_arrears_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  raise exception 'Rental arrears events are append-only; record a new material event instead.';
end;
$$;


--
-- Name: protect_discussion_buyer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_discussion_buyer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (nullif(trim(old.buyer_name),'') is not null or nullif(trim(old.buyer_person_name),'') is not null or nullif(trim(old.buyer_company_name),'') is not null)
    and (old.buyer_name is distinct from new.buyer_name or old.buyer_person_name is distinct from new.buyer_person_name or old.buyer_company_name is distinct from new.buyer_company_name)
    and exists(select 1 from public.sale_comments where sale_attempt_id=old.id) then
    raise exception 'This sale has a conversation. For a replacement buyer, return the unit to For sale and start a new transaction.';
  end if;
  return new;
end $$;


--
-- Name: protect_unit_sale_invoice_payment_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_unit_sale_invoice_payment_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Historical agent fee payments cannot be deleted.';
  end if;

  if row(
    new.id,
    new.invoice_id,
    new.sale_attempt_id,
    new.payment_source,
    new.payer_type,
    new.amount,
    new.paid_at,
    new.paid_by_organisation_id,
    new.recorded_by_user_id,
    new.recorded_by_name,
    new.recorded_by_email,
    new.recorded_by_organisation_name,
    new.notes,
    new.client_reference,
    new.created_at
  ) is distinct from row(
    old.id,
    old.invoice_id,
    old.sale_attempt_id,
    old.payment_source,
    old.payer_type,
    old.amount,
    old.paid_at,
    old.paid_by_organisation_id,
    old.recorded_by_user_id,
    old.recorded_by_name,
    old.recorded_by_email,
    old.recorded_by_organisation_name,
    old.notes,
    old.client_reference,
    old.created_at
  ) then
    raise exception 'Historical agent fee payment details cannot be edited. Void and re-record the payment instead.';
  end if;

  if old.voided_at is not null and row(new.voided_at, new.voided_by_user_id, new.void_reason)
    is distinct from row(old.voided_at, old.voided_by_user_id, old.void_reason) then
    raise exception 'A voided agent fee payment cannot be changed.';
  end if;

  return new;
end;
$$;


--
-- Name: record_unit_open(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_unit_open(p_unit uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: record_unit_sale_invoice_payment(uuid, text, numeric, date, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid)
 RETURNS TABLE(payment_id uuid, created boolean, paid_amount numeric, outstanding_balance numeric, payment_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice public.unit_sale_invoices%rowtype;
  v_existing public.unit_sale_invoice_payments%rowtype;
  v_payment_id uuid;
  v_requester_role text;
  v_requester_active boolean;
  v_cash_payable numeric(14, 2);
  v_paid numeric(14, 2);
  v_outstanding numeric(14, 2);
  v_source text;
  v_is_duplicate boolean := false;
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot record this payment.';
  end if;

  select role, active
  into v_requester_role, v_requester_active
  from public.profiles
  where id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer', 'conveyancer') then
    raise exception 'Only developers, admins or conveyancers can record agent fee payments.';
  end if;

  if p_payer_type not in ('solicitor', 'developer', 'other') then
    raise exception 'Choose a valid payer.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'Enter a valid payment date that is not in the future.';
  end if;
  if p_client_reference is null then
    raise exception 'Payment reference is required.';
  end if;

  select *
  into v_invoice
  from public.unit_sale_invoices invoice
  where invoice.id = p_invoice_id
    and invoice.invoice_type = 'sales_agent'
  for update;

  if not found then
    raise exception 'Sales agent invoice not found.';
  end if;
  -- Match requesterBuildingIds in the sales API for the newly authorised role.
  if v_requester_role = 'conveyancer' and not exists (
    select 1 from public.unit_sale_attempts sale
    where sale.id = v_invoice.sale_attempt_id
      and (
        exists (select 1 from public.user_building_access access
          where access.user_id = p_requester_id and access.building_id = sale.building_id)
        or exists (select 1 from public.building_organisations appointment
          join public.profiles profile on profile.organisation_id = appointment.organisation_id
          where profile.id = p_requester_id and appointment.building_id = sale.building_id
            and appointment.role_on_project = 'conveyancer' and appointment.active <> false)
      )
  ) then
    raise exception 'You do not have sales access to this building.';
  end if;
  if v_invoice.approved_at is null
     and v_invoice.status not in ('approved', 'part_paid', 'paid', 'reconciled') then
    raise exception 'Approve the invoice before recording a payment.';
  end if;

  select *
  into v_existing
  from public.unit_sale_invoice_payments payment
  where payment.client_reference = p_client_reference;

  if found and v_existing.invoice_id <> v_invoice.id then
    raise exception 'Payment reference has already been used.';
  end if;
  v_is_duplicate := found;

  v_cash_payable := greatest(
    0,
    coalesce(
      v_invoice.expected_payable_amount,
      v_invoice.expected_gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      v_invoice.gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      0
    )
  );

  select coalesce(sum(payment.amount), 0)
  into v_paid
  from public.unit_sale_invoice_payments payment
  where payment.invoice_id = v_invoice.id
    and payment.payment_source <> 'reservation_fee'
    and payment.voided_at is null;

  if v_is_duplicate then
    v_payment_id := v_existing.id;
  else
    v_outstanding := greatest(0, v_cash_payable - v_paid);
    if p_amount > v_outstanding then
      raise exception 'Payment amount cannot exceed the outstanding balance of %.', to_char(v_outstanding, 'FM999999999990.00');
    end if;

    v_source := case p_payer_type
      when 'solicitor' then 'solicitor_deposit'
      when 'developer' then 'developer_shortfall'
      else 'other'
    end;

    insert into public.unit_sale_invoice_payments (
      invoice_id,
      sale_attempt_id,
      payment_source,
      payer_type,
      amount,
      paid_at,
      recorded_by_user_id,
      notes,
      client_reference
    )
    values (
      v_invoice.id,
      v_invoice.sale_attempt_id,
      v_source,
      p_payer_type,
      round(p_amount, 2),
      p_payment_date,
      p_requester_id,
      nullif(trim(coalesce(p_note, '')), ''),
      p_client_reference
    )
    returning id into v_payment_id;

    v_paid := v_paid + round(p_amount, 2);
  end if;

  v_outstanding := greatest(0, v_cash_payable - v_paid);
  payment_id := v_payment_id;
  created := not v_is_duplicate;
  paid_amount := v_paid;
  outstanding_balance := v_outstanding;
  payment_status := case
    when v_outstanding = 0 and v_cash_payable > 0 then 'paid'
    when v_paid > 0 then 'part_paid'
    else 'unpaid'
  end;
  return next;
end;
$function$;


--
-- Name: return_pre_exchange_unit_for_sale(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_pre_exchange_unit_for_sale(p_sale_attempt_id uuid, p_actor_user_id uuid, p_reason text, p_source text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_attempt public.unit_sale_attempts%rowtype;
  v_unit public.units%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_now timestamptz := now();
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if v_reason is null then
    raise exception 'Add a reason for returning the unit to For sale.';
  end if;

  select attempt.*
  into v_attempt
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'Sale attempt not found.';
  end if;
  if v_attempt.is_active is not true then
    raise exception 'Only an active sale attempt can return a unit to For sale.';
  end if;
  if v_attempt.workflow_status not in (
    'draft',
    'awaiting_approval',
    'reservation_submitted',
    'rejected',
    'reservation_query_raised',
    'approved',
    'reservation_approved',
    'awaiting_commercial_approval',
    'ready_for_exchange'
  ) then
    raise exception 'Only a sale attempt that has not exchanged can return the unit to For sale.';
  end if;

  select unit.*
  into v_unit
  from public.units unit
  where unit.id = v_attempt.unit_id
  for update;

  if v_unit.id is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_unit.sale_status not in ('for_sale', 'reserved') then
    raise exception 'Unit % cannot return to For sale from its current sales position.', v_unit.unit_number;
  end if;

  update public.unit_sale_attempts
  set
    buyer_email = null,
    buyer_phone = null,
    buyer_solicitor_name = null,
    buyer_solicitor_email = null,
    buyer_solicitor_phone = null,
    is_active = false,
    workflow_status = 'fallen_through',
    fall_through_reason = v_reason,
    fallen_through_at = v_now,
    stage_entered_at = v_now,
    redacted_at = v_now,
    redacted_by_user_id = p_actor_user_id,
    redaction_note = v_reason,
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where id = v_attempt.id;

  update public.unit_sale_terms
  set
    status = 'superseded',
    is_current = false,
    superseded_at = v_now,
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where sale_attempt_id = v_attempt.id
    and is_current is true;

  update public.unit_sale_invoices
  set
    status = 'redacted',
    updated_by_user_id = p_actor_user_id,
    updated_at = v_now
  where sale_attempt_id = v_attempt.id;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units
  set
    sale_status = 'for_sale',
    reservation_date = null,
    updated_at = v_now
  where id = v_unit.id;

  insert into public.unit_sale_workflow_events (
    sale_attempt_id,
    building_id,
    unit_id,
    event_type,
    from_status,
    to_status,
    summary,
    metadata,
    created_by_user_id
  ) values (
    v_attempt.id,
    v_attempt.building_id,
    v_attempt.unit_id,
    'unit_returned_to_for_sale',
    v_attempt.workflow_status,
    'fallen_through',
    format('Unit %s returned to For sale. Buyer contact details cleared; reservation record retained.', v_unit.unit_number),
    jsonb_build_object('reason', v_reason, 'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow')),
    p_actor_user_id
  );

  insert into public.audit_events (
    event_type,
    entity_type,
    entity_id,
    summary,
    metadata,
    created_by_user_id
  ) values (
    'unit_returned_to_for_sale',
    'unit',
    v_unit.id,
    format('Unit %s returned to For sale from %s.', v_unit.unit_number, v_attempt.workflow_status),
    jsonb_build_object(
      'building_id', v_unit.building_id,
      'unit_id', v_unit.id,
      'unit_number', v_unit.unit_number,
      'sale_attempt_id', v_attempt.id,
      'old_sale_status', v_unit.sale_status,
      'new_sale_status', 'for_sale',
      'old_workflow_status', v_attempt.workflow_status,
      'new_workflow_status', 'fallen_through',
      'reason', v_reason,
      'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow')
    ),
    p_actor_user_id
  );

  return v_unit.id;
end;
$$;


--
-- Name: sale_activity_page(uuid, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_activity_page(p_sale uuid, p_before_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into result from (
    select e.id,e.created_at,public.sale_event_projection(e) item from public.unit_sale_workflow_events e
    where e.sale_attempt_id=p_sale and (p_before_time is null or (e.created_at,e.id)<(p_before_time,p_before_id))
      and public.sale_event_projection(e) is not null
    order by e.created_at desc,e.id desc limit 51
  ) q;
  return result;
end $$;


--
-- Name: sale_actor_names(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_actor_names(p_sales uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;
  with accessible as materialized (
    select a.* from public.unit_sale_attempts a
    where a.id=any(p_sales) and public.can_access_sale_attempt(a.id)
  ), visible_documents as materialized (
    select d.* from public.unit_sale_documents d join accessible a on a.id=d.sale_attempt_id
    where d.visibility='shared_sale_file' or public.is_sales_internal_user() or d.visibility=public.current_app_role()
  ), actors(actor_id) as (
    select unnest(array[a.created_by_user_id,a.updated_by_user_id,a.reservation_submitted_by_user_id,
      a.reservation_approved_by_user_id,a.reservation_rejected_by_user_id,a.commercial_approved_by_user_id,a.redacted_by_user_id])
      from accessible a
    union
    select e.created_by_user_id from public.unit_sale_workflow_events e join accessible a on a.id=e.sale_attempt_id
      where public.sale_event_projection(e) is not null
    union
    select unnest(array[d.created_by_user_id,d.updated_by_user_id,d.approved_by_user_id,d.redacted_by_user_id]) from visible_documents d
    union
    select unnest(array[v.uploaded_by_user_id,v.redacted_by_user_id]) from public.unit_sale_document_versions v
      join visible_documents d on d.id=v.document_id
    union
    select c.author_id from public.sale_comments c join accessible a on a.id=c.sale_attempt_id
    union
    select unnest(array[i.created_by_user_id,i.updated_by_user_id,i.approved_by_user_id])
      from public.unit_sale_invoices i join accessible a on a.id=i.sale_attempt_id
    union
    select unnest(array[p.recorded_by_user_id,p.voided_by_user_id])
      from public.unit_sale_invoice_payments p join accessible a on a.id=p.sale_attempt_id
    union
    select unnest(array[n.created_by_user_id,n.redacted_by_user_id])
      from public.unit_sale_notes n join accessible a on a.id=n.sale_attempt_id
      where n.visibility='shared_sale_file' or public.is_sales_internal_user() or n.visibility=public.current_app_role()
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,
    'display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.name),''),'Unknown user')) order by p.id),'[]'::jsonb)
    into result from public.profiles p join actors a on a.actor_id=p.id;
  return result;
end $$;


--
-- Name: sale_attempt_blocks_unit_allocation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_attempt_blocks_unit_allocation(p_sale_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select case
      when attempt.is_active is not true then false
      when attempt.workflow_status in ('fallen_through', 'superseded') then false
      when attempt.workflow_status <> 'draft' then true
      else attempt.is_system_baseline is not true
        or public.sale_attempt_has_meaningful_activity(attempt.id)
    end
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$$;


--
-- Name: sale_attempt_has_meaningful_activity(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(select 1 from public.sale_comments where sale_attempt_id=p_sale_attempt_id)
    or public.sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id)
$$;


--
-- Name: sale_attempt_has_meaningful_activity_before_discussions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select
      attempt.workflow_status <> 'draft'
      or nullif(trim(coalesce(attempt.buyer_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_person_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_company_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_phone, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_name, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_email, '')), '') is not null
      or nullif(trim(coalesce(attempt.buyer_solicitor_phone, '')), '') is not null
      or attempt.sales_agent_organisation_id is not null
      or attempt.conveyancer_organisation_id is not null
      or attempt.reservation_date is not null
      or attempt.reservation_terms_checked is true
      or attempt.reservation_submitted_at is not null
      or attempt.reservation_approved_at is not null
      or attempt.commercial_approved_at is not null
      or attempt.exchanged_at is not null
      or attempt.completed_at is not null
      or exists (
        select 1
        from public.unit_sale_terms terms
        where terms.sale_attempt_id = attempt.id
          and (
            terms.status <> 'draft'
            or terms.approved_by_user_id is not null
            or terms.approved_at is not null
            or nullif(trim(coalesce(terms.commercial_summary, '')), '') is not null
            or nullif(trim(coalesce(terms.parking_location_details, '')), '') is not null
            or cardinality(coalesce(terms.additional_special_conditions, '{}'::text[])) > 0
            or coalesce(terms.developer_contribution_value, terms.developer_contribution, 0) <> 0
            or coalesce(terms.agent_contribution_value, terms.agent_contribution, 0) <> 0
            or coalesce(terms.parking_contribution_value, 0) <> 0
            or coalesce(terms.other_concessions, 0) <> 0
            or (
              terms.list_price_at_offer is not null
              and terms.contract_price is distinct from terms.list_price_at_offer
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_payment_schedule schedule
        where schedule.sale_attempt_id = attempt.id
          and (
            schedule.status <> 'pending'
            or nullif(trim(coalesce(schedule.notes, '')), '') is not null
          )
      )
      or exists (
        select 1
        from public.unit_sale_documents document
        where document.sale_attempt_id = attempt.id
          and (
            document.status <> 'not_uploaded'
            or document.approved_by_user_id is not null
            or nullif(trim(coalesce(document.query_note, '')), '') is not null
            or exists (
              select 1
              from public.unit_sale_document_versions version
              where version.document_id = document.id
            )
          )
      )
      or exists (
        select 1
        from public.unit_sale_invoices invoice
        where invoice.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_invoice_payments payment
        where payment.sale_attempt_id = attempt.id
      )
      or exists (
        select 1
        from public.unit_sale_notes note
        where note.sale_attempt_id = attempt.id
          and note.category <> 'system'
      )
      or exists (
        select 1
        from public.unit_sale_workflow_events event
        where event.sale_attempt_id = attempt.id
          and (event.event_type <> 'sale_record_changed'
            or event.metadata->>'source' is distinct from 'database')
      )
    from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id
  ), false)
$function$;


--
-- Name: sale_comment_history(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_comment_history(p_sale uuid, p_comment uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  if not exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and id=p_comment) then raise exception 'Comment unavailable on this sale.'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by version desc),'[]') into result from public.sale_comment_revisions r where sale_attempt_id=p_sale and comment_id=p_comment;
  return result;
end $$;


--
-- Name: sale_comment_page(uuid, bigint, bigint, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_comment_page(p_sale uuid, p_before bigint DEFAULT NULL::bigint, p_after bigint DEFAULT NULL::bigint, p_target uuid DEFAULT NULL::uuid, p_unit uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare start_at bigint; result jsonb; low_seq bigint; high_seq bigint;
begin
  perform public.assert_sale_discussion(p_sale);
  if p_unit is not null and not exists(select 1 from public.unit_sale_attempts where id=p_sale and unit_id=p_unit) then raise exception 'This conversation does not belong to the selected unit.'; end if;
  if p_before is not null and p_after is not null then raise exception 'Choose one cursor.'; end if;
  if p_target is not null then
    select sequence into start_at from public.sale_comments where id=p_target and sale_attempt_id=p_sale;
    if start_at is null then raise exception 'Comment unavailable on this sale.'; end if;
    start_at:=greatest(1,start_at-5);
  elsif p_before is null and p_after is null then
    select min(c.sequence) into start_at from public.sale_comments c where c.sale_attempt_id=p_sale and c.author_id<>auth.uid()
      and not exists(select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid());
    if start_at is not null then start_at:=greatest(1,start_at-5); end if;
  end if;
  with page as (
    select c.* from public.sale_comments c where c.sale_attempt_id=p_sale
      and (p_before is null or c.sequence<p_before) and (p_after is null or c.sequence>p_after)
      and (start_at is null or c.sequence>=start_at)
    order by case when p_after is not null or start_at is not null then c.sequence end asc, c.sequence desc limit 50
  ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('unread',c.author_id<>auth.uid() and not exists(
      select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid())) order by c.sequence),'[]'),min(c.sequence),max(c.sequence)
    into result,low_seq,high_seq from page c;
  return jsonb_build_object('comments',result,'hasBefore',exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and sequence<low_seq),
    'hasAfter',exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and sequence>high_seq));
end $$;


--
-- Name: sale_comment_read(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_comment_read(p_sale uuid, p_comments uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n bigint;
begin
  perform public.assert_sale_discussion(p_sale);
  if cardinality(p_comments)>100 then raise exception 'Too many read receipts.'; end if;
  if exists(select 1 from unnest(p_comments) x where not exists(select 1 from public.sale_comments where id=x and sale_attempt_id=p_sale)) then raise exception 'Invalid comment receipt.'; end if;
  insert into public.sale_comment_receipts(sale_attempt_id,comment_id,user_id) select p_sale,x,auth.uid() from unnest(p_comments) x on conflict do nothing;
  select max(sequence) into n from public.sale_comments where sale_attempt_id=p_sale and id=any(p_comments);
  if n is not null then
    insert into public.sale_comment_read_state values(p_sale,auth.uid(),n) on conflict(sale_attempt_id,user_id)
      do update set last_presented_sequence=greatest(sale_comment_read_state.last_presented_sequence,excluded.last_presented_sequence);
  end if;
  update public.sale_mention_notifications set seen_at=coalesce(seen_at,now()) where recipient_id=auth.uid() and sale_attempt_id=p_sale and comment_id=any(p_comments);
end $$;


--
-- Name: sale_comment_unread(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_comment_unread(p_sales uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;
  select coalesce(jsonb_object_agg(s.id,(select count(*) from public.sale_comments c where c.sale_attempt_id=s.id and c.author_id<>auth.uid()
    and not exists(select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid()))),'{}') into result
    from (select distinct unnest(p_sales) id) s where public.sale_discussion_access(s.id,auth.uid());
  return result;
end $$;


--
-- Name: sale_comment_write(uuid, text, uuid, uuid, text, uuid[], uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_mentions uuid[] DEFAULT '{}'::uuid[], p_comment uuid DEFAULT NULL::uuid, p_version integer DEFAULT NULL::integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare old_comment public.sale_comments%rowtype; new_id uuid; n bigint; actor public.profiles%rowtype; org text;
begin
  -- Serialise per transaction so sequence order also follows commit order.
  perform 1 from public.unit_sale_attempts where id=p_sale for update;
  perform public.assert_sale_discussion(p_sale);
  if p_body is null or p_body !~ '[^[:space:]]' or length(p_body)>5000 or p_client is null then raise exception 'Write an update of 1–5,000 characters.'; end if;
  if p_stage is not null and p_stage not in ('reservation','exchange','completion','handover') then raise exception 'Invalid stage.'; end if;
  if cardinality(p_mentions)>25 or exists(select 1 from unnest(p_mentions) x where not public.sale_discussion_access(p_sale,x)) then
    raise exception 'A mentioned person no longer has access. Remove the mention and retry.' using errcode='42501';
  end if;
  if p_parent is not null and not exists(select 1 from public.sale_comments where id=p_parent and sale_attempt_id=p_sale) then raise exception 'Reply must refer to a comment on this sale.'; end if;
  select * into actor from public.profiles where id=auth.uid();
  select name into org from public.organisations where id=actor.organisation_id;
  if p_comment is null then
    select * into old_comment from public.sale_comments where sale_attempt_id=p_sale and author_id=auth.uid() and client_id=p_client;
    if old_comment.id is not null then
      if old_comment.body is distinct from p_body or old_comment.mention_ids is distinct from coalesce(p_mentions,'{}')
        or old_comment.parent_id is distinct from p_parent or old_comment.stage is distinct from p_stage then
        raise exception 'The earlier update was already sent. Your revised text can be sent as a new update.';
      end if;
      return old_comment.id;
    end if;
    update public.unit_sale_attempts set comment_sequence=comment_sequence+1,is_system_baseline=false where id=p_sale returning comment_sequence into n;
    insert into public.sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,author_organisation,body,stage,parent_id,mention_ids,client_id)
      values(p_sale,n,auth.uid(),coalesce(nullif(actor.full_name,''),nullif(actor.name,''),'Sale participant'),actor.role,org,p_body,p_stage,p_parent,coalesce(p_mentions,'{}'),p_client) returning id into new_id;
  else
    select * into old_comment from public.sale_comments where id=p_comment and sale_attempt_id=p_sale for update;
    if old_comment.id is null or old_comment.author_id<>auth.uid() then raise exception 'Only the author can edit this comment.' using errcode='42501'; end if;
    if old_comment.body=p_body and old_comment.mention_ids=coalesce(p_mentions,'{}') then return p_comment; end if;
    if p_version is distinct from old_comment.version then raise exception 'This comment changed on another device. Reload its history before editing.'; end if;
    insert into public.sale_comment_revisions(sale_attempt_id,comment_id,version,body,mention_ids,recorded_at)
      values(p_sale,p_comment,old_comment.version,old_comment.body,old_comment.mention_ids,coalesce(old_comment.edited_at,old_comment.created_at));
    update public.sale_comments set body=p_body,mention_ids=coalesce(p_mentions,'{}'),edited_at=clock_timestamp(),version=version+1 where id=p_comment;
    new_id:=p_comment;
  end if;
  insert into public.sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
    select p_sale,new_id,x from unnest(coalesce(p_mentions,'{}')) x where x<>auth.uid() on conflict(comment_id,recipient_id) do nothing;
  return new_id;
end $$;


--
-- Name: sale_discussion_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_discussion_access(p_sale uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.can_access_sale(p_sale,p_user)
$$;


--
-- Name: sale_discussion_candidate(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_discussion_candidate(p_sale uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.can_access_sale(p_sale,p_user)
$$;


--
-- Name: sale_discussion_people(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_discussion_people(p_sale uuid, p_candidates boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,
    'name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.name),''),'Unknown user'),
    'role',p.role,'organisation',o.name) order by p.full_name,p.id),'[]'::jsonb) into result
  from public.profiles p left join public.organisations o on o.id=p.organisation_id
  where public.can_access_sale(p_sale,p.id);
  return result;
end $$;


--
-- Name: sale_discussion_start(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_discussion_start(p_unit uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a uuid; u public.units%rowtype; next_number integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active is true and role in ('admin','developer','sales_agent')) then
    raise exception 'You cannot start a sale discussion.' using errcode='42501';
  end if;
  select * into u from public.units where id=p_unit for update;
  if u.id is null or not public.can_access_sales_building(u.building_id) then raise exception 'Unit access denied.' using errcode='42501'; end if;
  select id into a from public.unit_sale_attempts where unit_id=p_unit and is_active;
  if a is not null then perform public.assert_sale_discussion(a); return a; end if;
  if u.sale_status <> 'for_sale' then raise exception 'This unit is not available for a new sale.'; end if;
  select coalesce(max(attempt_number),0)+1 into next_number from public.unit_sale_attempts where unit_id=p_unit;
  insert into public.unit_sale_attempts(building_id,unit_id,attempt_number,workflow_status,is_active,created_by_user_id,updated_by_user_id,is_system_baseline)
    values(u.building_id,u.id,next_number,'draft',true,auth.uid(),auth.uid(),false) returning id into a;
  return a;
end $$;


--
-- Name: sale_document_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_document_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d public.unit_sale_documents%rowtype; v public.unit_sale_document_versions%rowtype; a public.unit_sale_attempts%rowtype; kind text; title text; actor uuid;
begin
  -- Package operations emit precise per-file events and one atomic approval event.
  if coalesce(current_setting('app.completion_package_write',true),'')='on' then
    if tg_table_name='unit_sale_document_versions' then
      if exists(select 1 from unit_sale_documents where id=new.document_id and document_type in ('completion_statement','draft_statement_of_account')) then return new; end if;
    elsif new.document_type in ('completion_statement','draft_statement_of_account') then return new;
    end if;
  end if;
  if tg_table_name='unit_sale_document_versions' then
    v:=new;
    select * into d from public.unit_sale_documents where id=v.document_id;
    kind:=case when v.version_number>1 then 'replaced' else 'uploaded' end;
    actor:=v.uploaded_by_user_id;
  else
    d:=new;
    if d.document_type not in ('completion_statement','statement_of_account') or old.status is not distinct from new.status or new.status not in ('approved','query_raised') then return new; end if;
    select * into v from public.unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null;
    kind:=case when new.status='approved' then 'approved' else 'rejected' end;
    actor:=new.updated_by_user_id;
  end if;
  select * into a from public.unit_sale_attempts where id=d.sale_attempt_id;
  title:=case d.document_type when 'completion_statement' then 'Completion statement' when 'statement_of_account' then 'Statement of account'
    when 'reservation_form' then 'Reservation form' when 'agent_invoice' then d.title else d.title end;
  insert into public.unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
    values(a.id,a.building_id,a.unit_id,
      case kind when 'approved' then 'completion_documents_approved' when 'rejected' then 'completion_documents_query_raised' else d.document_type||'_'||kind end,
      a.workflow_status,case when kind='approved' then 'completion_pending' else a.workflow_status end,title||' '||kind,
      jsonb_strip_nulls(jsonb_build_object('documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name,
        'versionNumber',v.version_number,'feeMilestone',d.fee_milestone,'queryNote',case when kind='rejected' then d.query_note end,'outcome',kind)),actor);
  return new;
end $$;


--
-- Name: sale_event_actor_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_actor_snapshot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.role()='authenticated' then new.created_by_user_id:=auth.uid(); end if;
  select coalesce(nullif(p.full_name,''),nullif(p.name,'')),p.role,o.name into new.actor_name,new.actor_role,new.actor_organisation
    from public.profiles p left join public.organisations o on o.id=p.organisation_id where p.id=new.created_by_user_id;
  return new;
end $$;


--
-- Name: unit_sale_workflow_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_workflow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_name text,
    actor_role text,
    actor_organisation text
);


--
-- Name: sale_event_projection(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if e.event_type like 'further_deposit_%' then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_further_deposit(e);
end $$;


--
-- Name: sale_event_projection_before_deposit(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection_before_deposit(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if e.event_type in ('authority_notice_requested','authority_notice_given','completion_arrangements_dates_corrected') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_notice(e);
end $$;


--
-- Name: sale_event_projection_before_further_deposit(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection_before_further_deposit(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if e.metadata->>'packageWorkflow'='true' and e.event_type like 'completion_%' then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata,'version_id',e.metadata->>'versionId');
  end if;
  return public.sale_event_projection_before_package(e);
end $$;


--
-- Name: sale_event_projection_before_legal(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection_before_legal(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare m jsonb:=coalesce(e.metadata,'{}'); safe jsonb; vid uuid; legacy_actor text; shared boolean; document_kind text; safe_summary text;
begin
  shared:=e.event_type ~ '^(reservation_(submitted|approved|rejected|query_raised|form_uploaded|form_replaced)|exchange_recorded|completion_recorded|completion_documents_(approved|query_raised)|completion_statement_(uploaded|replaced|approved|rejected)|statement_of_account_(uploaded|replaced|approved|rejected)|unit_returned_to_for_sale)$';
  if not public.is_sales_internal_user() and not shared then return null; end if;
  if not public.is_sales_internal_user() and coalesce(m->>'documentId','') ~* '^[0-9a-f-]{36}$' and exists(
    select 1 from public.unit_sale_documents d where d.id=(m->>'documentId')::uuid and (d.sale_attempt_id<>e.sale_attempt_id
      or d.visibility not in ('shared_sale_file',public.current_app_role()))) then return null; end if;
  document_kind:=coalesce(m->>'documentType',m->>'completionDocumentType',m->>'document_type');
  if document_kind is null and coalesce(m->>'documentId','') ~* '^[0-9a-f-]{36}$' then
    select document_type into document_kind from public.unit_sale_documents where id=(m->>'documentId')::uuid and sale_attempt_id=e.sale_attempt_id;
  end if;
  safe:=jsonb_strip_nulls(jsonb_build_object('documentType',document_kind,'fileName',m->'fileName','versionNumber',m->'versionNumber',
    'queryNote',m->'queryNote','rejectionReason',m->'rejectionReason','exchangeDate',m->'exchangeDate','completionDate',m->'completionDate','outcome',m->'outcome'));
  -- A legacy document ID alone is insufficient to identify a historical file.
  if coalesce(m->>'versionId','') ~* '^[0-9a-f-]{36}$' then
    select v.id into vid from public.unit_sale_document_versions v join public.unit_sale_documents d on d.id=v.document_id
    where v.id=(m->>'versionId')::uuid and d.sale_attempt_id=e.sale_attempt_id and d.redacted_at is null and v.redacted_at is null
      and (public.is_sales_internal_user() or d.visibility='shared_sale_file'
        or d.visibility=public.current_app_role());
  end if;
  -- A historical name explicitly stored on the event is reliable; the user's
  -- current organisation is not a historical snapshot.
  legacy_actor:=coalesce(m->>'actorName',m->>'actor_name',m->>'recordedByName');
  if legacy_actor is null and e.actor_name is null then
    select coalesce(nullif(full_name,''),nullif(name,'')) into legacy_actor from public.profiles where id=e.created_by_user_id;
  end if;
  -- Free-form summaries can contain internal values. External views only use
  -- known safe historical wording or a title derived from a shared event type.
  safe_summary:=case when public.is_sales_internal_user() then e.summary
    when e.summary in ('Completion statement and statement of account approved.','Completion document query raised.') then e.summary
    when e.event_type='completion_recorded' then 'Sale completed'
    else upper(left(replace(e.event_type,'_',' '),1))||substring(replace(e.event_type,'_',' ') from 2) end;
  return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,
    'created_by_user_id',e.created_by_user_id,'from_status',e.from_status,'to_status',e.to_status,
    'summary',safe_summary,
    'actor_name',coalesce(e.actor_name,legacy_actor),'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,
    'metadata',safe,'version_id',vid);
end $_$;


--
-- Name: sale_event_projection_before_notice(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection_before_notice(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if e.event_type in ('authority_requested','authority_issued','authority_reissued','authority_expired','authority_revoked','completion_instruction_sent','completion_instruction_cancelled','completion_arrangements_confirmed','legal_email_prepared','legal_email_delivery','completion_correspondence_uploaded','completion_correspondence_replaced') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',case when e.event_type='authority_expired' then 'System' else e.actor_name end,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_legal(e);
end $$;


--
-- Name: sale_event_projection_before_package(public.unit_sale_workflow_events); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_event_projection_before_package(e public.unit_sale_workflow_events) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if e.event_type in ('exchange_deposit_received','exchange_deposit_date_corrected') then
    return jsonb_build_object('id',e.id,'sale_attempt_id',e.sale_attempt_id,'event_type',e.event_type,'created_at',e.created_at,'created_by_user_id',e.created_by_user_id,
      'from_status',e.from_status,'to_status',e.to_status,'summary',e.summary,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_organisation',e.actor_organisation,'metadata',e.metadata);
  end if;
  return public.sale_event_projection_before_deposit(e);
end $$;


--
-- Name: sale_mentions_inbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_mentions_inbox() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]') from (
    select m.id,m.comment_id,m.sale_attempt_id,m.created_at,a.unit_id,a.building_id,u.unit_number,b.name building_name,c.author_name
    from public.sale_mention_notifications m join public.sale_comments c on c.id=m.comment_id
    join public.unit_sale_attempts a on a.id=m.sale_attempt_id join public.units u on u.id=a.unit_id join public.buildings b on b.id=a.building_id
    where m.recipient_id=auth.uid() and m.seen_at is null and public.sale_discussion_access(m.sale_attempt_id,auth.uid())
      and auth.uid()=any(c.mention_ids)
    order by m.created_at desc,m.id desc limit 50
  ) n
$$;


--
-- Name: sale_workflow_context(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_workflow_context(p_sales uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;

  with requested_sale_ids as materialized (
    select distinct e.sale_attempt_id
    from public.unit_sale_workflow_events e
    where e.sale_attempt_id=any(p_sales)
  ), accessible as materialized (
    select r.sale_attempt_id
    from requested_sale_ids r
    where public.can_access_sale_attempt(r.sale_attempt_id)
  ), projected as materialized (
    select e.sale_attempt_id,e.event_type,e.id,e.created_at,
      public.sale_event_projection(e) as item
    from public.unit_sale_workflow_events e
    join accessible a on a.sale_attempt_id=e.sale_attempt_id
  )
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]')
    into result
  from (
    -- Select the latest VISIBLE event, not the latest raw event. A newer
    -- hidden document event must not hide an older visible event of its type.
    select distinct on (sale_attempt_id,event_type) id,created_at,item
    from projected
    where item is not null
    order by sale_attempt_id,event_type,created_at desc,id desc
  ) q;
  return result;
end $$;


--
-- Name: building_sale_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_sale_defaults (
    building_id uuid NOT NULL,
    reservation_fee numeric(14,2),
    reservation_fee_holder_default text DEFAULT 'sales_agent'::text NOT NULL,
    exchange_deposit_percent numeric(7,4),
    default_agent_fee_percent numeric(7,4),
    default_vat_rate numeric(7,4) DEFAULT 20 NOT NULL,
    default_sales_solicitor_fee numeric(14,2),
    sales_agent_organisation_id uuid,
    conveyancer_organisation_id uuid,
    notes text,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    build_cost numeric(14,2),
    second_deposit_enabled boolean DEFAULT false NOT NULL,
    second_deposit_percent numeric(7,4),
    second_deposit_months_after_exchange integer,
    default_exchange_agent_fee_percent numeric(7,4),
    default_completion_agent_fee_percent numeric(7,4),
    further_deposit_timing jsonb,
    CONSTRAINT building_sale_defaults_agent_fee_check CHECK (((default_agent_fee_percent IS NULL) OR ((default_agent_fee_percent >= (0)::numeric) AND (default_agent_fee_percent <= (100)::numeric)))),
    CONSTRAINT building_sale_defaults_agent_fee_structure_check CHECK ((((default_agent_fee_percent IS NULL) AND (default_exchange_agent_fee_percent = (0)::numeric) AND (default_completion_agent_fee_percent = (0)::numeric)) OR (((default_agent_fee_percent >= (0)::numeric) AND (default_agent_fee_percent <= (100)::numeric)) AND ((default_exchange_agent_fee_percent >= (0)::numeric) AND (default_exchange_agent_fee_percent <= (100)::numeric)) AND ((default_completion_agent_fee_percent >= (0)::numeric) AND (default_completion_agent_fee_percent <= (100)::numeric)) AND (round((default_exchange_agent_fee_percent + default_completion_agent_fee_percent), 4) = round(default_agent_fee_percent, 4))))),
    CONSTRAINT building_sale_defaults_build_cost_check CHECK (((build_cost IS NULL) OR (build_cost >= (0)::numeric))),
    CONSTRAINT building_sale_defaults_exchange_deposit_check CHECK (((exchange_deposit_percent IS NULL) OR ((exchange_deposit_percent >= (0)::numeric) AND (exchange_deposit_percent <= (100)::numeric)))),
    CONSTRAINT building_sale_defaults_holder_check CHECK ((reservation_fee_holder_default = ANY (ARRAY['sales_agent'::text, 'developer'::text, 'conveyancer'::text, 'other'::text]))),
    CONSTRAINT building_sale_defaults_reservation_fee_check CHECK (((reservation_fee IS NULL) OR (reservation_fee >= (0)::numeric))),
    CONSTRAINT building_sale_defaults_second_deposit_check CHECK (((second_deposit_percent IS NULL) OR ((second_deposit_percent >= (0)::numeric) AND (second_deposit_percent <= (100)::numeric)))),
    CONSTRAINT building_sale_defaults_second_deposit_timing_check CHECK (((second_deposit_months_after_exchange IS NULL) OR (second_deposit_months_after_exchange >= 0))),
    CONSTRAINT building_sale_defaults_solicitor_fee_check CHECK (((default_sales_solicitor_fee IS NULL) OR (default_sales_solicitor_fee >= (0)::numeric))),
    CONSTRAINT building_sale_defaults_vat_rate_check CHECK (((default_vat_rate >= (0)::numeric) AND (default_vat_rate <= (100)::numeric)))
);


--
-- Name: sales_apply_inherited_deposits(public.building_sale_defaults, public.building_sale_defaults); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_apply_inherited_deposits(p_defaults public.building_sale_defaults, p_previous public.building_sale_defaults DEFAULT NULL::public.building_sale_defaults) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r record; changed integer := 0;
begin
  for r in
    select t.id, a.id as sale_id
    from public.unit_sale_terms t
    join public.unit_sale_attempts a on a.id=t.sale_attempt_id
    join public.units u on u.id=a.unit_id
    where a.building_id=p_defaults.building_id and a.is_active and a.workflow_status='draft'
      and t.is_current and t.status='draft'
      and u.sale_status in ('not_released','not_for_sale','for_sale')
      and a.exchanged_at is null and a.completed_at is null
      and a.reservation_approved_at is null and a.commercial_approved_at is null
      and a.reservation_submitted_at is null and a.reservation_date is null
      and nullif(btrim(concat(a.buyer_name,a.buyer_person_name,a.buyer_company_name,
        a.buyer_email,a.buyer_phone,a.buyer_solicitor_name)),'') is null
      and not exists(select 1 from public.unit_sale_documents d where d.sale_attempt_id=a.id
        and d.document_type='reservation_form' and d.redacted_at is null and d.status<>'redacted')
      and not exists(select 1 from public.sale_exchange_deposit_sources s where s.sale_attempt_id=a.id)
      and not exists(select 1 from public.unit_sale_payment_schedule s where s.sale_attempt_id=a.id and (
        s.status is distinct from 'pending' or s.payment_stage not in ('exchange','delayed_deposit','completion')
        or s.fixed_amount is not null or nullif(btrim(s.notes),'') is not null
        or s.percent_of_contract_price is distinct from case s.payment_stage
          when 'exchange' then t.exchange_deposit_percent
          when 'delayed_deposit' then case when t.second_deposit_enabled then t.second_deposit_percent else null end
          when 'completion' then t.completion_balance_percent end
        or s.expected_amount is not null and s.expected_amount is distinct from round(t.contract_price*s.percent_of_contract_price/100,2)
      ))
      and (
        -- Only a completely uninitialised system baseline may adopt CURRENT
        -- defaults without evidence of its previous inherited configuration.
        (a.is_system_baseline and t.exchange_deposit_percent is null and t.completion_balance_percent is null
          and not coalesce(t.second_deposit_enabled,false) and t.second_deposit_percent is null
          and t.second_deposit_months_after_exchange is null and t.further_deposit_timing is null)
        or (
          p_previous.building_id is not null
          and t.exchange_deposit_percent is not distinct from p_previous.exchange_deposit_percent
          and coalesce(t.second_deposit_enabled,false)=coalesce(p_previous.second_deposit_enabled,false)
          -- Disabled deposits have no amount or timing. Legacy zero/null values
          -- must not accidentally turn an inherited schedule into an override.
          and (not coalesce(t.second_deposit_enabled,false) or
            (t.second_deposit_percent,t.second_deposit_months_after_exchange,t.further_deposit_timing)
            is not distinct from
            (p_previous.second_deposit_percent,p_previous.second_deposit_months_after_exchange,p_previous.further_deposit_timing))
          and (t.completion_balance_percent is null or t.completion_balance_percent =
            100-coalesce(p_previous.exchange_deposit_percent,0)
              -case when p_previous.second_deposit_enabled then coalesce(p_previous.second_deposit_percent,0) else 0 end)
        )
      )
      and (t.exchange_deposit_percent,t.second_deposit_enabled,t.second_deposit_percent,
        t.second_deposit_months_after_exchange,t.further_deposit_timing,t.completion_balance_percent)
        is distinct from (
          p_defaults.exchange_deposit_percent,coalesce(p_defaults.second_deposit_enabled,false),
          case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_percent end,
          case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_months_after_exchange end,
          case when p_defaults.second_deposit_enabled then p_defaults.further_deposit_timing end,
          100-coalesce(p_defaults.exchange_deposit_percent,0)
            -case when p_defaults.second_deposit_enabled then coalesce(p_defaults.second_deposit_percent,0) else 0 end
        )
    order by a.id for update of a,t,u
  loop
    update public.unit_sale_terms set
      exchange_deposit_percent=p_defaults.exchange_deposit_percent,
      second_deposit_enabled=coalesce(p_defaults.second_deposit_enabled,false),
      second_deposit_percent=case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_percent end,
      second_deposit_months_after_exchange=case when p_defaults.second_deposit_enabled then p_defaults.second_deposit_months_after_exchange end,
      further_deposit_timing=case when p_defaults.second_deposit_enabled then p_defaults.further_deposit_timing end,
      completion_balance_percent=100-coalesce(p_defaults.exchange_deposit_percent,0)
        -case when p_defaults.second_deposit_enabled then coalesce(p_defaults.second_deposit_percent,0) else 0 end,
      deposit_summary=null,updated_at=now()
    where id=r.id;
    -- Only untouched generated schedules passed the checks above. The normal
    -- commercial workflow rebuilds them from the corrected terms.
    delete from public.unit_sale_payment_schedule where sale_attempt_id=r.sale_id;
    changed := changed+1;
  end loop;
  return changed;
end $$;


--
-- Name: sales_building_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_building_access(p_building uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p where p.id=p_user and p.active is true and (
      p.role in ('admin','developer') or (p.role in ('sales_agent','conveyancer') and (
        exists (select 1 from public.user_building_access b where b.user_id=p.id and b.building_id=p_building)
        or exists (select 1 from public.building_organisations b where b.building_id=p_building
          and b.organisation_id=p.organisation_id and b.role_on_project=p.role::text and coalesce(b.active,true))
      ))
    )
  )
$$;


--
-- Name: sales_cascade_deposit_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_cascade_deposit_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then
    perform public.sales_apply_inherited_deposits(new);
  else
    perform public.sales_apply_inherited_deposits(new,old);
  end if;
  return new;
end $$;


--
-- Name: sales_completion_approval_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_approval_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op<>'INSERT' then raise exception 'Completion package approvals are immutable.'; end if;
  if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  return new;
end $$;


--
-- Name: sales_completion_draft_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_draft_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare protected boolean;
begin
  if tg_table_name='unit_sale_documents' then
    protected:=coalesce(new.document_type,'') in ('completion_statement','draft_statement_of_account') or coalesce(old.document_type,'') in ('completion_statement','draft_statement_of_account');
    if protected and tg_op='UPDATE' and (new.sale_attempt_id,new.document_type) is distinct from (old.sale_attempt_id,old.document_type) then raise exception 'Completion document identity is immutable.'; end if;
  else
    select exists(select 1 from unit_sale_documents where id in (new.document_id,old.document_id) and document_type in ('completion_statement','draft_statement_of_account')) into protected;
    if protected and tg_op='UPDATE' and (to_jsonb(new)-'is_current') is distinct from (to_jsonb(old)-'is_current') then raise exception 'Completion document versions are immutable.'; end if;
  end if;
  if protected then
    if tg_op='DELETE' then raise exception 'Completion document history is immutable.'; end if;
    if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;


--
-- Name: sales_completion_package_context(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_package_context(p_sale uuid, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare approved boolean; approval sale_completion_package_approvals%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select count(distinct d.document_type)=2 into approved
    from unit_sale_documents d join unit_sale_document_versions v on v.document_id=d.id
      and v.id=d.approved_version_id and v.is_current and v.redacted_at is null
    where d.sale_attempt_id=p_sale and d.document_type in ('completion_statement','draft_statement_of_account')
      and d.status='approved' and d.redacted_at is null and d.superseded_at is null;
  -- Preserve the old response for historical package approvals; new approvals
  -- are independent and do not manufacture a joint approver or timestamp.
  if approved then
    select p.* into approval from sale_completion_package_approvals p
      join unit_sale_document_versions s on s.id=p.statement_version_id and s.is_current and s.redacted_at is null
      join unit_sale_document_versions a on a.id=p.account_version_id and a.is_current and a.redacted_at is null
      where p.sale_attempt_id=p_sale order by p.approved_at desc limit 1;
  end if;
  return jsonb_build_object('approved',approved,'approval',case when approval.id is not null then to_jsonb(approval) end);
end $$;


--
-- Name: sales_completion_package_history_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_package_history_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(new.event_type,'') like 'completion_draft_statement_of_account_%' or coalesce(old.event_type,'') like 'completion_draft_statement_of_account_%' then
    if tg_op<>'INSERT' then raise exception 'Completion document history is immutable.'; end if;
    if coalesce(current_setting('app.completion_package_write',true),'')<>'on' then raise exception 'Use the completion document package workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;


--
-- Name: sales_completion_upload(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_upload(p_sale uuid, p_actor uuid, p_request uuid, p_files jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; oldv unit_sale_document_versions%rowtype;
  file_item jsonb; vid uuid; title text; result jsonb:='[]'; prior jsonb; n int;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  if p_request is null or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 2 then raise exception 'Select one or two completion PDFs and a submission reference.'; end if;
  if exists(select 1 from jsonb_array_elements(p_files) f where coalesce(f->>'type','') not in ('completion_statement','draft_statement_of_account')) or
    (select count(distinct f->>'type') from jsonb_array_elements(p_files) f)<>jsonb_array_length(p_files) then raise exception 'Assign each PDF a different completion document type.'; end if;
  select jsonb_agg(jsonb_build_object('type',upload_doc.document_type,'versionId',v.id,'path',v.storage_path)) into prior
    from unit_sale_document_versions v join unit_sale_documents upload_doc on upload_doc.id=v.document_id where v.completion_upload_id=p_request and upload_doc.sale_attempt_id=p_sale and v.uploaded_by_user_id=p_actor;
  if prior is not null then
    if jsonb_array_length(prior)<>jsonb_array_length(p_files) or exists(select 1 from jsonb_array_elements(p_files) f where not exists(select 1 from jsonb_array_elements(prior) x where x->>'type'=f->>'type')) then raise exception 'Submission reference conflicts with the saved documents.'; end if;
    return prior;
  end if;
  if exists(select 1 from unit_sale_document_versions where completion_upload_id=p_request) then raise exception 'Submission reference conflict.'; end if;
  perform set_config('app.sales_legal_write','on',true); perform set_config('app.completion_package_write','on',true);
  for file_item in select value from jsonb_array_elements(p_files) loop
    if coalesce(file_item->>'mime','')<>'application/pdf' or coalesce((file_item->>'size')::bigint,0) not between 1 and 10485760 or nullif(file_item->>'name','') is null or coalesce(file_item->>'path','') not like a.building_id::text||'/'||p_sale::text||'/%' then raise exception 'Choose a PDF up to 10 MB for this sale.'; end if;
    select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=file_item->>'type' and redacted_at is null and superseded_at is null for update;
    select * into oldv from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
    if oldv.id is distinct from nullif(file_item->>'expectedVersionId','')::uuid then raise exception 'The current document changed. Reload before replacing it.'; end if;
    if d.status='approved' then raise exception 'Approved completion documents are locked.'; end if;
    title:=case file_item->>'type' when 'completion_statement' then 'Draft completion statement' else 'Draft statement of account' end;
    if d.id is null then
      insert into unit_sale_documents(sale_attempt_id,document_type,title,status,visibility,required,created_by_user_id,updated_by_user_id)
        values(p_sale,file_item->>'type',title,'uploaded','shared_sale_file',true,p_actor,p_actor) returning * into d;
    end if;
    select coalesce(max(version_number),0)+1 into n from unit_sale_document_versions where document_id=d.id;
    update unit_sale_document_versions set is_current=false where document_id=d.id and is_current;
    if oldv.id is not null then perform public.sales_legal_event(p_sale,p_actor,case file_item->>'type' when 'completion_statement' then 'completion_statement_superseded' else 'completion_draft_statement_of_account_superseded' end,title||' superseded: '||oldv.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',oldv.id,'fileName',oldv.file_name)); end if;
    insert into unit_sale_document_versions(document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id,completion_upload_id)
      values(d.id,n,true,'sale-documents',file_item->>'path',file_item->>'name','application/pdf',(file_item->>'size')::bigint,p_actor,p_request) returning id into vid;
    update unit_sale_documents set status='uploaded',approved_version_id=null,approved_at=null,approved_by_user_id=null,query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,(case d.document_type when 'completion_statement' then 'completion_statement' else 'completion_draft_statement_of_account' end)||case when oldv.id is null then '_uploaded' else '_replaced' end,
      title||case when oldv.id is null then ' uploaded: ' else ' replaced: ' end||(file_item->>'name'),jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',vid,'fileName',file_item->>'name','versionNumber',n));
    result:=result||jsonb_build_array(jsonb_build_object('type',d.document_type,'versionId',vid,'path',file_item->>'path'));
  end loop;
  update unit_sale_attempts set workflow_status='exchanged',updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
  return result;
end $$;


--
-- Name: sale_completion_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_completion_uploads (
    id uuid NOT NULL,
    sale_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    files jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '02:00:00'::interval) NOT NULL,
    cleaned_at timestamp with time zone,
    CONSTRAINT sale_completion_uploads_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'finalized'::text, 'expired'::text])))
);


--
-- Name: sales_completion_upload_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_upload_cleanup() RETURNS SETOF public.sale_completion_uploads
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query update sale_completion_uploads set state=case when state='finalized' then state else 'expired' end
  where id in (select id from sale_completion_uploads where cleaned_at is null and expires_at<now()-interval '26 hours' order by expires_at limit 30 for update skip locked)
  returning *;
end $$;


--
-- Name: sales_completion_upload_session(uuid, uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_completion_upload_session(p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_files jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare a unit_sale_attempts%rowtype; u sale_completion_uploads%rowtype; f jsonb; manifest jsonb:='[]'; current_id uuid; saved jsonb;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_request is null or p_action not in ('begin','get','finalize') then raise exception 'Invalid upload request.'; end if;
  select * into u from sale_completion_uploads where id=p_request for update;
  if found then
    if u.sale_id<>p_sale or u.actor_id<>p_actor then raise exception 'Upload access denied.' using errcode='42501'; end if;
    if p_action='begin' and (select jsonb_agg(value-'path') from jsonb_array_elements(u.files)) is distinct from p_files then raise exception 'Submission reference conflicts with the selected files.'; end if;
    -- Return the committed outcome even after legal completion / a later upload.
    if u.state='finalized' then return to_jsonb(u); end if;
    if u.state<>'pending' or u.expires_at<=now() then raise exception 'Upload expired. Remove the selected files and choose them again.'; end if;
  elsif p_action<>'begin' then raise exception 'Upload not found. Choose the files again.';
  end if;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements first.'; end if;
  if u.id is null then
    if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 2 then raise exception 'Choose one or two PDFs.'; end if;
    if (select count(distinct value->>'type') from jsonb_array_elements(p_files))<>jsonb_array_length(p_files) then raise exception 'Assign different document types.'; end if;
    for f in select value from jsonb_array_elements(p_files) loop
      if coalesce(f->>'type','') not in ('completion_statement','draft_statement_of_account') or coalesce(f->>'mime','')<>'application/pdf'
        or coalesce((f->>'size')::bigint,0) not between 5 and 10485760 or length(coalesce(f->>'name','')) not between 5 and 200
        or f->>'name' !~* '\.pdf$' or f->>'name' ~ '[/\\\x00-\x1f]' then raise exception 'Choose PDFs up to 10 MiB each.'; end if;
      manifest:=manifest||jsonb_build_array((f-'path')||jsonb_build_object('path',a.building_id::text||'/'||p_sale::text||'/completion-'||p_request::text||'/'||(f->>'type')||'.pdf'));
    end loop;
    insert into sale_completion_uploads(id,sale_id,actor_id,files) values(p_request,p_sale,p_actor,manifest) returning * into u;
  end if;
  for f in select value from jsonb_array_elements(u.files) loop
    select v.id into current_id from unit_sale_document_versions v join unit_sale_documents d on d.id=v.document_id
      where d.sale_attempt_id=p_sale and d.document_type=f->>'type' and d.redacted_at is null and d.superseded_at is null and v.is_current and v.redacted_at is null;
    if exists(select 1 from unit_sale_documents where sale_attempt_id=p_sale and document_type=f->>'type'
      and redacted_at is null and superseded_at is null and status='approved') then raise exception 'Approved completion documents are locked.'; end if;
    if current_id is distinct from nullif(f->>'expectedVersionId','')::uuid then raise exception 'The current document changed. Reload before replacing it.'; end if;
  end loop;
  if p_action='finalize' then
    -- Only the service verifier can call this function. Independently check the
    -- final Storage metadata here, in the same transaction as document history.
    for f in select value from jsonb_array_elements(u.files) loop
      if not exists(select 1 from storage.objects where bucket_id='sale-documents' and name=f->>'path'
        and (metadata->>'size')::bigint=(f->>'size')::bigint and metadata->>'mimetype'='application/pdf') then raise exception 'A verified PDF is missing. Retry the upload.'; end if;
    end loop;
    saved:=public.sales_completion_upload(p_sale,p_actor,p_request,u.files);
    update sale_completion_uploads set state='finalized',result=saved where id=u.id returning * into u;
  end if;
  return to_jsonb(u);
end $_$;


--
-- Name: sales_contact_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_contact_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_table_name='buildings' and (to_jsonb(old)->'conveyancer_organisation_id',to_jsonb(old)->'sales_agent_organisation_id',to_jsonb(old)->'seller_name',to_jsonb(old)->'completion_information')
    is distinct from (to_jsonb(new)->'conveyancer_organisation_id',to_jsonb(new)->'sales_agent_organisation_id',to_jsonb(new)->'seller_name',to_jsonb(new)->'completion_information') then
    insert into audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id) values('building_sales_contacts_updated','building',new.id,'Building sales contacts updated',
      jsonb_build_object('previous',jsonb_build_object('conveyancer',to_jsonb(old)->'conveyancer_organisation_id','salesAgent',to_jsonb(old)->'sales_agent_organisation_id','seller',to_jsonb(old)->'seller_name','completion',to_jsonb(old)->'completion_information'),
        'next',jsonb_build_object('conveyancer',to_jsonb(new)->'conveyancer_organisation_id','salesAgent',to_jsonb(new)->'sales_agent_organisation_id','seller',to_jsonb(new)->'seller_name','completion',to_jsonb(new)->'completion_information')),auth.uid());
  elsif tg_table_name='organisations' and to_jsonb(old)->'shared_system_email' is distinct from to_jsonb(new)->'shared_system_email' then
    insert into audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id) values('organisation_system_email_updated','organisation',new.id,'Organisation shared system email updated',
      jsonb_build_object('previous',to_jsonb(old)->'shared_system_email','next',to_jsonb(new)->'shared_system_email'),auth.uid());
  end if;
  return new;
end $$;


--
-- Name: sales_contact_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_contact_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_table_name='buildings' then
    if new.conveyancer_organisation_id is not null and not exists(select 1 from organisations where id=new.conveyancer_organisation_id and type='conveyancer') then raise exception 'Select a conveyancer organisation.'; end if;
    if new.sales_agent_organisation_id is not null and not exists(select 1 from organisations where id=new.sales_agent_organisation_id and type='sales_agent') then raise exception 'Select a sales agent organisation.'; end if;
  elsif new.type is distinct from old.type and exists(select 1 from buildings where
    (conveyancer_organisation_id=new.id and new.type<>'conveyancer') or (sales_agent_organisation_id=new.id and new.type<>'sales_agent')) then
    raise exception 'Remove this organisation from building Sales contacts before changing its type.';
  end if;
  return new;
end $$;


--
-- Name: sales_deposit_context(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_deposit_context(p_sale uuid, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sales_deposit_terms_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_deposit_terms_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sales_deposit_timing(jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_deposit_timing(p_value jsonb, p_require_time boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
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
end $_$;


--
-- Name: sales_exchange_deposit_amount(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_exchange_deposit_amount(p_snapshot jsonb) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sales_exchange_deposit_context(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_exchange_deposit_context(p_sale uuid, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare source jsonb; receipt jsonb;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select to_jsonb(s)-'snapshot' into source from sale_exchange_deposit_sources s where sale_attempt_id=p_sale;
  select to_jsonb(r) into receipt from sale_exchange_deposit_receipts r where sale_attempt_id=p_sale order by revision desc limit 1;
  return jsonb_build_object('source',source,'receipt',receipt);
end $$;


--
-- Name: sales_exchange_deposit_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_exchange_deposit_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op<>'INSERT' then raise exception 'Exchange deposit history is immutable. Record an audited correction.'; end if;
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the legal workflow to record deposit receipt.'; end if;
  return new;
end $$;


--
-- Name: sales_further_deposit_action(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_further_deposit_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
end $_$;


--
-- Name: sales_further_deposit_amount(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_further_deposit_amount(p_snapshot jsonb) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sales_further_deposit_event_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_further_deposit_event_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(new.event_type,'') like 'further_deposit_%' or coalesce(old.event_type,'') like 'further_deposit_%' then
    if tg_op<>'INSERT' then raise exception 'Deposit history is immutable.'; end if;
    if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the deposit workflow.'; end if;
  end if;
  return coalesce(new,old);
end $$;


--
-- Name: sales_legal_action(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_action(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
  reason text; title text; package jsonb;
begin
  if p_action not in ('approve_statement','query_statement','approve_completion_package','query_completion_package',
    'approve_completion_document','query_completion_document','confirm_completion') then
    return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  -- Serialize approval, replacement and completion on the same sale lock.
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_action='confirm_completion' then
    perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
    if a.completed_at is not null or a.workflow_status='completed' then return jsonb_build_object('alreadyCompleted',true); end if;
    package:=public.sales_completion_package_context(p_sale,p_actor);
    if not (package->>'approved')::boolean then raise exception 'The developer must approve both current completion documents.'; end if;
    return public.sales_legal_action_before_package(p_sale,p_action,p_payload,p_actor);
  end if;
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null or a.workflow_status='completed' then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  if p_action in ('approve_statement','query_statement','approve_completion_package','query_completion_package') then
    raise exception 'Review each current completion document separately. Reload the page.';
  end if;
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=p_payload->>'documentType'
    and document_type in ('completion_statement','draft_statement_of_account') and redacted_at is null and superseded_at is null for update;
  select * into v from unit_sale_document_versions where document_id=d.id and is_current and redacted_at is null for update;
  if v.id is null or v.id::text is distinct from p_payload->>'versionId' then raise exception 'The completion document changed. Review the current file.'; end if;
  if d.status='approved' then
    if p_action='approve_completion_document' and d.approved_version_id=v.id then return public.sales_completion_package_context(p_sale,p_actor); end if;
    raise exception 'Approved completion documents are locked.';
  end if;
  reason:=nullif(btrim(p_payload->>'reason'),'');
  if p_action='query_completion_document' and reason is null then raise exception 'Enter a query or rejection reason.'; end if;
  if p_action='query_completion_document' and d.status='query_raised' and d.query_note=reason then return public.sales_completion_package_context(p_sale,p_actor); end if;
  perform set_config('app.sales_legal_write','on',true); perform set_config('app.completion_package_write','on',true);
  title:=case d.document_type when 'completion_statement' then 'Completion statement' else 'Statement of account' end;
  if p_action='approve_completion_document' then
    update unit_sale_documents set status='approved',approved_version_id=v.id,approved_by_user_id=p_actor,approved_at=now(),
      query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_documents_approved',title||' approved: '||v.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name));
  else
    update unit_sale_documents set status='query_raised',query_note=reason,approved_version_id=null,approved_at=null,
      approved_by_user_id=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_documents_query_raised','Query raised against '||lower(title)||': '||v.file_name,
      jsonb_build_object('packageWorkflow',true,'documentType',d.document_type,'documentId',d.id,'versionId',v.id,'fileName',v.file_name,'queryNote',reason));
  end if;
  package:=public.sales_completion_package_context(p_sale,p_actor);
  update unit_sale_attempts set workflow_status=case when (package->>'approved')::boolean then 'completion_pending' else 'exchanged' end where id=p_sale;
  return package;
end $$;


--
-- Name: sales_legal_action_before_deposit(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_action_before_deposit(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare a unit_sale_attempts%rowtype; comment_id uuid; seq bigint; notice_date date; due_date date; e sale_legal_emails%rowtype; reason text;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if p_action='confirm_arrangements' then raise exception 'Submit both dates and the notice PDF together.'; end if;
  if p_action='cancel_notice_authority' then
    perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if reason is null then raise exception 'Add a cancellation reason.'; end if;
    select * into e from sale_legal_emails where id=(p_payload->>'emailId')::uuid and sale_attempt_id=p_sale and kind='notice_authority' for update;
    if e.id is null or e.sent_at is not null or e.revoked_at is not null then raise exception 'Only a pending notice authority can be cancelled.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Wait for the email send to finish before cancelling.'; end if;
    perform set_config('app.sales_legal_write','on',true);
    update sale_legal_emails set revoked_at=now(),revoked_by=p_actor,revocation_reason=reason where id=e.id;
    perform public.sales_legal_event(p_sale,p_actor,'completion_instruction_cancelled','Pending authority to serve notice cancelled',jsonb_build_object('emailId',e.id,'reason',reason));
    return jsonb_build_object('cancelled',true);
  end if;
  if p_action='request_notice_authority' then
    perform public.sales_legal_assert(p_sale,p_actor,array['sales_agent','conveyancer']);
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
    if a.completion_authority_given_at is not null or a.completion_legacy_stage is not null then raise exception 'Authority is already available.'; end if;
    if a.completion_authority_requested_at is not null then return jsonb_build_object('alreadyRequested',true); end if;
    perform set_config('app.sales_legal_write','on',true);
    update unit_sale_attempts set completion_authority_requested_at=now(),completion_authority_requested_by=p_actor where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'authority_notice_requested','Authority to serve notice requested');
    select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
    insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
      select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,
        'Authority to serve notice requested. Developer authority is required before the conveyancer records the notice.','completion',gen_random_uuid()
      from profiles where id=p_actor returning id into comment_id;
    insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
      select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
    return jsonb_build_object('requested',true);
  end if;
  if p_action in ('approve_statement','query_statement','confirm_completion','correct_completion_dates')
    and a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then
    raise exception 'Confirm completion arrangements and the notice PDF first.';
  end if;
  if p_action='correct_completion_dates' then
    perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
    if a.completed_at is not null then raise exception 'Legal completion has already been recorded.'; end if;
    if coalesce(p_payload->>'noticeDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Both calendar dates are required.'; end if;
    notice_date:=(p_payload->>'noticeDate')::date; due_date:=(p_payload->>'date')::date;
    if due_date<notice_date then raise exception 'Completion due date cannot be earlier than the notice issue date.'; end if;
    if (a.completion_notice_issued_at,a.contractual_completion_date) is distinct from
      (nullif(p_payload->>'previousNoticeDate','')::date,nullif(p_payload->>'previousDate','')::date) then raise exception 'Dates changed. Refresh before correcting them.'; end if;
    if (notice_date,due_date) is not distinct from (a.completion_notice_issued_at,a.contractual_completion_date) then return jsonb_build_object('unchanged',true); end if;
    perform set_config('app.sales_legal_write','on',true);
    update unit_sale_attempts set completion_notice_issued_at=notice_date,contractual_completion_date=due_date,updated_by_user_id=p_actor,updated_at=now() where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_dates_corrected','Completion arrangement dates corrected',
      jsonb_build_object('previousNoticeDate',a.completion_notice_issued_at,'previousCompletionDate',a.contractual_completion_date,'noticeDate',notice_date,'completionDate',due_date));
    return jsonb_build_object('corrected',true);
  end if;
  return public.sales_legal_action_before_notice(p_sale,p_action,p_payload,p_actor);
end $_$;


--
-- Name: sales_legal_action_before_notice(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_action_before_notice(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; d unit_sale_documents%rowtype; v unit_sale_document_versions%rowtype;
  actor_role text; reason text; actual_date date; actual_time timestamptz; comment_id uuid; seq bigint;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select role::text into actor_role from profiles where id=p_actor;
  if (p_action='request_authority' and actor_role not in ('sales_agent','conveyancer'))
    or (p_action in ('revoke_authority','cancel_instruction','approve_statement','query_statement') and actor_role not in ('admin','developer'))
    or (p_action in ('confirm_exchange','confirm_arrangements','confirm_completion') and actor_role<>'conveyancer') then raise exception 'Your role cannot perform this legal action.' using errcode='42501'; end if;
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  perform set_config('app.sales_legal_write','on',true);
  if p_action='request_authority' then
    if a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') or a.exchanged_at is not null then raise exception 'Approve the reservation before requesting authority.'; end if;
    if a.authority_requested_at is not null then return jsonb_build_object('alreadyRequested',true); end if;
    update unit_sale_attempts set authority_requested_at=now() where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'authority_requested','Exchange authority requested — this is not authority to exchange');
    -- Use the existing sale conversation notification inbox for developers.
    select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
    insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
      select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,'Exchange authority requested. Developer review and issued authority are required before exchange.','exchange',gen_random_uuid() from profiles where id=p_actor returning id into comment_id;
    insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
      select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
  elsif p_action in ('revoke_authority','cancel_instruction') then
    reason:=nullif(btrim(p_payload->>'reason'),''); if reason is null then raise exception 'Add a revocation reason.'; end if;
    select * into e from sale_legal_emails where id=(p_payload->>'emailId')::uuid and sale_attempt_id=p_sale and kind=case when p_action='revoke_authority' then 'authority' else 'completion_instruction' end for update;
    if e.id is null or e.revoked_at is not null or e.exchanged_at is not null or a.completed_at is not null or (e.kind='authority' and a.exchanged_at is not null) then raise exception 'Only an unexchanged, unrevoked authority or an instruction awaiting completion can be revoked.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Wait for the email send to finish before revoking.'; end if;
    update sale_legal_emails set revoked_at=now(),revoked_by=p_actor,revocation_reason=reason where id=e.id;
    perform public.sales_legal_event(p_sale,p_actor,case when e.kind='authority' then 'authority_revoked' else 'completion_instruction_cancelled' end,
      case when e.kind='authority' then 'Exchange authority revoked' else 'Completion instruction cancelled in the portal' end,jsonb_build_object('emailId',e.id,'versionNumber',e.version,'reason',reason));
  elsif p_action='confirm_exchange' then
    if a.exchanged_at is not null then return jsonb_build_object('alreadyExchanged',true); end if;
    actual_date:=(p_payload->>'date')::date;
    if actual_date is null or actual_date>current_date or p_payload->>'depositConfirmed' is distinct from 'true' then raise exception 'Enter the actual exchange date and confirm receipt of the exchange deposit.'; end if;
    select * into e from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' order by version desc limit 1 for update;
    if e.id is null or e.sent_at is null or e.revoked_at is not null or e.replaced_by is not null or e.expires_at<=now() or e.delivery_status in ('bounced','complained','suppressed','failed','unknown') then raise exception 'A sent, unexpired authority is required. Ask the developer to issue fresh authority.'; end if;
    if actual_date<(e.issued_at at time zone 'Europe/London')::date then raise exception 'Exchange cannot predate the authority.'; end if;
    update sale_legal_emails set exchanged_at=actual_date where id=e.id;
    update unit_sale_attempts set workflow_status='exchanged',exchanged_at=actual_date,stage_entered_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_workflow_mark_unit_exchanged(a.unit_id,p_sale,p_actor,'legal_authority_exchange');
    perform public.sales_legal_event(p_sale,p_actor,'exchange_recorded','Exchange confirmed by conveyancer',jsonb_build_object('exchangeDate',actual_date,'emailId',e.id,'versionNumber',e.version));
  elsif p_action='confirm_arrangements' then
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'Exchange must be confirmed before completion arrangements.'; end if;
    if not exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='completion_instruction' and sent_at is not null and revoked_at is null) then raise exception 'The developer must send completion instructions first.'; end if;
    actual_date:=(p_payload->>'date')::date;
    if actual_date is null or actual_date<a.exchanged_at then raise exception 'Enter the contractual completion date on or after exchange.'; end if;
    if nullif(p_payload->>'noticeDate','')::date>current_date then raise exception 'Notice or confirmation issue date cannot be in the future.'; end if;
    update unit_sale_attempts set contractual_completion_date=actual_date,completion_notice_issued_at=nullif(p_payload->>'noticeDate','')::date where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_confirmed','Contractual completion date confirmed',jsonb_build_object('completionDate',actual_date,'noticeDate',p_payload->>'noticeDate'));
  elsif p_action in ('approve_statement','query_statement') then
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
    select * into v from unit_sale_document_versions where id=(p_payload->>'versionId')::uuid and is_current and redacted_at is null for update;
    select * into d from unit_sale_documents where id=v.document_id and sale_attempt_id=p_sale and document_type='completion_statement' and redacted_at is null and superseded_at is null for update;
    if d.id is null then raise exception 'The completion statement version changed. Review the current version.'; end if;
    if p_action='approve_statement' and d.status='approved' and d.approved_version_id=v.id then return jsonb_build_object('alreadyApproved',true); end if;
    reason:=nullif(btrim(p_payload->>'reason'),'');
    if p_action='query_statement' and reason is null then raise exception 'Add comments explaining the query or rejection.'; end if;
    update unit_sale_documents set status=case when p_action='approve_statement' then 'approved' else 'query_raised' end,
      approved_version_id=case when p_action='approve_statement' then v.id end,approved_at=case when p_action='approve_statement' then now() end,
      approved_by_user_id=case when p_action='approve_statement' then p_actor end,query_note=reason,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
    update unit_sale_attempts set workflow_status=case when p_action='approve_statement' then 'completion_pending' else 'exchanged' end where id=p_sale;
  elsif p_action='confirm_completion' then
    if a.completed_at is not null then return jsonb_build_object('alreadyCompleted',true); end if;
    actual_time:=(p_payload->>'dateTime')::timestamptz;
    if a.exchanged_at is null or a.contractual_completion_date is null then raise exception 'Confirm the contractual completion date first.'; end if;
    if actual_time is null or actual_time>now() or (actual_time at time zone 'Europe/London')::date<a.exchanged_at then raise exception 'Enter the actual legal completion date and time, on or after exchange and not in the future.'; end if;
    if not exists(select 1 from unit_sale_documents document join unit_sale_document_versions version on version.id=document.approved_version_id and version.document_id=document.id
      where document.sale_attempt_id=p_sale and document.document_type='completion_statement' and document.status='approved' and version.is_current and version.redacted_at is null and document.redacted_at is null and document.superseded_at is null) then raise exception 'The developer must approve the current completion statement version.'; end if;
    update unit_sale_attempts set workflow_status='completed',completed_at=(actual_time at time zone 'Europe/London')::date,legal_completed_at=actual_time,legal_completed_by=p_actor,stage_entered_at=now(),updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_workflow_mark_unit_completed(a.unit_id,p_sale,p_actor,'legal_completion_confirmed');
    perform public.sales_legal_event(p_sale,p_actor,'completion_recorded','Legal completion confirmed — handover and key release available',jsonb_build_object('completionDate',actual_time,'legalCompletedAt',actual_time));
  else raise exception 'Unsupported legal workflow action.'; end if;
  return jsonb_build_object('saleAttemptId',p_sale);
end $$;


--
-- Name: sales_legal_action_before_package(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_action_before_package(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; e sale_legal_emails%rowtype; comment_id uuid; seq bigint;
begin
  if p_action<>'request_authority' then return public.sales_legal_action_before_renewal(p_sale,p_action,p_payload,p_actor); end if;
  perform public.sales_legal_assert(p_sale,p_actor);
  if not exists(select 1 from profiles where id=p_actor and role in ('sales_agent','conveyancer')) then raise exception 'Your role cannot perform this legal action.' using errcode='42501'; end if;
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if a.exchanged_at is not null or a.completed_at is not null or a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') then raise exception 'An approved, unexchanged reservation is required.'; end if;
  select * into e from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' order by version desc limit 1;
  if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' and revoked_at is null and replaced_by is null and (expires_at is null or expires_at>now()))
    or e.id is not null and (e.exchanged_at is not null or e.replaced_by is not null) then
    raise exception 'Authority is already issued or being sent. A renewed request is available only after expiry or revocation.';
  end if;
  if (e.id is null and a.authority_requested_at is not null) or exists(select 1 from unit_sale_workflow_events
    where sale_attempt_id=p_sale and event_type='authority_requested' and metadata->>'renewalOfAuthorityId'=e.id::text) then
    return jsonb_build_object('alreadyRequested',true);
  end if;
  perform set_config('app.sales_legal_write','on',true);
  update unit_sale_attempts set authority_requested_at=now() where id=p_sale;
  perform public.sales_legal_event(p_sale,p_actor,'authority_requested',case when e.id is null then 'Exchange authority requested — this is not authority to exchange' else 'Renewed exchange authority requested — this is not authority to exchange' end,
    jsonb_strip_nulls(jsonb_build_object('renewalOfAuthorityId',e.id,'previousAuthorityVersion',e.version)));
  select coalesce(max(sequence),0)+1 into seq from sale_comments where sale_attempt_id=p_sale;
  insert into sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,body,stage,client_id)
    select p_sale,seq,id,coalesce(nullif(full_name,''),nullif(name,''),'Unknown user'),role::text,
      case when e.id is null then 'Exchange authority requested. Developer review and issued authority are required before exchange.' else 'Renewed exchange authority requested. The previous authority remains in history; fresh developer authority is required before exchange.' end,
      'exchange',gen_random_uuid() from profiles where id=p_actor returning id into comment_id;
  insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
    select p_sale,comment_id,id from profiles where active is true and role in ('admin','developer') and public.can_access_sale(p_sale,id);
  return jsonb_build_object('saleAttemptId',p_sale);
end $$;


--
-- Name: sales_legal_action_before_renewal(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_action_before_renewal(p_sale uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
end $_$;


--
-- Name: sales_legal_assert(uuid, uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_assert(p_sale uuid, p_actor uuid, p_roles text[] DEFAULT NULL::text[]) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.role()<>'service_role' and p_actor is distinct from auth.uid() then raise exception 'Actor access denied.' using errcode='42501'; end if;
  if not public.can_access_sale(p_sale,p_actor) or not exists(select 1 from profiles where id=p_actor and active is true
    and (p_roles is null or role::text=any(p_roles))) then raise exception 'Sale action access denied.' using errcode='42501'; end if;
end $$;


--
-- Name: sales_legal_dispatch(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_dispatch(p_id uuid, p_actor uuid, p_status text, p_message_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare e sale_legal_emails%rowtype;
begin
  select * into e from sale_legal_emails where id=p_id;
  perform public.sales_legal_assert(e.sale_attempt_id,p_actor,array['admin','developer']);
  perform 1 from unit_sale_attempts where id=e.sale_attempt_id for update;
  select * into e from sale_legal_emails where id=p_id for update;
  perform set_config('app.sales_legal_write','on',true);
  if p_status='sending' then
    if e.sent_at is not null then return to_jsonb(e); end if;
    if e.kind='notice_authority' and exists(select 1 from unit_sale_attempts where id=e.sale_attempt_id and completion_authority_given_at is not null) then raise exception 'Authority to serve notice is already available.'; end if;
    if e.revoked_at is not null or e.replaced_by is not null or e.exchanged_at is not null or e.expires_at<=now() or not exists(select 1 from unit_sale_attempts where id=e.sale_attempt_id and is_active and redacted_at is null and completed_at is null and workflow_status not in ('fallen_through','superseded')) then raise exception 'This instruction is no longer available to send.'; end if;
    if e.issued_at<now()-interval '23 hours' then raise exception 'The safe email retry window has ended. Check Resend before revoking and reissuing.'; end if;
    if e.delivery_status='sending' and e.dispatch_started_at>now()-interval '2 minutes' then raise exception 'Email sending is already in progress.'; end if;
    update sale_legal_emails set delivery_status='sending',dispatch_started_at=now() where id=p_id returning * into e;
  elsif p_status='sent' then
    if p_message_id is null then raise exception 'Resend message ID is required.'; end if;
    if e.sent_at is not null then return to_jsonb(e); end if;
    update sale_legal_emails set delivery_status='sent',resend_message_id=p_message_id,sent_at=now() where id=p_id returning * into e;
    if e.kind='authority' then
      update sale_legal_emails set replaced_by=e.id where sale_attempt_id=e.sale_attempt_id and kind='authority' and id<>e.id and replaced_by is null and revoked_at is null and exchanged_at is null;
      update unit_sale_attempts set commercial_approved_at=now(),commercial_approved_by_user_id=p_actor,workflow_status='ready_for_exchange',updated_at=now() where id=e.sale_attempt_id;
    elsif e.kind='notice_authority' then
      update unit_sale_attempts set completion_authority_given_at=now(),completion_authority_given_by=e.approved_by,updated_at=now() where id=e.sale_attempt_id;
    end if;
    perform public.sales_legal_event(e.sale_attempt_id,e.approved_by,case when e.kind='authority' and e.version>1 then 'authority_reissued' when e.kind='authority' then 'authority_issued' when e.kind='notice_authority' then 'authority_notice_given' else 'completion_instruction_sent' end,
      case when e.kind='authority' and e.version>1 then 'Fresh authority to exchange issued' when e.kind='authority' then 'Authority to exchange issued' when e.kind='notice_authority' then 'Authority to serve notice given' else 'Completion arrangements instructed' end,
      jsonb_build_object('emailId',e.id,'versionNumber',e.version,'expiresAt',e.expires_at,'proposedCompletionDate',e.proposed_completion_date,'to',e.to_recipients,'cc',e.cc_recipients));
  elsif p_status in ('failed','unknown','delivered','delivery_delayed','bounced','complained','suppressed','opened','clicked') then
    if e.sent_at is not null and p_status in ('failed','unknown') then return to_jsonb(e); end if;
    if e.delivery_status is distinct from p_status then
      update sale_legal_emails set delivery_status=p_status where id=p_id returning * into e;
      perform public.sales_legal_event(e.sale_attempt_id,p_actor,'legal_email_delivery','Email delivery: '||p_status,jsonb_build_object('emailId',e.id,'deliveryStatus',p_status));
    end if;
  else raise exception 'Invalid delivery status.'; end if;
  return to_jsonb(e);
end $$;


--
-- Name: sales_legal_email_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_email_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op='DELETE' then raise exception 'Legal email history is immutable.'; end if;
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Use the legal workflow to change email state.'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['revoked_at','revoked_by','revocation_reason','replaced_by','exchanged_at','resend_message_id','delivery_status','dispatch_started_at','sent_at','expiry_recorded_at'])
    is distinct from (to_jsonb(old)-array['revoked_at','revoked_by','revocation_reason','replaced_by','exchanged_at','resend_message_id','delivery_status','dispatch_started_at','sent_at','expiry_recorded_at']) then
    raise exception 'Issued terms and email contents are immutable.';
  end if;
  return new;
end $$;


--
-- Name: sales_legal_event(uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_event(p_sale uuid, p_actor uuid, p_type text, p_summary text, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,from_status,to_status,summary,metadata,created_by_user_id)
    select id,building_id,unit_id,p_type,workflow_status,workflow_status,p_summary,p_meta,p_actor from unit_sale_attempts where id=p_sale;
$$;


--
-- Name: sales_legal_expire(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_expire(p_sale uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare e sale_legal_emails%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  perform 1 from unit_sale_attempts where id=p_sale for update;
  perform set_config('app.sales_legal_write','on',true);
  for e in select * from sale_legal_emails where sale_attempt_id=p_sale and kind='authority' and expires_at<=now()
    and expiry_recorded_at is null and exchanged_at is null and revoked_at is null and replaced_by is null and sent_at is not null for update loop
    update sale_legal_emails set expiry_recorded_at=now() where id=e.id;
    insert into unit_sale_workflow_events(sale_attempt_id,building_id,unit_id,event_type,summary,metadata,created_at)
      select id,building_id,unit_id,'authority_expired','Authority to exchange expired',jsonb_build_object('emailId',e.id,'versionNumber',e.version,'expiresAt',e.expires_at),e.expires_at from unit_sale_attempts where id=p_sale;
  end loop;
end $$;


--
-- Name: sales_legal_history_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_history_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
begin
  if coalesce(new.event_type,'') ~ '^(authority_|legal_email_|completion_instruction_|completion_arrangements_|exchange_deposit_|exchange_recorded$|completion_recorded$|completion_documents_|completion_statement_|completion_correspondence_|statement_of_account_)'
    or coalesce(old.event_type,'') ~ '^(authority_|legal_email_|completion_instruction_|completion_arrangements_|exchange_deposit_|exchange_recorded$|completion_recorded$|completion_documents_|completion_statement_|completion_correspondence_|statement_of_account_)' then
    if tg_op<>'INSERT' then raise exception 'Legal workflow history is immutable.'; end if;
    if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' then raise exception 'Legal events must be recorded by the legal workflow.'; end if;
  end if;
  return coalesce(new,old);
end $_$;


--
-- Name: sales_legal_prepare_email(uuid, uuid, uuid, text, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_prepare_email(p_sale uuid, p_actor uuid, p_id uuid, p_kind text, p_snapshot jsonb, p_email jsonb, p_date text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; result sale_legal_emails%rowtype; snap jsonb; recipient text; cc text[]; next_version integer;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['admin','developer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  select * into result from sale_legal_emails where id=p_id;
  if found then
    if result.sale_attempt_id<>p_sale or result.approved_by<>p_actor then raise exception 'Email reference conflict.'; end if;
    return to_jsonb(result);
  end if;
  if not a.is_active or a.redacted_at is not null then raise exception 'The active sale file is required.'; end if;
  if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and delivery_status in ('pending','sending','unknown') and revoked_at is null) then raise exception 'Resolve or revoke the outstanding email before issuing another instruction.'; end if;
  if p_kind='authority' then
    if a.exchanged_at is not null or a.completed_at is not null or a.workflow_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange') then raise exception 'An approved, unexchanged reservation is required.'; end if;
    if p_date::timestamptz<=now() then raise exception 'Authority expiry must be in the future.'; end if;
  elsif p_kind='notice_authority' then
    if a.completion_authority_given_at is not null or a.completion_legacy_stage is not null then raise exception 'Authority to serve notice is already available.'; end if;
    if exists(select 1 from sale_legal_emails where sale_attempt_id=p_sale and kind='notice_authority' and revoked_at is null) then raise exception 'Resolve or cancel the existing notice authority email first.'; end if;
    if nullif(p_date,'') is not null then raise exception 'No date is required for authority to serve notice.'; end if;
    if a.exchanged_at is null or a.completed_at is not null then raise exception 'An exchanged sale awaiting completion is required.'; end if;
  else raise exception 'Invalid email kind.'; end if;
  -- Serialise building/organisation changes with snapshot validation.
  perform 1 from buildings where id=a.building_id for share;
  perform 1 from organisations where id in(select conveyancer_organisation_id from buildings where id=a.building_id union select sales_agent_organisation_id from buildings where id=a.building_id) for share;
  snap:=public.sales_legal_snapshot(p_sale,p_actor);
  if snap is distinct from p_snapshot then raise exception 'Sale terms or recipients changed. Refresh the email preview.'; end if;
  recipient:=snap#>>'{conveyancer,shared_system_email}';
  if recipient is null or snap#>>'{conveyancer,type}'<>'conveyancer' then raise exception 'Configure the building conveyancer shared system email.'; end if;
  if nullif(btrim(snap#>>'{building,seller_name}'),'') is null then raise exception 'Configure the legal seller/SPV.'; end if;
  if p_kind='authority' and (snap#>>'{terms,contract_price}' is null or (snap#>>'{terms,contract_price}')::numeric<=0) then raise exception 'Agreed contract price is required.'; end if;
  cc:=case when p_kind in ('authority','notice_authority') and snap#>>'{sales_agent,type}'='sales_agent' and snap#>>'{sales_agent,shared_system_email}' is not null then array[snap#>>'{sales_agent,shared_system_email}'] else '{}'::text[] end;
  select coalesce(max(version),0)+1 into next_version from sale_legal_emails where sale_attempt_id=p_sale and kind=p_kind;
  perform set_config('app.sales_legal_write','on',true);
  insert into sale_legal_emails(id,sale_attempt_id,kind,version,snapshot,subject,body,html_body,sending_address,to_recipients,cc_recipients,approved_by,expires_at,proposed_completion_date)
    values(p_id,p_sale,p_kind,next_version,snap,p_email->>'subject',p_email->>'body',p_email->>'html',p_email->>'from',array[recipient],cc,p_actor,
      case when p_kind='authority' then p_date::timestamptz end,null) returning * into result;
  perform public.sales_legal_event(p_sale,p_actor,'legal_email_prepared','Email approved for sending',jsonb_build_object('emailId',p_id,'kind',p_kind,'versionNumber',next_version,'expiresAt',result.expires_at));
  return to_jsonb(result);
end $$;


--
-- Name: sales_legal_register_document(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_register_document(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_type in ('completion_statement','draft_statement_of_account') then raise exception 'Use the completion document package upload.'; end if;
  return public.sales_legal_register_document_before_package(p_sale,p_actor,p_type,p_file);
end $$;


--
-- Name: sales_legal_register_document_before_notice(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_register_document_before_notice(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype; d unit_sale_documents%rowtype; vid uuid; n integer;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null then raise exception 'An active exchanged sale is required.'; end if;
  if p_type not in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Invalid completion document type.'; end if;
  if (p_type='statement_of_account' and a.completed_at is null) or (p_type<>'statement_of_account' and a.completed_at is not null) then raise exception 'Final accounts follow legal completion; statements and correspondence precede it.'; end if;
  perform set_config('app.sales_legal_write','on',true);
  select * into d from unit_sale_documents where sale_attempt_id=p_sale and document_type=p_type and redacted_at is null and superseded_at is null for update;
  if d.id is null then
    insert into unit_sale_documents(sale_attempt_id,document_type,title,status,visibility,required,created_by_user_id,updated_by_user_id)
      values(p_sale,p_type,case p_type when 'completion_statement' then 'Completion statement' when 'statement_of_account' then 'Final statement of account' else 'Notice PDF' end,
        'uploaded','shared_sale_file',p_type='completion_statement',p_actor,p_actor) returning * into d;
  end if;
  select coalesce(max(version_number),0)+1 into n from unit_sale_document_versions where document_id=d.id;
  update unit_sale_document_versions set is_current=false where document_id=d.id and is_current;
  insert into unit_sale_document_versions(document_id,version_number,is_current,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,uploaded_by_user_id)
    values(d.id,n,true,'sale-documents',p_file->>'path',p_file->>'name','application/pdf',(p_file->>'size')::bigint,p_actor) returning id into vid;
  update unit_sale_documents set status='uploaded',approved_version_id=null,approved_at=null,approved_by_user_id=null,query_note=null,updated_by_user_id=p_actor,updated_at=now() where id=d.id;
  if p_type='completion_statement' then update unit_sale_attempts set workflow_status='exchanged' where id=p_sale and completed_at is null; end if;
  return vid;
end $$;


--
-- Name: sales_legal_register_document_before_package(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_register_document_before_package(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a unit_sale_attempts%rowtype;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_type='completion_correspondence' then raise exception 'Use the notice submission to save or replace the notice PDF.'; end if;
  if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements and the notice PDF first.'; end if;
  return public.sales_legal_register_document_before_notice(p_sale,p_actor,p_type,p_file);
end $$;


--
-- Name: sales_legal_snapshot(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_snapshot(p_sale uuid, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb; timing jsonb;
begin
  result:=public.sales_legal_snapshot_before_further_deposit(p_sale,p_actor);
  select further_deposit_timing into timing from unit_sale_terms where id=(result#>>'{terms,id}')::uuid and sale_attempt_id=p_sale;
  return jsonb_set(result,'{terms,further_deposit_timing}',coalesce(timing,'null'::jsonb));
end $$;


--
-- Name: sales_legal_snapshot_before_further_deposit(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_snapshot_before_further_deposit(p_sale uuid, p_actor uuid DEFAULT auth.uid()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result jsonb; sale_status text;
begin
  perform public.sales_legal_assert(p_sale,p_actor);
  select jsonb_build_object('sale_id',a.id,'unit_id',a.unit_id,'building',jsonb_build_object('id',b.id,'name',b.name,'seller_name',b.seller_name,'completion_information',b.completion_information),
    'plot',u.unit_number,'buyer',coalesce(nullif(concat_ws(' / ',nullif(a.buyer_person_name,''),nullif(a.buyer_company_name,'')),''),a.buyer_name),
    'terms',jsonb_build_object('id',t.id,'version_number',t.version_number,'contract_price',t.contract_price,'reservation_fee',t.reservation_fee,'reservation_fee_holder',t.reservation_fee_holder,
      'exchange_deposit_percent',t.exchange_deposit_percent,'deposit_summary',t.deposit_summary,'second_deposit_enabled',to_jsonb(t)->'second_deposit_enabled',
      'second_deposit_percent',to_jsonb(t)->'second_deposit_percent','second_deposit_months_after_exchange',to_jsonb(t)->'second_deposit_months_after_exchange',
      'completion_balance_percent',to_jsonb(t)->'completion_balance_percent','developer_contribution',t.developer_contribution,'agent_contribution',t.agent_contribution,
      'other_concessions',t.other_concessions,'parking_value',t.parking_value,'parking_contribution_value',t.parking_contribution_value,'parking_location_details',t.parking_location_details,
      'additional_special_conditions',t.additional_special_conditions,'commercial_summary',t.commercial_summary),
    'schedule',coalesce((select jsonb_agg(jsonb_build_object('payment_stage',s.payment_stage,'label',s.label,'due_event',s.due_event,'due_offset_days',s.due_offset_days,
      'percent_of_contract_price',s.percent_of_contract_price,'fixed_amount',s.fixed_amount,'expected_amount',s.expected_amount,'includes_reservation_fee',s.includes_reservation_fee,'notes',s.notes) order by s.sequence_no)
      from unit_sale_payment_schedule s where s.sale_attempt_id=a.id and (s.sale_terms_id=t.id or s.sale_terms_id is null)),'[]'),
    'conveyancer',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.name,'type',c.type,'shared_system_email',c.shared_system_email) end,
    'sales_agent',case when g.id is not null then jsonb_build_object('id',g.id,'name',g.name,'type',g.type,'shared_system_email',g.shared_system_email) end,
    'approver',jsonb_build_object('id',p.id,'name',coalesce(nullif(p.full_name,''),nullif(p.name,''),'Unknown user')))
  into result from unit_sale_attempts a join buildings b on b.id=a.building_id join units u on u.id=a.unit_id
    left join unit_sale_terms t on t.sale_attempt_id=a.id and t.is_current
    left join organisations c on c.id=b.conveyancer_organisation_id left join organisations g on g.id=b.sales_agent_organisation_id
    join profiles p on p.id=p_actor where a.id=p_sale;
  select workflow_status into sale_status from unit_sale_attempts where id=p_sale;
  if not exists(select 1 from profiles where id=p_actor and role in ('admin','developer')) and sale_status not in ('approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange','exchanged','completion_pending','completed') then
    result:=jsonb_set(jsonb_set(result,'{terms}','{}'),'{schedule}','[]');
  end if;
  return result;
end $$;


--
-- Name: sales_legal_submit_notice(uuid, uuid, uuid, jsonb, text, text, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_submit_notice(p_sale uuid, p_actor uuid, p_request uuid, p_file jsonb, p_notice text DEFAULT NULL::text, p_due text DEFAULT NULL::text, p_replace boolean DEFAULT false, p_expected uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare a unit_sale_attempts%rowtype; v unit_sale_document_versions%rowtype; current_id uuid; vid uuid; notice_date date; due_date date;
begin
  perform public.sales_legal_assert(p_sale,p_actor,array['conveyancer']);
  select * into a from unit_sale_attempts where id=p_sale for update;
  if p_request is null then raise exception 'A submission reference is required.'; end if;
  select * into v from unit_sale_document_versions where notice_submission_id=p_request;
  if found then
    if v.uploaded_by_user_id<>p_actor or not exists(select 1 from unit_sale_documents where id=v.document_id and sale_attempt_id=p_sale) then raise exception 'Submission reference conflict.'; end if;
    return jsonb_build_object('versionId',v.id,'path',v.storage_path,'duplicate',true);
  end if;
  if not a.is_active or a.redacted_at is not null or a.exchanged_at is null or a.completed_at is not null then raise exception 'An active exchanged sale awaiting completion is required.'; end if;
  if a.completion_authority_given_at is null and a.completion_legacy_stage is null then raise exception 'Awaiting developer authority to serve notice'; end if;
  if coalesce((p_file->>'size')::bigint,0) not between 1 and 10485760 or coalesce(p_file->>'name','') !~* '\.pdf$'
    or p_file->>'mime' is distinct from 'application/pdf' or coalesce(p_file->>'path','') not like a.building_id::text||'/'||p_sale::text||'/%' then raise exception 'Choose a PDF up to 10 MB.'; end if;
  select version.id into current_id from unit_sale_documents document join unit_sale_document_versions version on version.document_id=document.id
    where document.sale_attempt_id=p_sale and document.document_type='completion_correspondence' and document.redacted_at is null and document.superseded_at is null and version.is_current and version.redacted_at is null;
  if p_replace then
    if a.completion_arrangements_confirmed_at is null and a.completion_legacy_stage is distinct from 'arrangements' then raise exception 'Confirm completion arrangements first.'; end if;
    if current_id is distinct from p_expected then raise exception 'Notice PDF changed. Refresh before replacing it.'; end if;
  else
    if a.completion_arrangements_confirmed_at is not null or a.completion_legacy_stage='arrangements' then raise exception 'Completion arrangements are already confirmed. Refresh to view them.'; end if;
    if coalesce(p_notice,'') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_due,'') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Both calendar dates are required.'; end if;
    notice_date:=p_notice::date; due_date:=p_due::date;
    if due_date<notice_date then raise exception 'Completion due date cannot be earlier than the notice issue date.'; end if;
  end if;
  vid:=public.sales_legal_register_document_before_notice(p_sale,p_actor,'completion_correspondence',p_file);
  update unit_sale_document_versions set notice_submission_id=p_request where id=vid;
  if not p_replace then
    update unit_sale_attempts set completion_notice_issued_at=notice_date,contractual_completion_date=due_date,
      completion_arrangements_confirmed_at=now(),completion_arrangements_confirmed_by=p_actor,updated_at=now(),updated_by_user_id=p_actor where id=p_sale;
    perform public.sales_legal_event(p_sale,p_actor,'completion_arrangements_confirmed','Completion arrangements confirmed',jsonb_build_object('noticeDate',notice_date,'completionDate',due_date,'versionId',vid));
  end if;
  return jsonb_build_object('versionId',vid,'path',p_file->>'path');
end $_$;


--
-- Name: sales_legal_unit_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_unit_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op='INSERT' and new.sale_status in ('completed','handed_over') then raise exception 'New units must progress through legal completion before handover.'; end if;
  if new.sale_status='completed' and old.sale_status is distinct from new.sale_status and not exists(select 1 from unit_sale_attempts where unit_id=new.id and is_active and legal_completed_at is not null) then
    raise exception 'Conveyancer confirmation of legal completion is required before handover or key release.';
  end if;
  return new;
end $$;


--
-- Name: sales_legal_write_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_legal_write_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare sale_id uuid; a unit_sale_attempts%rowtype; doc_type text;
begin
  if coalesce(current_setting('app.sales_legal_write',true),'')='on' then return new; end if;
  if tg_table_name='unit_sale_attempts' then
    if tg_op='INSERT' then
      if new.exchanged_at is not null or new.completed_at is not null or new.legal_completed_at is not null or new.contractual_completion_date is not null or new.authority_requested_at is not null or new.workflow_status in ('exchanged','completion_pending','completed') then raise exception 'Use the legal workflow for confirmations.'; end if;
    elsif (new.exchanged_at,new.completed_at,new.legal_completed_at,new.legal_completed_by,new.contractual_completion_date,new.completion_notice_issued_at,new.authority_requested_at)
      is distinct from (old.exchanged_at,old.completed_at,old.legal_completed_at,old.legal_completed_by,old.contractual_completion_date,old.completion_notice_issued_at,old.authority_requested_at)
      or (new.workflow_status is distinct from old.workflow_status and new.workflow_status in ('exchanged','completion_pending','completed')) then raise exception 'Use the legal workflow for confirmations.';
    end if;
    if tg_op='INSERT' or (new.buyer_name,new.buyer_person_name,new.buyer_company_name,new.is_active,new.redacted_at,new.workflow_status in ('fallen_through','superseded'))
      is not distinct from (old.buyer_name,old.buyer_person_name,old.buyer_company_name,old.is_active,old.redacted_at,old.workflow_status in ('fallen_through','superseded')) then return new; end if;
    sale_id:=new.id;
  elsif tg_table_name='unit_sale_documents' then
    if coalesce(new.document_type,old.document_type) in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Use the legal workflow for completion documents.'; end if; return coalesce(new,old);
  elsif tg_table_name='unit_sale_document_versions' then
    select document_type into doc_type from unit_sale_documents where id=coalesce(new.document_id,old.document_id);
    if doc_type in ('completion_statement','statement_of_account','completion_correspondence') then raise exception 'Use the legal workflow for completion document versions.'; end if; return coalesce(new,old);
  else sale_id:=coalesce(new.sale_attempt_id,old.sale_attempt_id);
  end if;
  select * into a from unit_sale_attempts where id=sale_id for update;
  if a.exchanged_at is not null or exists(select 1 from sale_legal_emails where sale_attempt_id=sale_id and kind='authority' and revoked_at is null and replaced_by is null
    and (expires_at>now() or delivery_status in ('pending','sending','unknown'))) then raise exception 'Authorised terms are locked. Revoke unexchanged authority before changing the agreed terms.'; end if;
  return coalesce(new,old);
end $$;


--
-- Name: sales_notice_state_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sales_notice_state_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if coalesce(current_setting('app.sales_legal_write',true),'')<>'on' and (
    (tg_op='INSERT' and (new.completion_authority_requested_at is not null or new.completion_authority_requested_by is not null
      or new.completion_authority_given_at is not null or new.completion_authority_given_by is not null
      or new.completion_arrangements_confirmed_at is not null or new.completion_arrangements_confirmed_by is not null or new.completion_legacy_stage is not null))
    or (tg_op='UPDATE' and (new.completion_authority_requested_at,new.completion_authority_requested_by,new.completion_authority_given_at,new.completion_authority_given_by,
      new.completion_arrangements_confirmed_at,new.completion_arrangements_confirmed_by,new.completion_legacy_stage) is distinct from
      (old.completion_authority_requested_at,old.completion_authority_requested_by,old.completion_authority_given_at,old.completion_authority_given_by,
      old.completion_arrangements_confirmed_at,old.completion_arrangements_confirmed_by,old.completion_legacy_stage))) then
    raise exception 'Use the legal workflow for completion authority and confirmation.';
  end if;
  return new;
end $function$;


--
-- Name: sales_notice_version_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_notice_version_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if exists(select 1 from unit_sale_documents where id=old.document_id and document_type='completion_correspondence') then
    if tg_op='DELETE' or (to_jsonb(new)-array['is_current','notice_submission_id']) is distinct from (to_jsonb(old)-array['is_current','notice_submission_id'])
      or (old.notice_submission_id is not null and new.notice_submission_id is distinct from old.notice_submission_id) then raise exception 'Notice document versions are immutable.'; end if;
  end if;
  return new;
end $$;


--
-- Name: sales_workflow_mark_unit_completed(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_workflow_mark_unit_completed(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true and attempt.workflow_status = 'completed'
  ) then raise exception 'A completed active sale file is required before marking a unit Completed.'; end if;
  if v_unit.sale_status not in ('exchanged', 'completed') then raise exception 'Only an Exchanged unit can progress to Completed.'; end if;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units
  set sale_status = 'completed',
      rental_portfolio_status = case when rental_portfolio_status = 'active' then 'exited' else rental_portfolio_status end,
      updated_at = now()
  where id = p_unit_id;

  if v_unit.rental_portfolio_status = 'active' then
    insert into public.audit_events (
      event_type, entity_type, entity_id, summary, metadata, created_by_user_id
    ) values (
      'unit_exited_rental_portfolio',
      'unit',
      v_unit.id,
      format('Unit %s exited the rental portfolio on legal completion.', v_unit.unit_number),
      jsonb_build_object(
        'building_id', v_unit.building_id,
        'unit_id', v_unit.id,
        'unit_number', v_unit.unit_number,
        'old_sale_status', v_unit.sale_status,
        'new_sale_status', 'completed',
        'old_rental_portfolio_status', 'active',
        'new_rental_portfolio_status', 'exited',
        'source', coalesce(nullif(trim(p_source), ''), 'sales_workflow_completion'),
        'acting_user', p_actor_user_id,
        'batch_identifier', v_batch_id,
        'related_sale_attempt', p_sale_attempt_id
      ),
      p_actor_user_id
    );
  end if;
end;
$$;


--
-- Name: sales_workflow_mark_unit_exchanged(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_workflow_mark_unit_exchanged(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true and attempt.workflow_status = 'exchanged'
  ) then raise exception 'An exchanged active sale file is required before marking a unit Exchanged.'; end if;
  if v_unit.sale_status not in ('reserved', 'exchanged') then raise exception 'Only a Reserved unit can progress to Exchanged.'; end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'exchanged', updated_at = now() where id = p_unit_id;
end;
$$;


--
-- Name: sales_workflow_mark_unit_for_sale(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_workflow_mark_unit_for_sale(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_workflow_status text;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer', 'sales_agent', 'conveyancer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  select attempt.workflow_status into v_workflow_status
  from public.unit_sale_attempts attempt
  where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id;

  if v_unit.id is null or v_workflow_status is null then raise exception 'Sale unit or sale attempt not found.'; end if;
  if v_workflow_status not in ('draft', 'awaiting_approval', 'reservation_submitted', 'rejected', 'reservation_query_raised', 'fallen_through') then
    raise exception 'The sale file is not in a state that can return the unit to For sale.';
  end if;
  if v_unit.sale_status in ('not_released', 'not_for_sale', 'completed', 'handed_over') then
    raise exception 'This unit cannot enter the sales workflow from its current sales position.';
  end if;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'for_sale', updated_at = now() where id = p_unit_id;
end;
$$;


--
-- Name: sales_workflow_mark_unit_reserved(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_workflow_mark_unit_reserved(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);
  select unit.* into v_unit from public.units unit where unit.id = p_unit_id for update;
  if v_unit.id is null or not exists (
    select 1 from public.unit_sale_attempts attempt
    where attempt.id = p_sale_attempt_id and attempt.unit_id = p_unit_id
      and attempt.is_active is true
      and attempt.workflow_status in ('approved', 'reservation_approved')
  ) then raise exception 'An approved active sale file is required before marking a unit Reserved.'; end if;
  if v_unit.sale_status <> 'for_sale' then raise exception 'Only a For sale unit can be marked Reserved.'; end if;
  perform set_config('app.unit_commercial_mutation', 'on', true);
  update public.units set sale_status = 'reserved', updated_at = now() where id = p_unit_id;
end;
$$;


--
-- Name: save_portal_user_access(uuid, jsonb, uuid[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_portal_user_access(p_user uuid, p_profile jsonb, p_buildings uuid[], p_units jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: save_unit_commercial_model(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, boolean, numeric, integer, numeric, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb) RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
  v_terms public.unit_sale_terms%rowtype;
  v_now timestamptz := now();
  v_row jsonb;
begin
  select *
  into v_unit
  from public.units
  where public.units.id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit not found.';
  end if;

  select *
  into v_attempt
  from public.unit_sale_attempts
  where public.unit_sale_attempts.unit_id = p_unit_id
    and public.unit_sale_attempts.is_active is true
  order by public.unit_sale_attempts.attempt_number desc
  limit 1
  for update;

  if not found then
    insert into public.unit_sale_attempts (
      building_id,
      unit_id,
      attempt_number,
      workflow_status,
      is_active,
      stage_entered_at,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_unit.building_id,
      v_unit.id,
      coalesce((select max(usa.attempt_number) + 1 from public.unit_sale_attempts usa where usa.unit_id = v_unit.id), 1),
      'draft',
      true,
      v_now,
      p_requester_id,
      p_requester_id
    )
    returning * into v_attempt;
  end if;

  if v_attempt.workflow_status in ('fallen_through', 'superseded', 'completed') then
    raise exception 'This commercial model cannot be edited.';
  end if;

  select *
  into v_terms
  from public.unit_sale_terms
  where public.unit_sale_terms.sale_attempt_id = v_attempt.id
    and public.unit_sale_terms.is_current is true
  limit 1
  for update;

  if found then
    update public.unit_sale_terms
    set
      list_price_at_offer = p_list_price_at_offer,
      contract_price = p_contract_price,
      parking_value = coalesce(p_parking_value, 0),
      developer_contribution = coalesce(p_developer_contribution, 0),
      agent_contribution = coalesce(p_agent_contribution, 0),
      reservation_fee = p_reservation_fee,
      reservation_fee_holder = p_reservation_fee_holder,
      agent_fee_percent = p_agent_fee_percent,
      vat_rate = coalesce(p_vat_rate, 20),
      solicitor_fee = p_solicitor_fee,
      exchange_deposit_percent = p_exchange_deposit_percent,
      second_deposit_enabled = coalesce(p_second_deposit_enabled, false),
      second_deposit_percent = p_second_deposit_percent,
      second_deposit_months_after_exchange = p_second_deposit_months_after_exchange,
      completion_balance_percent = p_completion_balance_percent,
      deposit_summary = p_deposit_summary,
      commercial_summary = p_commercial_summary,
      updated_by_user_id = p_requester_id,
      updated_at = v_now
    where public.unit_sale_terms.id = v_terms.id
    returning * into v_terms;
  else
    insert into public.unit_sale_terms (
      sale_attempt_id,
      version_number,
      is_current,
      status,
      list_price_at_offer,
      contract_price,
      parking_value,
      developer_contribution,
      agent_contribution,
      reservation_fee,
      reservation_fee_holder,
      agent_fee_percent,
      vat_rate,
      solicitor_fee,
      exchange_deposit_percent,
      second_deposit_enabled,
      second_deposit_percent,
      second_deposit_months_after_exchange,
      completion_balance_percent,
      deposit_summary,
      commercial_summary,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      1,
      true,
      case when v_attempt.workflow_status = 'draft' then 'draft' else 'submitted' end,
      p_list_price_at_offer,
      p_contract_price,
      coalesce(p_parking_value, 0),
      coalesce(p_developer_contribution, 0),
      coalesce(p_agent_contribution, 0),
      p_reservation_fee,
      p_reservation_fee_holder,
      p_agent_fee_percent,
      coalesce(p_vat_rate, 20),
      p_solicitor_fee,
      p_exchange_deposit_percent,
      coalesce(p_second_deposit_enabled, false),
      p_second_deposit_percent,
      p_second_deposit_months_after_exchange,
      p_completion_balance_percent,
      p_deposit_summary,
      p_commercial_summary,
      p_requester_id,
      p_requester_id
    )
    returning * into v_terms;
  end if;

  delete from public.unit_sale_payment_schedule
  where public.unit_sale_payment_schedule.sale_attempt_id = v_attempt.id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payment_schedule, '[]'::jsonb))
  loop
    insert into public.unit_sale_payment_schedule (
      sale_attempt_id,
      sale_terms_id,
      sequence_no,
      payment_stage,
      label,
      due_event,
      due_offset_days,
      percent_of_contract_price,
      fixed_amount,
      expected_amount,
      includes_reservation_fee,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      v_terms.id,
      (v_row ->> 'sequenceNo')::integer,
      v_row ->> 'paymentStage',
      v_row ->> 'label',
      v_row ->> 'dueEvent',
      nullif(v_row ->> 'dueOffsetDays', '')::integer,
      nullif(v_row ->> 'percentOfContractPrice', '')::numeric,
      nullif(v_row ->> 'fixedAmount', '')::numeric,
      nullif(v_row ->> 'expectedAmount', '')::numeric,
      coalesce((v_row ->> 'includesReservationFee')::boolean, false),
      p_requester_id,
      p_requester_id
    );
  end loop;

  sale_attempt_id := v_attempt.id;
  sale_terms_id := v_terms.id;
  return next;
end;
$$;


--
-- Name: save_unit_commercial_model(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, boolean, numeric, integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_developer_contribution_value numeric DEFAULT NULL::numeric, p_developer_contribution_value_type text DEFAULT 'amount'::text, p_agent_contribution_value numeric DEFAULT NULL::numeric, p_agent_contribution_value_type text DEFAULT 'amount'::text, p_parking_contribution_value numeric DEFAULT 0, p_parking_location_details text DEFAULT NULL::text, p_additional_special_conditions text[] DEFAULT '{}'::text[]) RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_attempt public.unit_sale_attempts%rowtype;
  v_terms public.unit_sale_terms%rowtype;
  v_now timestamptz := now();
  v_row jsonb;
begin
  select *
  into v_unit
  from public.units
  where public.units.id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit not found.';
  end if;

  select *
  into v_attempt
  from public.unit_sale_attempts
  where public.unit_sale_attempts.unit_id = p_unit_id
    and public.unit_sale_attempts.is_active is true
  order by public.unit_sale_attempts.attempt_number desc
  limit 1
  for update;

  if not found then
    insert into public.unit_sale_attempts (
      building_id,
      unit_id,
      attempt_number,
      workflow_status,
      is_active,
      stage_entered_at,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_unit.building_id,
      v_unit.id,
      coalesce((select max(usa.attempt_number) + 1 from public.unit_sale_attempts usa where usa.unit_id = v_unit.id), 1),
      'draft',
      true,
      v_now,
      p_requester_id,
      p_requester_id
    )
    returning * into v_attempt;
  end if;

  if v_attempt.workflow_status in ('fallen_through', 'superseded', 'completed') then
    raise exception 'This commercial model cannot be edited.';
  end if;

  select *
  into v_terms
  from public.unit_sale_terms
  where public.unit_sale_terms.sale_attempt_id = v_attempt.id
    and public.unit_sale_terms.is_current is true
  limit 1
  for update;

  if found then
    update public.unit_sale_terms
    set
      list_price_at_offer = p_list_price_at_offer,
      contract_price = p_contract_price,
      parking_value = coalesce(p_parking_value, 0),
      developer_contribution = coalesce(p_developer_contribution, 0),
      agent_contribution = coalesce(p_agent_contribution, 0),
      developer_contribution_value = coalesce(p_developer_contribution_value, p_developer_contribution, 0),
      developer_contribution_value_type = coalesce(p_developer_contribution_value_type, 'amount'),
      agent_contribution_value = coalesce(p_agent_contribution_value, p_agent_contribution, 0),
      agent_contribution_value_type = coalesce(p_agent_contribution_value_type, 'amount'),
      parking_contribution_value = coalesce(p_parking_contribution_value, 0),
      parking_location_details = p_parking_location_details,
      additional_special_conditions = coalesce(p_additional_special_conditions, '{}'::text[]),
      reservation_fee = p_reservation_fee,
      reservation_fee_holder = p_reservation_fee_holder,
      agent_fee_percent = p_agent_fee_percent,
      vat_rate = coalesce(p_vat_rate, 20),
      solicitor_fee = p_solicitor_fee,
      exchange_deposit_percent = p_exchange_deposit_percent,
      second_deposit_enabled = coalesce(p_second_deposit_enabled, false),
      second_deposit_percent = p_second_deposit_percent,
      second_deposit_months_after_exchange = p_second_deposit_months_after_exchange,
      completion_balance_percent = p_completion_balance_percent,
      deposit_summary = p_deposit_summary,
      commercial_summary = p_commercial_summary,
      updated_by_user_id = p_requester_id,
      updated_at = v_now
    where public.unit_sale_terms.id = v_terms.id
    returning * into v_terms;
  else
    insert into public.unit_sale_terms (
      sale_attempt_id,
      version_number,
      is_current,
      status,
      list_price_at_offer,
      contract_price,
      parking_value,
      developer_contribution,
      agent_contribution,
      developer_contribution_value,
      developer_contribution_value_type,
      agent_contribution_value,
      agent_contribution_value_type,
      parking_contribution_value,
      parking_location_details,
      additional_special_conditions,
      reservation_fee,
      reservation_fee_holder,
      agent_fee_percent,
      vat_rate,
      solicitor_fee,
      exchange_deposit_percent,
      second_deposit_enabled,
      second_deposit_percent,
      second_deposit_months_after_exchange,
      completion_balance_percent,
      deposit_summary,
      commercial_summary,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      1,
      true,
      case when v_attempt.workflow_status = 'draft' then 'draft' else 'submitted' end,
      p_list_price_at_offer,
      p_contract_price,
      coalesce(p_parking_value, 0),
      coalesce(p_developer_contribution, 0),
      coalesce(p_agent_contribution, 0),
      coalesce(p_developer_contribution_value, p_developer_contribution, 0),
      coalesce(p_developer_contribution_value_type, 'amount'),
      coalesce(p_agent_contribution_value, p_agent_contribution, 0),
      coalesce(p_agent_contribution_value_type, 'amount'),
      coalesce(p_parking_contribution_value, 0),
      p_parking_location_details,
      coalesce(p_additional_special_conditions, '{}'::text[]),
      p_reservation_fee,
      p_reservation_fee_holder,
      p_agent_fee_percent,
      coalesce(p_vat_rate, 20),
      p_solicitor_fee,
      p_exchange_deposit_percent,
      coalesce(p_second_deposit_enabled, false),
      p_second_deposit_percent,
      p_second_deposit_months_after_exchange,
      p_completion_balance_percent,
      p_deposit_summary,
      p_commercial_summary,
      p_requester_id,
      p_requester_id
    )
    returning * into v_terms;
  end if;

  delete from public.unit_sale_payment_schedule
  where public.unit_sale_payment_schedule.sale_attempt_id = v_attempt.id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payment_schedule, '[]'::jsonb))
  loop
    insert into public.unit_sale_payment_schedule (
      sale_attempt_id,
      sale_terms_id,
      sequence_no,
      payment_stage,
      label,
      due_event,
      due_offset_days,
      percent_of_contract_price,
      fixed_amount,
      expected_amount,
      includes_reservation_fee,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      v_attempt.id,
      v_terms.id,
      (v_row ->> 'sequenceNo')::integer,
      v_row ->> 'paymentStage',
      v_row ->> 'label',
      v_row ->> 'dueEvent',
      nullif(v_row ->> 'dueOffsetDays', '')::integer,
      nullif(v_row ->> 'percentOfContractPrice', '')::numeric,
      nullif(v_row ->> 'fixedAmount', '')::numeric,
      nullif(v_row ->> 'expectedAmount', '')::numeric,
      coalesce((v_row ->> 'includesReservationFee')::boolean, false),
      p_requester_id,
      p_requester_id
    );
  end loop;

  sale_attempt_id := v_attempt.id;
  sale_terms_id := v_terms.id;
  return next;
end;
$$;


--
-- Name: save_unit_commercial_model_with_agent_fees(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_unit_commercial_model_with_agent_fees(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_developer_contribution_value numeric DEFAULT NULL::numeric, p_developer_contribution_value_type text DEFAULT 'amount'::text, p_agent_contribution_value numeric DEFAULT NULL::numeric, p_agent_contribution_value_type text DEFAULT 'amount'::text, p_parking_contribution_value numeric DEFAULT 0, p_parking_location_details text DEFAULT NULL::text, p_additional_special_conditions text[] DEFAULT '{}'::text[]) RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    exchange_agent_fee_percent = coalesce(p_exchange_agent_fee_percent, 0),
    completion_agent_fee_percent = coalesce(p_completion_agent_fee_percent, 0)
  where id = v_result.sale_terms_id;

  sale_attempt_id := v_result.sale_attempt_id;
  sale_terms_id := v_result.sale_terms_id;
  return next;
end;
$$;


--
-- Name: save_unit_commercial_model_with_deposits(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, integer, numeric, text, text, jsonb, numeric, text, numeric, text, numeric, text, text[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_developer_contribution_value numeric DEFAULT NULL::numeric, p_developer_contribution_value_type text DEFAULT 'amount'::text, p_agent_contribution_value numeric DEFAULT NULL::numeric, p_agent_contribution_value_type text DEFAULT 'amount'::text, p_parking_contribution_value numeric DEFAULT 0, p_parking_location_details text DEFAULT NULL::text, p_additional_special_conditions text[] DEFAULT '{}'::text[], p_further_deposit_timing jsonb DEFAULT NULL::jsonb) RETURNS TABLE(sale_attempt_id uuid, sale_terms_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_sale_attempt_stage_entered_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_sale_attempt_stage_entered_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at = coalesce(new.stage_entered_at, new.created_at, now());
  else
    new.stage_entered_at = coalesce(new.stage_entered_at, old.stage_entered_at);
  end if;

  return new;
end;
$$;


--
-- Name: set_unit_rental_portfolio_status(uuid[], text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_unit_rental_portfolio_status(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_changed integer := 0;
  v_event_type text;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
    raise exception 'Choose at least one unit.';
  end if;
  if p_target_status not in ('active', 'exited') then
    raise exception 'Choose a valid rental-portfolio action.';
  end if;
  if (select count(*) from unnest(p_unit_ids) requested(id)) <> (select count(distinct id) from unnest(p_unit_ids) requested(id)) then
    raise exception 'The unit selection contains duplicates.';
  end if;
  if (select count(*) from public.units unit where unit.id = any(p_unit_ids)) <> array_length(p_unit_ids, 1) then
    raise exception 'One or more selected units could not be found.';
  end if;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
    for update
  loop
    if p_target_status = 'active'
       and v_unit.sale_status not in ('not_for_sale', 'for_sale', 'reserved', 'exchanged') then
      raise exception 'Unit % cannot enter the rental portfolio while its sales position is %.', v_unit.unit_number, v_unit.sale_status;
    end if;
    if p_target_status = 'exited' and v_unit.rental_portfolio_status <> 'active' then
      raise exception 'Unit % is not currently in the rental portfolio.', v_unit.unit_number;
    end if;
  end loop;

  perform set_config('app.unit_commercial_mutation', 'on', true);
  v_event_type := case when p_target_status = 'active' then 'unit_added_to_rental_portfolio' else 'unit_exited_rental_portfolio' end;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.rental_portfolio_status is distinct from p_target_status then
      update public.units
      set rental_portfolio_status = p_target_status,
          updated_at = now()
      where id = v_unit.id;

      insert into public.audit_events (
        event_type,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_by_user_id
      ) values (
        v_event_type,
        'unit',
        v_unit.id,
        case when p_target_status = 'active'
          then format('Unit %s added to the rental portfolio.', v_unit.unit_number)
          else format('Unit %s exited the rental portfolio.', v_unit.unit_number)
        end,
        jsonb_build_object(
          'building_id', v_unit.building_id,
          'unit_id', v_unit.id,
          'unit_number', v_unit.unit_number,
          'old_sale_status', v_unit.sale_status,
          'new_sale_status', v_unit.sale_status,
          'old_rental_portfolio_status', v_unit.rental_portfolio_status,
          'new_rental_portfolio_status', p_target_status,
          'source', coalesce(nullif(trim(p_source), ''), 'unit_allocation'),
          'acting_user', p_actor_user_id,
          'batch_identifier', v_batch_id,
          'related_sale_attempt', null
        ),
        p_actor_user_id
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;


--
-- Name: set_unit_sales_availability(uuid[], text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_unit_sales_availability(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_changed integer := 0;
  v_blocking_unit_numbers text;
  v_blocking_count integer := 0;
begin
  perform public.assert_commercial_unit_actor(p_actor_user_id, array['admin', 'developer']);

  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
    raise exception 'Choose at least one unit.';
  end if;
  if p_target_status not in ('not_released', 'not_for_sale', 'for_sale') then
    raise exception 'Choose a valid administrative sales availability.';
  end if;
  if (select count(*) from unnest(p_unit_ids) requested(id)) <> (select count(distinct id) from unnest(p_unit_ids) requested(id)) then
    raise exception 'The unit selection contains duplicates.';
  end if;
  if (select count(*) from public.units unit where unit.id = any(p_unit_ids)) <> array_length(p_unit_ids, 1) then
    raise exception 'One or more selected units could not be found.';
  end if;

  -- Lock every unit and active attempt in a stable order before validating. The
  -- same transaction either changes and audits the full selection or changes none.
  perform unit.id
  from public.units unit
  where unit.id = any(p_unit_ids)
  order by unit.id
  for update;

  perform attempt.id
  from public.unit_sale_attempts attempt
  where attempt.unit_id = any(p_unit_ids)
    and attempt.is_active is true
  order by attempt.id
  for update;

  select count(*), string_agg(unit.unit_number, ', ' order by unit.unit_number)
  into v_blocking_count, v_blocking_unit_numbers
  from public.units unit
  where unit.id = any(p_unit_ids)
    and exists (
      select 1
      from public.unit_sale_attempts attempt
      where attempt.unit_id = unit.id
        and attempt.is_active is true
        and public.sale_attempt_blocks_unit_allocation(attempt.id)
    );

  if v_blocking_count = 1 then
    raise exception 'Unit % has a sales workflow in progress. Resolve the sales workflow before changing its sales availability.', v_blocking_unit_numbers;
  elsif v_blocking_count > 1 then
    raise exception 'Units % have sales workflows in progress. Resolve those sales workflows before changing their sales availability.', v_blocking_unit_numbers;
  end if;

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.sale_status not in ('not_released', 'not_for_sale', 'for_sale') then
      raise exception 'Unit % is controlled by the formal sales workflow and cannot be changed through Unit Allocation.', v_unit.unit_number;
    end if;
  end loop;

  perform set_config('app.unit_commercial_mutation', 'on', true);

  for v_unit in
    select unit.*
    from public.units unit
    where unit.id = any(p_unit_ids)
    order by unit.id
  loop
    if v_unit.sale_status is distinct from p_target_status then
      update public.units
      set sale_status = p_target_status,
          updated_at = now()
      where id = v_unit.id;

      insert into public.audit_events (
        event_type,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_by_user_id
      ) values (
        'unit_sales_availability_changed',
        'unit',
        v_unit.id,
        format('Unit %s sales availability changed from %s to %s.', v_unit.unit_number, v_unit.sale_status, p_target_status),
        jsonb_build_object(
          'building_id', v_unit.building_id,
          'unit_id', v_unit.id,
          'unit_number', v_unit.unit_number,
          'old_sale_status', v_unit.sale_status,
          'new_sale_status', p_target_status,
          'old_rental_portfolio_status', v_unit.rental_portfolio_status,
          'new_rental_portfolio_status', v_unit.rental_portfolio_status,
          'source', coalesce(nullif(trim(p_source), ''), 'unit_allocation'),
          'acting_user', p_actor_user_id,
          'batch_identifier', v_batch_id,
          'related_sale_attempt', null
        ),
        p_actor_user_id
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: stamp_unit_sale_invoice_payment_recorder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_unit_sale_invoice_payment_recorder() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.recorded_by_user_id is not null then
    select
      coalesce(profile.full_name, profile.name, profile.email),
      profile.email,
      organisation.name
    into
      new.recorded_by_name,
      new.recorded_by_email,
      new.recorded_by_organisation_name
    from public.profiles profile
    left join public.organisations organisation on organisation.id = profile.organisation_id
    where profile.id = new.recorded_by_user_id;
  end if;

  return new;
end;
$$;


--
-- Name: update_unit_tenancy(uuid, uuid, text, date, date, date, numeric, integer, numeric, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) RETURNS public.unit_tenancies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old public.unit_tenancies%rowtype;
  v_updated public.unit_tenancies%rowtype;
  v_unit public.units%rowtype;
begin
  perform public.assert_tenancy_manager(p_actor_user_id);
  select * into v_old from public.unit_tenancies where id = p_tenancy_id for update;
  if v_old.id is null then raise exception 'Tenancy not found.'; end if;
  select * into v_unit from public.units where id = v_old.unit_id for update;
  if v_unit.id is null or v_unit.rental_portfolio_status not in ('active', 'exited') then
    raise exception 'The unit is not part of the current or historical rental portfolio.';
  end if;

  update public.unit_tenancies set
    tenant_name = trim(p_tenant_name), tenancy_start_date = p_tenancy_start_date,
    fixed_term_end_date = p_fixed_term_end_date, tenancy_end_date = p_tenancy_end_date,
    monthly_rent = p_monthly_rent, rent_due_day = p_rent_due_day, deposit_amount = p_deposit_amount,
    letting_agent_organisation_id = p_letting_agent_organisation_id, notes = nullif(trim(p_notes), ''),
    source_type = coalesce(nullif(trim(p_source_type), ''), 'manual'), source_reference = nullif(trim(p_source_reference), ''),
    updated_by_user_id = p_actor_user_id
  where id = p_tenancy_id returning * into v_updated;

  insert into public.audit_events (event_type, entity_type, entity_id, summary, metadata, created_by_user_id)
  values ('tenancy_updated', 'unit_tenancy', v_updated.id, format('Tenancy updated for Unit %s.', v_unit.unit_number), jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_updated)), p_actor_user_id);
  return v_updated;
end;
$$;


--
-- Name: validate_active_sale_attempt_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_active_sale_attempt_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_sale_status text;
  v_requires_for_sale boolean := false;
begin
  if new.is_active is not true then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_requires_for_sale := true;
  elsif old.is_active is not true or old.unit_id is distinct from new.unit_id then
    v_requires_for_sale := true;
  elsif old.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
        and new.workflow_status not in ('draft', 'rejected', 'reservation_query_raised', 'fallen_through', 'superseded') then
    v_requires_for_sale := true;
  end if;

  if v_requires_for_sale is not true then
    return new;
  end if;

  select unit.sale_status
  into v_sale_status
  from public.units unit
  where unit.id = new.unit_id
  for update;

  if v_sale_status is null then
    raise exception 'Sale unit not found.';
  end if;
  if v_sale_status <> 'for_sale'
     and not (
       coalesce(current_setting('app.unit_baseline_initialization', true), '') = 'on'
       and new.is_system_baseline is true
       and new.workflow_status = 'draft'
       and v_sale_status in ('not_released', 'not_for_sale')
     ) then
    raise exception 'A reservation or new sale file can only start for a unit that is For sale.';
  end if;

  return new;
end;
$$;


--
-- Name: validate_building_pc_confirmation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_building_pc_confirmation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.pc_confirmed = true and new.pc_date is null then
    raise exception 'Enter the Practical Completion date before confirming PC.';
  end if;

  if new.pc_confirmed = true and new.pc_date > current_date then
    raise exception 'PC can only be confirmed once Practical Completion has actually occurred. Enter today''s date or a past date.';
  end if;

  new.practical_completion_date = new.pc_date;

  if new.pc_confirmed = true and new.pc_date is not null then
    new.defects_liability_end_date = (new.pc_date + interval '12 months')::date;
  end if;

  return new;
end;
$$;


--
-- Name: validate_sale_draft_substantive_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_sale_draft_substantive_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_unit_number text;
  v_sale_status text;
  v_is_system_baseline boolean;
  v_is_baseline_write boolean := false;
begin
  select unit.unit_number, unit.sale_status, attempt.is_system_baseline
  into v_unit_number, v_sale_status, v_is_system_baseline
  from public.unit_sale_attempts attempt
  join public.units unit on unit.id = attempt.unit_id
  where attempt.id = new.sale_attempt_id
    and attempt.is_active is true
    and attempt.workflow_status in ('draft', 'rejected', 'reservation_query_raised')
  for update of unit;

  if not found then
    return new;
  end if;

  -- A direct authenticated write is itself intentional sales preparation. The
  -- portal's two server paths use service_role and explicitly decide whether a
  -- write is baseline setup or substantive Sales work.
  if auth.role() <> 'service_role' then
    update public.unit_sale_attempts
    set is_system_baseline = false,
        updated_at = now()
    where id = new.sale_attempt_id;
  end if;

  if v_sale_status = 'for_sale' then
    return new;
  end if;

  if tg_table_name = 'unit_sale_terms' then
    v_is_baseline_write :=
      auth.role() = 'service_role'
      and
      v_is_system_baseline is true
      and new.status = 'draft'
      and new.approved_by_user_id is null
      and new.approved_at is null
      and nullif(trim(coalesce(new.commercial_summary, '')), '') is null
      and nullif(trim(coalesce(new.parking_location_details, '')), '') is null
      and cardinality(coalesce(new.additional_special_conditions, '{}'::text[])) = 0
      and coalesce(new.developer_contribution_value, new.developer_contribution, 0) = 0
      and coalesce(new.agent_contribution_value, new.agent_contribution, 0) = 0
      and coalesce(new.parking_contribution_value, 0) = 0
      and coalesce(new.other_concessions, 0) = 0
      and (
        new.list_price_at_offer is null
        or new.contract_price is not distinct from new.list_price_at_offer
      );
  elsif tg_table_name = 'unit_sale_payment_schedule' then
    v_is_baseline_write :=
      auth.role() = 'service_role'
      and
      v_is_system_baseline is true
      and new.status = 'pending'
      and nullif(trim(coalesce(new.notes, '')), '') is null;
  end if;

  if not v_is_baseline_write then
    raise exception 'Unit % must be For sale before sales preparation can continue.', v_unit_number;
  end if;

  return new;
end;
$$;


--
-- Name: units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_number text NOT NULL,
    floor text,
    unit_type text,
    size_sqm numeric,
    sale_status text DEFAULT 'not_released'::text NOT NULL,
    completion_date date,
    handover_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_type_id uuid,
    parking_bays integer[],
    reservation_date date,
    rental_portfolio_status text DEFAULT 'not_in_portfolio'::text NOT NULL,
    CONSTRAINT units_rental_portfolio_status_check CHECK ((rental_portfolio_status = ANY (ARRAY['not_in_portfolio'::text, 'active'::text, 'exited'::text]))),
    CONSTRAINT units_sale_status_check CHECK ((sale_status = ANY (ARRAY['not_released'::text, 'not_for_sale'::text, 'for_sale'::text, 'reserved'::text, 'exchanged'::text, 'completed'::text, 'handed_over'::text])))
);


--
-- Name: validate_tenancy_unit_eligibility(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_tenancy_unit_eligibility(p_unit_id uuid, p_tenancy_start_date date, p_tenancy_end_date date) RETURNS public.units
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if v_unit.id is null then raise exception 'Unit not found.'; end if;
  if v_unit.rental_portfolio_status not in ('active', 'exited') then
    raise exception 'The unit is not part of the current or historical rental portfolio.';
  end if;
  if (p_tenancy_end_date is null or p_tenancy_end_date >= current_date)
    and v_unit.rental_portfolio_status <> 'active' then
    raise exception 'Current and future tenancies require an active rental-portfolio unit.';
  end if;
  return v_unit;
end;
$$;


--
-- Name: validate_unit_tenancy_relations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_unit_tenancy_relations() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_unit public.units%rowtype;
  v_agent_type text;
begin
  select * into v_unit from public.units where id = new.unit_id;
  if v_unit.id is null or v_unit.building_id <> new.building_id then
    raise exception 'The tenancy unit does not belong to the selected building.';
  end if;

  if new.letting_agent_organisation_id is not null then
    select type into v_agent_type from public.organisations where id = new.letting_agent_organisation_id;
    if v_agent_type is distinct from 'letting_agent' then
      raise exception 'Choose an organisation with type Letting agent.';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: void_unit_sale_invoice_payment(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid) RETURNS TABLE(payment_id uuid, invoice_id uuid, sale_attempt_id uuid, voided boolean, paid_amount numeric, outstanding_balance numeric, payment_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_invoice public.unit_sale_invoices%rowtype;
  v_payment public.unit_sale_invoice_payments%rowtype;
  v_requester_role text;
  v_requester_active boolean;
  v_cash_payable numeric(14, 2);
  v_paid numeric(14, 2);
  v_outstanding numeric(14, 2);
begin
  if auth.role() <> 'service_role' and p_requester_id is distinct from auth.uid() then
    raise exception 'You cannot void this payment.';
  end if;

  select role, active
  into v_requester_role, v_requester_active
  from public.profiles
  where id = p_requester_id;

  if coalesce(v_requester_active, false) is not true
     or coalesce(v_requester_role, '') not in ('admin', 'developer') then
    raise exception 'Only developers or admins can void agent fee payments.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Add a reason for voiding the payment.';
  end if;

  select payment.*
  into v_payment
  from public.unit_sale_invoice_payments payment
  where payment.id = p_payment_id;

  if not found then
    raise exception 'Agent fee payment not found.';
  end if;

  select invoice.*
  into v_invoice
  from public.unit_sale_invoices invoice
  where invoice.id = v_payment.invoice_id
    and invoice.invoice_type = 'sales_agent'
  for update;

  if not found then
    raise exception 'Sales agent invoice not found.';
  end if;

  select payment.*
  into v_payment
  from public.unit_sale_invoice_payments payment
  where payment.id = p_payment_id
  for update;

  if not found then
    raise exception 'Agent fee payment not found.';
  end if;

  if v_payment.payment_source = 'reservation_fee' then
    raise exception 'Reservation fee credits cannot be voided as cash payments.';
  end if;

  if v_payment.voided_at is null then
    update public.unit_sale_invoice_payments payment
    set
      voided_at = now(),
      voided_by_user_id = p_requester_id,
      void_reason = trim(p_reason)
    where payment.id = v_payment.id;
    voided := true;
  else
    voided := false;
  end if;

  v_cash_payable := greatest(
    0,
    coalesce(
      v_invoice.expected_payable_amount,
      v_invoice.expected_gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      v_invoice.gross_amount - v_invoice.reservation_fee_deduction - v_invoice.agent_contribution_deduction,
      0
    )
  );

  select coalesce(sum(payment.amount), 0)
  into v_paid
  from public.unit_sale_invoice_payments payment
  where payment.invoice_id = v_invoice.id
    and payment.payment_source <> 'reservation_fee'
    and payment.voided_at is null;

  v_outstanding := greatest(0, v_cash_payable - v_paid);
  payment_id := v_payment.id;
  invoice_id := v_invoice.id;
  sale_attempt_id := v_invoice.sale_attempt_id;
  paid_amount := v_paid;
  outstanding_balance := v_outstanding;
  payment_status := case
    when v_outstanding = 0 and v_cash_payable > 0 then 'paid'
    when v_paid > 0 then 'part_paid'
    else 'unpaid'
  end;
  return next;
end;
$$;


--
-- Name: auth_events; Type: TABLE; Schema: portal_audit; Owner: -
--

CREATE TABLE portal_audit.auth_events (
    id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    action text NOT NULL,
    imported_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT auth_events_action_check CHECK ((action = ANY (ARRAY['login'::text, 'logout'::text])))
);


--
-- Name: options; Type: TABLE; Schema: portal_audit; Owner: -
--

CREATE TABLE portal_audit.options (
    singleton boolean DEFAULT true NOT NULL,
    unit_opens_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT options_singleton_check CHECK (singleton)
);


--
-- Name: areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid,
    area_type text NOT NULL,
    name text NOT NULL,
    floor text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT areas_area_type_check CHECK ((area_type = ANY (ARRAY['unit_room'::text, 'communal_area'::text, 'private_amenity'::text])))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text,
    actor_organisation_id uuid,
    building_id uuid,
    unit_id uuid,
    affected_user_id uuid,
    field_name text,
    previous_value jsonb,
    new_value jsonb,
    action_id uuid,
    source text,
    outcome text,
    actor_name text,
    actor_role text
);


--
-- Name: building_floors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_floors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_organisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    organisation_id uuid NOT NULL,
    role_on_project text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trade_type text,
    active boolean DEFAULT true NOT NULL,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT building_organisations_role_on_project_check CHECK (((role_on_project IS NULL) OR (role_on_project = ANY (ARRAY['main_contractor'::text, 'developer_representative'::text, 'supporting_trade'::text, 'sales_agent'::text, 'conveyancer'::text, 'letting_agent'::text, 'managing_agent'::text]))))
);


--
-- Name: building_sale_default_payment_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_sale_default_payment_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    sequence_no integer NOT NULL,
    payment_stage text NOT NULL,
    label text NOT NULL,
    due_offset_days integer,
    percent_of_contract_price numeric(7,4),
    fixed_amount numeric(14,2),
    includes_reservation_fee boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT building_sale_default_payment_schedule_amount_check CHECK (((fixed_amount IS NULL) OR (fixed_amount >= (0)::numeric))),
    CONSTRAINT building_sale_default_payment_schedule_percent_check CHECK (((percent_of_contract_price IS NULL) OR ((percent_of_contract_price >= (0)::numeric) AND (percent_of_contract_price <= (100)::numeric)))),
    CONSTRAINT building_sale_default_payment_schedule_sequence_check CHECK ((sequence_no > 0)),
    CONSTRAINT building_sale_default_payment_schedule_stage_check CHECK ((payment_stage = ANY (ARRAY['reservation'::text, 'exchange'::text, 'delayed_deposit'::text, 'completion'::text, 'other'::text])))
);


--
-- Name: buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buildings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address_line_1 text,
    address_line_2 text,
    town text,
    postcode text,
    practical_completion_date date,
    defects_liability_end_date date,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_url text,
    documents_url text,
    home_user_guide_url text,
    allow_resident_access_requests boolean DEFAULT true NOT NULL,
    dlp_end_date date,
    dlp_closing_notice_start_date date,
    archive_date date,
    lifecycle_status text DEFAULT 'dlp_active'::text NOT NULL,
    pc_date date,
    pc_confirmed boolean DEFAULT false NOT NULL,
    conveyancer_organisation_id uuid,
    sales_agent_organisation_id uuid,
    seller_name text,
    completion_information text,
    CONSTRAINT buildings_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['pre_handover'::text, 'handover_active'::text, 'dlp_active'::text, 'dlp_closing'::text, 'post_dlp_readonly'::text, 'archived'::text]))),
    CONSTRAINT buildings_pc_confirmed_requires_date CHECK (((pc_confirmed = false) OR (pc_date IS NOT NULL)))
);


--
-- Name: digest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.digest_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    digest_key text NOT NULL,
    digest_type text DEFAULT 'snag_digest'::text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'started'::text NOT NULL,
    recipients_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT digest_runs_digest_type_check CHECK ((digest_type = 'snag_digest'::text)),
    CONSTRAINT digest_runs_status_check CHECK ((status = ANY (ARRAY['started'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: flats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flat_reference text NOT NULL,
    building_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: handover_key_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handover_key_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    handover_id uuid NOT NULL,
    key_type text NOT NULL,
    quantity integer NOT NULL,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT handover_key_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: handover_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handover_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    handover_id uuid NOT NULL,
    file_url text NOT NULL,
    photo_type text DEFAULT 'keys'::text NOT NULL,
    caption text,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT handover_photos_photo_type_check CHECK ((photo_type = ANY (ARRAY['keys'::text, 'other'::text])))
);


--
-- Name: handovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handovers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unit_id uuid NOT NULL,
    handover_by_user_id uuid,
    recipient_name text NOT NULL,
    recipient_email text,
    recipient_phone text,
    recipient_capacity text,
    number_of_keys integer DEFAULT 0 NOT NULL,
    signature_url text,
    handover_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handover_datetime timestamp with time zone,
    recipient_relationship text,
    recipient_relationship_other text,
    declaration_accepted boolean DEFAULT false NOT NULL
);


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid,
    uploaded_by_user_id uuid,
    source_file_url text,
    source_type text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_batches_source_type_check CHECK ((source_type = ANY (ARRAY['professional_pdf'::text, 'spreadsheet_import'::text, 'manual_import'::text]))),
    CONSTRAINT import_batches_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'imported'::text, 'reviewed'::text])))
);


--
-- Name: meter_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meter_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    handover_id uuid,
    meter_type text NOT NULL,
    meter_serial_number text,
    reading_value text NOT NULL,
    reading_date date DEFAULT CURRENT_DATE NOT NULL,
    photo_url text,
    created_by_user_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meter_readings_meter_type_check CHECK ((meter_type = ANY (ARRAY['electricity'::text, 'water'::text, 'heat'::text])))
);


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    main_contact_name text,
    email text,
    phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    shared_system_email text,
    CONSTRAINT organisations_shared_system_email_check CHECK (((shared_system_email IS NULL) OR ((length(shared_system_email) <= 254) AND (length(split_part(shared_system_email, '@'::text, 1)) <= 64) AND (split_part(shared_system_email, '@'::text, 1) !~~ '.%'::text) AND (split_part(shared_system_email, '@'::text, 1) !~~ '%.'::text) AND (POSITION(('..'::text) IN (split_part(shared_system_email, '@'::text, 1))) = 0) AND (shared_system_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'::text)))),
    CONSTRAINT organisations_type_check CHECK ((type = ANY (ARRAY['developer_representative'::text, 'contractor'::text, 'supporting_trade'::text, 'sales_agent'::text, 'conveyancer'::text, 'letting_agent'::text, 'managing_agent'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    phone text,
    organisation_id uuid,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resident_type text,
    last_active_at timestamp with time zone,
    CONSTRAINT profiles_resident_type_check CHECK (((resident_type IS NULL) OR (resident_type = ANY (ARRAY['leaseholder'::text, 'tenant'::text, 'letting_agent'::text, 'managing_agent'::text])))),
    CONSTRAINT profiles_role_final_check CHECK (((role)::text = ANY (ARRAY['admin'::text, 'developer'::text, 'developer_representative'::text, 'contractor'::text, 'resident'::text, 'sales_agent'::text, 'conveyancer'::text, 'user'::text])))
);


--
-- Name: rental_arrears_episodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_arrears_episodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenancy_id uuid NOT NULL,
    agent_tenancy_reference text,
    first_reported_at timestamp with time zone NOT NULL,
    last_reported_at timestamp with time zone NOT NULL,
    cleared_at timestamp with time zone,
    initial_reported_amount numeric(12,2) NOT NULL,
    maximum_reported_amount numeric(12,2) NOT NULL,
    latest_reported_amount numeric(12,2),
    status text NOT NULL,
    intervention_level text NOT NULL,
    owner_action_required boolean DEFAULT false NOT NULL,
    resolution_basis text,
    management_summary text NOT NULL,
    source_reference text NOT NULL,
    source_import_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attribution_status text DEFAULT 'matched'::text NOT NULL,
    attribution_review_reason text,
    CONSTRAINT rental_arrears_episode_attribution_status_check CHECK ((((attribution_status = 'matched'::text) AND (attribution_review_reason IS NULL)) OR ((attribution_status = 'review_required'::text) AND (NULLIF(btrim(attribution_review_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT rental_arrears_episode_clearance_check CHECK ((((status = 'cleared'::text) AND (cleared_at IS NOT NULL) AND (cleared_at >= first_reported_at)) OR ((status <> 'cleared'::text) AND (cleared_at IS NULL)))),
    CONSTRAINT rental_arrears_episode_latest_amount_check CHECK (((latest_reported_amount IS NULL) OR (maximum_reported_amount >= latest_reported_amount))),
    CONSTRAINT rental_arrears_episode_report_dates_check CHECK ((last_reported_at >= first_reported_at)),
    CONSTRAINT rental_arrears_episodes_check CHECK ((maximum_reported_amount >= initial_reported_amount)),
    CONSTRAINT rental_arrears_episodes_initial_reported_amount_check CHECK ((initial_reported_amount >= (0)::numeric)),
    CONSTRAINT rental_arrears_episodes_intervention_level_check CHECK ((intervention_level = ANY (ARRAY['information'::text, 'watch'::text, 'action_required'::text]))),
    CONSTRAINT rental_arrears_episodes_latest_reported_amount_check CHECK (((latest_reported_amount IS NULL) OR (latest_reported_amount >= (0)::numeric))),
    CONSTRAINT rental_arrears_episodes_management_summary_check CHECK ((length(TRIM(BOTH FROM management_summary)) > 0)),
    CONSTRAINT rental_arrears_episodes_source_reference_check CHECK ((length(TRIM(BOTH FROM source_reference)) > 0)),
    CONSTRAINT rental_arrears_episodes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'cleared'::text, 'closed_reconciliation_review'::text, 'ended_unreconciled'::text])))
);


--
-- Name: rental_arrears_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_arrears_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    event_at timestamp with time zone NOT NULL,
    event_type text NOT NULL,
    reported_amount numeric(12,2),
    summary text NOT NULL,
    source_reference text NOT NULL,
    source_kind text,
    evidence_confidence text NOT NULL,
    source_import_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_arrears_events_event_type_check CHECK ((event_type = ANY (ARRAY['first_arrears_notification'::text, 'balance_changed'::text, 'payment_or_clearance_evidence'::text, 'tenancy_ended_or_relet'::text, 'recovery_outcome'::text, 'owner_decision_requested'::text]))),
    CONSTRAINT rental_arrears_events_evidence_confidence_check CHECK ((evidence_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT rental_arrears_events_reported_amount_check CHECK (((reported_amount IS NULL) OR (reported_amount >= (0)::numeric))),
    CONSTRAINT rental_arrears_events_source_reference_check CHECK ((length(TRIM(BOTH FROM source_reference)) > 0)),
    CONSTRAINT rental_arrears_events_summary_check CHECK ((length(TRIM(BOTH FROM summary)) > 0))
);


--
-- Name: rental_import_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_import_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    source_reference text NOT NULL,
    status text DEFAULT 'started'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    data_as_of timestamp with time zone,
    episodes_imported integer DEFAULT 0 NOT NULL,
    events_imported integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_quality_issue_count integer DEFAULT 0 NOT NULL,
    data_quality_issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_import_runs_completion_check CHECK ((((status = 'started'::text) AND (completed_at IS NULL)) OR ((status = ANY (ARRAY['succeeded'::text, 'failed'::text])) AND (completed_at IS NOT NULL)))),
    CONSTRAINT rental_import_runs_data_quality_issue_count_check CHECK ((data_quality_issue_count >= 0)),
    CONSTRAINT rental_import_runs_data_quality_issues_check CHECK ((jsonb_typeof(data_quality_issues) = 'array'::text)),
    CONSTRAINT rental_import_runs_episodes_imported_check CHECK ((episodes_imported >= 0)),
    CONSTRAINT rental_import_runs_error_count_check CHECK ((error_count >= 0)),
    CONSTRAINT rental_import_runs_errors_check CHECK ((jsonb_typeof(errors) = 'array'::text)),
    CONSTRAINT rental_import_runs_events_imported_check CHECK ((events_imported >= 0)),
    CONSTRAINT rental_import_runs_source_reference_check CHECK ((length(TRIM(BOTH FROM source_reference)) > 0)),
    CONSTRAINT rental_import_runs_status_check CHECK ((status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid,
    report_type text NOT NULL,
    generated_by_user_id uuid,
    file_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resident_access_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resident_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    resident_type text NOT NULL,
    requested_units jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_notes text,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resident_access_requests_resident_type_check CHECK ((resident_type = ANY (ARRAY['leaseholder'::text, 'tenant'::text, 'letting_agent'::text, 'managing_agent'::text]))),
    CONSTRAINT resident_access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: sale_comment_read_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_comment_read_state (
    sale_attempt_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_presented_sequence bigint NOT NULL
);


--
-- Name: sale_comment_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_comment_receipts (
    sale_attempt_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sale_comment_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_comment_revisions (
    sale_attempt_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    version integer NOT NULL,
    body text NOT NULL,
    mention_ids uuid[] NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    replaced_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: sale_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    sequence bigint NOT NULL,
    author_id uuid NOT NULL,
    author_name text NOT NULL,
    author_role text,
    author_organisation text,
    body text NOT NULL,
    stage text,
    parent_id uuid,
    mention_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    edited_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sale_comments_body_check CHECK (((body ~ '[^[:space:]]'::text) AND (length(body) <= 5000))),
    CONSTRAINT sale_comments_stage_check CHECK ((stage = ANY (ARRAY['reservation'::text, 'exchange'::text, 'completion'::text, 'handover'::text])))
);


--
-- Name: sale_completion_package_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_completion_package_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    statement_document_id uuid NOT NULL,
    statement_version_id uuid NOT NULL,
    account_document_id uuid NOT NULL,
    account_version_id uuid NOT NULL,
    approved_by uuid NOT NULL,
    approved_by_name text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sale_exchange_deposit_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_exchange_deposit_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    source_id uuid NOT NULL,
    revision integer NOT NULL,
    supersedes_id uuid,
    expected_amount numeric(16,2) NOT NULL,
    received_amount numeric(16,2) NOT NULL,
    received_date date NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_by_name text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    correction_reason text,
    CONSTRAINT sale_exchange_deposit_receipts_check CHECK ((received_amount = expected_amount)),
    CONSTRAINT sale_exchange_deposit_receipts_check1 CHECK ((((revision = 1) AND (supersedes_id IS NULL) AND (correction_reason IS NULL)) OR ((revision > 1) AND (supersedes_id IS NOT NULL) AND (length(btrim(correction_reason)) > 0)))),
    CONSTRAINT sale_exchange_deposit_receipts_expected_amount_check CHECK ((expected_amount >= (0)::numeric)),
    CONSTRAINT sale_exchange_deposit_receipts_revision_check CHECK ((revision > 0))
);


--
-- Name: TABLE sale_exchange_deposit_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sale_exchange_deposit_receipts IS 'Full receipt confirmations and append-only date corrections, not separate payments. Expected and received amounts are separate for future partial-payment support.';


--
-- Name: sale_exchange_deposit_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_exchange_deposit_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    authority_id uuid,
    authority_version integer,
    terms_id uuid,
    terms_version integer,
    source_kind text NOT NULL,
    snapshot jsonb NOT NULL,
    expected_amount numeric(16,2),
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sale_exchange_deposit_sources_expected_amount_check CHECK ((expected_amount >= (0)::numeric)),
    CONSTRAINT sale_exchange_deposit_sources_source_kind_check CHECK ((source_kind = ANY (ARRAY['executed_authority'::text, 'legacy_locked_terms'::text, 'unavailable'::text])))
);


--
-- Name: sale_further_deposit_deadlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_further_deposit_deadlines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    source_id uuid NOT NULL,
    request_id uuid NOT NULL,
    supersedes_id uuid,
    date date NOT NULL,
    "time" time without time zone,
    instant timestamp with time zone,
    reason text NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_by_name text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    request_payload jsonb NOT NULL,
    CONSTRAINT sale_further_deposit_deadlines_check CHECK ((("time" IS NULL) = (instant IS NULL))),
    CONSTRAINT sale_further_deposit_deadlines_reason_check CHECK ((length(btrim(reason)) > 0))
);


--
-- Name: sale_further_deposit_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_further_deposit_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    source_id uuid NOT NULL,
    request_id uuid NOT NULL,
    receipt_key uuid NOT NULL,
    revision integer NOT NULL,
    supersedes_id uuid,
    amount numeric(16,2) NOT NULL,
    received_date date NOT NULL,
    received_time time without time zone,
    received_instant timestamp with time zone,
    note text,
    voided boolean DEFAULT false NOT NULL,
    reason text,
    recorded_by uuid NOT NULL,
    recorded_by_name text NOT NULL,
    organisation_id uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    request_payload jsonb NOT NULL,
    CONSTRAINT sale_further_deposit_receipts_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT sale_further_deposit_receipts_check CHECK ((((revision = 1) AND (supersedes_id IS NULL) AND (NOT voided)) OR ((revision > 1) AND (supersedes_id IS NOT NULL) AND (length(btrim(reason)) > 0)))),
    CONSTRAINT sale_further_deposit_receipts_check1 CHECK (((received_time IS NULL) = (received_instant IS NULL))),
    CONSTRAINT sale_further_deposit_receipts_revision_check CHECK ((revision > 0))
);


--
-- Name: unit_sale_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    workflow_status text DEFAULT 'draft'::text NOT NULL,
    buyer_name text,
    buyer_email text,
    buyer_phone text,
    buyer_solicitor_name text,
    buyer_solicitor_email text,
    buyer_solicitor_phone text,
    sales_agent_organisation_id uuid,
    conveyancer_organisation_id uuid,
    reservation_submitted_at timestamp with time zone,
    reservation_approved_at timestamp with time zone,
    reservation_approved_by_user_id uuid,
    commercial_approved_at timestamp with time zone,
    commercial_approved_by_user_id uuid,
    exchanged_at date,
    completed_at date,
    fallen_through_at timestamp with time zone,
    fall_through_reason text,
    redacted_at timestamp with time zone,
    redacted_by_user_id uuid,
    redaction_note text,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_entered_at timestamp with time zone,
    buyer_person_name text,
    buyer_company_name text,
    reservation_terms_checked boolean DEFAULT false NOT NULL,
    reservation_submitted_by_user_id uuid,
    reservation_submitted_by_name text,
    reservation_submitted_by_email text,
    reservation_date date,
    reservation_approved_by_name text,
    reservation_approved_by_email text,
    reservation_rejected_at timestamp with time zone,
    reservation_rejected_by_user_id uuid,
    reservation_rejected_by_name text,
    reservation_rejected_by_email text,
    reservation_rejection_reason text,
    is_system_baseline boolean DEFAULT false NOT NULL,
    comment_sequence bigint DEFAULT 0 NOT NULL,
    authority_requested_at timestamp with time zone,
    contractual_completion_date date,
    completion_notice_issued_at date,
    legal_completed_at timestamp with time zone,
    legal_completed_by uuid,
    completion_authority_requested_at timestamp with time zone,
    completion_authority_requested_by uuid,
    completion_authority_given_at timestamp with time zone,
    completion_authority_given_by uuid,
    completion_arrangements_confirmed_at timestamp with time zone,
    completion_arrangements_confirmed_by uuid,
    completion_legacy_stage text,
    CONSTRAINT unit_sale_attempts_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT unit_sale_attempts_buyer_identity_check CHECK (((workflow_status <> ALL (ARRAY['awaiting_approval'::text, 'approved'::text, 'reservation_submitted'::text, 'reservation_approved'::text, 'awaiting_commercial_approval'::text, 'ready_for_exchange'::text, 'exchanged'::text, 'completion_pending'::text, 'completed'::text])) OR (NULLIF(TRIM(BOTH FROM COALESCE(buyer_person_name, ''::text)), ''::text) IS NOT NULL) OR (NULLIF(TRIM(BOTH FROM COALESCE(buyer_company_name, ''::text)), ''::text) IS NOT NULL))),
    CONSTRAINT unit_sale_attempts_completion_legacy_stage_check CHECK ((completion_legacy_stage = ANY (ARRAY['authority'::text, 'arrangements'::text]))),
    CONSTRAINT unit_sale_attempts_workflow_status_check CHECK ((workflow_status = ANY (ARRAY['draft'::text, 'awaiting_approval'::text, 'approved'::text, 'rejected'::text, 'reservation_submitted'::text, 'reservation_query_raised'::text, 'reservation_approved'::text, 'awaiting_commercial_approval'::text, 'ready_for_exchange'::text, 'exchanged'::text, 'completion_pending'::text, 'completed'::text, 'fallen_through'::text, 'superseded'::text])))
);


--
-- Name: sale_further_deposit_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sale_further_deposit_facts WITH (security_invoker='true') AS
 SELECT s.id,
    s.sale_attempt_id,
    COALESCE(((s.snapshot #>> '{terms,second_deposit_enabled}'::text[]))::boolean, false) AS required,
    ((s.snapshot #>> '{terms,second_deposit_percent}'::text[]))::numeric AS percent,
    public.sales_further_deposit_amount(s.snapshot) AS expected_amount,
    (s.snapshot #> '{terms,further_deposit_timing}'::text[]) AS timing,
    ((s.snapshot #>> '{terms,second_deposit_months_after_exchange}'::text[]))::integer AS months_after_exchange,
    s.terms_version,
    a.exchanged_at,
    COALESCE((b.pc_date)::text, (b.practical_completion_date)::text) AS pc_date,
    COALESCE(receipts.amount, (0)::numeric) AS received_amount,
    deadline.value AS deadline
   FROM ((((public.sale_exchange_deposit_sources s
     JOIN public.unit_sale_attempts a ON ((a.id = s.sale_attempt_id)))
     JOIN public.buildings b ON ((b.id = a.building_id)))
     LEFT JOIN LATERAL ( SELECT sum(r.amount) AS amount
           FROM public.sale_further_deposit_receipts r
          WHERE ((r.source_id = s.id) AND (NOT r.voided) AND (NOT (EXISTS ( SELECT 1
                   FROM public.sale_further_deposit_receipts next
                  WHERE (next.supersedes_id = r.id)))))) receipts ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_build_object('id', d.id, 'date', d.date, 'time', to_char((d."time")::interval, 'HH24:MI'::text), 'instant', d.instant) AS value
           FROM public.sale_further_deposit_deadlines d
          WHERE ((d.source_id = s.id) AND (NOT (EXISTS ( SELECT 1
                   FROM public.sale_further_deposit_deadlines next
                  WHERE (next.supersedes_id = d.id)))))
         LIMIT 1) deadline ON (true));


--
-- Name: sale_legal_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_legal_emails (
    id uuid NOT NULL,
    sale_attempt_id uuid NOT NULL,
    kind text NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    sending_address text NOT NULL,
    to_recipients text[] NOT NULL,
    cc_recipients text[] DEFAULT '{}'::text[] NOT NULL,
    approved_by uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    proposed_completion_date date,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revocation_reason text,
    replaced_by uuid,
    exchanged_at date,
    resend_message_id text,
    delivery_status text DEFAULT 'pending'::text NOT NULL,
    dispatch_started_at timestamp with time zone,
    sent_at timestamp with time zone,
    expiry_recorded_at timestamp with time zone,
    html_body text,
    CONSTRAINT sale_legal_emails_dates_check CHECK ((((kind = 'authority'::text) AND (expires_at > issued_at)) OR ((kind = 'completion_instruction'::text) AND (proposed_completion_date IS NOT NULL)) OR ((kind = 'notice_authority'::text) AND (proposed_completion_date IS NULL) AND (expires_at IS NULL)))),
    CONSTRAINT sale_legal_emails_kind_check CHECK ((kind = ANY (ARRAY['authority'::text, 'completion_instruction'::text, 'notice_authority'::text]))),
    CONSTRAINT sale_legal_emails_to_recipients_check CHECK ((cardinality(to_recipients) = 1)),
    CONSTRAINT sale_legal_emails_version_check CHECK ((version > 0))
);


--
-- Name: sale_mention_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_mention_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seen_at timestamp with time zone
);


--
-- Name: sale_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_participants (
    sale_attempt_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: sales_forecast_scenario_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_forecast_scenario_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scenario_id uuid NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    strategy text NOT NULL,
    assumed_value numeric(14,2),
    monthly_rent numeric(14,2),
    completion_month integer,
    refinance_ltv_percent numeric(7,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_forecast_scenario_units_ltv_check CHECK (((refinance_ltv_percent IS NULL) OR ((refinance_ltv_percent >= (0)::numeric) AND (refinance_ltv_percent <= (100)::numeric)))),
    CONSTRAINT sales_forecast_scenario_units_money_check CHECK ((((assumed_value IS NULL) OR (assumed_value >= (0)::numeric)) AND ((monthly_rent IS NULL) OR (monthly_rent >= (0)::numeric)))),
    CONSTRAINT sales_forecast_scenario_units_month_check CHECK (((completion_month IS NULL) OR (completion_month >= 0))),
    CONSTRAINT sales_forecast_scenario_units_strategy_check CHECK ((strategy = ANY (ARRAY['sell'::text, 'retain'::text, 'rent'::text, 'refinance'::text])))
);


--
-- Name: sales_forecast_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_forecast_scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    sell_unit_count integer DEFAULT 0 NOT NULL,
    retain_unit_count integer DEFAULT 0 NOT NULL,
    rent_unit_count integer DEFAULT 0 NOT NULL,
    refinance_unit_count integer DEFAULT 0 NOT NULL,
    average_sale_value numeric(14,2),
    average_rent_per_unit numeric(14,2) DEFAULT 0 NOT NULL,
    ltv_percent numeric(7,4) DEFAULT 70 NOT NULL,
    monthly_interest_rate numeric(7,4) DEFAULT 0 NOT NULL,
    completion_month integer DEFAULT 1 NOT NULL,
    refinance_month integer DEFAULT 1 NOT NULL,
    opening_debt numeric(14,2) DEFAULT 0 NOT NULL,
    development_cost numeric(14,2) DEFAULT 0 NOT NULL,
    investor_repayment numeric(14,2) DEFAULT 0 NOT NULL,
    results jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_forecast_scenarios_counts_check CHECK (((sell_unit_count >= 0) AND (retain_unit_count >= 0) AND (rent_unit_count >= 0) AND (refinance_unit_count >= 0))),
    CONSTRAINT sales_forecast_scenarios_money_check CHECK ((((average_sale_value IS NULL) OR (average_sale_value >= (0)::numeric)) AND (average_rent_per_unit >= (0)::numeric) AND (opening_debt >= (0)::numeric) AND (development_cost >= (0)::numeric) AND (investor_repayment >= (0)::numeric))),
    CONSTRAINT sales_forecast_scenarios_month_check CHECK (((completion_month >= 0) AND (refinance_month >= 0))),
    CONSTRAINT sales_forecast_scenarios_percent_check CHECK (((ltv_percent >= (0)::numeric) AND (ltv_percent <= (100)::numeric) AND (monthly_interest_rate >= (0)::numeric) AND (monthly_interest_rate <= (100)::numeric))),
    CONSTRAINT sales_forecast_scenarios_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: snag_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snag_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: snag_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snag_id uuid NOT NULL,
    event_type text NOT NULL,
    old_value text,
    new_value text,
    comment text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    audit_origin text,
    actor_name text,
    actor_role text
);


--
-- Name: snag_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snag_id uuid NOT NULL,
    file_url text NOT NULL,
    photo_type text DEFAULT 'annotated'::text NOT NULL,
    caption text,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    media_type text DEFAULT 'image'::text NOT NULL,
    thumbnail_url text,
    thumbnail_square_url text,
    thumbnail_landscape_url text,
    report_image_url text,
    storage_path text,
    thumbnail_storage_path text,
    thumbnail_square_storage_path text,
    thumbnail_landscape_storage_path text,
    report_image_storage_path text,
    mime_type text,
    file_size_bytes bigint,
    duration_seconds numeric,
    CONSTRAINT snag_photos_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text]))),
    CONSTRAINT snag_photos_photo_type_check CHECK ((photo_type = ANY (ARRAY['original'::text, 'annotated'::text, 'resolution_photo'::text])))
);


--
-- Name: snag_report_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_report_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    snag_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: snag_report_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_report_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    user_id uuid,
    email text NOT NULL,
    name text,
    organisation_id uuid,
    delivery_status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT snag_report_recipients_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: snag_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snag_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid,
    communal_area_id uuid,
    location_type text NOT NULL,
    location_label text NOT NULL,
    include_photos boolean DEFAULT true NOT NULL,
    include_closed_snags boolean DEFAULT false NOT NULL,
    snag_count integer DEFAULT 0 NOT NULL,
    file_path text,
    file_url text,
    sent_by_user_id uuid,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT snag_reports_location_type_check CHECK ((location_type = ANY (ARRAY['unit'::text, 'communal'::text])))
);


--
-- Name: snags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flat_id uuid,
    title text NOT NULL,
    description text,
    status public.snag_status DEFAULT 'Open'::public.snag_status NOT NULL,
    priority integer DEFAULT 2,
    image_path text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    building_id uuid,
    unit_id uuid,
    area_id uuid,
    source_type text DEFAULT 'developer_snag'::text NOT NULL,
    created_by_user_id uuid,
    trade_id uuid,
    priority_code text,
    assigned_to_organisation_id uuid,
    assigned_to_user_id uuid,
    sla_due_date timestamp with time zone,
    import_batch_id uuid,
    closed_at timestamp with time zone,
    CONSTRAINT snags_priority_check CHECK ((priority = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT snags_priority_code_check CHECK ((priority_code = ANY (ARRAY['P1'::text, 'P2'::text, 'P3'::text]))),
    CONSTRAINT snags_source_type_check CHECK ((source_type = ANY (ARRAY['developer_snag'::text, 'leaseholder_defect'::text, 'imported_report'::text])))
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: unit_open_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_open_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_user_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    building_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL
);


--
-- Name: unit_sale_document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    version_number integer NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    storage_bucket text NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    file_size_bytes bigint,
    checksum text,
    uploaded_by_user_id uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    redacted_at timestamp with time zone,
    redacted_by_user_id uuid,
    notice_submission_id uuid,
    completion_upload_id uuid,
    CONSTRAINT unit_sale_document_versions_file_size_check CHECK (((file_size_bytes IS NULL) OR (file_size_bytes >= 0))),
    CONSTRAINT unit_sale_document_versions_version_check CHECK ((version_number > 0))
);


--
-- Name: unit_sale_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    document_type text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'not_uploaded'::text NOT NULL,
    visibility text DEFAULT 'shared_sale_file'::text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    query_note text,
    superseded_at timestamp with time zone,
    redacted_at timestamp with time zone,
    redacted_by_user_id uuid,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fee_milestone text,
    approved_version_id uuid,
    CONSTRAINT unit_sale_documents_fee_milestone_check CHECK (((fee_milestone IS NULL) OR (fee_milestone = ANY (ARRAY['exchange'::text, 'completion'::text])))),
    CONSTRAINT unit_sale_documents_status_check CHECK ((status = ANY (ARRAY['not_uploaded'::text, 'uploaded'::text, 'under_review'::text, 'approved'::text, 'query_raised'::text, 'superseded'::text, 'redacted'::text]))),
    CONSTRAINT unit_sale_documents_type_check CHECK ((document_type = ANY (ARRAY['reservation_form'::text, 'agent_invoice'::text, 'completion_statement'::text, 'draft_statement_of_account'::text, 'statement_of_account'::text, 'completion_correspondence'::text, 'other'::text]))),
    CONSTRAINT unit_sale_documents_visibility_check CHECK ((visibility = ANY (ARRAY['internal_only'::text, 'sales_agent'::text, 'conveyancer'::text, 'shared_sale_file'::text])))
);


--
-- Name: unit_sale_invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    sale_attempt_id uuid NOT NULL,
    payment_source text NOT NULL,
    amount numeric(14,2) NOT NULL,
    paid_at date,
    paid_by_organisation_id uuid,
    recorded_by_user_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payer_type text NOT NULL,
    client_reference uuid DEFAULT gen_random_uuid() NOT NULL,
    voided_at timestamp with time zone,
    voided_by_user_id uuid,
    void_reason text,
    recorded_by_name text,
    recorded_by_email text,
    recorded_by_organisation_name text,
    CONSTRAINT unit_sale_invoice_payments_payer_type_check CHECK ((payer_type = ANY (ARRAY['solicitor'::text, 'developer'::text, 'other'::text]))),
    CONSTRAINT unit_sale_invoice_payments_source_check CHECK ((payment_source = ANY (ARRAY['solicitor_deposit'::text, 'developer_shortfall'::text, 'reservation_fee'::text, 'other'::text])))
);


--
-- Name: unit_sale_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    document_id uuid,
    invoice_type text DEFAULT 'sales_agent'::text NOT NULL,
    supplier_organisation_id uuid,
    invoice_reference text,
    invoice_date date,
    net_amount numeric(14,2),
    vat_amount numeric(14,2),
    gross_amount numeric(14,2),
    reservation_fee_deduction numeric(14,2) DEFAULT 0 NOT NULL,
    agent_contribution_deduction numeric(14,2) DEFAULT 0 NOT NULL,
    expected_payable_amount numeric(14,2),
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    query_note text,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fee_milestone text,
    fee_percentage numeric(7,4),
    expected_gross_amount numeric(14,2),
    CONSTRAINT unit_sale_invoices_expected_gross_check CHECK (((expected_gross_amount IS NULL) OR (expected_gross_amount >= (0)::numeric))),
    CONSTRAINT unit_sale_invoices_fee_milestone_check CHECK ((((invoice_type <> 'sales_agent'::text) AND (fee_milestone IS NULL)) OR ((invoice_type = 'sales_agent'::text) AND (fee_milestone = ANY (ARRAY['exchange'::text, 'completion'::text]))))),
    CONSTRAINT unit_sale_invoices_fee_percentage_check CHECK (((fee_percentage IS NULL) OR ((fee_percentage >= (0)::numeric) AND (fee_percentage <= (100)::numeric)))),
    CONSTRAINT unit_sale_invoices_money_check CHECK ((((net_amount IS NULL) OR (net_amount >= (0)::numeric)) AND ((vat_amount IS NULL) OR (vat_amount >= (0)::numeric)) AND ((gross_amount IS NULL) OR (gross_amount >= (0)::numeric)) AND (reservation_fee_deduction >= (0)::numeric) AND (agent_contribution_deduction >= (0)::numeric) AND ((expected_payable_amount IS NULL) OR (expected_payable_amount >= (0)::numeric)))),
    CONSTRAINT unit_sale_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'uploaded'::text, 'under_review'::text, 'approved'::text, 'query_raised'::text, 'part_paid'::text, 'paid'::text, 'reconciled'::text, 'superseded'::text, 'redacted'::text]))),
    CONSTRAINT unit_sale_invoices_type_check CHECK ((invoice_type = ANY (ARRAY['sales_agent'::text, 'other'::text])))
);


--
-- Name: unit_sale_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    building_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    visibility text DEFAULT 'shared_sale_file'::text NOT NULL,
    body text NOT NULL,
    redacted_at timestamp with time zone,
    redacted_by_user_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unit_sale_notes_category_check CHECK ((category = ANY (ARRAY['general'::text, 'buyer_update'::text, 'solicitor_update'::text, 'financial'::text, 'commercial'::text, 'blocker'::text, 'system'::text]))),
    CONSTRAINT unit_sale_notes_visibility_check CHECK ((visibility = ANY (ARRAY['internal_only'::text, 'sales_agent'::text, 'conveyancer'::text, 'shared_sale_file'::text])))
);


--
-- Name: unit_sale_payment_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_payment_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    sale_terms_id uuid,
    sequence_no integer NOT NULL,
    payment_stage text NOT NULL,
    label text NOT NULL,
    due_event text,
    due_offset_days integer,
    percent_of_contract_price numeric(7,4),
    fixed_amount numeric(14,2),
    includes_reservation_fee boolean DEFAULT false NOT NULL,
    expected_amount numeric(14,2),
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unit_sale_payment_schedule_amount_check CHECK ((((fixed_amount IS NULL) OR (fixed_amount >= (0)::numeric)) AND ((expected_amount IS NULL) OR (expected_amount >= (0)::numeric)))),
    CONSTRAINT unit_sale_payment_schedule_due_event_check CHECK (((due_event IS NULL) OR (due_event = ANY (ARRAY['reservation'::text, 'exchange'::text, 'completion'::text, 'manual_date'::text])))),
    CONSTRAINT unit_sale_payment_schedule_percent_check CHECK (((percent_of_contract_price IS NULL) OR ((percent_of_contract_price >= (0)::numeric) AND (percent_of_contract_price <= (100)::numeric)))),
    CONSTRAINT unit_sale_payment_schedule_sequence_check CHECK ((sequence_no > 0)),
    CONSTRAINT unit_sale_payment_schedule_stage_check CHECK ((payment_stage = ANY (ARRAY['reservation'::text, 'exchange'::text, 'delayed_deposit'::text, 'completion'::text, 'other'::text]))),
    CONSTRAINT unit_sale_payment_schedule_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'due'::text, 'paid'::text, 'waived'::text, 'superseded'::text])))
);


--
-- Name: unit_sale_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_sale_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_attempt_id uuid NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    list_price_at_offer numeric(14,2),
    contract_price numeric(14,2),
    parking_value numeric(14,2) DEFAULT 0 NOT NULL,
    developer_contribution numeric(14,2) DEFAULT 0 NOT NULL,
    agent_contribution numeric(14,2) DEFAULT 0 NOT NULL,
    other_concessions numeric(14,2) DEFAULT 0 NOT NULL,
    reservation_fee numeric(14,2),
    reservation_fee_holder text,
    agent_fee_percent numeric(7,4),
    vat_rate numeric(7,4) DEFAULT 20 NOT NULL,
    solicitor_fee numeric(14,2),
    deposit_summary text,
    commercial_summary text,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    superseded_at timestamp with time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    exchange_deposit_percent numeric(7,4),
    second_deposit_enabled boolean DEFAULT false NOT NULL,
    second_deposit_percent numeric(7,4),
    second_deposit_months_after_exchange integer,
    completion_balance_percent numeric(7,4),
    developer_contribution_value numeric(14,4),
    developer_contribution_value_type text DEFAULT 'amount'::text NOT NULL,
    agent_contribution_value numeric(14,4),
    agent_contribution_value_type text DEFAULT 'amount'::text NOT NULL,
    parking_contribution_value numeric(14,2) DEFAULT 0 NOT NULL,
    parking_location_details text,
    additional_special_conditions text[] DEFAULT '{}'::text[] NOT NULL,
    exchange_agent_fee_percent numeric(7,4),
    completion_agent_fee_percent numeric(7,4),
    further_deposit_timing jsonb,
    CONSTRAINT unit_sale_terms_agent_fee_check CHECK (((agent_fee_percent IS NULL) OR ((agent_fee_percent >= (0)::numeric) AND (agent_fee_percent <= (100)::numeric)))),
    CONSTRAINT unit_sale_terms_agent_fee_structure_check CHECK ((((agent_fee_percent IS NULL) AND (exchange_agent_fee_percent = (0)::numeric) AND (completion_agent_fee_percent = (0)::numeric)) OR (((agent_fee_percent >= (0)::numeric) AND (agent_fee_percent <= (100)::numeric)) AND ((exchange_agent_fee_percent >= (0)::numeric) AND (exchange_agent_fee_percent <= (100)::numeric)) AND ((completion_agent_fee_percent >= (0)::numeric) AND (completion_agent_fee_percent <= (100)::numeric)) AND (round((exchange_agent_fee_percent + completion_agent_fee_percent), 4) = round(agent_fee_percent, 4))))),
    CONSTRAINT unit_sale_terms_buyer_incentives_check CHECK ((((developer_contribution_value IS NULL) OR (developer_contribution_value >= (0)::numeric)) AND ((agent_contribution_value IS NULL) OR (agent_contribution_value >= (0)::numeric)) AND (parking_contribution_value >= (0)::numeric) AND ((developer_contribution_value_type <> 'percent'::text) OR (developer_contribution_value <= (100)::numeric)) AND ((agent_contribution_value_type <> 'percent'::text) OR (agent_contribution_value <= (100)::numeric)))),
    CONSTRAINT unit_sale_terms_contribution_type_check CHECK (((developer_contribution_value_type = ANY (ARRAY['amount'::text, 'percent'::text])) AND (agent_contribution_value_type = ANY (ARRAY['amount'::text, 'percent'::text])))),
    CONSTRAINT unit_sale_terms_deposit_structure_check CHECK ((((exchange_deposit_percent IS NULL) OR ((exchange_deposit_percent >= (0)::numeric) AND (exchange_deposit_percent <= (100)::numeric))) AND ((second_deposit_percent IS NULL) OR ((second_deposit_percent >= (0)::numeric) AND (second_deposit_percent <= (100)::numeric))) AND ((completion_balance_percent IS NULL) OR ((completion_balance_percent >= (0)::numeric) AND (completion_balance_percent <= (100)::numeric))) AND ((second_deposit_months_after_exchange IS NULL) OR (second_deposit_months_after_exchange >= 0)) AND ((exchange_deposit_percent IS NULL) OR (completion_balance_percent IS NULL) OR (((COALESCE(exchange_deposit_percent, (0)::numeric) + COALESCE(
CASE
    WHEN second_deposit_enabled THEN second_deposit_percent
    ELSE (0)::numeric
END, (0)::numeric)) + COALESCE(completion_balance_percent, (0)::numeric)) = (100)::numeric)))),
    CONSTRAINT unit_sale_terms_holder_check CHECK (((reservation_fee_holder IS NULL) OR (reservation_fee_holder = ANY (ARRAY['sales_agent'::text, 'developer'::text, 'conveyancer'::text, 'other'::text])))),
    CONSTRAINT unit_sale_terms_money_check CHECK ((((list_price_at_offer IS NULL) OR (list_price_at_offer >= (0)::numeric)) AND ((contract_price IS NULL) OR (contract_price >= (0)::numeric)) AND (parking_value >= (0)::numeric) AND (developer_contribution >= (0)::numeric) AND (agent_contribution >= (0)::numeric) AND (other_concessions >= (0)::numeric) AND ((reservation_fee IS NULL) OR (reservation_fee >= (0)::numeric)) AND ((solicitor_fee IS NULL) OR (solicitor_fee >= (0)::numeric)))),
    CONSTRAINT unit_sale_terms_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'superseded'::text]))),
    CONSTRAINT unit_sale_terms_vat_rate_check CHECK (((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))),
    CONSTRAINT unit_sale_terms_version_check CHECK ((version_number > 0))
);


--
-- Name: unit_type_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_type_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unit_type_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    optional boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: unit_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_building_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_building_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    building_id uuid NOT NULL,
    role_on_building text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_unit_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_unit_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    access_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_unit_access_access_type_check CHECK ((access_type = ANY (ARRAY['leaseholder'::text, 'tenant'::text, 'letting_agent'::text, 'managing_agent'::text, 'representative'::text])))
);


--
-- Name: auth_events auth_events_pkey; Type: CONSTRAINT; Schema: portal_audit; Owner: -
--

ALTER TABLE ONLY portal_audit.auth_events
    ADD CONSTRAINT auth_events_pkey PRIMARY KEY (id);


--
-- Name: options options_pkey; Type: CONSTRAINT; Schema: portal_audit; Owner: -
--

ALTER TABLE ONLY portal_audit.options
    ADD CONSTRAINT options_pkey PRIMARY KEY (singleton);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: building_floors building_floors_building_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_floors
    ADD CONSTRAINT building_floors_building_id_name_key UNIQUE (building_id, name);


--
-- Name: building_floors building_floors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_floors
    ADD CONSTRAINT building_floors_pkey PRIMARY KEY (id);


--
-- Name: building_organisations building_organisations_building_id_organisation_id_role_on__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_organisations
    ADD CONSTRAINT building_organisations_building_id_organisation_id_role_on__key UNIQUE (building_id, organisation_id, role_on_project);


--
-- Name: building_organisations building_organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_organisations
    ADD CONSTRAINT building_organisations_pkey PRIMARY KEY (id);


--
-- Name: building_sale_default_payment_schedule building_sale_default_payment_sched_building_id_sequence_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_default_payment_schedule
    ADD CONSTRAINT building_sale_default_payment_sched_building_id_sequence_no_key UNIQUE (building_id, sequence_no);


--
-- Name: building_sale_default_payment_schedule building_sale_default_payment_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_default_payment_schedule
    ADD CONSTRAINT building_sale_default_payment_schedule_pkey PRIMARY KEY (id);


--
-- Name: building_sale_defaults building_sale_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_pkey PRIMARY KEY (building_id);


--
-- Name: buildings buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (id);


--
-- Name: digest_runs digest_runs_digest_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_digest_key_key UNIQUE (digest_key);


--
-- Name: digest_runs digest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_pkey PRIMARY KEY (id);


--
-- Name: flats flats_flat_reference_building_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flats
    ADD CONSTRAINT flats_flat_reference_building_name_key UNIQUE (flat_reference, building_name);


--
-- Name: flats flats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flats
    ADD CONSTRAINT flats_pkey PRIMARY KEY (id);


--
-- Name: handover_key_items handover_key_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_key_items
    ADD CONSTRAINT handover_key_items_pkey PRIMARY KEY (id);


--
-- Name: handover_photos handover_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_photos
    ADD CONSTRAINT handover_photos_pkey PRIMARY KEY (id);


--
-- Name: handovers handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handovers
    ADD CONSTRAINT handovers_pkey PRIMARY KEY (id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: meter_readings meter_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_pkey PRIMARY KEY (id);


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: rental_arrears_episodes rental_arrears_episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_episodes
    ADD CONSTRAINT rental_arrears_episodes_pkey PRIMARY KEY (id);


--
-- Name: rental_arrears_episodes rental_arrears_episodes_source_import_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_episodes
    ADD CONSTRAINT rental_arrears_episodes_source_import_key_key UNIQUE (source_import_key);


--
-- Name: rental_arrears_events rental_arrears_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_events
    ADD CONSTRAINT rental_arrears_events_pkey PRIMARY KEY (id);


--
-- Name: rental_arrears_events rental_arrears_events_source_import_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_events
    ADD CONSTRAINT rental_arrears_events_source_import_key_key UNIQUE (source_import_key);


--
-- Name: rental_import_runs rental_import_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_import_runs
    ADD CONSTRAINT rental_import_runs_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: resident_access_requests resident_access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_access_requests
    ADD CONSTRAINT resident_access_requests_pkey PRIMARY KEY (id);


--
-- Name: sale_comment_read_state sale_comment_read_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_read_state
    ADD CONSTRAINT sale_comment_read_state_pkey PRIMARY KEY (sale_attempt_id, user_id);


--
-- Name: sale_comment_receipts sale_comment_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_receipts
    ADD CONSTRAINT sale_comment_receipts_pkey PRIMARY KEY (user_id, comment_id);


--
-- Name: sale_comment_revisions sale_comment_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_revisions
    ADD CONSTRAINT sale_comment_revisions_pkey PRIMARY KEY (comment_id, version);


--
-- Name: sale_comments sale_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_pkey PRIMARY KEY (id);


--
-- Name: sale_comments sale_comments_sale_attempt_id_author_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_sale_attempt_id_author_id_client_id_key UNIQUE (sale_attempt_id, author_id, client_id);


--
-- Name: sale_comments sale_comments_sale_attempt_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_sale_attempt_id_id_key UNIQUE (sale_attempt_id, id);


--
-- Name: sale_comments sale_comments_sale_attempt_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_sale_attempt_id_sequence_key UNIQUE (sale_attempt_id, sequence);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_pkey PRIMARY KEY (id);


--
-- Name: sale_completion_uploads sale_completion_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_uploads
    ADD CONSTRAINT sale_completion_uploads_pkey PRIMARY KEY (id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_pkey PRIMARY KEY (id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_sale_attempt_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_sale_attempt_id_revision_key UNIQUE (sale_attempt_id, revision);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_supersedes_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_supersedes_id_key UNIQUE (supersedes_id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_id_sale_attempt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_id_sale_attempt_id_key UNIQUE (id, sale_attempt_id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_pkey PRIMARY KEY (id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_sale_attempt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_sale_attempt_id_key UNIQUE (sale_attempt_id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_pkey PRIMARY KEY (id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_sale_attempt_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_sale_attempt_id_request_id_key UNIQUE (sale_attempt_id, request_id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_supersedes_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_supersedes_id_key UNIQUE (supersedes_id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_pkey PRIMARY KEY (id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_sale_attempt_id_receipt_key_r_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_sale_attempt_id_receipt_key_r_key UNIQUE (sale_attempt_id, receipt_key, revision);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_sale_attempt_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_sale_attempt_id_request_id_key UNIQUE (sale_attempt_id, request_id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_supersedes_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_supersedes_id_key UNIQUE (supersedes_id);


--
-- Name: sale_legal_emails sale_legal_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_pkey PRIMARY KEY (id);


--
-- Name: sale_legal_emails sale_legal_emails_sale_attempt_id_kind_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_sale_attempt_id_kind_version_key UNIQUE (sale_attempt_id, kind, version);


--
-- Name: sale_mention_notifications sale_mention_notifications_comment_id_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_mention_notifications
    ADD CONSTRAINT sale_mention_notifications_comment_id_recipient_id_key UNIQUE (comment_id, recipient_id);


--
-- Name: sale_mention_notifications sale_mention_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_mention_notifications
    ADD CONSTRAINT sale_mention_notifications_pkey PRIMARY KEY (id);


--
-- Name: sale_participants sale_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_participants
    ADD CONSTRAINT sale_participants_pkey PRIMARY KEY (sale_attempt_id, user_id);


--
-- Name: sales_forecast_scenario_units sales_forecast_scenario_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenario_units
    ADD CONSTRAINT sales_forecast_scenario_units_pkey PRIMARY KEY (id);


--
-- Name: sales_forecast_scenario_units sales_forecast_scenario_units_scenario_id_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenario_units
    ADD CONSTRAINT sales_forecast_scenario_units_scenario_id_unit_id_key UNIQUE (scenario_id, unit_id);


--
-- Name: sales_forecast_scenarios sales_forecast_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenarios
    ADD CONSTRAINT sales_forecast_scenarios_pkey PRIMARY KEY (id);


--
-- Name: snag_comments snag_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_comments
    ADD CONSTRAINT snag_comments_pkey PRIMARY KEY (id);


--
-- Name: snag_events snag_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_events
    ADD CONSTRAINT snag_events_pkey PRIMARY KEY (id);


--
-- Name: snag_photos snag_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_photos
    ADD CONSTRAINT snag_photos_pkey PRIMARY KEY (id);


--
-- Name: snag_report_items snag_report_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_items
    ADD CONSTRAINT snag_report_items_pkey PRIMARY KEY (id);


--
-- Name: snag_report_items snag_report_items_report_id_snag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_items
    ADD CONSTRAINT snag_report_items_report_id_snag_id_key UNIQUE (report_id, snag_id);


--
-- Name: snag_report_recipients snag_report_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_recipients
    ADD CONSTRAINT snag_report_recipients_pkey PRIMARY KEY (id);


--
-- Name: snag_reports snag_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_reports
    ADD CONSTRAINT snag_reports_pkey PRIMARY KEY (id);


--
-- Name: snags snags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_pkey PRIMARY KEY (id);


--
-- Name: trades trades_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_name_key UNIQUE (name);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: unit_open_events unit_open_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_open_events
    ADD CONSTRAINT unit_open_events_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_attempts unit_sale_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_attempts unit_sale_attempts_reservation_date_not_future; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_reservation_date_not_future CHECK (((reservation_date IS NULL) OR (reservation_date <= CURRENT_DATE))) NOT VALID;


--
-- Name: unit_sale_attempts unit_sale_attempts_unit_id_attempt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_unit_id_attempt_number_key UNIQUE (unit_id, attempt_number);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_document_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_document_id_version_number_key UNIQUE (document_id, version_number);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_notice_submission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_notice_submission_id_key UNIQUE (notice_submission_id);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_storage_bucket_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_storage_bucket_storage_path_key UNIQUE (storage_bucket, storage_path);


--
-- Name: unit_sale_documents unit_sale_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_amount_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_amount_check CHECK ((amount > (0)::numeric)) NOT VALID;


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_paid_at_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_paid_at_check CHECK ((paid_at IS NOT NULL)) NOT VALID;


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_void_consistency_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_void_consistency_check CHECK ((((voided_at IS NULL) AND (voided_by_user_id IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by_user_id IS NOT NULL) AND (length(TRIM(BOTH FROM COALESCE(void_reason, ''::text))) > 0)))) NOT VALID;


--
-- Name: unit_sale_invoices unit_sale_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_notes unit_sale_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_sale_attempt_id_sequence_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_sale_attempt_id_sequence_no_key UNIQUE (sale_attempt_id, sequence_no);


--
-- Name: unit_sale_terms unit_sale_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_pkey PRIMARY KEY (id);


--
-- Name: unit_sale_terms unit_sale_terms_sale_attempt_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_sale_attempt_id_version_number_key UNIQUE (sale_attempt_id, version_number);


--
-- Name: unit_sale_workflow_events unit_sale_workflow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_workflow_events
    ADD CONSTRAINT unit_sale_workflow_events_pkey PRIMARY KEY (id);


--
-- Name: unit_tenancies unit_tenancies_no_overlapping_occupancy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_no_overlapping_occupancy EXCLUDE USING gist (unit_id WITH =, daterange(tenancy_start_date, COALESCE(tenancy_end_date, 'infinity'::date), '[]'::text) WITH &&);


--
-- Name: unit_tenancies unit_tenancies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_pkey PRIMARY KEY (id);


--
-- Name: unit_type_areas unit_type_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_type_areas
    ADD CONSTRAINT unit_type_areas_pkey PRIMARY KEY (id);


--
-- Name: unit_type_areas unit_type_areas_unit_type_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_type_areas
    ADD CONSTRAINT unit_type_areas_unit_type_id_name_key UNIQUE (unit_type_id, name);


--
-- Name: unit_types unit_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_types
    ADD CONSTRAINT unit_types_name_key UNIQUE (name);


--
-- Name: unit_types unit_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_types
    ADD CONSTRAINT unit_types_pkey PRIMARY KEY (id);


--
-- Name: units units_building_id_unit_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_building_id_unit_number_key UNIQUE (building_id, unit_number);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (id);


--
-- Name: units units_reservation_date_not_future; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.units
    ADD CONSTRAINT units_reservation_date_not_future CHECK (((reservation_date IS NULL) OR (reservation_date <= CURRENT_DATE))) NOT VALID;


--
-- Name: user_building_access user_building_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_building_access
    ADD CONSTRAINT user_building_access_pkey PRIMARY KEY (id);


--
-- Name: user_building_access user_building_access_user_id_building_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_building_access
    ADD CONSTRAINT user_building_access_user_id_building_id_key UNIQUE (user_id, building_id);


--
-- Name: user_unit_access user_unit_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unit_access
    ADD CONSTRAINT user_unit_access_pkey PRIMARY KEY (id);


--
-- Name: user_unit_access user_unit_access_user_id_unit_id_access_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unit_access
    ADD CONSTRAINT user_unit_access_user_id_unit_id_access_type_key UNIQUE (user_id, unit_id, access_type);


--
-- Name: audit_events_action_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_action_id_idx ON public.audit_events USING btree (action_id) WHERE (action_id IS NOT NULL);


--
-- Name: audit_events_affected_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_affected_user_created_at_idx ON public.audit_events USING btree (affected_user_id, created_at DESC) WHERE (affected_user_id IS NOT NULL);


--
-- Name: audit_events_building_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_building_created_at_idx ON public.audit_events USING btree (building_id, created_at DESC) WHERE (building_id IS NOT NULL);


--
-- Name: audit_events_category_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_category_created_at_idx ON public.audit_events USING btree (category, created_at DESC);


--
-- Name: audit_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_created_at_idx ON public.audit_events USING btree (created_at DESC);


--
-- Name: audit_events_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_created_by_idx ON public.audit_events USING btree (created_by_user_id);


--
-- Name: audit_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_entity_idx ON public.audit_events USING btree (entity_type, entity_id);


--
-- Name: audit_events_unit_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_unit_created_at_idx ON public.audit_events USING btree (unit_id, created_at DESC) WHERE (unit_id IS NOT NULL);


--
-- Name: building_organisations_one_developer_rep_per_building; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX building_organisations_one_developer_rep_per_building ON public.building_organisations USING btree (building_id) WHERE ((role_on_project = 'developer_representative'::text) AND (active IS TRUE));


--
-- Name: building_organisations_one_main_contractor_per_building; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX building_organisations_one_main_contractor_per_building ON public.building_organisations USING btree (building_id) WHERE ((role_on_project = 'main_contractor'::text) AND (active IS TRUE));


--
-- Name: building_sale_default_payment_schedule_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX building_sale_default_payment_schedule_building_idx ON public.building_sale_default_payment_schedule USING btree (building_id, sequence_no);


--
-- Name: buildings_conveyancer_organisation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buildings_conveyancer_organisation_id_idx ON public.buildings USING btree (conveyancer_organisation_id);


--
-- Name: buildings_sales_agent_organisation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buildings_sales_agent_organisation_id_idx ON public.buildings USING btree (sales_agent_organisation_id);


--
-- Name: completion_upload_document; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX completion_upload_document ON public.unit_sale_document_versions USING btree (completion_upload_id, document_id) WHERE (completion_upload_id IS NOT NULL);


--
-- Name: digest_runs_scheduled_for_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX digest_runs_scheduled_for_idx ON public.digest_runs USING btree (scheduled_for DESC);


--
-- Name: digest_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX digest_runs_status_idx ON public.digest_runs USING btree (status);


--
-- Name: further_deadline_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX further_deadline_source ON public.sale_further_deposit_deadlines USING btree (source_id, recorded_at DESC);


--
-- Name: further_receipt_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX further_receipt_source ON public.sale_further_deposit_receipts USING btree (source_id, receipt_key, revision DESC);


--
-- Name: profiles_last_active_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_last_active_at_idx ON public.profiles USING btree (last_active_at DESC NULLS LAST);


--
-- Name: rental_arrears_episodes_attention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_arrears_episodes_attention_idx ON public.rental_arrears_episodes USING btree (intervention_level, last_reported_at DESC) WHERE (intervention_level = ANY (ARRAY['watch'::text, 'action_required'::text]));


--
-- Name: rental_arrears_episodes_matched_tenancy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_arrears_episodes_matched_tenancy_idx ON public.rental_arrears_episodes USING btree (tenancy_id, first_reported_at DESC) WHERE (attribution_status = 'matched'::text);


--
-- Name: rental_arrears_episodes_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_arrears_episodes_open_idx ON public.rental_arrears_episodes USING btree (last_reported_at DESC) WHERE (status = 'open'::text);


--
-- Name: rental_arrears_episodes_tenancy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_arrears_episodes_tenancy_idx ON public.rental_arrears_episodes USING btree (tenancy_id, first_reported_at DESC);


--
-- Name: rental_arrears_events_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_arrears_events_episode_idx ON public.rental_arrears_events USING btree (episode_id, event_at DESC);


--
-- Name: rental_import_runs_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_import_runs_building_idx ON public.rental_import_runs USING btree (building_id, completed_at DESC);


--
-- Name: rental_import_runs_success_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_import_runs_success_idx ON public.rental_import_runs USING btree (completed_at DESC) WHERE (status = 'succeeded'::text);


--
-- Name: resident_access_requests_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resident_access_requests_email_idx ON public.resident_access_requests USING btree (lower(email));


--
-- Name: resident_access_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resident_access_requests_status_idx ON public.resident_access_requests USING btree (status);


--
-- Name: sale_activity_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_activity_cursor_idx ON public.unit_sale_workflow_events USING btree (sale_attempt_id, created_at DESC, id DESC);


--
-- Name: sale_completion_package_approva_sale_attempt_id_approved_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_completion_package_approva_sale_attempt_id_approved_at_idx ON public.sale_completion_package_approvals USING btree (sale_attempt_id, approved_at DESC);


--
-- Name: sale_completion_uploads_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_completion_uploads_actor ON public.sale_completion_uploads USING btree (actor_id);


--
-- Name: sale_completion_uploads_cleanup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_completion_uploads_cleanup ON public.sale_completion_uploads USING btree (expires_at) WHERE (cleaned_at IS NULL);


--
-- Name: sale_completion_uploads_sale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_completion_uploads_sale ON public.sale_completion_uploads USING btree (sale_id);


--
-- Name: sale_mentions_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_mentions_recipient_idx ON public.sale_mention_notifications USING btree (recipient_id, created_at DESC);


--
-- Name: sale_participants_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_participants_user_idx ON public.sale_participants USING btree (user_id, sale_attempt_id) WHERE (revoked_at IS NULL);


--
-- Name: sales_forecast_scenario_units_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_forecast_scenario_units_building_idx ON public.sales_forecast_scenario_units USING btree (building_id, strategy);


--
-- Name: sales_forecast_scenario_units_scenario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_forecast_scenario_units_scenario_idx ON public.sales_forecast_scenario_units USING btree (scenario_id);


--
-- Name: sales_forecast_scenarios_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_forecast_scenarios_building_idx ON public.sales_forecast_scenarios USING btree (building_id, status);


--
-- Name: snag_photos_media_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_photos_media_type_idx ON public.snag_photos USING btree (media_type);


--
-- Name: snag_report_items_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_report_items_report_idx ON public.snag_report_items USING btree (report_id, sort_order);


--
-- Name: snag_report_items_snag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_report_items_snag_idx ON public.snag_report_items USING btree (snag_id);


--
-- Name: snag_report_recipients_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_report_recipients_report_idx ON public.snag_report_recipients USING btree (report_id);


--
-- Name: snag_report_recipients_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_report_recipients_user_idx ON public.snag_report_recipients USING btree (user_id);


--
-- Name: snag_reports_building_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snag_reports_building_created_idx ON public.snag_reports USING btree (building_id, created_at DESC);


--
-- Name: unit_open_actor_unit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_open_actor_unit_time ON public.unit_open_events USING btree (created_by_user_id, unit_id, created_at DESC);


--
-- Name: unit_open_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_open_time ON public.unit_open_events USING btree (created_at);


--
-- Name: unit_sale_attempts_active_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_attempts_active_status_idx ON public.unit_sale_attempts USING btree (is_active, workflow_status);


--
-- Name: unit_sale_attempts_building_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_attempts_building_status_idx ON public.unit_sale_attempts USING btree (building_id, workflow_status);


--
-- Name: unit_sale_attempts_one_active_per_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_sale_attempts_one_active_per_unit_idx ON public.unit_sale_attempts USING btree (unit_id) WHERE (is_active IS TRUE);


--
-- Name: unit_sale_attempts_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_attempts_unit_idx ON public.unit_sale_attempts USING btree (unit_id);


--
-- Name: unit_sale_document_versions_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_document_versions_document_idx ON public.unit_sale_document_versions USING btree (document_id, uploaded_at DESC);


--
-- Name: unit_sale_document_versions_one_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_sale_document_versions_one_current_idx ON public.unit_sale_document_versions USING btree (document_id) WHERE (is_current IS TRUE);


--
-- Name: unit_sale_documents_agent_fee_milestone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_documents_agent_fee_milestone_idx ON public.unit_sale_documents USING btree (sale_attempt_id, fee_milestone) WHERE (document_type = 'agent_invoice'::text);


--
-- Name: unit_sale_documents_attempt_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_documents_attempt_type_idx ON public.unit_sale_documents USING btree (sale_attempt_id, document_type);


--
-- Name: unit_sale_documents_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_documents_status_idx ON public.unit_sale_documents USING btree (status);


--
-- Name: unit_sale_invoice_payments_active_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_invoice_payments_active_invoice_idx ON public.unit_sale_invoice_payments USING btree (invoice_id, paid_at) WHERE (voided_at IS NULL);


--
-- Name: unit_sale_invoice_payments_client_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_sale_invoice_payments_client_reference_idx ON public.unit_sale_invoice_payments USING btree (client_reference);


--
-- Name: unit_sale_invoice_payments_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_invoice_payments_invoice_idx ON public.unit_sale_invoice_payments USING btree (invoice_id, paid_at);


--
-- Name: unit_sale_invoices_attempt_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_invoices_attempt_status_idx ON public.unit_sale_invoices USING btree (sale_attempt_id, status);


--
-- Name: unit_sale_invoices_current_agent_milestone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_sale_invoices_current_agent_milestone_idx ON public.unit_sale_invoices USING btree (sale_attempt_id, fee_milestone) WHERE ((invoice_type = 'sales_agent'::text) AND (status <> ALL (ARRAY['superseded'::text, 'redacted'::text])));


--
-- Name: unit_sale_notes_attempt_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_notes_attempt_created_idx ON public.unit_sale_notes USING btree (sale_attempt_id, created_at DESC);


--
-- Name: unit_sale_notes_building_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_notes_building_created_idx ON public.unit_sale_notes USING btree (building_id, created_at DESC);


--
-- Name: unit_sale_payment_schedule_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_payment_schedule_attempt_idx ON public.unit_sale_payment_schedule USING btree (sale_attempt_id, sequence_no);


--
-- Name: unit_sale_terms_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_terms_attempt_idx ON public.unit_sale_terms USING btree (sale_attempt_id, is_current);


--
-- Name: unit_sale_terms_one_current_per_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_sale_terms_one_current_per_attempt_idx ON public.unit_sale_terms USING btree (sale_attempt_id) WHERE (is_current IS TRUE);


--
-- Name: unit_sale_workflow_events_attempt_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_workflow_events_attempt_created_idx ON public.unit_sale_workflow_events USING btree (sale_attempt_id, created_at DESC);


--
-- Name: unit_sale_workflow_events_building_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_sale_workflow_events_building_created_idx ON public.unit_sale_workflow_events USING btree (building_id, created_at DESC);


--
-- Name: unit_tenancies_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_tenancies_agent_idx ON public.unit_tenancies USING btree (letting_agent_organisation_id);


--
-- Name: unit_tenancies_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_tenancies_building_idx ON public.unit_tenancies USING btree (building_id, tenancy_start_date DESC);


--
-- Name: unit_tenancies_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unit_tenancies_unit_idx ON public.unit_tenancies USING btree (unit_id, tenancy_start_date DESC);


--
-- Name: units_building_rental_portfolio_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX units_building_rental_portfolio_status_idx ON public.units USING btree (building_id, rental_portfolio_status, unit_number);


--
-- Name: units_building_sale_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX units_building_sale_status_idx ON public.units USING btree (building_id, sale_status, unit_number);


--
-- Name: audit_events audit_events_populate_context; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_populate_context BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.populate_audit_event_context();


--
-- Name: audit_events audit_events_trusted_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_trusted_stamp BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION portal_audit.stamp_general();


--
-- Name: unit_sale_invoice_payments audit_unit_sale_invoice_payment_void; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_unit_sale_invoice_payment_void AFTER UPDATE OF voided_at ON public.unit_sale_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.audit_unit_sale_invoice_payment_void();


--
-- Name: unit_sale_documents completion_draft_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER completion_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_documents FOR EACH ROW EXECUTE FUNCTION public.sales_completion_draft_guard();


--
-- Name: unit_sale_document_versions completion_draft_version_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER completion_draft_version_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_document_versions FOR EACH ROW EXECUTE FUNCTION public.sales_completion_draft_guard();


--
-- Name: unit_sale_workflow_events completion_package_history_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER completion_package_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_workflow_events FOR EACH ROW EXECUTE FUNCTION public.sales_completion_package_history_guard();


--
-- Name: sale_completion_package_approvals completion_package_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER completion_package_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.sale_completion_package_approvals FOR EACH ROW EXECUTE FUNCTION public.sales_completion_approval_immutable();


--
-- Name: building_sale_defaults deposit_defaults_cascade; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deposit_defaults_cascade AFTER INSERT OR UPDATE ON public.building_sale_defaults FOR EACH ROW EXECUTE FUNCTION public.sales_cascade_deposit_defaults();


--
-- Name: building_sale_defaults deposit_defaults_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deposit_defaults_validate BEFORE INSERT OR UPDATE ON public.building_sale_defaults FOR EACH ROW EXECUTE FUNCTION public.sales_deposit_terms_guard();


--
-- Name: sale_exchange_deposit_receipts deposit_receipt_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deposit_receipt_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.sale_exchange_deposit_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_exchange_deposit_immutable();


--
-- Name: sale_exchange_deposit_sources deposit_source_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deposit_source_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.sale_exchange_deposit_sources FOR EACH ROW EXECUTE FUNCTION public.sales_exchange_deposit_immutable();


--
-- Name: unit_sale_terms deposit_terms_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deposit_terms_validate BEFORE INSERT OR UPDATE ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION public.sales_deposit_terms_guard();


--
-- Name: areas essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.areas FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: profiles essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: resident_access_requests essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.resident_access_requests FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: unit_sale_attempts essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: unit_sale_invoices essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.unit_sale_invoices FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: unit_sale_terms essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: units essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: user_building_access essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.user_building_access FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: user_unit_access essential_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_audit_change AFTER INSERT OR DELETE OR UPDATE ON public.user_unit_access FOR EACH ROW EXECUTE FUNCTION portal_audit.business_change();


--
-- Name: unit_sale_invoice_payments essential_payment_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_payment_created AFTER INSERT ON public.unit_sale_invoice_payments FOR EACH ROW EXECUTE FUNCTION portal_audit.payment_created();


--
-- Name: snags essential_snag_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER essential_snag_changed AFTER INSERT OR UPDATE ON public.snags FOR EACH ROW EXECUTE FUNCTION portal_audit.snag_changed();


--
-- Name: sale_further_deposit_deadlines further_deadline_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER further_deadline_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.sale_further_deposit_deadlines FOR EACH ROW EXECUTE FUNCTION public.sales_exchange_deposit_immutable();


--
-- Name: unit_sale_workflow_events further_deposit_event_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER further_deposit_event_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_workflow_events FOR EACH ROW EXECUTE FUNCTION public.sales_further_deposit_event_guard();


--
-- Name: sale_further_deposit_receipts further_receipt_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER further_receipt_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.sale_further_deposit_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_exchange_deposit_immutable();


--
-- Name: handovers handover_unit_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER handover_unit_status BEFORE INSERT ON public.handovers FOR EACH ROW EXECUTE FUNCTION public.complete_handover_unit();


--
-- Name: unit_sale_attempts legal_attempt_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_attempt_guard BEFORE INSERT OR UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.sales_legal_write_guard();


--
-- Name: unit_sale_documents legal_document_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_document_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_documents FOR EACH ROW EXECUTE FUNCTION public.sales_legal_write_guard();


--
-- Name: sale_legal_emails legal_email_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_email_guard BEFORE INSERT OR DELETE OR UPDATE ON public.sale_legal_emails FOR EACH ROW EXECUTE FUNCTION public.sales_legal_email_guard();


--
-- Name: unit_sale_workflow_events legal_history_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_workflow_events FOR EACH ROW EXECUTE FUNCTION public.sales_legal_history_guard();


--
-- Name: unit_sale_payment_schedule legal_schedule_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_schedule_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_payment_schedule FOR EACH ROW EXECUTE FUNCTION public.sales_legal_write_guard();


--
-- Name: unit_sale_terms legal_terms_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_terms_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION public.sales_legal_write_guard();


--
-- Name: units legal_unit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_unit_guard BEFORE INSERT OR UPDATE OF sale_status ON public.units FOR EACH ROW EXECUTE FUNCTION public.sales_legal_unit_guard();


--
-- Name: unit_sale_document_versions legal_version_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legal_version_guard BEFORE INSERT OR DELETE OR UPDATE ON public.unit_sale_document_versions FOR EACH ROW EXECUTE FUNCTION public.sales_legal_write_guard();


--
-- Name: unit_sale_terms normalise_unit_sale_agent_fee_structure; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER normalise_unit_sale_agent_fee_structure BEFORE INSERT OR UPDATE OF agent_fee_percent ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION public.normalise_unit_sale_agent_fee_structure();


--
-- Name: unit_sale_attempts notice_state_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notice_state_guard BEFORE INSERT OR UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.sales_notice_state_guard();


--
-- Name: unit_sale_document_versions notice_version_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notice_version_guard BEFORE DELETE OR UPDATE ON public.unit_sale_document_versions FOR EACH ROW EXECUTE FUNCTION public.sales_notice_version_guard();


--
-- Name: unit_sale_attempts prevent_direct_sale_baseline_marker_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_direct_sale_baseline_marker_change BEFORE INSERT OR UPDATE OF is_system_baseline ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_sale_baseline_marker_change();


--
-- Name: units prevent_direct_unit_commercial_status_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_direct_unit_commercial_status_change BEFORE UPDATE OF sale_status, rental_portfolio_status ON public.units FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_unit_commercial_status_change();


--
-- Name: units prevent_manual_handed_over_unit_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_manual_handed_over_unit_status BEFORE INSERT OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_handed_over_unit_status();


--
-- Name: unit_sale_invoice_payments protect_unit_sale_invoice_payment_history_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_unit_sale_invoice_payment_history_delete BEFORE DELETE ON public.unit_sale_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.protect_unit_sale_invoice_payment_history();


--
-- Name: unit_sale_invoice_payments protect_unit_sale_invoice_payment_history_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_unit_sale_invoice_payment_history_update BEFORE UPDATE ON public.unit_sale_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.protect_unit_sale_invoice_payment_history();


--
-- Name: rental_arrears_events rental_arrears_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rental_arrears_events_append_only BEFORE DELETE OR UPDATE ON public.rental_arrears_events FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_arrears_event_mutation();


--
-- Name: unit_sale_attempts sale_discussion_buyer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sale_discussion_buyer BEFORE UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.protect_discussion_buyer();


--
-- Name: unit_sale_documents sale_document_review_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sale_document_review_activity AFTER UPDATE OF status ON public.unit_sale_documents FOR EACH ROW EXECUTE FUNCTION public.sale_document_activity();


--
-- Name: unit_sale_document_versions sale_document_uploaded_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sale_document_uploaded_activity AFTER INSERT ON public.unit_sale_document_versions FOR EACH ROW EXECUTE FUNCTION public.sale_document_activity();


--
-- Name: unit_sale_workflow_events sale_event_actor_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sale_event_actor_snapshot BEFORE INSERT ON public.unit_sale_workflow_events FOR EACH ROW EXECUTE FUNCTION public.sale_event_actor_snapshot();


--
-- Name: buildings sales_contact_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_contact_audit AFTER UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.sales_contact_audit();


--
-- Name: buildings sales_contact_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_contact_guard BEFORE INSERT OR UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.sales_contact_guard();


--
-- Name: organisations sales_contact_type_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_contact_type_guard BEFORE UPDATE OF type ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.sales_contact_guard();


--
-- Name: organisations sales_email_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_email_audit AFTER UPDATE OF shared_system_email ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.sales_contact_audit();


--
-- Name: building_sale_default_payment_schedule set_building_sale_default_payment_schedule_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_building_sale_default_payment_schedule_updated_at BEFORE UPDATE ON public.building_sale_default_payment_schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_sale_defaults set_building_sale_defaults_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_building_sale_defaults_updated_at BEFORE UPDATE ON public.building_sale_defaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: rental_arrears_episodes set_rental_arrears_episodes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_rental_arrears_episodes_updated_at BEFORE UPDATE ON public.rental_arrears_episodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: rental_import_runs set_rental_import_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_rental_import_runs_updated_at BEFORE UPDATE ON public.rental_import_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sales_forecast_scenarios set_sales_forecast_scenarios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_sales_forecast_scenarios_updated_at BEFORE UPDATE ON public.sales_forecast_scenarios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_sale_attempts set_unit_sale_attempts_stage_entered_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_attempts_stage_entered_at BEFORE INSERT OR UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.set_sale_attempt_stage_entered_at();


--
-- Name: unit_sale_attempts set_unit_sale_attempts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_attempts_updated_at BEFORE UPDATE ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_sale_documents set_unit_sale_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_documents_updated_at BEFORE UPDATE ON public.unit_sale_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_sale_invoices set_unit_sale_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_invoices_updated_at BEFORE UPDATE ON public.unit_sale_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_sale_payment_schedule set_unit_sale_payment_schedule_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_payment_schedule_updated_at BEFORE UPDATE ON public.unit_sale_payment_schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_sale_terms set_unit_sale_terms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_sale_terms_updated_at BEFORE UPDATE ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: unit_tenancies set_unit_tenancies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_unit_tenancies_updated_at BEFORE UPDATE ON public.unit_tenancies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: snag_events snag_events_trusted_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER snag_events_trusted_stamp BEFORE INSERT ON public.snag_events FOR EACH ROW EXECUTE FUNCTION portal_audit.snag_event_stamp();


--
-- Name: unit_sale_invoice_payments stamp_unit_sale_invoice_payment_recorder; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_unit_sale_invoice_payment_recorder BEFORE INSERT ON public.unit_sale_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.stamp_unit_sale_invoice_payment_recorder();


--
-- Name: unit_sale_attempts validate_active_sale_attempt_entry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_active_sale_attempt_entry BEFORE INSERT OR UPDATE OF is_active, unit_id, workflow_status ON public.unit_sale_attempts FOR EACH ROW EXECUTE FUNCTION public.validate_active_sale_attempt_entry();


--
-- Name: buildings validate_building_pc_confirmation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_building_pc_confirmation BEFORE INSERT OR UPDATE OF pc_date, pc_confirmed ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.validate_building_pc_confirmation();


--
-- Name: unit_sale_documents validate_sale_draft_document_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_sale_draft_document_write BEFORE INSERT OR UPDATE ON public.unit_sale_documents FOR EACH ROW EXECUTE FUNCTION public.validate_sale_draft_substantive_write();


--
-- Name: unit_sale_payment_schedule validate_sale_draft_schedule_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_sale_draft_schedule_write BEFORE INSERT OR UPDATE ON public.unit_sale_payment_schedule FOR EACH ROW EXECUTE FUNCTION public.validate_sale_draft_substantive_write();


--
-- Name: unit_sale_terms validate_sale_draft_terms_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_sale_draft_terms_write BEFORE INSERT OR UPDATE ON public.unit_sale_terms FOR EACH ROW EXECUTE FUNCTION public.validate_sale_draft_substantive_write();


--
-- Name: unit_tenancies validate_unit_tenancy_relations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_unit_tenancy_relations BEFORE INSERT OR UPDATE ON public.unit_tenancies FOR EACH ROW EXECUTE FUNCTION public.validate_unit_tenancy_relations();


--
-- Name: areas areas_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: areas areas_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_actor_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_organisation_id_fkey FOREIGN KEY (actor_organisation_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_affected_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_affected_user_id_fkey FOREIGN KEY (affected_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: audit_events audit_events_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;


--
-- Name: building_floors building_floors_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_floors
    ADD CONSTRAINT building_floors_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_organisations building_organisations_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_organisations
    ADD CONSTRAINT building_organisations_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_organisations building_organisations_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_organisations
    ADD CONSTRAINT building_organisations_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: building_sale_default_payment_schedule building_sale_default_payment_schedule_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_default_payment_schedule
    ADD CONSTRAINT building_sale_default_payment_schedule_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_sale_defaults building_sale_defaults_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_sale_defaults building_sale_defaults_conveyancer_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_conveyancer_organisation_id_fkey FOREIGN KEY (conveyancer_organisation_id) REFERENCES public.organisations(id);


--
-- Name: building_sale_defaults building_sale_defaults_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: building_sale_defaults building_sale_defaults_sales_agent_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_sales_agent_organisation_id_fkey FOREIGN KEY (sales_agent_organisation_id) REFERENCES public.organisations(id);


--
-- Name: building_sale_defaults building_sale_defaults_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sale_defaults
    ADD CONSTRAINT building_sale_defaults_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: buildings buildings_conveyancer_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_conveyancer_organisation_id_fkey FOREIGN KEY (conveyancer_organisation_id) REFERENCES public.organisations(id);


--
-- Name: buildings buildings_sales_agent_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_sales_agent_organisation_id_fkey FOREIGN KEY (sales_agent_organisation_id) REFERENCES public.organisations(id);


--
-- Name: handover_key_items handover_key_items_handover_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_key_items
    ADD CONSTRAINT handover_key_items_handover_id_fkey FOREIGN KEY (handover_id) REFERENCES public.handovers(id) ON DELETE CASCADE;


--
-- Name: handover_photos handover_photos_handover_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_photos
    ADD CONSTRAINT handover_photos_handover_id_fkey FOREIGN KEY (handover_id) REFERENCES public.handovers(id) ON DELETE CASCADE;


--
-- Name: handover_photos handover_photos_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_photos
    ADD CONSTRAINT handover_photos_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.profiles(id);


--
-- Name: handovers handovers_handover_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handovers
    ADD CONSTRAINT handovers_handover_by_user_id_fkey FOREIGN KEY (handover_by_user_id) REFERENCES public.profiles(id);


--
-- Name: handovers handovers_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handovers
    ADD CONSTRAINT handovers_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.profiles(id);


--
-- Name: meter_readings meter_readings_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: meter_readings meter_readings_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: meter_readings meter_readings_handover_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_handover_id_fkey FOREIGN KEY (handover_id) REFERENCES public.handovers(id) ON DELETE SET NULL;


--
-- Name: meter_readings meter_readings_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id);


--
-- Name: rental_arrears_episodes rental_arrears_episodes_tenancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_episodes
    ADD CONSTRAINT rental_arrears_episodes_tenancy_id_fkey FOREIGN KEY (tenancy_id) REFERENCES public.unit_tenancies(id) ON DELETE RESTRICT;


--
-- Name: rental_arrears_events rental_arrears_events_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_arrears_events
    ADD CONSTRAINT rental_arrears_events_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.rental_arrears_episodes(id) ON DELETE RESTRICT;


--
-- Name: rental_import_runs rental_import_runs_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_import_runs
    ADD CONSTRAINT rental_import_runs_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: rental_import_runs rental_import_runs_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_import_runs
    ADD CONSTRAINT rental_import_runs_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: reports reports_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: reports reports_generated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_generated_by_user_id_fkey FOREIGN KEY (generated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: reports reports_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: resident_access_requests resident_access_requests_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_access_requests
    ADD CONSTRAINT resident_access_requests_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.profiles(id);


--
-- Name: sale_comment_read_state sale_comment_read_state_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_read_state
    ADD CONSTRAINT sale_comment_read_state_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_comment_read_state sale_comment_read_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_read_state
    ADD CONSTRAINT sale_comment_read_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: sale_comment_receipts sale_comment_receipts_sale_attempt_id_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_receipts
    ADD CONSTRAINT sale_comment_receipts_sale_attempt_id_comment_id_fkey FOREIGN KEY (sale_attempt_id, comment_id) REFERENCES public.sale_comments(sale_attempt_id, id);


--
-- Name: sale_comment_receipts sale_comment_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_receipts
    ADD CONSTRAINT sale_comment_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: sale_comment_revisions sale_comment_revisions_sale_attempt_id_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comment_revisions
    ADD CONSTRAINT sale_comment_revisions_sale_attempt_id_comment_id_fkey FOREIGN KEY (sale_attempt_id, comment_id) REFERENCES public.sale_comments(sale_attempt_id, id);


--
-- Name: sale_comments sale_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: sale_comments sale_comments_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_comments sale_comments_sale_attempt_id_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_comments
    ADD CONSTRAINT sale_comments_sale_attempt_id_parent_id_fkey FOREIGN KEY (sale_attempt_id, parent_id) REFERENCES public.sale_comments(sale_attempt_id, id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_account_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_account_document_id_fkey FOREIGN KEY (account_document_id) REFERENCES public.unit_sale_documents(id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_account_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_account_version_id_fkey FOREIGN KEY (account_version_id) REFERENCES public.unit_sale_document_versions(id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_statement_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_statement_document_id_fkey FOREIGN KEY (statement_document_id) REFERENCES public.unit_sale_documents(id);


--
-- Name: sale_completion_package_approvals sale_completion_package_approvals_statement_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_package_approvals
    ADD CONSTRAINT sale_completion_package_approvals_statement_version_id_fkey FOREIGN KEY (statement_version_id) REFERENCES public.unit_sale_document_versions(id);


--
-- Name: sale_completion_uploads sale_completion_uploads_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_uploads
    ADD CONSTRAINT sale_completion_uploads_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);


--
-- Name: sale_completion_uploads sale_completion_uploads_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_completion_uploads
    ADD CONSTRAINT sale_completion_uploads_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_source_id_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_source_id_sale_attempt_id_fkey FOREIGN KEY (source_id, sale_attempt_id) REFERENCES public.sale_exchange_deposit_sources(id, sale_attempt_id);


--
-- Name: sale_exchange_deposit_receipts sale_exchange_deposit_receipts_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_receipts
    ADD CONSTRAINT sale_exchange_deposit_receipts_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.sale_exchange_deposit_receipts(id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_authority_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_authority_id_fkey FOREIGN KEY (authority_id) REFERENCES public.sale_legal_emails(id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_exchange_deposit_sources sale_exchange_deposit_sources_terms_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_exchange_deposit_sources
    ADD CONSTRAINT sale_exchange_deposit_sources_terms_id_fkey FOREIGN KEY (terms_id) REFERENCES public.unit_sale_terms(id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_source_id_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_source_id_sale_attempt_id_fkey FOREIGN KEY (source_id, sale_attempt_id) REFERENCES public.sale_exchange_deposit_sources(id, sale_attempt_id);


--
-- Name: sale_further_deposit_deadlines sale_further_deposit_deadlines_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_deadlines
    ADD CONSTRAINT sale_further_deposit_deadlines_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.sale_further_deposit_deadlines(id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_source_id_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_source_id_sale_attempt_id_fkey FOREIGN KEY (source_id, sale_attempt_id) REFERENCES public.sale_exchange_deposit_sources(id, sale_attempt_id);


--
-- Name: sale_further_deposit_receipts sale_further_deposit_receipts_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_further_deposit_receipts
    ADD CONSTRAINT sale_further_deposit_receipts_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.sale_further_deposit_receipts(id);


--
-- Name: sale_legal_emails sale_legal_emails_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: sale_legal_emails sale_legal_emails_replaced_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.sale_legal_emails(id);


--
-- Name: sale_legal_emails sale_legal_emails_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);


--
-- Name: sale_legal_emails sale_legal_emails_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_legal_emails
    ADD CONSTRAINT sale_legal_emails_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_mention_notifications sale_mention_notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_mention_notifications
    ADD CONSTRAINT sale_mention_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id);


--
-- Name: sale_mention_notifications sale_mention_notifications_sale_attempt_id_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_mention_notifications
    ADD CONSTRAINT sale_mention_notifications_sale_attempt_id_comment_id_fkey FOREIGN KEY (sale_attempt_id, comment_id) REFERENCES public.sale_comments(sale_attempt_id, id);


--
-- Name: sale_participants sale_participants_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_participants
    ADD CONSTRAINT sale_participants_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);


--
-- Name: sale_participants sale_participants_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_participants
    ADD CONSTRAINT sale_participants_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id);


--
-- Name: sale_participants sale_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_participants
    ADD CONSTRAINT sale_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: sales_forecast_scenario_units sales_forecast_scenario_units_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenario_units
    ADD CONSTRAINT sales_forecast_scenario_units_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: sales_forecast_scenario_units sales_forecast_scenario_units_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenario_units
    ADD CONSTRAINT sales_forecast_scenario_units_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.sales_forecast_scenarios(id) ON DELETE CASCADE;


--
-- Name: sales_forecast_scenario_units sales_forecast_scenario_units_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenario_units
    ADD CONSTRAINT sales_forecast_scenario_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: sales_forecast_scenarios sales_forecast_scenarios_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenarios
    ADD CONSTRAINT sales_forecast_scenarios_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: sales_forecast_scenarios sales_forecast_scenarios_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenarios
    ADD CONSTRAINT sales_forecast_scenarios_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: sales_forecast_scenarios sales_forecast_scenarios_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecast_scenarios
    ADD CONSTRAINT sales_forecast_scenarios_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: snag_comments snag_comments_snag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_comments
    ADD CONSTRAINT snag_comments_snag_id_fkey FOREIGN KEY (snag_id) REFERENCES public.snags(id) ON DELETE CASCADE;


--
-- Name: snag_comments snag_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_comments
    ADD CONSTRAINT snag_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: snag_events snag_events_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_events
    ADD CONSTRAINT snag_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: snag_events snag_events_snag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_events
    ADD CONSTRAINT snag_events_snag_id_fkey FOREIGN KEY (snag_id) REFERENCES public.snags(id) ON DELETE CASCADE;


--
-- Name: snag_photos snag_photos_snag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_photos
    ADD CONSTRAINT snag_photos_snag_id_fkey FOREIGN KEY (snag_id) REFERENCES public.snags(id) ON DELETE CASCADE;


--
-- Name: snag_photos snag_photos_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_photos
    ADD CONSTRAINT snag_photos_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.profiles(id);


--
-- Name: snag_report_items snag_report_items_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_items
    ADD CONSTRAINT snag_report_items_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.snag_reports(id) ON DELETE CASCADE;


--
-- Name: snag_report_items snag_report_items_snag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_items
    ADD CONSTRAINT snag_report_items_snag_id_fkey FOREIGN KEY (snag_id) REFERENCES public.snags(id) ON DELETE CASCADE;


--
-- Name: snag_report_recipients snag_report_recipients_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_recipients
    ADD CONSTRAINT snag_report_recipients_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: snag_report_recipients snag_report_recipients_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_recipients
    ADD CONSTRAINT snag_report_recipients_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.snag_reports(id) ON DELETE CASCADE;


--
-- Name: snag_report_recipients snag_report_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_report_recipients
    ADD CONSTRAINT snag_report_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: snag_reports snag_reports_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_reports
    ADD CONSTRAINT snag_reports_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: snag_reports snag_reports_communal_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_reports
    ADD CONSTRAINT snag_reports_communal_area_id_fkey FOREIGN KEY (communal_area_id) REFERENCES public.areas(id) ON DELETE SET NULL;


--
-- Name: snag_reports snag_reports_sent_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_reports
    ADD CONSTRAINT snag_reports_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: snag_reports snag_reports_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snag_reports
    ADD CONSTRAINT snag_reports_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;


--
-- Name: snags snags_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: snags snags_assigned_to_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_assigned_to_organisation_id_fkey FOREIGN KEY (assigned_to_organisation_id) REFERENCES public.organisations(id);


--
-- Name: snags snags_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.profiles(id);


--
-- Name: snags snags_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id);


--
-- Name: snags snags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: snags snags_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: snags snags_flat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_flat_id_fkey FOREIGN KEY (flat_id) REFERENCES public.flats(id) ON DELETE RESTRICT;


--
-- Name: snags snags_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id);


--
-- Name: snags snags_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id);


--
-- Name: snags snags_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snags
    ADD CONSTRAINT snags_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: unit_sale_attempts unit_sale_attempts_commercial_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_commercial_approved_by_user_id_fkey FOREIGN KEY (commercial_approved_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_completion_arrangements_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_completion_arrangements_confirmed_by_fkey FOREIGN KEY (completion_arrangements_confirmed_by) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_completion_authority_given_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_completion_authority_given_by_fkey FOREIGN KEY (completion_authority_given_by) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_completion_authority_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_completion_authority_requested_by_fkey FOREIGN KEY (completion_authority_requested_by) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_conveyancer_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_conveyancer_organisation_id_fkey FOREIGN KEY (conveyancer_organisation_id) REFERENCES public.organisations(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_legal_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_legal_completed_by_fkey FOREIGN KEY (legal_completed_by) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_redacted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_redacted_by_user_id_fkey FOREIGN KEY (redacted_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_reservation_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_reservation_approved_by_user_id_fkey FOREIGN KEY (reservation_approved_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_reservation_rejected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_reservation_rejected_by_user_id_fkey FOREIGN KEY (reservation_rejected_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_reservation_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_reservation_submitted_by_user_id_fkey FOREIGN KEY (reservation_submitted_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_sales_agent_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_sales_agent_organisation_id_fkey FOREIGN KEY (sales_agent_organisation_id) REFERENCES public.organisations(id);


--
-- Name: unit_sale_attempts unit_sale_attempts_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: unit_sale_attempts unit_sale_attempts_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_attempts
    ADD CONSTRAINT unit_sale_attempts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.unit_sale_documents(id) ON DELETE CASCADE;


--
-- Name: unit_sale_document_versions unit_sale_document_versions_redacted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_redacted_by_user_id_fkey FOREIGN KEY (redacted_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_document_versions unit_sale_document_versions_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_document_versions
    ADD CONSTRAINT unit_sale_document_versions_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_documents unit_sale_documents_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_documents unit_sale_documents_approved_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_approved_version_id_fkey FOREIGN KEY (approved_version_id) REFERENCES public.unit_sale_document_versions(id);


--
-- Name: unit_sale_documents unit_sale_documents_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_documents unit_sale_documents_redacted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_redacted_by_user_id_fkey FOREIGN KEY (redacted_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_documents unit_sale_documents_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_documents unit_sale_documents_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_documents
    ADD CONSTRAINT unit_sale_documents_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.unit_sale_invoices(id) ON DELETE CASCADE;


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_paid_by_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_paid_by_organisation_id_fkey FOREIGN KEY (paid_by_organisation_id) REFERENCES public.organisations(id);


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_invoice_payments unit_sale_invoice_payments_voided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoice_payments
    ADD CONSTRAINT unit_sale_invoice_payments_voided_by_user_id_fkey FOREIGN KEY (voided_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_invoices unit_sale_invoices_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_invoices unit_sale_invoices_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_invoices unit_sale_invoices_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.unit_sale_documents(id) ON DELETE SET NULL;


--
-- Name: unit_sale_invoices unit_sale_invoices_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_invoices unit_sale_invoices_supplier_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_supplier_organisation_id_fkey FOREIGN KEY (supplier_organisation_id) REFERENCES public.organisations(id);


--
-- Name: unit_sale_invoices unit_sale_invoices_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_invoices
    ADD CONSTRAINT unit_sale_invoices_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_notes unit_sale_notes_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: unit_sale_notes unit_sale_notes_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_notes unit_sale_notes_redacted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_redacted_by_user_id_fkey FOREIGN KEY (redacted_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_notes unit_sale_notes_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_notes unit_sale_notes_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_notes
    ADD CONSTRAINT unit_sale_notes_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_sale_terms_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_sale_terms_id_fkey FOREIGN KEY (sale_terms_id) REFERENCES public.unit_sale_terms(id) ON DELETE SET NULL;


--
-- Name: unit_sale_payment_schedule unit_sale_payment_schedule_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_payment_schedule
    ADD CONSTRAINT unit_sale_payment_schedule_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_terms unit_sale_terms_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_terms unit_sale_terms_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_terms unit_sale_terms_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_terms unit_sale_terms_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_terms
    ADD CONSTRAINT unit_sale_terms_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_workflow_events unit_sale_workflow_events_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_workflow_events
    ADD CONSTRAINT unit_sale_workflow_events_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: unit_sale_workflow_events unit_sale_workflow_events_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_workflow_events
    ADD CONSTRAINT unit_sale_workflow_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id);


--
-- Name: unit_sale_workflow_events unit_sale_workflow_events_sale_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_workflow_events
    ADD CONSTRAINT unit_sale_workflow_events_sale_attempt_id_fkey FOREIGN KEY (sale_attempt_id) REFERENCES public.unit_sale_attempts(id) ON DELETE CASCADE;


--
-- Name: unit_sale_workflow_events unit_sale_workflow_events_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_sale_workflow_events
    ADD CONSTRAINT unit_sale_workflow_events_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: unit_tenancies unit_tenancies_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id);


--
-- Name: unit_tenancies unit_tenancies_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: unit_tenancies unit_tenancies_letting_agent_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_letting_agent_organisation_id_fkey FOREIGN KEY (letting_agent_organisation_id) REFERENCES public.organisations(id);


--
-- Name: unit_tenancies unit_tenancies_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id);


--
-- Name: unit_tenancies unit_tenancies_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_tenancies
    ADD CONSTRAINT unit_tenancies_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: unit_type_areas unit_type_areas_unit_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_type_areas
    ADD CONSTRAINT unit_type_areas_unit_type_id_fkey FOREIGN KEY (unit_type_id) REFERENCES public.unit_types(id) ON DELETE CASCADE;


--
-- Name: units units_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: units units_unit_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_unit_type_id_fkey FOREIGN KEY (unit_type_id) REFERENCES public.unit_types(id);


--
-- Name: user_building_access user_building_access_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_building_access
    ADD CONSTRAINT user_building_access_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: user_building_access user_building_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_building_access
    ADD CONSTRAINT user_building_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_unit_access user_unit_access_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unit_access
    ADD CONSTRAINT user_unit_access_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;


--
-- Name: user_unit_access user_unit_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unit_access
    ADD CONSTRAINT user_unit_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: auth_events; Type: ROW SECURITY; Schema: portal_audit; Owner: -
--

ALTER TABLE portal_audit.auth_events ENABLE ROW LEVEL SECURITY;

--
-- Name: options; Type: ROW SECURITY; Schema: portal_audit; Owner: -
--

ALTER TABLE portal_audit.options ENABLE ROW LEVEL SECURITY;

--
-- Name: snags admins delete snags production; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete snags production" ON public.snags FOR DELETE TO authenticated USING (public.is_back_office_user());


--
-- Name: areas admins manage areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage areas" ON public.areas TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: building_floors admins manage building floors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage building floors" ON public.building_floors TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: buildings admins manage buildings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage buildings" ON public.buildings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: flats admins manage flats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage flats" ON public.flats TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::public.user_role))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::public.user_role)))));


--
-- Name: organisations admins manage organisations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage organisations" ON public.organisations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: trades admins manage trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage trades" ON public.trades TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: unit_type_areas admins manage unit type areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage unit type areas" ON public.unit_type_areas TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: unit_types admins manage unit types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage unit types" ON public.unit_types TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'developer'::public.user_role]))))));


--
-- Name: areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_comments authenticated users create comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users create comments" ON public.snag_comments FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: trades authenticated users read trades hardened; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users read trades hardened" ON public.trades FOR SELECT TO authenticated USING (true);


--
-- Name: unit_type_areas authenticated users read unit type areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users read unit type areas" ON public.unit_type_areas FOR SELECT TO authenticated USING (true);


--
-- Name: unit_types authenticated users read unit types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users read unit types" ON public.unit_types FOR SELECT TO authenticated USING (true);


--
-- Name: audit_events back office add audit events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "back office add audit events" ON public.audit_events FOR INSERT TO authenticated WITH CHECK ((public.is_setup_admin() AND (created_by_user_id = auth.uid())));


--
-- Name: handovers back office manage handovers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "back office manage handovers" ON public.handovers TO authenticated USING (public.is_setup_admin()) WITH CHECK (public.is_setup_admin());


--
-- Name: profiles back office manage profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "back office manage profiles" ON public.profiles TO authenticated USING (public.is_setup_admin()) WITH CHECK (public.is_setup_admin());


--
-- Name: resident_access_requests back office manage resident access requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "back office manage resident access requests" ON public.resident_access_requests TO authenticated USING (public.is_setup_admin()) WITH CHECK (public.is_setup_admin());


--
-- Name: audit_events back office read audit events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "back office read audit events" ON public.audit_events FOR SELECT TO authenticated USING (public.is_setup_admin());


--
-- Name: building_floors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_floors ENABLE ROW LEVEL SECURITY;

--
-- Name: building_organisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_organisations ENABLE ROW LEVEL SECURITY;

--
-- Name: building_sale_default_payment_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_sale_default_payment_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: building_sale_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_sale_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: buildings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_comments comments are visible to authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "comments are visible to authenticated users" ON public.snag_comments FOR SELECT TO authenticated USING (true);


--
-- Name: unit_sale_workflow_events commercial admins add workflow events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins add workflow events" ON public.unit_sale_workflow_events FOR INSERT TO authenticated WITH CHECK ((public.can_manage_sale_attempt(sale_attempt_id) AND (created_by_user_id = auth.uid())));


--
-- Name: building_sale_default_payment_schedule commercial admins manage building default payment schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage building default payment schedule" ON public.building_sale_default_payment_schedule TO authenticated USING (public.is_sales_internal_user()) WITH CHECK (public.is_sales_internal_user());


--
-- Name: building_sale_defaults commercial admins manage building sale defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage building sale defaults" ON public.building_sale_defaults TO authenticated USING (public.is_sales_internal_user()) WITH CHECK (public.is_sales_internal_user());


--
-- Name: unit_sale_payment_schedule commercial admins manage payment schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage payment schedule" ON public.unit_sale_payment_schedule TO authenticated USING (public.can_manage_sale_attempt(sale_attempt_id)) WITH CHECK (public.can_manage_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_attempts commercial admins manage sale attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale attempts" ON public.unit_sale_attempts TO authenticated USING (public.is_sales_internal_user()) WITH CHECK (public.is_sales_internal_user());


--
-- Name: unit_sale_document_versions commercial admins manage sale document versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale document versions" ON public.unit_sale_document_versions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.unit_sale_documents usd
  WHERE ((usd.id = unit_sale_document_versions.document_id) AND public.can_manage_sale_attempt(usd.sale_attempt_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.unit_sale_documents usd
  WHERE ((usd.id = unit_sale_document_versions.document_id) AND public.can_manage_sale_attempt(usd.sale_attempt_id)))));


--
-- Name: unit_sale_documents commercial admins manage sale documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale documents" ON public.unit_sale_documents TO authenticated USING (public.can_manage_sale_attempt(sale_attempt_id)) WITH CHECK (public.can_manage_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_invoices commercial admins manage sale invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale invoices" ON public.unit_sale_invoices TO authenticated USING (public.can_manage_sale_attempt(sale_attempt_id)) WITH CHECK (public.can_manage_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_notes commercial admins manage sale notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale notes" ON public.unit_sale_notes TO authenticated USING (public.can_manage_sale_attempt(sale_attempt_id)) WITH CHECK (public.can_manage_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_terms commercial admins manage sale terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commercial admins manage sale terms" ON public.unit_sale_terms TO authenticated USING (public.can_manage_sale_attempt(sale_attempt_id)) WITH CHECK (public.can_manage_sale_attempt(sale_attempt_id));


--
-- Name: sale_completion_package_approvals completion_package_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY completion_package_read ON public.sale_completion_package_approvals FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: sale_exchange_deposit_receipts deposit_receipt_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deposit_receipt_read ON public.sale_exchange_deposit_receipts FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: sale_exchange_deposit_sources deposit_source_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deposit_source_read ON public.sale_exchange_deposit_sources FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: digest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_comments discussion_comments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_comments_read ON public.sale_comments FOR SELECT TO authenticated USING (public.can_discuss_sale(sale_attempt_id));


--
-- Name: sale_mention_notifications discussion_mentions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_mentions_read ON public.sale_mention_notifications FOR SELECT TO authenticated USING (((recipient_id = auth.uid()) AND public.can_discuss_sale(sale_attempt_id)));


--
-- Name: sale_participants discussion_participants_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_participants_read ON public.sale_participants FOR SELECT TO authenticated USING (public.can_discuss_sale(sale_attempt_id));


--
-- Name: sale_comment_read_state discussion_read_state_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_read_state_read ON public.sale_comment_read_state FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND public.can_discuss_sale(sale_attempt_id)));


--
-- Name: sale_comment_receipts discussion_receipts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_receipts_read ON public.sale_comment_receipts FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND public.can_discuss_sale(sale_attempt_id)));


--
-- Name: sale_comment_revisions discussion_revisions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussion_revisions_read ON public.sale_comment_revisions FOR SELECT TO authenticated USING (public.can_discuss_sale(sale_attempt_id));


--
-- Name: flats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flats ENABLE ROW LEVEL SECURITY;

--
-- Name: flats flats are visible to authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "flats are visible to authenticated users" ON public.flats FOR SELECT TO authenticated USING (true);


--
-- Name: sale_further_deposit_deadlines further_deadlines_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY further_deadlines_read ON public.sale_further_deposit_deadlines FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: sale_further_deposit_receipts further_receipts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY further_receipts_read ON public.sale_further_deposit_receipts FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: handover_key_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.handover_key_items ENABLE ROW LEVEL SECURITY;

--
-- Name: handover_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.handover_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: handovers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.handovers ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_legal_emails legal_emails_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_emails_read ON public.sale_legal_emails FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: meter_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_report_items operational users add snag report items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users add snag report items" ON public.snag_report_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.snag_reports sr
  WHERE ((sr.id = snag_report_items.report_id) AND public.is_operational_user() AND public.can_access_building(sr.building_id)))));


--
-- Name: snag_report_recipients operational users add snag report recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users add snag report recipients" ON public.snag_report_recipients FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.snag_reports sr
  WHERE ((sr.id = snag_report_recipients.report_id) AND public.is_operational_user() AND public.can_access_building(sr.building_id)))));


--
-- Name: snag_reports operational users add snag reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users add snag reports" ON public.snag_reports FOR INSERT TO authenticated WITH CHECK ((public.is_operational_user() AND public.can_access_building(building_id)));


--
-- Name: snag_report_items operational users read snag report items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users read snag report items" ON public.snag_report_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.snag_reports sr
  WHERE ((sr.id = snag_report_items.report_id) AND public.is_operational_user() AND public.can_access_building(sr.building_id)))));


--
-- Name: snag_report_recipients operational users read snag report recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users read snag report recipients" ON public.snag_report_recipients FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.snag_reports sr
  WHERE ((sr.id = snag_report_recipients.report_id) AND public.is_operational_user() AND public.can_access_building(sr.building_id)))));


--
-- Name: snag_reports operational users read snag reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "operational users read snag reports" ON public.snag_reports FOR SELECT TO authenticated USING ((public.is_operational_user() AND public.can_access_building(building_id)));


--
-- Name: organisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

--
-- Name: handover_key_items permitted users add handover key items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users add handover key items" ON public.handover_key_items FOR INSERT TO authenticated WITH CHECK ((public.is_back_office_user() AND (EXISTS ( SELECT 1
   FROM public.handovers h
  WHERE (h.id = handover_key_items.handover_id)))));


--
-- Name: handover_photos permitted users add handover photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users add handover photos" ON public.handover_photos FOR INSERT TO authenticated WITH CHECK (((uploaded_by_user_id = auth.uid()) AND public.is_back_office_user() AND (EXISTS ( SELECT 1
   FROM public.handovers h
  WHERE (h.id = handover_photos.handover_id)))));


--
-- Name: meter_readings permitted users add meter readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users add meter readings" ON public.meter_readings FOR INSERT TO authenticated WITH CHECK (((created_by_user_id = auth.uid()) AND public.can_access_unit(unit_id) AND (meter_type = ANY (ARRAY['electricity'::text, 'water'::text])) AND (photo_url IS NOT NULL)));


--
-- Name: snag_events permitted users add snag events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users add snag events" ON public.snag_events FOR INSERT TO authenticated WITH CHECK (((created_by_user_id = auth.uid()) AND public.can_access_snag(snag_id)));


--
-- Name: snag_photos permitted users add snag photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users add snag photos" ON public.snag_photos FOR INSERT TO authenticated WITH CHECK (((uploaded_by_user_id = auth.uid()) AND public.can_access_snag(snag_id)));


--
-- Name: areas permitted users read areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read areas" ON public.areas FOR SELECT TO authenticated USING ((public.is_back_office_user() OR ((unit_id IS NOT NULL) AND public.can_access_unit(unit_id)) OR ((unit_id IS NULL) AND (building_id IS NOT NULL) AND public.can_access_building(building_id))));


--
-- Name: building_floors permitted users read building floors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read building floors" ON public.building_floors FOR SELECT TO authenticated USING (public.can_access_building(building_id));


--
-- Name: building_organisations permitted users read building organisations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read building organisations" ON public.building_organisations FOR SELECT TO authenticated USING ((public.is_setup_admin() OR public.can_access_building(building_id) OR (organisation_id = public.current_organisation_id())));


--
-- Name: buildings permitted users read buildings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read buildings" ON public.buildings FOR SELECT TO authenticated USING (public.can_access_building(id));


--
-- Name: handover_key_items permitted users read handover key items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read handover key items" ON public.handover_key_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.handovers h
  WHERE ((h.id = handover_key_items.handover_id) AND public.can_access_unit(h.unit_id)))));


--
-- Name: handover_photos permitted users read handover photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read handover photos" ON public.handover_photos FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.handovers h
  WHERE ((h.id = handover_photos.handover_id) AND public.can_access_unit(h.unit_id)))));


--
-- Name: handovers permitted users read handovers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read handovers" ON public.handovers FOR SELECT TO authenticated USING ((public.is_setup_admin() OR public.can_access_unit(unit_id)));


--
-- Name: meter_readings permitted users read meter readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read meter readings" ON public.meter_readings FOR SELECT TO authenticated USING ((public.is_setup_admin() OR public.can_access_unit(unit_id)));


--
-- Name: organisations permitted users read organisations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read organisations" ON public.organisations FOR SELECT TO authenticated USING ((public.is_setup_admin() OR (id = public.current_organisation_id()) OR (EXISTS ( SELECT 1
   FROM public.building_organisations bo
  WHERE ((bo.organisation_id = organisations.id) AND COALESCE(bo.active, true) AND public.can_access_building(bo.building_id))))));


--
-- Name: snag_events permitted users read snag events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read snag events" ON public.snag_events FOR SELECT TO authenticated USING (public.can_access_snag(snag_id));


--
-- Name: snag_photos permitted users read snag photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read snag photos" ON public.snag_photos FOR SELECT TO authenticated USING (public.can_access_snag(snag_id));


--
-- Name: units permitted users read units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "permitted users read units" ON public.units FOR SELECT TO authenticated USING (public.can_access_unit(id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles visible to permitted users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles visible to permitted users" ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_setup_admin() OR (organisation_id = public.current_organisation_id()) OR (EXISTS ( SELECT 1
   FROM public.user_building_access uba
  WHERE ((uba.user_id = profiles.id) AND public.can_access_building(uba.building_id)))) OR ((organisation_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.building_organisations bo
  WHERE ((bo.organisation_id = profiles.organisation_id) AND COALESCE(bo.active, true) AND public.can_access_building(bo.building_id)))))));


--
-- Name: unit_tenancies rental administrators read tenancies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rental administrators read tenancies" ON public.unit_tenancies FOR SELECT TO authenticated USING ((public.current_app_role() = ANY (ARRAY['admin'::text, 'developer'::text])));


--
-- Name: rental_arrears_episodes rental managers read arrears episodes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rental managers read arrears episodes" ON public.rental_arrears_episodes FOR SELECT TO authenticated USING (((public.current_app_role() = ANY (ARRAY['admin'::text, 'developer'::text])) AND (EXISTS ( SELECT 1
   FROM public.unit_tenancies tenancy
  WHERE ((tenancy.id = rental_arrears_episodes.tenancy_id) AND public.can_access_building(tenancy.building_id))))));


--
-- Name: rental_arrears_events rental managers read arrears events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rental managers read arrears events" ON public.rental_arrears_events FOR SELECT TO authenticated USING (((public.current_app_role() = ANY (ARRAY['admin'::text, 'developer'::text])) AND (EXISTS ( SELECT 1
   FROM (public.rental_arrears_episodes episode
     JOIN public.unit_tenancies tenancy ON ((tenancy.id = episode.tenancy_id)))
  WHERE ((episode.id = rental_arrears_events.episode_id) AND public.can_access_building(tenancy.building_id))))));


--
-- Name: rental_import_runs rental managers read import health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rental managers read import health" ON public.rental_import_runs FOR SELECT TO authenticated USING (((public.current_app_role() = ANY (ARRAY['admin'::text, 'developer'::text])) AND ((building_id IS NULL) OR public.can_access_building(building_id))));


--
-- Name: rental_arrears_episodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_arrears_episodes ENABLE ROW LEVEL SECURITY;

--
-- Name: rental_arrears_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_arrears_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rental_import_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_import_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: resident_access_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resident_access_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: snags role aware snag inserts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "role aware snag inserts" ON public.snags FOR INSERT TO authenticated WITH CHECK (((created_by_user_id = auth.uid()) AND (((source_type = 'developer_snag'::text) AND (public.is_setup_admin() OR ((public.current_app_role() = 'developer_representative'::text) AND (building_id IS NOT NULL) AND public.can_access_building(building_id)))) OR ((public.current_app_role() = 'resident'::text) AND (source_type = 'leaseholder_defect'::text) AND (unit_id IS NOT NULL) AND (area_id IS NOT NULL) AND public.can_access_unit(unit_id) AND public.building_allows_resident_routine_snags(building_id) AND (EXISTS ( SELECT 1
   FROM public.units u
  WHERE ((u.id = snags.unit_id) AND (u.building_id = snags.building_id)))) AND (EXISTS ( SELECT 1
   FROM public.areas a
  WHERE ((a.id = snags.area_id) AND (a.unit_id = a.unit_id))))))));


--
-- Name: snags role aware snag updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "role aware snag updates" ON public.snags FOR UPDATE TO authenticated USING ((public.is_setup_admin() OR ((public.current_app_role() = 'developer_representative'::text) AND (building_id IS NOT NULL) AND public.can_access_building(building_id)) OR public.contractor_can_access_developer_snag(building_id, assigned_to_organisation_id))) WITH CHECK ((public.is_setup_admin() OR ((public.current_app_role() = 'developer_representative'::text) AND (building_id IS NOT NULL) AND public.can_access_building(building_id)) OR public.contractor_can_access_developer_snag(building_id, assigned_to_organisation_id)));


--
-- Name: snags role aware snag visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "role aware snag visibility" ON public.snags FOR SELECT TO authenticated USING (public.can_access_snag_row(source_type, building_id, unit_id, assigned_to_organisation_id, created_by_user_id));


--
-- Name: sale_comment_read_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_comment_read_state ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_comment_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_comment_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_comment_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_comment_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_completion_package_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_completion_package_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_completion_uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_completion_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_exchange_deposit_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_exchange_deposit_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_exchange_deposit_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_exchange_deposit_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_further_deposit_deadlines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_further_deposit_deadlines ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_further_deposit_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_further_deposit_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_legal_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_legal_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_mention_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_mention_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_forecast_scenario_units sales internal users manage forecast scenario units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales internal users manage forecast scenario units" ON public.sales_forecast_scenario_units TO authenticated USING ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id))) WITH CHECK ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id)));


--
-- Name: sales_forecast_scenarios sales internal users manage forecast scenarios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales internal users manage forecast scenarios" ON public.sales_forecast_scenarios TO authenticated USING ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id))) WITH CHECK ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id)));


--
-- Name: sales_forecast_scenario_units sales internal users read forecast scenario units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales internal users read forecast scenario units" ON public.sales_forecast_scenario_units FOR SELECT TO authenticated USING ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id)));


--
-- Name: sales_forecast_scenarios sales internal users read forecast scenarios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales internal users read forecast scenarios" ON public.sales_forecast_scenarios FOR SELECT TO authenticated USING ((public.is_sales_internal_user() AND public.can_access_sales_building(building_id)));


--
-- Name: building_sale_default_payment_schedule sales users read building default payment schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read building default payment schedule" ON public.building_sale_default_payment_schedule FOR SELECT TO authenticated USING (public.can_access_sales_building(building_id));


--
-- Name: building_sale_defaults sales users read building sale defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read building sale defaults" ON public.building_sale_defaults FOR SELECT TO authenticated USING (public.can_access_sales_building(building_id));


--
-- Name: unit_sale_payment_schedule sales users read payment schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read payment schedule" ON public.unit_sale_payment_schedule FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_attempts sales users read sale attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale attempts" ON public.unit_sale_attempts FOR SELECT TO authenticated USING (public.can_access_sales_building(building_id));


--
-- Name: unit_sale_document_versions sales users read sale document versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale document versions" ON public.unit_sale_document_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.unit_sale_documents usd
  WHERE ((usd.id = unit_sale_document_versions.document_id) AND public.can_access_sale_attempt(usd.sale_attempt_id) AND ((usd.visibility = 'shared_sale_file'::text) OR public.is_sales_internal_user() OR (usd.visibility = public.current_app_role()))))));


--
-- Name: unit_sale_documents sales users read sale documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale documents" ON public.unit_sale_documents FOR SELECT TO authenticated USING ((public.can_access_sale_attempt(sale_attempt_id) AND ((visibility = 'shared_sale_file'::text) OR public.is_sales_internal_user() OR (visibility = public.current_app_role()))));


--
-- Name: unit_sale_invoice_payments sales users read sale invoice payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale invoice payments" ON public.unit_sale_invoice_payments FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_invoices sales users read sale invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale invoices" ON public.unit_sale_invoices FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_notes sales users read sale notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale notes" ON public.unit_sale_notes FOR SELECT TO authenticated USING ((public.can_access_sale_attempt(sale_attempt_id) AND ((visibility = 'shared_sale_file'::text) OR public.is_sales_internal_user() OR (visibility = public.current_app_role()))));


--
-- Name: unit_sale_terms sales users read sale terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read sale terms" ON public.unit_sale_terms FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: unit_sale_workflow_events sales users read workflow events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales users read workflow events" ON public.unit_sale_workflow_events FOR SELECT TO authenticated USING (public.can_access_sale_attempt(sale_attempt_id));


--
-- Name: sales_forecast_scenario_units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_forecast_scenario_units ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_forecast_scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_forecast_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: organisations sales_routing_organisations_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_routing_organisations_read ON public.organisations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.buildings b
  WHERE (((organisations.id = b.conveyancer_organisation_id) OR (organisations.id = b.sales_agent_organisation_id)) AND public.can_access_sales_building(b.id)))));


--
-- Name: units setup admins create units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "setup admins create units" ON public.units FOR INSERT TO authenticated WITH CHECK ((public.is_setup_admin() AND (sale_status = 'not_released'::text) AND (rental_portfolio_status = 'not_in_portfolio'::text)));


--
-- Name: units setup admins delete units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "setup admins delete units" ON public.units FOR DELETE TO authenticated USING (public.is_setup_admin());


--
-- Name: building_organisations setup admins manage building organisations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "setup admins manage building organisations" ON public.building_organisations TO authenticated USING (public.is_setup_admin()) WITH CHECK (public.is_setup_admin());


--
-- Name: digest_runs setup admins read digest runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "setup admins read digest runs" ON public.digest_runs FOR SELECT TO authenticated USING (public.is_setup_admin());


--
-- Name: snag_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_events ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_report_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_report_items ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_report_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_report_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: snag_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snag_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: snags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snags ENABLE ROW LEVEL SECURITY;

--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_open_events unit_open_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unit_open_admin_read ON public.unit_open_events FOR SELECT TO authenticated USING ((public.is_setup_admin() AND (created_at >= (statement_timestamp() - '30 days'::interval))));


--
-- Name: unit_open_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_open_events ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_document_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_document_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_invoice_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_invoice_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_payment_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_payment_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_sale_workflow_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_sale_workflow_events ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_tenancies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_tenancies ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_type_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_type_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_types ENABLE ROW LEVEL SECURITY;

--
-- Name: units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

--
-- Name: user_building_access user building access visible to owner and back office; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user building access visible to owner and back office" ON public.user_building_access FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_setup_admin()));


--
-- Name: user_unit_access user unit access visible to owner and back office; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user unit access visible to owner and back office" ON public.user_unit_access FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_setup_admin()));


--
-- Name: user_building_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_building_access ENABLE ROW LEVEL SECURITY;

--
-- Name: user_unit_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_unit_access ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA portal_audit; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA portal_audit TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION actor(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.actor() FROM PUBLIC;
GRANT ALL ON FUNCTION portal_audit.actor() TO service_role;


--
-- Name: FUNCTION business_change(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.business_change() FROM PUBLIC;


--
-- Name: FUNCTION payment_created(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.payment_created() FROM PUBLIC;


--
-- Name: FUNCTION purge_unit_opens(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.purge_unit_opens() FROM PUBLIC;


--
-- Name: FUNCTION snag_changed(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.snag_changed() FROM PUBLIC;


--
-- Name: FUNCTION snag_event_stamp(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.snag_event_stamp() FROM PUBLIC;


--
-- Name: FUNCTION stamp_general(); Type: ACL; Schema: portal_audit; Owner: -
--

REVOKE ALL ON FUNCTION portal_audit.stamp_general() FROM PUBLIC;


--
-- Name: FUNCTION assert_commercial_unit_actor(p_actor_user_id uuid, p_allowed_roles text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_commercial_unit_actor(p_actor_user_id uuid, p_allowed_roles text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_commercial_unit_actor(p_actor_user_id uuid, p_allowed_roles text[]) TO service_role;


--
-- Name: FUNCTION assert_sale_discussion(p_sale uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_sale_discussion(p_sale uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_sale_discussion(p_sale uuid) TO service_role;


--
-- Name: FUNCTION assert_tenancy_manager(p_actor_user_id uuid, p_admin_only boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_tenancy_manager(p_actor_user_id uuid, p_admin_only boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_tenancy_manager(p_actor_user_id uuid, p_admin_only boolean) TO service_role;


--
-- Name: FUNCTION audit_unit_open_setting(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_unit_open_setting(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_unit_open_setting(p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.audit_unit_open_setting(p_enabled boolean) TO service_role;


--
-- Name: FUNCTION audit_unit_sale_invoice_payment_void(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_unit_sale_invoice_payment_void() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_unit_sale_invoice_payment_void() TO anon;
GRANT ALL ON FUNCTION public.audit_unit_sale_invoice_payment_void() TO authenticated;
GRANT ALL ON FUNCTION public.audit_unit_sale_invoice_payment_void() TO service_role;


--
-- Name: FUNCTION building_allows_flat_handover(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.building_allows_flat_handover(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.building_allows_flat_handover(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.building_allows_flat_handover(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION building_allows_resident_routine_snags(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.building_allows_resident_routine_snags(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.building_allows_resident_routine_snags(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.building_allows_resident_routine_snags(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION building_closing_notice_start(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.building_closing_notice_start(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.building_closing_notice_start(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.building_closing_notice_start(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION building_derived_lifecycle_status(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.building_derived_lifecycle_status(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.building_derived_lifecycle_status(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.building_derived_lifecycle_status(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION building_initial_defects_reporting_end(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.building_initial_defects_reporting_end(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.building_initial_defects_reporting_end(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.building_initial_defects_reporting_end(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_building(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_building(target_building_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_building(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_building(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_sale(p_sale_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_sale(p_sale_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_sale(p_sale_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_sale_attempt(target_sale_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_sale_attempt(target_sale_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_sale_attempt(target_sale_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_sale_attempt(target_sale_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_sales_building(target_building_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_sales_building(target_building_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_sales_building(target_building_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_sales_building(target_building_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_snag(target_snag_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_snag(target_snag_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_snag(target_snag_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_snag(target_snag_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_snag_row(target_source_type text, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_snag_row(target_source_type text, target_building_id uuid, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_building_id uuid, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_building_id uuid, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_snag_row(target_source_type text, target_building_id uuid, target_unit_id uuid, target_assigned_organisation_id uuid, target_created_by_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_unit(target_unit_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_unit(target_unit_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_unit(target_unit_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_unit(target_unit_id uuid) TO service_role;


--
-- Name: FUNCTION can_discuss_sale(p_sale uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_discuss_sale(p_sale uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_discuss_sale(p_sale uuid) TO service_role;
GRANT ALL ON FUNCTION public.can_discuss_sale(p_sale uuid) TO authenticated;


--
-- Name: FUNCTION can_manage_sale_attempt(target_sale_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_manage_sale_attempt(target_sale_attempt_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_manage_sale_attempt(target_sale_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_sale_attempt(target_sale_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION change_snag(p_snag uuid, p_patch jsonb, p_comment text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.change_snag(p_snag uuid, p_patch jsonb, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.change_snag(p_snag uuid, p_patch jsonb, p_comment text) TO authenticated;
GRANT ALL ON FUNCTION public.change_snag(p_snag uuid, p_patch jsonb, p_comment text) TO service_role;


--
-- Name: FUNCTION complete_handover_unit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.complete_handover_unit() TO anon;
GRANT ALL ON FUNCTION public.complete_handover_unit() TO authenticated;
GRANT ALL ON FUNCTION public.complete_handover_unit() TO service_role;


--
-- Name: FUNCTION contractor_can_access_developer_snag(target_building_id uuid, target_assigned_organisation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.contractor_can_access_developer_snag(target_building_id uuid, target_assigned_organisation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.contractor_can_access_developer_snag(target_building_id uuid, target_assigned_organisation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.contractor_can_access_developer_snag(target_building_id uuid, target_assigned_organisation_id uuid) TO service_role;


--
-- Name: TABLE unit_tenancies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_tenancies TO service_role;
GRANT SELECT ON TABLE public.unit_tenancies TO authenticated;


--
-- Name: FUNCTION create_unit_tenancy(p_actor_user_id uuid, p_building_id uuid, p_unit_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_unit_tenancy(p_actor_user_id uuid, p_building_id uuid, p_unit_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_unit_tenancy(p_actor_user_id uuid, p_building_id uuid, p_unit_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) TO service_role;


--
-- Name: FUNCTION current_app_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_app_role() TO anon;
GRANT ALL ON FUNCTION public.current_app_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_role() TO service_role;


--
-- Name: FUNCTION current_organisation_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_organisation_id() TO anon;
GRANT ALL ON FUNCTION public.current_organisation_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_organisation_id() TO service_role;


--
-- Name: FUNCTION delete_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION get_agent_fee_portfolio(p_requester_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_agent_fee_portfolio(p_requester_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_agent_fee_portfolio(p_requester_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_agent_fee_portfolio(p_requester_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_agent_fee_portfolio(p_requester_id uuid) TO service_role;


--
-- Name: FUNCTION get_unit_allocation_sale_workflows(p_actor_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_unit_allocation_sale_workflows(p_actor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_unit_allocation_sale_workflows(p_actor_user_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION initialize_imported_unit_sale_status(p_unit_id uuid, p_sale_status text, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.initialize_imported_unit_sale_status(p_unit_id uuid, p_sale_status text, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.initialize_imported_unit_sale_status(p_unit_id uuid, p_sale_status text, p_source text) TO service_role;


--
-- Name: FUNCTION is_back_office_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_back_office_user() TO anon;
GRANT ALL ON FUNCTION public.is_back_office_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_back_office_user() TO service_role;


--
-- Name: FUNCTION is_operational_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_operational_user() TO anon;
GRANT ALL ON FUNCTION public.is_operational_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_operational_user() TO service_role;


--
-- Name: FUNCTION is_sales_external_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_sales_external_user() TO anon;
GRANT ALL ON FUNCTION public.is_sales_external_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_sales_external_user() TO service_role;


--
-- Name: FUNCTION is_sales_internal_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_sales_internal_user() TO anon;
GRANT ALL ON FUNCTION public.is_sales_internal_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_sales_internal_user() TO service_role;


--
-- Name: FUNCTION is_setup_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_setup_admin() TO anon;
GRANT ALL ON FUNCTION public.is_setup_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_setup_admin() TO service_role;


--
-- Name: FUNCTION mark_sale_attempt_substantive(p_sale_attempt_id uuid, p_actor_user_id uuid, p_event_type text, p_summary text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_sale_attempt_substantive(p_sale_attempt_id uuid, p_actor_user_id uuid, p_event_type text, p_summary text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_sale_attempt_substantive(p_sale_attempt_id uuid, p_actor_user_id uuid, p_event_type text, p_summary text) TO service_role;


--
-- Name: FUNCTION normalise_unit_sale_agent_fee_structure(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalise_unit_sale_agent_fee_structure() TO anon;
GRANT ALL ON FUNCTION public.normalise_unit_sale_agent_fee_structure() TO authenticated;
GRANT ALL ON FUNCTION public.normalise_unit_sale_agent_fee_structure() TO service_role;


--
-- Name: FUNCTION populate_audit_event_context(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.populate_audit_event_context() TO anon;
GRANT ALL ON FUNCTION public.populate_audit_event_context() TO authenticated;
GRANT ALL ON FUNCTION public.populate_audit_event_context() TO service_role;


--
-- Name: FUNCTION portal_audit_page(p_filters jsonb, p_before_time timestamp with time zone, p_before_id uuid, p_before_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_audit_page(p_filters jsonb, p_before_time timestamp with time zone, p_before_id uuid, p_before_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_audit_page(p_filters jsonb, p_before_time timestamp with time zone, p_before_id uuid, p_before_source text) TO authenticated;
GRANT ALL ON FUNCTION public.portal_audit_page(p_filters jsonb, p_before_time timestamp with time zone, p_before_id uuid, p_before_source text) TO service_role;


--
-- Name: FUNCTION prepare_unit_baseline_sale_record(p_unit_id uuid, p_actor_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prepare_unit_baseline_sale_record(p_unit_id uuid, p_actor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prepare_unit_baseline_sale_record(p_unit_id uuid, p_actor_user_id uuid) TO service_role;


--
-- Name: FUNCTION prevent_direct_sale_baseline_marker_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_direct_sale_baseline_marker_change() TO anon;
GRANT ALL ON FUNCTION public.prevent_direct_sale_baseline_marker_change() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_direct_sale_baseline_marker_change() TO service_role;


--
-- Name: FUNCTION prevent_direct_unit_commercial_status_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_direct_unit_commercial_status_change() TO anon;
GRANT ALL ON FUNCTION public.prevent_direct_unit_commercial_status_change() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_direct_unit_commercial_status_change() TO service_role;


--
-- Name: FUNCTION prevent_manual_handed_over_unit_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_manual_handed_over_unit_status() TO anon;
GRANT ALL ON FUNCTION public.prevent_manual_handed_over_unit_status() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_manual_handed_over_unit_status() TO service_role;


--
-- Name: FUNCTION prevent_rental_arrears_event_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_rental_arrears_event_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_rental_arrears_event_mutation() TO service_role;


--
-- Name: FUNCTION protect_discussion_buyer(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_discussion_buyer() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_discussion_buyer() TO service_role;


--
-- Name: FUNCTION protect_unit_sale_invoice_payment_history(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_unit_sale_invoice_payment_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_unit_sale_invoice_payment_history() TO anon;
GRANT ALL ON FUNCTION public.protect_unit_sale_invoice_payment_history() TO authenticated;
GRANT ALL ON FUNCTION public.protect_unit_sale_invoice_payment_history() TO service_role;


--
-- Name: FUNCTION record_unit_open(p_unit uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_unit_open(p_unit uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_unit_open(p_unit uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_unit_open(p_unit uuid) TO service_role;


--
-- Name: FUNCTION record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid) TO anon;
GRANT ALL ON FUNCTION public.record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_unit_sale_invoice_payment(p_invoice_id uuid, p_payer_type text, p_amount numeric, p_payment_date date, p_note text, p_client_reference uuid, p_requester_id uuid) TO service_role;


--
-- Name: FUNCTION return_pre_exchange_unit_for_sale(p_sale_attempt_id uuid, p_actor_user_id uuid, p_reason text, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.return_pre_exchange_unit_for_sale(p_sale_attempt_id uuid, p_actor_user_id uuid, p_reason text, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.return_pre_exchange_unit_for_sale(p_sale_attempt_id uuid, p_actor_user_id uuid, p_reason text, p_source text) TO service_role;


--
-- Name: FUNCTION sale_activity_page(p_sale uuid, p_before_time timestamp with time zone, p_before_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_activity_page(p_sale uuid, p_before_time timestamp with time zone, p_before_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_activity_page(p_sale uuid, p_before_time timestamp with time zone, p_before_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.sale_activity_page(p_sale uuid, p_before_time timestamp with time zone, p_before_id uuid) TO authenticated;


--
-- Name: FUNCTION sale_actor_names(p_sales uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_actor_names(p_sales uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_actor_names(p_sales uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sale_actor_names(p_sales uuid[]) TO service_role;


--
-- Name: FUNCTION sale_attempt_blocks_unit_allocation(p_sale_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_attempt_blocks_unit_allocation(p_sale_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_attempt_blocks_unit_allocation(p_sale_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION sale_comment_history(p_sale uuid, p_comment uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_comment_history(p_sale uuid, p_comment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_comment_history(p_sale uuid, p_comment uuid) TO service_role;
GRANT ALL ON FUNCTION public.sale_comment_history(p_sale uuid, p_comment uuid) TO authenticated;


--
-- Name: FUNCTION sale_comment_page(p_sale uuid, p_before bigint, p_after bigint, p_target uuid, p_unit uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_comment_page(p_sale uuid, p_before bigint, p_after bigint, p_target uuid, p_unit uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_comment_page(p_sale uuid, p_before bigint, p_after bigint, p_target uuid, p_unit uuid) TO service_role;
GRANT ALL ON FUNCTION public.sale_comment_page(p_sale uuid, p_before bigint, p_after bigint, p_target uuid, p_unit uuid) TO authenticated;


--
-- Name: FUNCTION sale_comment_read(p_sale uuid, p_comments uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_comment_read(p_sale uuid, p_comments uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_comment_read(p_sale uuid, p_comments uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.sale_comment_read(p_sale uuid, p_comments uuid[]) TO authenticated;


--
-- Name: FUNCTION sale_comment_unread(p_sales uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_comment_unread(p_sales uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_comment_unread(p_sales uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.sale_comment_unread(p_sales uuid[]) TO authenticated;


--
-- Name: FUNCTION sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid, p_stage text, p_mentions uuid[], p_comment uuid, p_version integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid, p_stage text, p_mentions uuid[], p_comment uuid, p_version integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid, p_stage text, p_mentions uuid[], p_comment uuid, p_version integer) TO service_role;
GRANT ALL ON FUNCTION public.sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid, p_stage text, p_mentions uuid[], p_comment uuid, p_version integer) TO authenticated;


--
-- Name: FUNCTION sale_discussion_access(p_sale uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_discussion_access(p_sale uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_discussion_access(p_sale uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION sale_discussion_candidate(p_sale uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_discussion_candidate(p_sale uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_discussion_candidate(p_sale uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION sale_discussion_people(p_sale uuid, p_candidates boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_discussion_people(p_sale uuid, p_candidates boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_discussion_people(p_sale uuid, p_candidates boolean) TO service_role;
GRANT ALL ON FUNCTION public.sale_discussion_people(p_sale uuid, p_candidates boolean) TO authenticated;


--
-- Name: FUNCTION sale_discussion_start(p_unit uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_discussion_start(p_unit uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_discussion_start(p_unit uuid) TO service_role;
GRANT ALL ON FUNCTION public.sale_discussion_start(p_unit uuid) TO authenticated;


--
-- Name: FUNCTION sale_document_activity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_document_activity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_document_activity() TO service_role;


--
-- Name: FUNCTION sale_event_actor_snapshot(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_event_actor_snapshot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_event_actor_snapshot() TO service_role;


--
-- Name: TABLE unit_sale_workflow_events; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,MAINTAIN ON TABLE public.unit_sale_workflow_events TO authenticated;
GRANT SELECT,INSERT,MAINTAIN ON TABLE public.unit_sale_workflow_events TO service_role;


--
-- Name: FUNCTION sale_event_projection(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sale_event_projection(e public.unit_sale_workflow_events) TO anon;
GRANT ALL ON FUNCTION public.sale_event_projection(e public.unit_sale_workflow_events) TO authenticated;
GRANT ALL ON FUNCTION public.sale_event_projection(e public.unit_sale_workflow_events) TO service_role;


--
-- Name: FUNCTION sale_event_projection_before_deposit(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sale_event_projection_before_deposit(e public.unit_sale_workflow_events) TO anon;
GRANT ALL ON FUNCTION public.sale_event_projection_before_deposit(e public.unit_sale_workflow_events) TO authenticated;
GRANT ALL ON FUNCTION public.sale_event_projection_before_deposit(e public.unit_sale_workflow_events) TO service_role;


--
-- Name: FUNCTION sale_event_projection_before_further_deposit(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_event_projection_before_further_deposit(e public.unit_sale_workflow_events) FROM PUBLIC;


--
-- Name: FUNCTION sale_event_projection_before_legal(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_event_projection_before_legal(e public.unit_sale_workflow_events) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_event_projection_before_legal(e public.unit_sale_workflow_events) TO service_role;


--
-- Name: FUNCTION sale_event_projection_before_notice(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sale_event_projection_before_notice(e public.unit_sale_workflow_events) TO anon;
GRANT ALL ON FUNCTION public.sale_event_projection_before_notice(e public.unit_sale_workflow_events) TO authenticated;
GRANT ALL ON FUNCTION public.sale_event_projection_before_notice(e public.unit_sale_workflow_events) TO service_role;


--
-- Name: FUNCTION sale_event_projection_before_package(e public.unit_sale_workflow_events); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sale_event_projection_before_package(e public.unit_sale_workflow_events) TO anon;
GRANT ALL ON FUNCTION public.sale_event_projection_before_package(e public.unit_sale_workflow_events) TO authenticated;
GRANT ALL ON FUNCTION public.sale_event_projection_before_package(e public.unit_sale_workflow_events) TO service_role;


--
-- Name: FUNCTION sale_mentions_inbox(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_mentions_inbox() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_mentions_inbox() TO service_role;
GRANT ALL ON FUNCTION public.sale_mentions_inbox() TO authenticated;


--
-- Name: FUNCTION sale_workflow_context(p_sales uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sale_workflow_context(p_sales uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sale_workflow_context(p_sales uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.sale_workflow_context(p_sales uuid[]) TO authenticated;


--
-- Name: TABLE building_sale_defaults; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.building_sale_defaults TO anon;
GRANT ALL ON TABLE public.building_sale_defaults TO authenticated;
GRANT ALL ON TABLE public.building_sale_defaults TO service_role;


--
-- Name: FUNCTION sales_apply_inherited_deposits(p_defaults public.building_sale_defaults, p_previous public.building_sale_defaults); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_apply_inherited_deposits(p_defaults public.building_sale_defaults, p_previous public.building_sale_defaults) FROM PUBLIC;


--
-- Name: FUNCTION sales_building_access(p_building uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_building_access(p_building uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_building_access(p_building uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION sales_cascade_deposit_defaults(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_cascade_deposit_defaults() FROM PUBLIC;


--
-- Name: FUNCTION sales_completion_approval_immutable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_completion_approval_immutable() TO anon;
GRANT ALL ON FUNCTION public.sales_completion_approval_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.sales_completion_approval_immutable() TO service_role;


--
-- Name: FUNCTION sales_completion_draft_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_completion_draft_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_completion_draft_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_completion_draft_guard() TO service_role;


--
-- Name: FUNCTION sales_completion_package_context(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_completion_package_context(p_sale uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_completion_package_context(p_sale uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_completion_package_context(p_sale uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_completion_package_history_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_completion_package_history_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_completion_package_history_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_completion_package_history_guard() TO service_role;


--
-- Name: FUNCTION sales_completion_upload(p_sale uuid, p_actor uuid, p_request uuid, p_files jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_completion_upload(p_sale uuid, p_actor uuid, p_request uuid, p_files jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_completion_upload(p_sale uuid, p_actor uuid, p_request uuid, p_files jsonb) TO service_role;


--
-- Name: TABLE sale_completion_uploads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_completion_uploads TO service_role;


--
-- Name: FUNCTION sales_completion_upload_cleanup(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_completion_upload_cleanup() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_completion_upload_cleanup() TO service_role;


--
-- Name: FUNCTION sales_completion_upload_session(p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_files jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_completion_upload_session(p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_files jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_completion_upload_session(p_sale uuid, p_actor uuid, p_request uuid, p_action text, p_files jsonb) TO service_role;


--
-- Name: FUNCTION sales_contact_audit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_contact_audit() TO anon;
GRANT ALL ON FUNCTION public.sales_contact_audit() TO authenticated;
GRANT ALL ON FUNCTION public.sales_contact_audit() TO service_role;


--
-- Name: FUNCTION sales_contact_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_contact_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_contact_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_contact_guard() TO service_role;


--
-- Name: FUNCTION sales_deposit_context(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_deposit_context(p_sale uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_deposit_context(p_sale uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_deposit_context(p_sale uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_deposit_terms_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_deposit_terms_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_deposit_terms_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_deposit_terms_guard() TO service_role;


--
-- Name: FUNCTION sales_deposit_timing(p_value jsonb, p_require_time boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_deposit_timing(p_value jsonb, p_require_time boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_deposit_timing(p_value jsonb, p_require_time boolean) TO authenticated;
GRANT ALL ON FUNCTION public.sales_deposit_timing(p_value jsonb, p_require_time boolean) TO service_role;


--
-- Name: FUNCTION sales_exchange_deposit_amount(p_snapshot jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_exchange_deposit_amount(p_snapshot jsonb) FROM PUBLIC;


--
-- Name: FUNCTION sales_exchange_deposit_context(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_exchange_deposit_context(p_sale uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_exchange_deposit_context(p_sale uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_exchange_deposit_context(p_sale uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_exchange_deposit_immutable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_exchange_deposit_immutable() TO anon;
GRANT ALL ON FUNCTION public.sales_exchange_deposit_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.sales_exchange_deposit_immutable() TO service_role;


--
-- Name: FUNCTION sales_further_deposit_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_further_deposit_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_further_deposit_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_further_deposit_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_further_deposit_amount(p_snapshot jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_further_deposit_amount(p_snapshot jsonb) TO anon;
GRANT ALL ON FUNCTION public.sales_further_deposit_amount(p_snapshot jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.sales_further_deposit_amount(p_snapshot jsonb) TO service_role;


--
-- Name: FUNCTION sales_further_deposit_event_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_further_deposit_event_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_further_deposit_event_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_further_deposit_event_guard() TO service_role;


--
-- Name: FUNCTION sales_legal_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_action(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_legal_action_before_deposit(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_action_before_deposit(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_action_before_notice(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_action_before_notice(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_action_before_package(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_action_before_package(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_action_before_renewal(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_action_before_renewal(p_sale uuid, p_action text, p_payload jsonb, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_assert(p_sale uuid, p_actor uuid, p_roles text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_assert(p_sale uuid, p_actor uuid, p_roles text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_assert(p_sale uuid, p_actor uuid, p_roles text[]) TO service_role;


--
-- Name: FUNCTION sales_legal_dispatch(p_id uuid, p_actor uuid, p_status text, p_message_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_dispatch(p_id uuid, p_actor uuid, p_status text, p_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_dispatch(p_id uuid, p_actor uuid, p_status text, p_message_id text) TO service_role;


--
-- Name: FUNCTION sales_legal_email_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_legal_email_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_legal_email_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_email_guard() TO service_role;


--
-- Name: FUNCTION sales_legal_event(p_sale uuid, p_actor uuid, p_type text, p_summary text, p_meta jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_event(p_sale uuid, p_actor uuid, p_type text, p_summary text, p_meta jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_event(p_sale uuid, p_actor uuid, p_type text, p_summary text, p_meta jsonb) TO service_role;


--
-- Name: FUNCTION sales_legal_expire(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_expire(p_sale uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_expire(p_sale uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_legal_history_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_legal_history_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_legal_history_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_history_guard() TO service_role;


--
-- Name: FUNCTION sales_legal_prepare_email(p_sale uuid, p_actor uuid, p_id uuid, p_kind text, p_snapshot jsonb, p_email jsonb, p_date text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_prepare_email(p_sale uuid, p_actor uuid, p_id uuid, p_kind text, p_snapshot jsonb, p_email jsonb, p_date text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_prepare_email(p_sale uuid, p_actor uuid, p_id uuid, p_kind text, p_snapshot jsonb, p_email jsonb, p_date text) TO service_role;


--
-- Name: FUNCTION sales_legal_register_document(p_sale uuid, p_actor uuid, p_type text, p_file jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_register_document(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_register_document(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) TO service_role;


--
-- Name: FUNCTION sales_legal_register_document_before_notice(p_sale uuid, p_actor uuid, p_type text, p_file jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_register_document_before_notice(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_register_document_before_package(p_sale uuid, p_actor uuid, p_type text, p_file jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_register_document_before_package(p_sale uuid, p_actor uuid, p_type text, p_file jsonb) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_snapshot(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_snapshot(p_sale uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_snapshot(p_sale uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_snapshot(p_sale uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION sales_legal_snapshot_before_further_deposit(p_sale uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_snapshot_before_further_deposit(p_sale uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION sales_legal_submit_notice(p_sale uuid, p_actor uuid, p_request uuid, p_file jsonb, p_notice text, p_due text, p_replace boolean, p_expected uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_legal_submit_notice(p_sale uuid, p_actor uuid, p_request uuid, p_file jsonb, p_notice text, p_due text, p_replace boolean, p_expected uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_legal_submit_notice(p_sale uuid, p_actor uuid, p_request uuid, p_file jsonb, p_notice text, p_due text, p_replace boolean, p_expected uuid) TO service_role;


--
-- Name: FUNCTION sales_legal_unit_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_legal_unit_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_legal_unit_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_unit_guard() TO service_role;


--
-- Name: FUNCTION sales_legal_write_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_legal_write_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_legal_write_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_legal_write_guard() TO service_role;


--
-- Name: FUNCTION sales_notice_state_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_notice_state_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_notice_state_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_notice_state_guard() TO service_role;


--
-- Name: FUNCTION sales_notice_version_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sales_notice_version_guard() TO anon;
GRANT ALL ON FUNCTION public.sales_notice_version_guard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_notice_version_guard() TO service_role;


--
-- Name: FUNCTION sales_workflow_mark_unit_completed(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_workflow_mark_unit_completed(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_workflow_mark_unit_completed(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION sales_workflow_mark_unit_exchanged(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_workflow_mark_unit_exchanged(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_workflow_mark_unit_exchanged(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION sales_workflow_mark_unit_for_sale(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_workflow_mark_unit_for_sale(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_workflow_mark_unit_for_sale(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION sales_workflow_mark_unit_reserved(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_workflow_mark_unit_reserved(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_workflow_mark_unit_reserved(p_unit_id uuid, p_sale_attempt_id uuid, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION save_portal_user_access(p_user uuid, p_profile jsonb, p_buildings uuid[], p_units jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_portal_user_access(p_user uuid, p_profile jsonb, p_buildings uuid[], p_units jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_portal_user_access(p_user uuid, p_profile jsonb, p_buildings uuid[], p_units jsonb) TO service_role;


--
-- Name: FUNCTION save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb) TO service_role;


--
-- Name: FUNCTION save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) TO anon;
GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) TO authenticated;
GRANT ALL ON FUNCTION public.save_unit_commercial_model(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) TO service_role;


--
-- Name: FUNCTION save_unit_commercial_model_with_agent_fees(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_unit_commercial_model_with_agent_fees(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_unit_commercial_model_with_agent_fees(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) TO anon;
GRANT ALL ON FUNCTION public.save_unit_commercial_model_with_agent_fees(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[]) TO service_role;


--
-- Name: FUNCTION save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_unit_commercial_model_with_deposits(p_unit_id uuid, p_requester_id uuid, p_list_price_at_offer numeric, p_contract_price numeric, p_parking_value numeric, p_developer_contribution numeric, p_agent_contribution numeric, p_reservation_fee numeric, p_reservation_fee_holder text, p_agent_fee_percent numeric, p_exchange_agent_fee_percent numeric, p_completion_agent_fee_percent numeric, p_vat_rate numeric, p_solicitor_fee numeric, p_exchange_deposit_percent numeric, p_second_deposit_enabled boolean, p_second_deposit_percent numeric, p_second_deposit_months_after_exchange integer, p_completion_balance_percent numeric, p_deposit_summary text, p_commercial_summary text, p_payment_schedule jsonb, p_developer_contribution_value numeric, p_developer_contribution_value_type text, p_agent_contribution_value numeric, p_agent_contribution_value_type text, p_parking_contribution_value numeric, p_parking_location_details text, p_additional_special_conditions text[], p_further_deposit_timing jsonb) TO service_role;


--
-- Name: FUNCTION set_sale_attempt_stage_entered_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_sale_attempt_stage_entered_at() TO anon;
GRANT ALL ON FUNCTION public.set_sale_attempt_stage_entered_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_sale_attempt_stage_entered_at() TO service_role;


--
-- Name: FUNCTION set_unit_rental_portfolio_status(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_unit_rental_portfolio_status(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_unit_rental_portfolio_status(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION set_unit_sales_availability(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_unit_sales_availability(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_unit_sales_availability(p_unit_ids uuid[], p_target_status text, p_actor_user_id uuid, p_source text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION stamp_unit_sale_invoice_payment_recorder(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stamp_unit_sale_invoice_payment_recorder() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stamp_unit_sale_invoice_payment_recorder() TO anon;
GRANT ALL ON FUNCTION public.stamp_unit_sale_invoice_payment_recorder() TO authenticated;
GRANT ALL ON FUNCTION public.stamp_unit_sale_invoice_payment_recorder() TO service_role;


--
-- Name: FUNCTION update_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_unit_tenancy(p_actor_user_id uuid, p_tenancy_id uuid, p_tenant_name text, p_tenancy_start_date date, p_fixed_term_end_date date, p_tenancy_end_date date, p_monthly_rent numeric, p_rent_due_day integer, p_deposit_amount numeric, p_letting_agent_organisation_id uuid, p_notes text, p_source_type text, p_source_reference text) TO service_role;


--
-- Name: FUNCTION validate_active_sale_attempt_entry(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_active_sale_attempt_entry() TO anon;
GRANT ALL ON FUNCTION public.validate_active_sale_attempt_entry() TO authenticated;
GRANT ALL ON FUNCTION public.validate_active_sale_attempt_entry() TO service_role;


--
-- Name: FUNCTION validate_building_pc_confirmation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_building_pc_confirmation() TO anon;
GRANT ALL ON FUNCTION public.validate_building_pc_confirmation() TO authenticated;
GRANT ALL ON FUNCTION public.validate_building_pc_confirmation() TO service_role;


--
-- Name: FUNCTION validate_sale_draft_substantive_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_sale_draft_substantive_write() TO anon;
GRANT ALL ON FUNCTION public.validate_sale_draft_substantive_write() TO authenticated;
GRANT ALL ON FUNCTION public.validate_sale_draft_substantive_write() TO service_role;


--
-- Name: TABLE units; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.units TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.units TO authenticated;
GRANT ALL ON TABLE public.units TO service_role;


--
-- Name: FUNCTION validate_tenancy_unit_eligibility(p_unit_id uuid, p_tenancy_start_date date, p_tenancy_end_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_tenancy_unit_eligibility(p_unit_id uuid, p_tenancy_start_date date, p_tenancy_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_tenancy_unit_eligibility(p_unit_id uuid, p_tenancy_start_date date, p_tenancy_end_date date) TO service_role;


--
-- Name: FUNCTION validate_unit_tenancy_relations(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_unit_tenancy_relations() TO anon;
GRANT ALL ON FUNCTION public.validate_unit_tenancy_relations() TO authenticated;
GRANT ALL ON FUNCTION public.validate_unit_tenancy_relations() TO service_role;


--
-- Name: FUNCTION void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid) TO anon;
GRANT ALL ON FUNCTION public.void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.void_unit_sale_invoice_payment(p_payment_id uuid, p_reason text, p_requester_id uuid) TO service_role;


--
-- Name: TABLE areas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.areas TO anon;
GRANT ALL ON TABLE public.areas TO authenticated;
GRANT ALL ON TABLE public.areas TO service_role;


--
-- Name: TABLE audit_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN ON TABLE public.audit_events TO authenticated;
GRANT SELECT,INSERT,MAINTAIN ON TABLE public.audit_events TO service_role;


--
-- Name: TABLE building_floors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.building_floors TO anon;
GRANT ALL ON TABLE public.building_floors TO authenticated;
GRANT ALL ON TABLE public.building_floors TO service_role;


--
-- Name: TABLE building_organisations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.building_organisations TO anon;
GRANT ALL ON TABLE public.building_organisations TO authenticated;
GRANT ALL ON TABLE public.building_organisations TO service_role;


--
-- Name: TABLE building_sale_default_payment_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.building_sale_default_payment_schedule TO anon;
GRANT ALL ON TABLE public.building_sale_default_payment_schedule TO authenticated;
GRANT ALL ON TABLE public.building_sale_default_payment_schedule TO service_role;


--
-- Name: TABLE buildings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.buildings TO anon;
GRANT ALL ON TABLE public.buildings TO authenticated;
GRANT ALL ON TABLE public.buildings TO service_role;


--
-- Name: TABLE digest_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.digest_runs TO anon;
GRANT ALL ON TABLE public.digest_runs TO authenticated;
GRANT ALL ON TABLE public.digest_runs TO service_role;


--
-- Name: TABLE flats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.flats TO anon;
GRANT ALL ON TABLE public.flats TO authenticated;
GRANT ALL ON TABLE public.flats TO service_role;


--
-- Name: TABLE handover_key_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.handover_key_items TO anon;
GRANT ALL ON TABLE public.handover_key_items TO authenticated;
GRANT ALL ON TABLE public.handover_key_items TO service_role;


--
-- Name: TABLE handover_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.handover_photos TO anon;
GRANT ALL ON TABLE public.handover_photos TO authenticated;
GRANT ALL ON TABLE public.handover_photos TO service_role;


--
-- Name: TABLE handovers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.handovers TO anon;
GRANT ALL ON TABLE public.handovers TO authenticated;
GRANT ALL ON TABLE public.handovers TO service_role;


--
-- Name: TABLE import_batches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.import_batches TO anon;
GRANT ALL ON TABLE public.import_batches TO authenticated;
GRANT ALL ON TABLE public.import_batches TO service_role;


--
-- Name: TABLE meter_readings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meter_readings TO anon;
GRANT ALL ON TABLE public.meter_readings TO authenticated;
GRANT ALL ON TABLE public.meter_readings TO service_role;


--
-- Name: TABLE organisations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organisations TO anon;
GRANT ALL ON TABLE public.organisations TO authenticated;
GRANT ALL ON TABLE public.organisations TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE rental_arrears_episodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_arrears_episodes TO service_role;
GRANT SELECT ON TABLE public.rental_arrears_episodes TO authenticated;


--
-- Name: TABLE rental_arrears_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_arrears_events TO service_role;
GRANT SELECT ON TABLE public.rental_arrears_events TO authenticated;


--
-- Name: TABLE rental_import_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_import_runs TO service_role;
GRANT SELECT ON TABLE public.rental_import_runs TO authenticated;


--
-- Name: TABLE reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reports TO anon;
GRANT ALL ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;


--
-- Name: TABLE resident_access_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.resident_access_requests TO anon;
GRANT ALL ON TABLE public.resident_access_requests TO authenticated;
GRANT ALL ON TABLE public.resident_access_requests TO service_role;


--
-- Name: TABLE sale_comment_read_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_comment_read_state TO service_role;
GRANT SELECT ON TABLE public.sale_comment_read_state TO authenticated;


--
-- Name: TABLE sale_comment_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_comment_receipts TO service_role;
GRANT SELECT ON TABLE public.sale_comment_receipts TO authenticated;


--
-- Name: TABLE sale_comment_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_comment_revisions TO service_role;
GRANT SELECT ON TABLE public.sale_comment_revisions TO authenticated;


--
-- Name: TABLE sale_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_comments TO service_role;
GRANT SELECT ON TABLE public.sale_comments TO authenticated;


--
-- Name: TABLE sale_completion_package_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_completion_package_approvals TO authenticated;
GRANT SELECT ON TABLE public.sale_completion_package_approvals TO service_role;


--
-- Name: TABLE sale_exchange_deposit_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_exchange_deposit_receipts TO authenticated;
GRANT SELECT ON TABLE public.sale_exchange_deposit_receipts TO service_role;


--
-- Name: TABLE sale_exchange_deposit_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_exchange_deposit_sources TO authenticated;
GRANT SELECT ON TABLE public.sale_exchange_deposit_sources TO service_role;


--
-- Name: TABLE sale_further_deposit_deadlines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_further_deposit_deadlines TO authenticated;
GRANT SELECT ON TABLE public.sale_further_deposit_deadlines TO service_role;


--
-- Name: TABLE sale_further_deposit_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_further_deposit_receipts TO authenticated;
GRANT SELECT ON TABLE public.sale_further_deposit_receipts TO service_role;


--
-- Name: TABLE unit_sale_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_attempts TO anon;
GRANT ALL ON TABLE public.unit_sale_attempts TO authenticated;
GRANT ALL ON TABLE public.unit_sale_attempts TO service_role;


--
-- Name: TABLE sale_further_deposit_facts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sale_further_deposit_facts TO authenticated;
GRANT SELECT ON TABLE public.sale_further_deposit_facts TO service_role;


--
-- Name: TABLE sale_legal_emails; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sale_legal_emails TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sale_legal_emails TO authenticated;
GRANT ALL ON TABLE public.sale_legal_emails TO service_role;


--
-- Name: TABLE sale_mention_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_mention_notifications TO service_role;
GRANT SELECT ON TABLE public.sale_mention_notifications TO authenticated;


--
-- Name: TABLE sale_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sale_participants TO service_role;


--
-- Name: TABLE sales_forecast_scenario_units; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sales_forecast_scenario_units TO anon;
GRANT ALL ON TABLE public.sales_forecast_scenario_units TO authenticated;
GRANT ALL ON TABLE public.sales_forecast_scenario_units TO service_role;


--
-- Name: TABLE sales_forecast_scenarios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sales_forecast_scenarios TO anon;
GRANT ALL ON TABLE public.sales_forecast_scenarios TO authenticated;
GRANT ALL ON TABLE public.sales_forecast_scenarios TO service_role;


--
-- Name: TABLE snag_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snag_comments TO anon;
GRANT ALL ON TABLE public.snag_comments TO authenticated;
GRANT ALL ON TABLE public.snag_comments TO service_role;


--
-- Name: TABLE snag_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN ON TABLE public.snag_events TO authenticated;
GRANT SELECT,INSERT,MAINTAIN ON TABLE public.snag_events TO service_role;


--
-- Name: TABLE snag_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snag_photos TO anon;
GRANT ALL ON TABLE public.snag_photos TO authenticated;
GRANT ALL ON TABLE public.snag_photos TO service_role;


--
-- Name: TABLE snag_report_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snag_report_items TO anon;
GRANT ALL ON TABLE public.snag_report_items TO authenticated;
GRANT ALL ON TABLE public.snag_report_items TO service_role;


--
-- Name: TABLE snag_report_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snag_report_recipients TO anon;
GRANT ALL ON TABLE public.snag_report_recipients TO authenticated;
GRANT ALL ON TABLE public.snag_report_recipients TO service_role;


--
-- Name: TABLE snag_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snag_reports TO anon;
GRANT ALL ON TABLE public.snag_reports TO authenticated;
GRANT ALL ON TABLE public.snag_reports TO service_role;


--
-- Name: TABLE snags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snags TO anon;
GRANT ALL ON TABLE public.snags TO authenticated;
GRANT ALL ON TABLE public.snags TO service_role;


--
-- Name: TABLE trades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trades TO anon;
GRANT ALL ON TABLE public.trades TO authenticated;
GRANT ALL ON TABLE public.trades TO service_role;


--
-- Name: TABLE unit_open_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.unit_open_events TO authenticated;
GRANT SELECT ON TABLE public.unit_open_events TO service_role;


--
-- Name: TABLE unit_sale_document_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_document_versions TO anon;
GRANT ALL ON TABLE public.unit_sale_document_versions TO authenticated;
GRANT ALL ON TABLE public.unit_sale_document_versions TO service_role;


--
-- Name: TABLE unit_sale_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_documents TO anon;
GRANT ALL ON TABLE public.unit_sale_documents TO authenticated;
GRANT ALL ON TABLE public.unit_sale_documents TO service_role;


--
-- Name: TABLE unit_sale_invoice_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_invoice_payments TO anon;
GRANT ALL ON TABLE public.unit_sale_invoice_payments TO authenticated;
GRANT ALL ON TABLE public.unit_sale_invoice_payments TO service_role;


--
-- Name: TABLE unit_sale_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_invoices TO anon;
GRANT ALL ON TABLE public.unit_sale_invoices TO authenticated;
GRANT ALL ON TABLE public.unit_sale_invoices TO service_role;


--
-- Name: TABLE unit_sale_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_notes TO anon;
GRANT ALL ON TABLE public.unit_sale_notes TO authenticated;
GRANT ALL ON TABLE public.unit_sale_notes TO service_role;


--
-- Name: TABLE unit_sale_payment_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_payment_schedule TO anon;
GRANT ALL ON TABLE public.unit_sale_payment_schedule TO authenticated;
GRANT ALL ON TABLE public.unit_sale_payment_schedule TO service_role;


--
-- Name: TABLE unit_sale_terms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_sale_terms TO anon;
GRANT ALL ON TABLE public.unit_sale_terms TO authenticated;
GRANT ALL ON TABLE public.unit_sale_terms TO service_role;


--
-- Name: TABLE unit_type_areas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_type_areas TO anon;
GRANT ALL ON TABLE public.unit_type_areas TO authenticated;
GRANT ALL ON TABLE public.unit_type_areas TO service_role;


--
-- Name: TABLE unit_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit_types TO anon;
GRANT ALL ON TABLE public.unit_types TO authenticated;
GRANT ALL ON TABLE public.unit_types TO service_role;


--
-- Name: TABLE user_building_access; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_building_access TO anon;
GRANT ALL ON TABLE public.user_building_access TO authenticated;
GRANT ALL ON TABLE public.user_building_access TO service_role;


--
-- Name: TABLE user_unit_access; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_unit_access TO anon;
GRANT ALL ON TABLE public.user_unit_access TO authenticated;
GRANT ALL ON TABLE public.user_unit_access TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- Auth profile creation and app-owned storage setup (no users or business records).
SET search_path=public;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('snag-images','snag-images',true,null,null);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('snag-reports','snag-reports',false,null,null);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sale-documents','sale-documents',false,10485760,ARRAY['application/pdf']);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('completion-uploads','completion-uploads',false,10485760,ARRAY['application/pdf']);
CREATE POLICY "authenticated users read snag report files" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'snag-reports'::text));
CREATE POLICY "authenticated users upload snag images hardened" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'snag-images'::text));
CREATE POLICY "back office delete snag images hardened" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'snag-images'::text) AND is_back_office_user()));
CREATE POLICY "back office update snag images hardened" ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'snag-images'::text) AND is_back_office_user())) WITH CHECK (((bucket_id = 'snag-images'::text) AND is_back_office_user()));
CREATE POLICY "snag images are publicly readable" ON storage.objects FOR SELECT TO PUBLIC USING ((bucket_id = 'snag-images'::text));

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.sale_event_projection_before_deposit(e unit_sale_workflow_events) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sale_event_projection_before_notice(e unit_sale_workflow_events) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sale_event_projection_before_package(e unit_sale_workflow_events) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_contact_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_contact_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_legal_unit_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_legal_write_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_notice_state_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sales_notice_version_guard() FROM PUBLIC,anon,authenticated;
SET check_function_bodies=true;
SET row_security=on;
