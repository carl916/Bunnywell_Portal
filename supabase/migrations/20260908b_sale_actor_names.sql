-- FINAL replacement for the actor-name migration that has not yet been run.
-- Requires the existing Sales schema and 20260907 discussion/activity migrations.
-- Also works whether or not 20260908_sale_discussion_building_agents.sql ran.
begin;

-- One access rule for Sales RLS, discussions, mentions and historical actors.
-- Explicit-user helpers are private; browser entry points always use auth.uid().
create or replace function public.sales_building_access(p_building uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
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
create or replace function public.can_access_sales_building(target_building_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.sales_building_access(target_building_id,auth.uid())
$$;
create or replace function public.can_access_sale(p_sale_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.unit_sale_attempts a where a.id=p_sale_id
    and public.sales_building_access(a.building_id,p_user_id))
$$;
create or replace function public.can_access_sale_attempt(target_sale_attempt_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_access_sale(target_sale_attempt_id,auth.uid())
$$;
-- Compatibility wrappers for existing discussion RPCs; no assignment checks.
create or replace function public.sale_discussion_candidate(p_sale uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_access_sale(p_sale,p_user)
$$;
create or replace function public.sale_discussion_access(p_sale uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_access_sale(p_sale,p_user)
$$;
create or replace function public.assert_sale_discussion(p_sale uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_access_sale_attempt(p_sale) then
    raise exception 'Sale access denied. Check your building access and account status.' using errcode='42501';
  end if;
end $$;

-- Retain assignment rows as history, but stop creating or changing them.
drop trigger if exists sale_discussion_creator on public.unit_sale_attempts;
drop trigger if exists sale_discussion_submitter on public.unit_sale_attempts;
drop function if exists public.assign_sale_creator();
drop function if exists public.assign_sale_submitter();
drop function if exists public.sale_discussion_assign(uuid,uuid,boolean);
revoke all on public.sale_participants from authenticated,anon;

-- Live mention suggestions use current role/organisation. These are not audit
-- identities. Keep the old optional argument for deployed clients, but ignore it.
create or replace function public.sale_discussion_people(p_sale uuid, p_candidates boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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

-- Resolve only explicit attribution columns on records the viewer may see.
-- Do not inspect arbitrary metadata, accept profile IDs, or require historical
-- actors to retain their old role, active account, building access or assignment.
create or replace function public.sale_actor_names(p_sales uuid[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
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

revoke all on function public.sales_building_access(uuid,uuid),public.can_access_sale(uuid,uuid),
  public.sale_discussion_candidate(uuid,uuid),public.sale_discussion_access(uuid,uuid),public.assert_sale_discussion(uuid)
  from public,anon,authenticated;
grant execute on function public.sales_building_access(uuid,uuid),public.can_access_sale(uuid,uuid),
  public.sale_discussion_candidate(uuid,uuid),public.sale_discussion_access(uuid,uuid),public.assert_sale_discussion(uuid) to service_role;
revoke all on function public.can_access_sales_building(uuid),public.can_access_sale_attempt(uuid),
  public.sale_discussion_people(uuid,boolean),public.sale_actor_names(uuid[]) from public,anon;
grant execute on function public.can_access_sales_building(uuid),public.can_access_sale_attempt(uuid),
  public.sale_discussion_people(uuid,boolean),public.sale_actor_names(uuid[]) to authenticated,service_role;
commit;
